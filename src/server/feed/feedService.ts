// The playlist: deck cards and stream items mixed by shares; viewer events routed back to the deck and the mixer.
import type { FeedCard, FeedEvent, FeedEventResult, Grade } from "../../shared/types.ts";
import { ClockDIToken, DAY, type IClock } from "../clock.ts";
import { DatabaseDIToken, type IDatabase, toJson } from "../db/database.ts";
import { builtinPresentation } from "../deck/builtinPresentation.ts";
import { DeckServiceDIToken, type IDeckService, type PickedFacet } from "../deck/deckService.ts";
import { GRADES } from "../deck/scheduler.ts";
import { token } from "../di/container.ts";
import { HttpError } from "../httpError.ts";
import { type IItemService, ItemServiceDIToken } from "../items/itemService.ts";
import { type ISettingsService, SettingsServiceDIToken } from "../settings/settingsService.ts";
import { effectiveShares, mix, type ReactionCounts, reactionWeight } from "./mixer.ts";

export interface IFeedService {
    playlist(limit: number): FeedCard[];
    event(cardId: string, event: FeedEvent): FeedEventResult;
}

export const FeedServiceDIToken = token<IFeedService>("FeedService");

export const DECK_STREAM = "nl";
const EVENT_TYPES = new Set(["seen", "grade", "answer", "skip", "boring", "more"]);

type CardRef = { stream: "nl"; facetId: string; presentationId: string | null } | { stream: "item"; itemId: string };

export function parseCardId(id: string, deck: Pick<IDeckService, "facetOfPresentation">): CardRef {
    if (id.startsWith("nl:facet:")) return { stream: "nl", facetId: id.slice(9), presentationId: null };
    if (id.startsWith("nl:")) {
        const presentationId = id.slice(3);
        const facetId = deck.facetOfPresentation(presentationId);
        if (!facetId) throw new HttpError(404, "unknown card");
        return { stream: "nl", facetId, presentationId };
    }
    if (id.startsWith("item:")) return { stream: "item", itemId: id.slice(5) };
    throw new HttpError(400, "bad card id");
}

export class FeedService implements IFeedService {
    public static readonly dependencies = [
        DatabaseDIToken,
        ClockDIToken,
        SettingsServiceDIToken,
        DeckServiceDIToken,
        ItemServiceDIToken,
    ] as const;

    private readonly q;

    public constructor(
        db: IDatabase,
        private readonly clock: IClock,
        private readonly settings: ISettingsService,
        private readonly deck: IDeckService,
        private readonly items: IItemService,
    ) {
        this.q = {
            insertEvent: db.raw.prepare("INSERT INTO events (card_id, stream, type, payload, ts) VALUES (?,?,?,?,?)"),
            streamReactions: db.raw.prepare(
                "SELECT stream, type, COUNT(*) AS n FROM events WHERE ts >= ? AND type IN ('more','boring') GROUP BY stream, type",
            ),
            tagReactions: db.raw.prepare(
                `SELECT j.value AS tag, e.type, COUNT(*) AS n FROM events e, json_each(e.payload, '$.tags') j
                 WHERE e.ts >= ? AND e.type IN ('more','boring') GROUP BY tag, e.type`,
            ),
        };
    }

    public playlist(limit: number): FeedCard[] {
        const s = this.settings.get();
        const since = this.clock.now() - s.mixer.reactionWindowDays * DAY;
        const streamReactions = this.reactions(
            this.q.streamReactions.all(since) as { stream: string; type: string; n: number }[],
            "stream",
        );
        const tagReactions = this.reactions(
            this.q.tagReactions.all(since) as { tag: string; type: string; n: number }[],
            "tag",
        );
        const tagWeight = (tag: string) => reactionWeight(tagReactions[tag], s.mixer.reactionStep);

        const shares = effectiveShares({
            shares: Object.fromEntries(Object.entries(s.streams).map(([k, v]) => [k, v.share])),
            modes: s.modes,
            reactions: streamReactions,
            step: s.mixer.reactionStep,
        });
        const candidates: Record<string, FeedCard[]> = {};
        if ((shares[DECK_STREAM] ?? 0) > 0) {
            candidates[DECK_STREAM] = this.deck.pick(limit).map((f) => this.deckCard(f));
        }
        for (const stream of Object.keys(shares)) {
            if (stream === DECK_STREAM) continue;
            candidates[stream] = this.items
                .candidates(stream, limit, { freshnessHours: s.mixer.freshnessHours, tagWeight })
                .map((i) => ({
                    id: `item:${i.id}`,
                    stream,
                    kind: i.kind,
                    html: i.html,
                    audio: i.audio,
                    meta: { ...i.meta, tags: i.tags },
                }));
        }
        return mix({ candidates, shares, maxRun: s.mixer.maxRun, limit }).map((m) => m.item);
    }

    public event(cardId: string, event: FeedEvent): FeedEventResult {
        if (!EVENT_TYPES.has(event.type)) throw new HttpError(400, "event.type: seen|grade|answer|skip|boring|more");
        const ref = parseCardId(cardId, this.deck);
        const now = this.clock.now();
        const result: FeedEventResult = { ok: true };
        let tags: string[] = [];
        if (ref.stream === "nl") {
            if (event.type === "seen" && ref.presentationId) this.deck.markShown(ref.presentationId);
            const grade = this.gradeOf(event);
            if (grade) {
                const g = this.deck.grade(ref.facetId, grade);
                result.due = g.due;
                result.state = g.state;
            }
        } else {
            const item = this.items.get(ref.itemId);
            if (!item) throw new HttpError(404, "unknown card");
            tags = item.tags;
            if (event.type === "seen") this.items.markShown(ref.itemId);
        }
        const stream = ref.stream === "nl" ? DECK_STREAM : (this.items.get(ref.itemId)?.stream ?? "item");
        this.q.insertEvent.run(
            cardId,
            stream,
            event.type,
            toJson({ grade: event.grade, correct: event.correct, tags }),
            now,
        );
        return result;
    }

    private gradeOf(event: FeedEvent): Grade | null {
        if (event.type === "grade") {
            if (!event.grade || !GRADES.includes(event.grade)) throw new HttpError(400, "grade: again|hard|good|easy");
            return event.grade;
        }
        if (event.type === "answer") {
            if (typeof event.correct !== "boolean") throw new HttpError(400, "answer: correct must be boolean");
            return event.correct ? "good" : "again";
        }
        return null;
    }

    private deckCard(f: PickedFacet): FeedCard {
        const p = f.presentation;
        return {
            id: p ? `nl:${p.id}` : `nl:facet:${f.id}`,
            stream: DECK_STREAM,
            kind: f.note.kind,
            html: p ? p.html : builtinPresentation(f),
            audio: p?.audio ?? null,
            meta: {
                ...(p?.meta ?? {}),
                facet: f.facet,
                facetId: f.id,
                noteId: f.noteId,
                isNew: f.isNew,
                state: f.state,
                tags: f.note.tags,
                builtin: p === null,
            },
            grades: f.grades,
        };
    }

    private reactions<K extends string>(
        rows: (Record<K, string> & { type: string; n: number })[],
        key: K,
    ): Record<string, ReactionCounts> {
        const out: Record<string, ReactionCounts> = {};
        for (const r of rows) {
            const name = r[key];
            const counts: ReactionCounts = out[name] ?? { more: 0, boring: 0 };
            out[name] = counts;
            if (r.type === "more") counts.more += r.n;
            else counts.boring += r.n;
        }
        return out;
    }
}
