// Viewer events go to the server right away; when offline they wait in localStorage and are replayed in order.
import type { FeedEvent, FeedEventResult } from "../../shared/types.ts";
import { ApiError, type IApiClient } from "../api/apiClient.ts";

interface Pending {
    cardId: string;
    event: FeedEvent;
    ts: number;
}

export interface StorageLike {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}

const KEY = "mijnfeed.pendingEvents";

export class EventQueue {
    private pending: Pending[] = [];
    private flushing: Promise<void> | null = null;

    public constructor(
        private readonly api: Pick<IApiClient, "event">,
        private readonly storage: StorageLike | null,
        private readonly now: () => number = () => Date.now(),
    ) {
        this.pending = this.load();
    }

    public get size(): number {
        return this.pending.length;
    }

    /** Resolves with the server result, or null when the event had to be queued. */
    public async send(cardId: string, event: FeedEvent): Promise<FeedEventResult | null> {
        if (this.pending.length > 0) {
            this.enqueue(cardId, event);
            void this.flush();
            return null;
        }
        try {
            return await this.api.event(cardId, event);
        } catch (e) {
            if (e instanceof ApiError && e.status >= 400 && e.status < 500) throw e; // our bug, not the network
            this.enqueue(cardId, event);
            return null;
        }
    }

    /** Replays queued events; stops at the first network failure, drops events the server rejects. */
    public flush(): Promise<void> {
        this.flushing ??= this.doFlush().finally(() => {
            this.flushing = null;
        });
        return this.flushing;
    }

    private async doFlush(): Promise<void> {
        while (this.pending.length > 0) {
            const next = this.pending[0];
            if (!next) break;
            try {
                await this.api.event(next.cardId, next.event);
            } catch (e) {
                if (!(e instanceof ApiError && e.status >= 400 && e.status < 500)) return;
            }
            this.pending.shift();
            this.save();
        }
    }

    private enqueue(cardId: string, event: FeedEvent): void {
        this.pending.push({ cardId, event, ts: this.now() });
        this.save();
    }

    private load(): Pending[] {
        try {
            const raw = this.storage?.getItem(KEY);
            const list = raw ? (JSON.parse(raw) as unknown) : [];
            return Array.isArray(list) ? (list as Pending[]) : [];
        } catch {
            return [];
        }
    }

    private save(): void {
        try {
            if (this.pending.length === 0) this.storage?.removeItem(KEY);
            else this.storage?.setItem(KEY, JSON.stringify(this.pending));
        } catch {
            /* storage unavailable: keep in memory */
        }
    }
}
