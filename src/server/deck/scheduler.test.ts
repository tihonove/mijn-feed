import { describe, expect, it } from "vitest";

import { DAY, MINUTE } from "../clock.ts";
import { FsrsScheduler, reviveCard } from "./scheduler.ts";

const params = { requestRetention: 0.9, maximumInterval: 365, learningSteps: ["1m", "10m"], relearningSteps: ["10m"] };
const t0 = Date.parse("2026-10-31T10:00:00Z");

describe("FsrsScheduler", () => {
    it("follows learning steps and then schedules in days", () => {
        const s = new FsrsScheduler(false);
        const c0 = s.emptyCard(t0);
        const { card: c1 } = s.next(c0, t0, "good", params);
        expect(c1.due.getTime() - t0).toBe(10 * MINUTE);
        const { card: c2 } = s.next(c1, c1.due.getTime(), "good", params);
        expect(c2.due.getTime() - c1.due.getTime()).toBeGreaterThanOrEqual(DAY);
        const preview = s.preview(c2, c2.due.getTime(), params);
        expect(preview.again).toBeLessThan(preview.hard);
        expect(preview.hard).toBeLessThan(preview.good);
        expect(preview.good).toBeLessThan(preview.easy);
    });

    it("caps the interval at maximumInterval", () => {
        const s = new FsrsScheduler(false);
        let card = s.emptyCard(t0);
        let now = t0;
        for (let i = 0; i < 30; i++) {
            card = s.next(card, now, "good", { ...params, maximumInterval: 30 }).card;
            now = card.due.getTime();
        }
        // FSRS keeps hard < good < easy after clamping, so "good" may land one day past the cap.
        expect(card.scheduled_days).toBeLessThanOrEqual(31);
    });

    it("revives dates after a JSON round-trip", () => {
        const s = new FsrsScheduler(false);
        const card = s.next(s.emptyCard(t0), t0, "good", params).card;
        const revived = reviveCard(JSON.parse(JSON.stringify(card)));
        expect(revived.due).toBeInstanceOf(Date);
        expect(revived.due.getTime()).toBe(card.due.getTime());
        expect(revived.last_review?.getTime()).toBe(t0);
        expect(reviveCard(JSON.parse(JSON.stringify(s.emptyCard(t0)))).last_review).toBeUndefined();
    });
});
