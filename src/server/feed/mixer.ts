// Pure playlist mixing: fill slots by stream share deficit, never more than maxRun of one stream in a row.

export interface MixInput<T> {
    /** Candidates per stream, best first. */
    candidates: Record<string, T[]>;
    /** Effective share per stream (0 = excluded). */
    shares: Record<string, number>;
    maxRun: number;
    limit: number;
}

export function mix<T>({ candidates, shares, maxRun, limit }: MixInput<T>): { stream: string; item: T }[] {
    const queues = new Map<string, T[]>();
    for (const [stream, list] of Object.entries(candidates)) {
        if ((shares[stream] ?? 0) > 0 && list.length > 0) queues.set(stream, [...list]);
    }
    const out: { stream: string; item: T }[] = [];
    const taken = new Map<string, number>();
    while (out.length < limit && queues.size > 0) {
        const total = [...queues.keys()].reduce((a, s) => a + (shares[s] ?? 0), 0);
        const run = runLength(out);
        let best: string | null = null;
        let bestDeficit = -Infinity;
        for (const stream of queues.keys()) {
            if (run.stream === stream && run.length >= maxRun && queues.size > 1) continue;
            const target = ((shares[stream] ?? 0) / total) * (out.length + 1);
            const deficit = target - (taken.get(stream) ?? 0);
            if (deficit > bestDeficit) {
                bestDeficit = deficit;
                best = stream;
            }
        }
        if (best === null) break;
        const queue = queues.get(best) ?? [];
        const item = queue.shift() as T;
        if (queue.length === 0) queues.delete(best);
        taken.set(best, (taken.get(best) ?? 0) + 1);
        out.push({ stream: best, item });
    }
    return out;
}

function runLength(out: { stream: string }[]): { stream: string | null; length: number } {
    const last = out.at(-1);
    if (!last) return { stream: null, length: 0 };
    let n = 0;
    for (let i = out.length - 1; i >= 0 && out[i]?.stream === last.stream; i--) n++;
    return { stream: last.stream, length: n };
}

export interface ReactionCounts {
    more: number;
    boring: number;
}

/** Multiplier from recent reactions: each "more" raises, each "boring" lowers, clamped to [0.2, 3]. */
export function reactionWeight(counts: ReactionCounts | undefined, step: number): number {
    if (!counts) return 1;
    const w = 1 + step * (counts.more - counts.boring);
    return Math.min(3, Math.max(0.2, w));
}

export interface EffectiveSharesInput {
    shares: Record<string, number>;
    modes: { onlyStream: string | null; mutedStreams: string[] };
    reactions: Record<string, ReactionCounts>;
    step: number;
}

export function effectiveShares({ shares, modes, reactions, step }: EffectiveSharesInput): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [stream, share] of Object.entries(shares)) {
        if (modes.onlyStream !== null && modes.onlyStream !== stream) continue;
        if (modes.mutedStreams.includes(stream)) continue;
        out[stream] = share * reactionWeight(reactions[stream], step);
    }
    return out;
}
