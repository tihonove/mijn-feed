import { describe, expect, it, vi } from "vitest";

import { ApiError } from "../api/apiClient.ts";
import { EventQueue, type StorageLike } from "./eventQueue.ts";

const memoryStorage = (): StorageLike & { data: Map<string, string> } => {
    const data = new Map<string, string>();
    return {
        data,
        getItem: (k) => data.get(k) ?? null,
        setItem: (k, v) => void data.set(k, v),
        removeItem: (k) => void data.delete(k),
    };
};

describe("EventQueue", () => {
    it("sends directly while online", async () => {
        const api = { event: vi.fn().mockResolvedValue({ ok: true, due: 1 }) };
        const q = new EventQueue(api, memoryStorage());
        expect(await q.send("c1", { type: "seen" })).toEqual({ ok: true, due: 1 });
        expect(q.size).toBe(0);
    });

    it("queues on network failure, persists, and replays in order once the network is back", async () => {
        const storage = memoryStorage();
        const api = { event: vi.fn().mockRejectedValue(new TypeError("Failed to fetch")) };
        const q = new EventQueue(api, storage);
        expect(await q.send("c1", { type: "seen" })).toBeNull();
        expect(await q.send("c2", { type: "grade", grade: "good" })).toBeNull();
        expect(q.size).toBe(2);
        expect(JSON.parse(storage.data.get("mijnfeed.pendingEvents") ?? "[]")).toHaveLength(2);

        // a new instance picks the queue up from storage
        api.event.mockResolvedValue({ ok: true });
        const q2 = new EventQueue(api, storage);
        expect(q2.size).toBe(2);
        await q2.flush();
        expect(q2.size).toBe(0);
        expect(api.event.mock.calls.slice(-2).map((c: unknown[]) => c[0])).toEqual(["c1", "c2"]);
        expect(storage.data.has("mijnfeed.pendingEvents")).toBe(false);
    });

    it("drops events the server rejects and rethrows 4xx for direct sends", async () => {
        const api = { event: vi.fn().mockRejectedValue(new ApiError(400, "bad")) };
        const q = new EventQueue(api, null);
        await expect(q.send("c1", { type: "seen" })).rejects.toThrow("bad");
        const flaky = {
            event: vi.fn().mockRejectedValueOnce(new TypeError("net")).mockRejectedValueOnce(new ApiError(404, "gone")),
        };
        const q2 = new EventQueue(flaky, null);
        await q2.send("c1", { type: "seen" });
        expect(q2.size).toBe(1);
        await q2.flush();
        expect(q2.size).toBe(0);
    });

    it("stops flushing at the first network failure and shares one flush at a time", async () => {
        const api = { event: vi.fn().mockRejectedValue(new TypeError("net")) };
        const q = new EventQueue(api, null);
        await q.send("c1", { type: "seen" });
        await q.send("c2", { type: "seen" });
        const a = q.flush();
        const b = q.flush();
        expect(a).toBe(b);
        await a;
        expect(q.size).toBe(2);
    });

    it("survives broken storage", () => {
        const broken: StorageLike = {
            getItem: () => "{not json",
            setItem: () => {
                throw new Error("quota");
            },
            removeItem: () => undefined,
        };
        const q = new EventQueue({ event: vi.fn().mockRejectedValue(new TypeError("net")) }, broken);
        expect(q.size).toBe(0);
        void q.send("c1", { type: "seen" });
    });
});
