import { describe, expect, it } from "vitest";

import { dayStart } from "./dayStart.ts";

describe("dayStart", () => {
    it("starts the deck day at the given hour in the zone; before that hour it is yesterday", () => {
        // Amsterdam is UTC+1 in late October (after DST ends on Oct 25, 2026).
        expect(new Date(dayStart(Date.parse("2026-10-31T10:00:00Z"), 4, "Europe/Amsterdam")).toISOString()).toBe(
            "2026-10-31T03:00:00.000Z",
        );
        expect(new Date(dayStart(Date.parse("2026-10-31T02:30:00Z"), 4, "Europe/Amsterdam")).toISOString()).toBe(
            "2026-10-30T03:00:00.000Z",
        );
    });

    it("handles summer time and UTC", () => {
        expect(new Date(dayStart(Date.parse("2026-07-01T12:00:00Z"), 4, "Europe/Amsterdam")).toISOString()).toBe(
            "2026-07-01T02:00:00.000Z",
        );
        expect(new Date(dayStart(Date.parse("2026-07-01T00:30:00Z"), 0, "UTC")).toISOString()).toBe(
            "2026-07-01T00:00:00.000Z",
        );
    });
});
