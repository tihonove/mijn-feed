import { describe, expect, it } from "vitest";

import { DAY, FakeClock } from "../clock.ts";
import { SqliteDatabase } from "../db/database.ts";
import { deepMerge, DEFAULT_SETTINGS, SettingsService } from "./settingsService.ts";

const make = () => {
    const clock = new FakeClock();
    return { clock, service: new SettingsService(new SqliteDatabase(":memory:"), clock) };
};

describe("deepMerge", () => {
    it("recurses into objects and replaces arrays and scalars", () => {
        expect(deepMerge({ a: { b: 1, c: [1] }, d: 2 }, { a: { c: [2, 3] } })).toEqual({
            a: { b: 1, c: [2, 3] },
            d: 2,
        });
        expect(deepMerge({ a: 1 }, { a: null })).toEqual({ a: null });
        expect(deepMerge({ a: 1 }, undefined)).toEqual({ a: 1 });
    });
});

describe("SettingsService", () => {
    it("returns defaults when nothing is stored", () => {
        expect(make().service.get()).toEqual(DEFAULT_SETTINGS);
    });

    it("merges a patch over defaults and persists only the patch", () => {
        const { service } = make();
        const s = service.patch({ deck: { newPerDay: 10 }, streams: { news: { share: 0 } } });
        expect(s.deck.newPerDay).toBe(10);
        expect(s.deck.requestRetention).toBe(0.9);
        expect(s.streams.news?.share).toBe(0);
        expect(s.streams.news?.title).toBe("Новости");
        expect(service.get()).toEqual(s);
    });

    it("adds a new stream through a patch", () => {
        const { service } = make();
        expect(service.patch({ streams: { music: { share: 5, title: "Music" } } }).streams.music).toEqual({
            share: 5,
            title: "Music",
        });
    });

    it("resets quick modes once their deadline passes", () => {
        const { service, clock } = make();
        service.patch({ modes: { onlyStream: "nl", until: clock.now() + DAY } });
        expect(service.get().modes.onlyStream).toBe("nl");
        clock.advance(DAY + 1);
        expect(service.get().modes).toEqual(DEFAULT_SETTINGS.modes);
    });

    it("rejects out-of-range knobs with 400", () => {
        const { service } = make();
        const bad = (patch: unknown, msg: RegExp) => {
            expect(() => service.patch(patch as never)).toThrow(msg);
        };
        bad(null, /expected an object/);
        bad({ deck: { requestRetention: 0.5 } }, /requestRetention/);
        bad({ deck: { newPerDay: -1 } }, /newPerDay/);
        bad({ deck: { newPerDay: 1.5 } }, /newPerDay/);
        bad({ deck: { newOrder: "weird" } }, /newOrder/);
        bad({ streams: { nl: { share: 5000 } } }, /streams\.nl\.share/);
        bad({ streams: { nl: 3 } }, /streams\.nl: expected/);
        bad({ mixer: { maxRun: 0 } }, /maxRun/);
        bad({ grading: { buttons: 3 } }, /buttons/);
    });
});
