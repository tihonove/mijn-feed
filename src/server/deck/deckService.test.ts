import { beforeEach, describe, expect, it } from "vitest";

import { DAY, FakeClock, MINUTE } from "../clock.ts";
import { SqliteDatabase } from "../db/database.ts";
import { SettingsService } from "../settings/settingsService.ts";
import { DeckService, interleave } from "./deckService.ts";
import { FsrsScheduler } from "./scheduler.ts";

let clock: FakeClock;
let settings: SettingsService;
let deck: DeckService;

const word = (id: string, facets = ["recognize"], presentations = 1) => ({
    id,
    kind: "word",
    fields: { word: id, meaning: `meaning of ${id}` },
    tags: ["test"],
    facets: facets.map((facet) => ({
        facet,
        presentations: Array.from({ length: presentations }, (_, i) => ({ html: `<p>${id}/${facet}/${i}</p>` })),
    })),
});

beforeEach(() => {
    clock = new FakeClock("2026-10-31T10:00:00Z");
    const db = new SqliteDatabase(":memory:");
    settings = new SettingsService(db, clock);
    deck = new DeckService(db, clock, settings, new FsrsScheduler(false));
});

describe("DeckService.addNote", () => {
    it("creates note, facets and presentations; re-adding the same note only appends", () => {
        const r1 = deck.addNote(word("fiets", ["recognize", "produce"]));
        expect(r1.id).toBe("fiets");
        expect(r1.facets.map((f) => f.facet)).toEqual(["recognize", "produce"]);
        const r2 = deck.addNote(word("fiets", ["recognize", "listen"], 2));
        expect(r2.facets[0]!.id).toBe(r1.facets[0]!.id);
        expect(r2.facets[1]!.facet).toBe("listen");
        expect(deck.state().notes).toHaveLength(1);
        expect(deck.state().byState).toEqual({ new: 3 });
    });

    it("re-publishing a presentation with the same id replaces it instead of duplicating", () => {
        const pres = (html: string) => ({
            ...word("w"),
            facets: [{ facet: "recognize", presentations: [{ id: "p1", html }] }],
        });
        deck.addNote(pres("<p>v1</p>"));
        expect(deck.addNote(pres("<p>v2</p>")).facets[0]!.presentations).toEqual(["p1"]);
        expect(deck.pick(1)[0]?.presentation?.html).toBe("<p>v2</p>");
    });

    it("validates input", () => {
        expect(() => deck.addNote({ kind: "", fields: {} })).toThrow(/kind and fields/);
        expect(() => deck.addNote({ kind: "word", fields: {}, facets: [{ facet: "" }] })).toThrow(/facet: name/);
        expect(() =>
            deck.addNote({ kind: "word", fields: {}, facets: [{ facet: "x", presentations: [{ html: "" }] }] }),
        ).toThrow(/html is required/);
        expect(() => deck.addPresentation("nope", { html: "<p/>" })).toThrow(/facet not found/);
    });

    it("rolls the whole note back when one facet is invalid", () => {
        expect(() => deck.addNote({ ...word("x"), facets: [{ facet: "a" }, { facet: "" }] })).toThrow();
        expect(deck.state().notes).toHaveLength(0);
    });
});

describe("DeckService.pick", () => {
    it("limits new cards per day and keeps the configured order", () => {
        settings.patch({ deck: { newPerDay: 2 } });
        for (const id of ["a", "b", "c"]) deck.addNote(word(id));
        const picked = deck.pick(10);
        expect(picked.map((p) => p.noteId)).toEqual(["a", "b"]);
        expect(picked[0]!.isNew).toBe(true);
        expect(picked[0]!.presentation?.html).toBe("<p>a/recognize/0</p>");
        expect(Object.keys(picked[0]!.grades)).toEqual(["again", "hard", "good", "easy"]);
    });

    it("counts new cards graded today against the daily limit", () => {
        settings.patch({ deck: { newPerDay: 2 } });
        for (const id of ["a", "b", "c"]) deck.addNote(word(id));
        deck.grade(deck.pick(1)[0]!.id, "good");
        expect(deck.pick(10).map((p) => p.noteId)).toEqual(["b"]);
        expect(deck.counts()).toMatchObject({ newDone: 1, newLeft: 1 });
    });

    it("pickOverflow serves new cards past the quota, then scheduled ones soonest first, skipping excluded", () => {
        settings.patch({ deck: { newPerDay: 1, learningSteps: ["1m", "10m"] } });
        for (const id of ["a", "b", "c"]) deck.addNote(word(id));
        const quota = deck.pick(10);
        expect(quota.map((p) => p.noteId)).toEqual(["a"]);
        deck.grade(quota[0]!.id, "good"); // a is now learning, due in 1 minute
        const overflow = deck.pickOverflow(10, new Set());
        expect(overflow.map((p) => `${p.noteId}:${p.state}`)).toEqual(["b:new", "c:new", "a:learning"]);
        expect(overflow.every((p) => p.overflow)).toBe(true);
        expect(deck.pick(10)).toEqual([]);
        expect(deck.pickOverflow(1, new Set([overflow[0]!.id])).map((p) => p.noteId)).toEqual(["c"]);
    });

    it("buries siblings: one facet per note per day", () => {
        deck.addNote(word("a", ["recognize", "produce"]));
        deck.addNote(word("b"));
        expect(deck.pick(10).map((p) => `${p.noteId}/${p.facet}`)).toEqual(["a/recognize", "b/recognize"]);
        settings.patch({ deck: { burySiblings: false } });
        expect(deck.pick(10)).toHaveLength(3);
    });

    it("puts due reviews first and interleaves new cards", () => {
        settings.patch({ deck: { newPerDay: 10, learningSteps: ["1m"] } });
        for (const id of ["r1", "r2", "n1", "n2"]) deck.addNote(word(id));
        // graduate r1 and r2 into review state
        for (const id of ["r1", "r2"]) {
            const f = deck.pick(10).find((p) => p.noteId === id)!;
            deck.grade(f.id, "good");
            clock.advance(2 * MINUTE);
            deck.grade(f.id, "good");
        }
        clock.advance(30 * DAY);
        const ids = deck.pick(10).map((p) => p.noteId);
        expect(ids).toHaveLength(4);
        expect(ids[0]).toMatch(/^r/);
        expect(new Set(ids)).toEqual(new Set(["r1", "r2", "n1", "n2"]));
        expect(deck.pick(10).every((p) => p.state === "review" || p.state === "new")).toBe(true);
    });

    it("rotates presentations: least shown first", () => {
        deck.addNote(word("a", ["recognize"], 2));
        const first = deck.pick(1)[0]!.presentation!;
        deck.markShown(first.id);
        const second = deck.pick(1)[0]!.presentation!;
        expect(second.id).not.toBe(first.id);
        deck.markShown(second.id);
        expect(deck.pick(1)[0]!.presentation!.id).toBe(first.id);
    });

    it("returns null presentation for a facet without one", () => {
        deck.addNote({ ...word("bare"), facets: [{ facet: "recognize" }] });
        expect(deck.pick(1)[0]!.presentation).toBeNull();
    });

    it("supports random and level order for new cards", () => {
        deck.addNote({ ...word("b2"), level: "B2" });
        deck.addNote({ ...word("a1"), level: "A1" });
        settings.patch({ deck: { newOrder: "level" } });
        expect(deck.pick(10).map((p) => p.noteId)).toEqual(["a1", "b2"]);
        settings.patch({ deck: { newOrder: "random" } });
        expect(deck.pick(10)).toHaveLength(2);
    });
});

describe("DeckService.grade", () => {
    it("moves a new card through learning into review with growing intervals", () => {
        deck.addNote(word("a"));
        const facetId = deck.pick(1)[0]!.id;
        const g1 = deck.grade(facetId, "good");
        expect(g1.state).toBe("learning");
        expect(g1.due - clock.now()).toBe(10 * MINUTE);
        clock.set(g1.due);
        const g2 = deck.grade(facetId, "good");
        expect(g2.state).toBe("review");
        expect(g2.scheduledDays).toBeGreaterThanOrEqual(1);
        clock.set(g2.due);
        const g3 = deck.grade(facetId, "good");
        expect(g3.scheduledDays).toBeGreaterThan(g2.scheduledDays);
        expect(deck.stats().cards).toMatchObject({ new: 0, young: 1, mature: 0 });
    });

    it("'again' on a review card sends it to relearning", () => {
        settings.patch({ deck: { learningSteps: ["1m"] } });
        deck.addNote(word("a"));
        const facetId = deck.pick(1)[0]!.id;
        deck.grade(facetId, "good");
        clock.advance(MINUTE);
        const g = deck.grade(facetId, "good");
        clock.set(g.due);
        expect(deck.grade(facetId, "again").state).toBe("relearning");
    });

    it("suspends a leech after the configured number of lapses", () => {
        settings.patch({ deck: { leechThreshold: 2 } });
        deck.addNote(word("a"));
        const facetId = deck.pick(1)[0]!.id;
        expect(deck.grade(facetId, "again").suspended).toBe(false);
        clock.advance(MINUTE);
        expect(deck.grade(facetId, "again").suspended).toBe(true);
        expect(deck.pick(10)).toHaveLength(0);
        expect(deck.state().leeches[0]).toMatchObject({ facetId, noteId: "a" });
        expect(deck.stats().cards.suspended).toBe(1);
    });

    it("rejects unknown facets", () => {
        expect(() => deck.grade("nope", "good")).toThrow(/facet not found/);
    });
});

describe("DeckService.state and stats", () => {
    it("reports upcoming facets, presentation needs, tags and recent kinds", () => {
        deck.addNote({ ...word("a"), tags: ["food", "a1"] });
        deck.addNote({ ...word("b"), facets: [{ facet: "recognize" }] });
        const pres = deck.pick(1)[0]!.presentation!;
        deck.markShown(pres.id);
        const s = deck.state();
        expect(s.upcoming.map((u) => u.noteId)).toEqual(["a", "b"]);
        expect(s.needPresentations.map((u) => u.noteId)).toEqual(["a", "b"]);
        expect(s.tags).toEqual({ food: 1, a1: 1, test: 1 });
        expect(s.byKind).toEqual({ word: 2 });
        expect(s.recent).toEqual([{ kind: "word", facet: "recognize", lastShown: clock.now() }]);
        expect(s.counts).toEqual({ newDone: 0, reviewsDone: 0, newLeft: 5, reviewsLeft: 100 });
        expect(deck.facetOfPresentation(pres.id)).toBe(s.upcoming[0]!.facetId);
        expect(deck.facetOfPresentation("nope")).toBeNull();
    });

    it("computes today's numbers, a 14-day forecast and retention", () => {
        settings.patch({ deck: { learningSteps: ["1m"] } });
        deck.addNote(word("a"));
        deck.addNote(word("b"));
        const facetId = deck.pick(1)[0]!.id;
        // With a single learning step "good" graduates straight into review (as in Anki).
        const g = deck.grade(facetId, "good");
        let stats = deck.stats();
        expect(g.state).toBe("review");
        expect(stats.today).toEqual({ dueNow: 0, newLeft: 1, newDone: 1, reviewsDone: 0 });
        expect(stats.forecast).toHaveLength(14);
        expect(stats.forecast.reduce((a, f) => a + f.due, 0)).toBe(1);
        expect(stats.retention30d).toBeNull();
        expect(stats.notes).toBe(2);
        clock.set(g.due);
        deck.grade(facetId, "again"); // review → relearning: counts as a failed review
        deck.grade(facetId, "good"); // relearning → review: not a review-state answer, excluded from retention
        stats = deck.stats();
        expect(stats.today).toMatchObject({ reviewsDone: 2 });
        expect(stats.retention30d).toBe(0);
        expect(stats.reviewsPerDay30d.reduce((a, b) => a + b, 0)).toBe(3);
    });
});

describe("interleave", () => {
    it("spreads fresh items evenly and keeps order", () => {
        expect(interleave<string | number>([1, 2, 3, 4], ["a", "b"])).toEqual([1, 2, "a", 3, 4, "b"]);
        expect(interleave([], ["a"])).toEqual(["a"]);
        expect(interleave([1], [])).toEqual([1]);
        expect(interleave<string | number>([1], ["a", "b", "c"])).toEqual(["a", 1, "b", "c"]);
    });
});
