import { beforeEach, describe, expect, it } from "vitest";

import { DAY, FakeClock, HOUR } from "../clock.ts";
import { SqliteDatabase } from "../db/database.ts";
import { ItemService } from "./itemService.ts";

let clock: FakeClock;
let items: ItemService;
const opts = { freshnessHours: 48, tagWeight: () => 1 };

beforeEach(() => {
    clock = new FakeClock();
    items = new ItemService(new SqliteDatabase(":memory:"), clock);
});

describe("ItemService", () => {
    it("adds, lists freshest first, hides shown and expired items", () => {
        const old = items.add("news", { html: "<p>old</p>", expiresAt: clock.now() + DAY });
        clock.advance(HOUR);
        const fresh = items.add("news", { html: "<p>fresh</p>", tags: ["nl"] });
        expect(items.candidates("news", 10, opts).map((i) => i.id)).toEqual([fresh, old]);
        items.markShown(fresh);
        expect(items.candidates("news", 10, opts).map((i) => i.id)).toEqual([old]);
        clock.advance(DAY);
        expect(items.candidates("news", 10, opts)).toEqual([]);
        expect(items.get(fresh)?.tags).toEqual(["nl"]);
        expect(items.get("nope")).toBeNull();
        expect(items.streams()).toEqual(["news"]);
    });

    it("repeats an item after repeatAfter", () => {
        const id = items.add("facts", { html: "<p>f</p>", repeatAfter: 7 * DAY });
        items.markShown(id);
        expect(items.candidates("facts", 10, opts)).toEqual([]);
        clock.advance(7 * DAY);
        expect(items.candidates("facts", 10, opts).map((i) => i.id)).toEqual([id]);
    });

    it("weights by tags and upserts by id", () => {
        items.add("news", { id: "a", html: "<p>a</p>", tags: ["sport"] });
        items.add("news", { id: "b", html: "<p>b</p>", tags: ["tech"] });
        const weighted = items.candidates("news", 10, { freshnessHours: 48, tagWeight: (t) => (t === "tech" ? 2 : 1) });
        expect(weighted.map((i) => i.id)).toEqual(["b", "a"]);
        items.add("news", { id: "a", html: "<p>a2</p>" });
        expect(items.get("a")?.html).toBe("<p>a2</p>");
    });

    it("validates stream and html", () => {
        expect(() => items.add("nl", { html: "x" })).toThrow(/non-deck stream/);
        expect(() => items.add("", { html: "x" })).toThrow(/non-deck stream/);
        expect(() => items.add("news", { html: "" })).toThrow(/html is required/);
    });
});
