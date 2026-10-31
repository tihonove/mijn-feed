import { beforeEach, describe, expect, it } from "vitest";

import { FakeClock, MINUTE } from "../clock.ts";
import { SqliteDatabase } from "../db/database.ts";
import { DeckService } from "../deck/deckService.ts";
import { FsrsScheduler } from "../deck/scheduler.ts";
import { ItemService } from "../items/itemService.ts";
import { SettingsService } from "../settings/settingsService.ts";
import { FeedService, parseCardId } from "./feedService.ts";

let clock: FakeClock;
let settings: SettingsService;
let deck: DeckService;
let items: ItemService;
let feed: FeedService;

beforeEach(() => {
    clock = new FakeClock();
    const db = new SqliteDatabase(":memory:");
    settings = new SettingsService(db, clock);
    deck = new DeckService(db, clock, settings, new FsrsScheduler(false));
    items = new ItemService(db, clock);
    feed = new FeedService(db, clock, settings, deck, items);
});

const addWord = (id: string, withPresentation = true) =>
    deck.addNote({
        id,
        kind: "word",
        fields: { word: id, meaning: "m" },
        tags: ["food"],
        facets: [
            {
                facet: "recognize",
                presentations: withPresentation
                    ? [{ html: `<p>${id}</p>`, audio: "/media/a.mp3", meta: { title: id } }]
                    : [],
            },
        ],
    });

describe("FeedService.playlist", () => {
    it("mixes deck cards and stream items by shares, with ids and meta the viewer needs", () => {
        settings.patch({ deck: { newPerDay: 20 } });
        for (let i = 0; i < 6; i++) addWord(`w${i}`);
        for (let i = 0; i < 6; i++) items.add("news", { html: `<p>n${i}</p>`, tags: ["tech"] });
        for (let i = 0; i < 6; i++) items.add("facts", { html: `<p>f${i}</p>` });
        const cards = feed.playlist(10);
        expect(cards).toHaveLength(10);
        expect(cards.filter((c) => c.stream === "nl")).toHaveLength(6);
        expect(cards.filter((c) => c.stream === "news")).toHaveLength(3);
        expect(cards.filter((c) => c.stream === "facts")).toHaveLength(1);
        const nl = cards.find((c) => c.stream === "nl")!;
        expect(nl.id).toMatch(/^nl:p_/);
        expect(nl.audio).toBe("/media/a.mp3");
        expect(nl.meta).toMatchObject({
            title: "w0",
            facet: "recognize",
            noteId: "w0",
            isNew: true,
            builtin: false,
            tags: ["food"],
        });
        expect(nl.grades?.good).toBeGreaterThan(clock.now());
        const news = cards.find((c) => c.stream === "news")!;
        expect(news.id).toMatch(/^item:i_/);
        expect(news.meta.tags).toEqual(["tech"]);
    });

    it("falls back to the built-in presentation and honours quick modes", () => {
        addWord("bare", false);
        items.add("news", { html: "<p>n</p>" });
        settings.patch({ modes: { onlyStream: "nl" } });
        const cards = feed.playlist(10);
        expect(cards).toHaveLength(1);
        expect(cards[0]!.id).toMatch(/^nl:facet:f_/);
        expect(cards[0]!.meta.builtin).toBe(true);
        expect(cards[0]!.html).toContain("bare");
        settings.patch({ modes: { onlyStream: null, mutedStreams: ["nl"] } });
        expect(feed.playlist(10).map((c) => c.stream)).toEqual(["news"]);
    });
});

describe("FeedService.playlist past the quota", () => {
    it("continues with a divider and overflow cards once the quota is done, and only then", () => {
        settings.patch({ deck: { newPerDay: 2 }, modes: { onlyStream: "nl" } });
        for (const id of ["a", "b", "c", "d"]) addWord(id);
        const cards = feed.playlist(10);
        expect(cards.map((c) => [c.meta.noteId ?? c.kind, c.meta.overflow ?? c.meta.divider])).toEqual([
            ["a", false],
            ["b", false],
            ["info", true],
            ["c", true],
            ["d", true],
        ]);
        const divider = cards[2]!;
        expect(divider.id).toMatch(/^info:quota:\d+$/);
        expect(divider.html).toContain("Норма на сегодня сделана");
        expect(divider.grades).toBeUndefined();
        // a full page from the quota alone has no divider
        expect(feed.playlist(2).map((c) => c.kind)).toEqual(["word", "word"]);
        // the divider is accepted as a card for events and recorded under its own stream
        expect(feed.event(divider.id, { type: "seen" })).toEqual({ ok: true });
        expect(feed.event(divider.id, { type: "grade", grade: "good" })).toEqual({ ok: true });
    });

    it("has no divider when there is nothing past the quota", () => {
        settings.patch({ modes: { onlyStream: "nl" } });
        addWord("a");
        expect(feed.playlist(10).map((c) => c.kind)).toEqual(["word"]);
    });
});

describe("FeedService.event", () => {
    it("routes grades and answers to the deck and marks presentations shown", () => {
        addWord("w");
        const card = feed.playlist(1)[0]!;
        expect(feed.event(card.id, { type: "seen" })).toEqual({ ok: true });
        expect(deck.state().recent).toHaveLength(1);
        const graded = feed.event(card.id, { type: "grade", grade: "good" });
        expect(graded.state).toBe("learning");
        expect(graded.due).toBe(clock.now() + 10 * MINUTE);
        clock.advance(10 * MINUTE);
        expect(feed.event(card.id, { type: "answer", correct: false }).state).toBe("learning");
    });

    it("accepts built-in card ids and item ids; marks items shown", () => {
        addWord("bare", false);
        const id = items.add("facts", { html: "<p>f</p>" });
        const builtin = feed.playlist(5).find((c) => c.stream === "nl")!;
        expect(feed.event(builtin.id, { type: "grade", grade: "easy" }).state).toBe("review");
        expect(feed.event(`item:${id}`, { type: "seen" })).toEqual({ ok: true });
        expect(items.candidates("facts", 5, { freshnessHours: 48, tagWeight: () => 1 })).toEqual([]);
        expect(feed.event(`item:${id}`, { type: "grade", grade: "good" })).toEqual({ ok: true });
    });

    it("reactions change stream and tag weights in later playlists", () => {
        settings.patch({ streams: { nl: { share: 0 }, news: { share: 50 }, facts: { share: 50 } } });
        const a = items.add("news", { html: "<p>a</p>", tags: ["sport"] });
        items.add("news", { html: "<p>b</p>", tags: ["tech"] });
        for (let i = 0; i < 5; i++) items.add("facts", { html: `<p>f${i}</p>` });
        for (let i = 0; i < 5; i++) feed.event(`item:${a}`, { type: "boring" });
        const cards = feed.playlist(6);
        // news weight 1 - 5*0.15 = 0.25 → 50*0.25 = 12.5 vs facts 50: roughly 1 news per 5 facts
        expect(cards.filter((c) => c.stream === "news").length).toBeLessThanOrEqual(2);
        // within news, the "sport" tag is penalised, so "tech" comes first
        expect(cards.find((c) => c.stream === "news")?.html).toBe("<p>b</p>");
    });

    it("validates ids, event types and payloads", () => {
        expect(() => feed.event("weird", { type: "seen" })).toThrow(/bad card id/);
        expect(() => feed.event("nl:p_missing", { type: "seen" })).toThrow(/unknown card/);
        expect(() => feed.event("item:missing", { type: "seen" })).toThrow(/unknown card/);
        addWord("w");
        const card = feed.playlist(1)[0]!;
        expect(() => feed.event(card.id, { type: "nope" as never })).toThrow(/event.type/);
        expect(() => feed.event(card.id, { type: "grade" })).toThrow(/grade: again/);
        expect(() => feed.event(card.id, { type: "grade", grade: "superb" as never })).toThrow(/grade: again/);
        expect(() => feed.event(card.id, { type: "answer" })).toThrow(/correct must be boolean/);
    });

    it("parseCardId resolves presentation ids through the deck", () => {
        const stub = { facetOfPresentation: (id: string) => (id === "p1" ? "f1" : null) };
        expect(parseCardId("nl:p1", stub)).toEqual({ stream: "nl", facetId: "f1", presentationId: "p1" });
        expect(parseCardId("nl:facet:f9", stub)).toEqual({ stream: "nl", facetId: "f9", presentationId: null });
        expect(parseCardId("item:i1", stub)).toEqual({ stream: "item", itemId: "i1" });
        expect(parseCardId("info:quota:1", stub)).toEqual({ stream: "info", infoId: "quota:1" });
    });
});
