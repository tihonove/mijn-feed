// One-shot cards of the non-deck streams (news, facts, …).
import type { ItemInput } from "../../shared/types.ts";
import { ClockDIToken, HOUR, type IClock } from "../clock.ts";
import { DatabaseDIToken, fromJson, type IDatabase, newId, toJson } from "../db/database.ts";
import { token } from "../di/container.ts";
import { HttpError } from "../httpError.ts";

export interface ItemView {
    id: string;
    stream: string;
    kind: string | null;
    html: string;
    audio: string | null;
    meta: Record<string, unknown>;
    tags: string[];
    createdAt: number;
}

export interface IItemService {
    add(stream: string, input: ItemInput): string;
    /** Unexpired items not yet shown (or due for a repeat), freshest first, scored by tag weights. */
    candidates(
        stream: string,
        limit: number,
        options: { freshnessHours: number; tagWeight: (tag: string) => number },
    ): ItemView[];
    get(id: string): ItemView | null;
    markShown(id: string): void;
    streams(): string[];
}

export const ItemServiceDIToken = token<IItemService>("ItemService");

interface ItemRow {
    id: string;
    stream: string;
    kind: string | null;
    html: string;
    audio: string | null;
    meta: string;
    tags: string;
    created_at: number;
}

export class ItemService implements IItemService {
    public static readonly dependencies = [DatabaseDIToken, ClockDIToken] as const;

    private readonly q;

    public constructor(
        db: IDatabase,
        private readonly clock: IClock,
    ) {
        this.q = {
            insert: db.raw.prepare(
                `INSERT INTO items (id, stream, kind, html, audio, meta, tags, expires_at, repeat_after, created_at)
                 VALUES (?,?,?,?,?,?,?,?,?,?)
                 ON CONFLICT(id) DO UPDATE SET kind = excluded.kind, html = excluded.html, audio = excluded.audio,
                 meta = excluded.meta, tags = excluded.tags, expires_at = excluded.expires_at, repeat_after = excluded.repeat_after`,
            ),
            candidates: db.raw.prepare(
                `SELECT id, stream, kind, html, audio, meta, tags, created_at FROM items
                 WHERE stream = ? AND (expires_at IS NULL OR expires_at > ?)
                   AND (shown = 0 OR (repeat_after IS NOT NULL AND last_shown + repeat_after <= ?))
                 ORDER BY created_at DESC LIMIT ?`,
            ),
            get: db.raw.prepare("SELECT id, stream, kind, html, audio, meta, tags, created_at FROM items WHERE id = ?"),
            shown: db.raw.prepare("UPDATE items SET shown = shown + 1, last_shown = ? WHERE id = ?"),
            streams: db.raw.prepare("SELECT DISTINCT stream FROM items ORDER BY stream"),
        };
    }

    public add(stream: string, input: ItemInput): string {
        if (!stream || stream === "nl") throw new HttpError(400, "stream: a non-deck stream name is required");
        if (typeof input.html !== "string" || input.html.length === 0)
            throw new HttpError(400, "item: html is required");
        const id = input.id ?? newId("i_");
        this.q.insert.run(
            id,
            stream,
            input.kind ?? null,
            input.html,
            input.audio ?? null,
            toJson(input.meta ?? {}),
            toJson(input.tags ?? []),
            input.expiresAt ?? null,
            input.repeatAfter ?? null,
            this.clock.now(),
        );
        return id;
    }

    public candidates(
        stream: string,
        limit: number,
        { freshnessHours, tagWeight }: { freshnessHours: number; tagWeight: (tag: string) => number },
    ): ItemView[] {
        const now = this.clock.now();
        const rows = this.q.candidates.all(stream, now, now, limit * 4) as unknown as ItemRow[];
        const scored = rows.map((r) => {
            const item = toView(r);
            const age = (now - r.created_at) / HOUR;
            const freshness = Math.exp(-age / Math.max(1, freshnessHours));
            const weight = item.tags.reduce((w, t) => w * tagWeight(t), 1);
            return { item, score: freshness * weight };
        });
        scored.sort((a, b) => b.score - a.score);
        return scored.slice(0, limit).map((s) => s.item);
    }

    public get(id: string): ItemView | null {
        const row = this.q.get.get(id) as unknown as ItemRow | undefined;
        return row ? toView(row) : null;
    }

    public markShown(id: string): void {
        this.q.shown.run(this.clock.now(), id);
    }

    public streams(): string[] {
        return (this.q.streams.all() as { stream: string }[]).map((r) => r.stream);
    }
}

const toView = (r: ItemRow): ItemView => ({
    id: r.id,
    stream: r.stream,
    kind: r.kind,
    html: r.html,
    audio: r.audio,
    meta: fromJson(r.meta, {}),
    tags: fromJson(r.tags, []),
    createdAt: r.created_at,
});
