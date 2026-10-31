import { describe, expect, it } from "vitest";

import { effectiveShares, mix, reactionWeight } from "./mixer.ts";

const list = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${i}`);

describe("mix", () => {
    it("keeps stream proportions close to the shares", () => {
        const out = mix({
            candidates: { nl: list("n", 50), news: list("w", 50), facts: list("f", 50) },
            shares: { nl: 60, news: 25, facts: 15 },
            maxRun: 3,
            limit: 20,
        });
        const count = (s: string) => out.filter((o) => o.stream === s).length;
        expect(out).toHaveLength(20);
        expect(count("nl")).toBe(12);
        expect(count("news")).toBe(5);
        expect(count("facts")).toBe(3);
        expect(out.map((o) => o.item)).toContain("n0");
        expect(out.filter((o) => o.stream === "nl").map((o) => o.item)).toEqual(list("n", 12));
    });

    it("never exceeds maxRun of one stream while another has candidates", () => {
        const out = mix({
            candidates: { a: list("a", 30), b: list("b", 30) },
            shares: { a: 95, b: 5 },
            maxRun: 2,
            limit: 12,
        });
        let run = 0;
        let prev = "";
        for (const o of out) {
            run = o.stream === prev ? run + 1 : 1;
            prev = o.stream;
            expect(run).toBeLessThanOrEqual(2);
        }
        expect(out.filter((o) => o.stream === "b")).toHaveLength(4);
        // once the minority stream is exhausted the majority may run on
        const tail = mix({
            candidates: { a: list("a", 30), b: list("b", 1) },
            shares: { a: 95, b: 5 },
            maxRun: 2,
            limit: 6,
        });
        expect(tail.map((o) => o.stream)).toEqual(["a", "a", "b", "a", "a", "a"]);
    });

    it("skips excluded and empty streams and stops when everything is exhausted", () => {
        const out = mix({
            candidates: { a: list("a", 2), b: list("b", 5), c: [] },
            shares: { a: 1, b: 0 },
            maxRun: 3,
            limit: 10,
        });
        expect(out.map((o) => o.item)).toEqual(["a0", "a1"]);
        expect(mix({ candidates: {}, shares: {}, maxRun: 3, limit: 5 })).toEqual([]);
    });
});

describe("reactionWeight / effectiveShares", () => {
    it("moves the weight by reactions within bounds", () => {
        expect(reactionWeight(undefined, 0.15)).toBe(1);
        expect(reactionWeight({ more: 2, boring: 0 }, 0.15)).toBeCloseTo(1.3);
        expect(reactionWeight({ more: 0, boring: 100 }, 0.15)).toBe(0.2);
        expect(reactionWeight({ more: 100, boring: 0 }, 0.15)).toBe(3);
    });

    it("applies quick modes and reactions to shares", () => {
        const shares = { nl: 60, news: 25, facts: 15 };
        expect(
            effectiveShares({ shares, modes: { onlyStream: "nl", mutedStreams: [] }, reactions: {}, step: 0.15 }),
        ).toEqual({ nl: 60 });
        expect(
            effectiveShares({
                shares,
                modes: { onlyStream: null, mutedStreams: ["news"] },
                reactions: { facts: { more: 0, boring: 2 } },
                step: 0.15,
            }),
        ).toEqual({ nl: 60, facts: 15 * 0.7 });
    });
});
