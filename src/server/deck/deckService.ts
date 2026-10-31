// The nl deck: notes → facets (Anki cards) → presentations. Scheduling by FSRS.
import { State } from "ts-fsrs";

const NEW_STATE: number = State.New;

import type {
    DeckState,
    DeckStats,
    FacetState,
    Grade,
    NoteInput,
    NoteResult,
    PresentationInput,
    UpcomingFacet,
} from "../../shared/types.ts";
import { ClockDIToken, DAY, type IClock } from "../clock.ts";
import { DatabaseDIToken, fromJson, type IDatabase, newId, toJson } from "../db/database.ts";
import { token } from "../di/container.ts";
import { HttpError } from "../httpError.ts";
import { type ISettingsService, SettingsServiceDIToken } from "../settings/settingsService.ts";
import { dayStart } from "./dayStart.ts";
import { type Card, type IScheduler, reviveCard, SchedulerDIToken, schedulerParams, STATE_NAMES } from "./scheduler.ts";

export interface NoteView {
    kind: string;
    fields: Record<string, unknown>;
    tags: string[];
    level: string | null;
}

export interface PresentationView {
    id: string;
    html: string;
    audio: string | null;
    meta: Record<string, unknown>;
    shown: number;
}

/** A facet chosen for display with its note and (if any) the presentation to use. */
export interface PickedFacet {
    id: string;
    noteId: string;
    facet: string;
    state: FacetState;
    due: number;
    isNew: boolean;
    note: NoteView;
    presentation: PresentationView | null;
    grades: Record<Grade, number>;
}

export interface GradeResult {
    facetId: string;
    state: FacetState;
    due: number;
    scheduledDays: number;
    suspended: boolean;
}

export interface DayCounts {
    dayStart: number;
    newDone: number;
    reviewsDone: number;
    newLeft: number;
    reviewsLeft: number;
}

export interface IDeckService {
    addNote(input: NoteInput): NoteResult;
    addPresentation(facetId: string, input: PresentationInput): string;
    counts(): DayCounts;
    /** What to show now: due reviews first, new cards interleaved evenly; respects daily caps and sibling burying. */
    pick(limit: number): PickedFacet[];
    markShown(presentationId: string): void;
    grade(facetId: string, grade: Grade): GradeResult;
    facetOfPresentation(presentationId: string): string | null;
    state(): DeckState;
    stats(): DeckStats;
}

export const DeckServiceDIToken = token<IDeckService>("DeckService");

interface FacetRow {
    id: string;
    note_id: string;
    facet: string;
    card: string;
    state: number;
    due: number;
    suspended: number;
    note_kind: string;
    fields: string;
    tags: string;
    level: string | null;
}

interface PresentationRow {
    id: string;
    facet_id: string;
    html: string;
    audio: string | null;
    meta: string;
    shown: number;
}

const FACET_SELECT =
    "SELECT f.*, n.kind AS note_kind, n.fields, n.tags, n.level FROM facets f JOIN notes n ON n.id = f.note_id";

export class DeckService implements IDeckService {
    public static readonly dependencies = [
        DatabaseDIToken,
        ClockDIToken,
        SettingsServiceDIToken,
        SchedulerDIToken,
    ] as const;

    private readonly q;

    public constructor(
        private readonly db: IDatabase,
        private readonly clock: IClock,
        private readonly settings: ISettingsService,
        private readonly scheduler: IScheduler,
    ) {
        const raw = db.raw;
        this.q = {
            upsertNote: raw.prepare(
                `INSERT INTO notes (id, kind, fields, tags, level, created_at, updated_at) VALUES (?,?,?,?,?,?,?)
                 ON CONFLICT(id) DO UPDATE SET kind = excluded.kind, fields = excluded.fields, tags = excluded.tags,
                 level = excluded.level, updated_at = excluded.updated_at`,
            ),
            facetByKey: raw.prepare("SELECT id FROM facets WHERE note_id = ? AND facet = ?"),
            facet: raw.prepare("SELECT * FROM facets WHERE id = ?"),
            insertFacet: raw.prepare(
                "INSERT INTO facets (id, note_id, facet, card, state, due, created_at) VALUES (?,?,?,?,?,?,?)",
            ),
            updateFacet: raw.prepare("UPDATE facets SET card = ?, state = ?, due = ?, suspended = ? WHERE id = ?"),
            insertPresentation: raw.prepare(
                "INSERT INTO presentations (id, facet_id, html, audio, meta, created_at) VALUES (?,?,?,?,?,?)",
            ),
            presentationFacet: raw.prepare("SELECT facet_id FROM presentations WHERE id = ?"),
            bestPresentation: raw.prepare(
                `SELECT id, facet_id, html, audio, meta, shown FROM presentations WHERE facet_id = ?
                 ORDER BY shown ASC, COALESCE(last_shown, 0) ASC, created_at ASC LIMIT 1`,
            ),
            presentationShown: raw.prepare("UPDATE presentations SET shown = shown + 1, last_shown = ? WHERE id = ?"),
            due: raw.prepare(
                `${FACET_SELECT} WHERE f.suspended = 0 AND f.state != 0 AND f.due <= ? ORDER BY f.due ASC LIMIT ?`,
            ),
            newAdded: raw.prepare(
                `${FACET_SELECT} WHERE f.suspended = 0 AND f.state = 0 ORDER BY f.created_at ASC, f.rowid ASC LIMIT ?`,
            ),
            newRandom: raw.prepare(`${FACET_SELECT} WHERE f.suspended = 0 AND f.state = 0 ORDER BY RANDOM() LIMIT ?`),
            newLevel: raw.prepare(
                `${FACET_SELECT} WHERE f.suspended = 0 AND f.state = 0 ORDER BY n.level ASC NULLS LAST, f.created_at ASC, f.rowid ASC LIMIT ?`,
            ),
            insertReview: raw.prepare(
                "INSERT INTO reviews (facet_id, rating, ts, state_before, due_before, log) VALUES (?,?,?,?,?,?)",
            ),
            reviewsToday: raw.prepare(
                "SELECT state_before, COUNT(*) AS n FROM reviews WHERE ts >= ? GROUP BY state_before",
            ),
            notesReviewedToday: raw.prepare(
                "SELECT DISTINCT f.note_id FROM reviews r JOIN facets f ON f.id = r.facet_id WHERE r.ts >= ?",
            ),
            lapses: raw.prepare("SELECT COUNT(*) AS n FROM reviews WHERE facet_id = ? AND rating = 1"),
            count: (sql: string) => raw.prepare(`SELECT COUNT(*) AS n ${sql}`),
        };
    }

    public addNote(input: NoteInput): NoteResult {
        if (!input.kind || typeof input.fields !== "object")
            throw new HttpError(400, "note: kind and fields are required");
        const now = this.clock.now();
        const id = input.id ?? newId("n_");
        return this.db.transaction(() => {
            this.q.upsertNote.run(
                id,
                input.kind,
                toJson(input.fields),
                toJson(input.tags ?? []),
                input.level ?? null,
                now,
                now,
            );
            const facets: NoteResult["facets"] = [];
            for (const f of input.facets ?? []) {
                if (!f.facet) throw new HttpError(400, "facet: name is required");
                let facetId = (this.q.facetByKey.get(id, f.facet) as { id: string } | undefined)?.id;
                if (facetId === undefined) {
                    const card = this.scheduler.emptyCard(now);
                    facetId = newId("f_");
                    this.q.insertFacet.run(facetId, id, f.facet, toJson(card), card.state, now, now);
                }
                const presentations = (f.presentations ?? []).map((p) => this.insertPresentation(facetId, p, now));
                facets.push({ id: facetId, facet: f.facet, presentations });
            }
            return { id, facets };
        });
    }

    public addPresentation(facetId: string, input: PresentationInput): string {
        if (!this.q.facet.get(facetId)) throw new HttpError(404, "facet not found");
        return this.insertPresentation(facetId, input, this.clock.now());
    }

    public counts(): DayCounts {
        const deck = this.settings.get().deck;
        const start = dayStart(this.clock.now(), deck.dayStartHour, deck.timezone);
        const rows = this.q.reviewsToday.all(start) as { state_before: number; n: number }[];
        const newDone = rows.filter((r) => r.state_before === NEW_STATE).reduce((a, r) => a + r.n, 0);
        const reviewsDone = rows.filter((r) => r.state_before !== NEW_STATE).reduce((a, r) => a + r.n, 0);
        return {
            dayStart: start,
            newDone,
            reviewsDone,
            newLeft: Math.max(0, deck.newPerDay - newDone),
            reviewsLeft: Math.max(0, deck.reviewsPerDay - reviewsDone),
        };
    }

    public pick(limit: number): PickedFacet[] {
        const now = this.clock.now();
        const deck = this.settings.get().deck;
        const counts = this.counts();
        const buried = new Set<string>(
            deck.burySiblings
                ? (this.q.notesReviewedToday.all(counts.dayStart) as { note_id: string }[]).map((r) => r.note_id)
                : [],
        );
        const take = (rows: FacetRow[], max: number): FacetRow[] => {
            const out: FacetRow[] = [];
            for (const r of rows) {
                if (out.length >= max) break;
                if (deck.burySiblings) {
                    if (buried.has(r.note_id)) continue;
                    buried.add(r.note_id);
                }
                out.push(r);
            }
            return out;
        };
        const reviewMax = Math.min(limit, counts.reviewsLeft);
        const reviews = take(this.q.due.all(now, reviewMax * 3 + 10) as unknown as FacetRow[], reviewMax);
        const newMax = Math.min(limit - reviews.length, counts.newLeft);
        const newQuery = { added: this.q.newAdded, random: this.q.newRandom, level: this.q.newLevel }[deck.newOrder];
        const fresh = take(newQuery.all(newMax * 3 + 10) as unknown as FacetRow[], newMax);
        return interleave(reviews, fresh).map((row) => this.toPicked(row, now));
    }

    public markShown(presentationId: string): void {
        this.q.presentationShown.run(this.clock.now(), presentationId);
    }

    public grade(facetId: string, grade: Grade): GradeResult {
        const now = this.clock.now();
        const row = this.q.facet.get(facetId) as FacetRow | undefined;
        if (!row) throw new HttpError(404, "facet not found");
        const deck = this.settings.get().deck;
        const before = reviveCard(fromJson<unknown>(row.card, {}));
        const { card, log } = this.scheduler.next(before, now, grade, schedulerParams(deck));
        let suspended = row.suspended;
        if (grade === "again" && deck.leechThreshold > 0) {
            const lapses = (this.q.lapses.get(facetId) as { n: number }).n + 1;
            if (lapses >= deck.leechThreshold) suspended = 1; // leech: park it until a human looks
        }
        this.db.transaction(() => {
            this.q.updateFacet.run(toJson(card), card.state, card.due.getTime(), suspended, facetId);
            this.q.insertReview.run(facetId, log.rating, now, before.state, before.due.getTime(), toJson(log));
        });
        return {
            facetId,
            state: STATE_NAMES[card.state] ?? "new",
            due: card.due.getTime(),
            scheduledDays: card.scheduled_days,
            suspended: suspended === 1,
        };
    }

    public facetOfPresentation(presentationId: string): string | null {
        return (this.q.presentationFacet.get(presentationId) as { facet_id: string } | undefined)?.facet_id ?? null;
    }

    public state(): DeckState {
        const now = this.clock.now();
        const raw = this.db.raw;
        const upcoming = (
            raw
                .prepare(
                    `SELECT f.id, f.note_id, f.facet, f.due, f.state, n.kind, n.fields, n.tags, n.level,
                        (SELECT COUNT(*) FROM presentations p WHERE p.facet_id = f.id) AS presentations,
                        (SELECT COUNT(*) FROM presentations p WHERE p.facet_id = f.id AND p.shown = 0) AS unseen
                     FROM facets f JOIN notes n ON n.id = f.note_id
                     WHERE f.suspended = 0 AND f.due <= ? ORDER BY f.due ASC LIMIT 200`,
                )
                .all(now + 7 * DAY) as unknown as (FacetRow & { kind: string; presentations: number; unseen: number })[]
        ).map((r): UpcomingFacet => ({
            facetId: r.id,
            noteId: r.note_id,
            facet: r.facet,
            due: r.due,
            state: STATE_NAMES[r.state] ?? "new",
            kind: r.kind,
            fields: fromJson(r.fields, {}),
            tags: fromJson(r.tags, []),
            level: r.level,
            presentations: r.presentations,
            unseen: r.unseen,
        }));
        const tags: Record<string, number> = {};
        for (const r of raw.prepare("SELECT tags FROM notes").all() as { tags: string }[]) {
            for (const t of fromJson<string[]>(r.tags, [])) tags[t] = (tags[t] ?? 0) + 1;
        }
        const byKind = Object.fromEntries(
            (
                raw.prepare("SELECT kind, COUNT(*) AS n FROM notes GROUP BY kind").all() as {
                    kind: string;
                    n: number;
                }[]
            ).map((r) => [r.kind, r.n]),
        );
        const byState: Partial<Record<FacetState, number>> = {};
        for (const r of raw
            .prepare("SELECT state, COUNT(*) AS n FROM facets WHERE suspended = 0 GROUP BY state")
            .all() as {
            state: number;
            n: number;
        }[]) {
            byState[STATE_NAMES[r.state] ?? "new"] = r.n;
        }
        const recent = (
            raw
                .prepare(
                    `SELECT n.kind, f.facet, p.last_shown FROM presentations p JOIN facets f ON f.id = p.facet_id
                     JOIN notes n ON n.id = f.note_id WHERE p.last_shown IS NOT NULL ORDER BY p.last_shown DESC LIMIT 20`,
                )
                .all() as { kind: string; facet: string; last_shown: number }[]
        ).map((r) => ({ kind: r.kind, facet: r.facet, lastShown: r.last_shown }));
        const leeches = (
            raw
                .prepare(
                    "SELECT f.id, f.note_id, f.facet, n.fields FROM facets f JOIN notes n ON n.id = f.note_id WHERE f.suspended = 1",
                )
                .all() as { id: string; note_id: string; facet: string; fields: string }[]
        ).map((r) => ({ facetId: r.id, noteId: r.note_id, facet: r.facet, fields: fromJson(r.fields, {}) }));
        const notes = (
            raw.prepare("SELECT id, kind, level, tags FROM notes ORDER BY created_at").all() as {
                id: string;
                kind: string;
                level: string | null;
                tags: string;
            }[]
        ).map((r) => ({ id: r.id, kind: r.kind, level: r.level, tags: fromJson<string[]>(r.tags, []) }));
        const c = this.counts();
        return {
            now,
            counts: { newDone: c.newDone, reviewsDone: c.reviewsDone, newLeft: c.newLeft, reviewsLeft: c.reviewsLeft },
            upcoming,
            needPresentations: upcoming.filter((u) => u.unseen === 0),
            tags,
            byKind,
            byState,
            recent,
            leeches,
            notes,
            settings: this.settings.get().deck,
        };
    }

    public stats(): DeckStats {
        const now = this.clock.now();
        const counts = this.counts();
        const n = (sql: string, ...args: number[]): number => (this.q.count(sql).get(...args) as { n: number }).n;
        const dueNow = n("FROM facets WHERE suspended = 0 AND state != 0 AND due <= ?", now);
        const newAvailable = n("FROM facets WHERE suspended = 0 AND state = 0");
        const forecast: DeckStats["forecast"] = [];
        for (let i = 0; i < 14; i++) {
            const a = counts.dayStart + i * DAY;
            forecast.push({
                day: new Date(a).toISOString().slice(0, 10),
                due: n(
                    "FROM facets WHERE suspended = 0 AND state != 0 AND due >= ? AND due < ?",
                    i === 0 ? 0 : a,
                    a + DAY,
                ),
            });
        }
        const monthAgo = now - 30 * DAY;
        const rr = this.db.raw
            .prepare("SELECT SUM(rating > 1) AS ok, COUNT(*) AS n FROM reviews WHERE ts >= ? AND state_before = 2")
            .get(monthAgo) as { ok: number | null; n: number };
        const perDay = new Array<number>(30).fill(0);
        for (const r of this.db.raw.prepare("SELECT ts FROM reviews WHERE ts >= ?").all(monthAgo) as { ts: number }[]) {
            const i = Math.min(29, Math.floor((r.ts - monthAgo) / DAY));
            perDay[i] = (perDay[i] ?? 0) + 1;
        }
        return {
            today: {
                dueNow,
                newLeft: Math.min(counts.newLeft, newAvailable),
                newDone: counts.newDone,
                reviewsDone: counts.reviewsDone,
            },
            forecast,
            retention30d: rr.n > 0 ? (rr.ok ?? 0) / rr.n : null,
            cards: {
                new: newAvailable,
                learning: n("FROM facets WHERE suspended = 0 AND state IN (1, 3)"),
                young: n(
                    "FROM facets WHERE suspended = 0 AND state = 2 AND json_extract(card, '$.scheduled_days') < 21",
                ),
                mature: n(
                    "FROM facets WHERE suspended = 0 AND state = 2 AND json_extract(card, '$.scheduled_days') >= 21",
                ),
                suspended: n("FROM facets WHERE suspended = 1"),
            },
            reviewsPerDay30d: perDay,
            notes: n("FROM notes"),
        };
    }

    private insertPresentation(facetId: string, input: PresentationInput, now: number): string {
        if (typeof input.html !== "string" || input.html.length === 0)
            throw new HttpError(400, "presentation: html is required");
        const id = input.id ?? newId("p_");
        this.q.insertPresentation.run(id, facetId, input.html, input.audio ?? null, toJson(input.meta ?? {}), now);
        return id;
    }

    private toPicked(row: FacetRow, now: number): PickedFacet {
        const card: Card = reviveCard(fromJson<unknown>(row.card, {}));
        const p = this.q.bestPresentation.get(row.id) as PresentationRow | undefined;
        return {
            id: row.id,
            noteId: row.note_id,
            facet: row.facet,
            state: STATE_NAMES[row.state] ?? "new",
            due: row.due,
            isNew: row.state === NEW_STATE,
            note: {
                kind: row.note_kind,
                fields: fromJson(row.fields, {}),
                tags: fromJson(row.tags, []),
                level: row.level,
            },
            presentation: p
                ? { id: p.id, html: p.html, audio: p.audio, meta: fromJson(p.meta, {}), shown: p.shown }
                : null,
            grades: this.scheduler.preview(card, now, schedulerParams(this.settings.get().deck)),
        };
    }
}

/** Spreads `fresh` evenly between `reviews`, keeping each list's order. */
export function interleave<T>(reviews: T[], fresh: T[]): T[] {
    if (fresh.length === 0) return [...reviews];
    if (reviews.length === 0) return [...fresh];
    const total = reviews.length + fresh.length;
    const step = total / fresh.length;
    const out: T[] = [];
    let ri = 0;
    let fi = 0;
    for (let i = 0; i < total; i++) {
        const wantFresh = fi < fresh.length && i + 1 >= Math.round((fi + 1) * step);
        if (wantFresh || ri >= reviews.length) out.push(fresh[fi++] as T);
        else out.push(reviews[ri++] as T);
    }
    return out;
}
