// End-to-end over real HTTP: the container wired as in production, with a fake clock and no network.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { FeedCard } from "../../shared/types.ts";
import { FakeClock } from "../clock.ts";
import { Container } from "../di/container.ts";
import { appModule } from "../modules.ts";
import type { HttpServer } from "./server.ts";
import { HttpServerDIToken } from "./server.ts";

let dir: string;
let server: HttpServer;
let base: string;
let cookie = "";
const producer = { authorization: "Bearer prod-token" };

const call = async (
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
    raw?: Buffer,
) => {
    const res = await fetch(base + path, {
        method,
        headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), cookie, ...headers },
        body: raw ? new Uint8Array(raw) : body !== undefined ? JSON.stringify(body) : undefined,
        redirect: "manual",
    });
    const text = await res.text();
    let json: unknown = null;
    try {
        json = JSON.parse(text);
    } catch {
        /* not json */
    }
    return { status: res.status, headers: res.headers, json: json as Record<string, never>, text };
};

beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "mijn-feed-api-"));
    const appDir = join(dir, "app");
    mkdirSync(appDir);
    writeFileSync(join(appDir, "index.html"), "<h1>app</h1>");
    const container = new Container().use(appModule, {
        dbPath: ":memory:",
        mediaDir: join(dir, "media"),
        appDir,
        clock: new FakeClock(),
        fetch: () => Promise.reject(new Error("no network in tests")),
        auth: {
            ownerEmails: ["owner@example.com"],
            producerToken: "prod-token",
            googleClientId: null,
            googleClientSecret: null,
            devLogin: true,
            publicOrigin: null,
            secureCookies: false,
        },
    });
    server = container.get(HttpServerDIToken);
    await server.listen(0, "127.0.0.1");
    const address = server.server.address();
    base = typeof address === "object" && address ? `http://127.0.0.1:${address.port}` : "";
});

afterAll(async () => {
    await server.close();
    rmSync(dir, { recursive: true, force: true });
});

describe("HTTP API", () => {
    it("serves the app shell and 404s for unknown api paths", async () => {
        expect((await call("GET", "/")).text).toBe("<h1>app</h1>");
        expect((await call("GET", "/settings")).text).toBe("<h1>app</h1>");
        expect((await call("GET", "/v1/nope")).status).toBe(404);
        expect((await call("GET", "/missing.png")).status).toBe(404);
        expect((await call("GET", "/healthz")).json).toEqual({ ok: true });
        const head = await fetch(`${base}/`, { method: "HEAD" });
        expect(head.status).toBe(200);
    });

    it("requires a session for the viewer api and reports google availability", async () => {
        const me = await call("GET", "/v1/me");
        expect(me.status).toBe(401);
        expect(me.json).toEqual({ error: "sign in required", google: false });
        expect((await call("GET", "/v1/feed")).status).toBe(401);
        expect((await call("GET", "/auth/google")).status).toBe(503);
    });

    it("signs in through the dev login and keeps the session cookie", async () => {
        const res = await call("GET", "/auth/dev");
        expect(res.status).toBe(302);
        const setCookie = res.headers.get("set-cookie") ?? "";
        cookie = setCookie.split(";")[0] ?? "";
        expect(cookie).toMatch(/^sid=/);
        const me = await call("GET", "/v1/me");
        expect(me.status).toBe(200);
        expect(me.json).toMatchObject({ email: "owner@example.com", kind: "user" });
    });

    it("lets a producer add notes, presentations, items and media; viewers cannot", async () => {
        expect((await call("POST", "/v1/nl/notes", { kind: "word", fields: {} })).status).toBe(401);
        const note = await call(
            "POST",
            "/v1/nl/notes",
            {
                id: "fiets",
                kind: "word",
                fields: { word: "fiets", meaning: "велосипед", article: "de" },
                tags: ["a1"],
                facets: [
                    { facet: "recognize", presentations: [{ html: "<p>fiets</p>", meta: { title: "fiets" } }] },
                    { facet: "produce" },
                ],
            },
            producer,
        );
        expect(note.status).toBe(201);
        const facets = (note.json as unknown as { notes: { facets: { id: string; facet: string }[] }[] }).notes[0]!
            .facets;
        expect(facets.map((f) => f.facet)).toEqual(["recognize", "produce"]);
        const pres = await call(
            "POST",
            `/v1/nl/facets/${facets[1]!.id}/presentations`,
            { html: "<p>produce</p>" },
            producer,
        );
        expect(pres.status).toBe(201);
        expect((await call("POST", "/v1/nl/facets/nope/presentations", { html: "<p/>" }, producer)).status).toBe(404);

        const items = await call(
            "POST",
            "/v1/streams/news/items",
            [{ html: "<p>n1</p>" }, { html: "<p>n2</p>" }],
            producer,
        );
        expect(items.status).toBe(201);
        expect((items.json as unknown as { items: string[] }).items).toHaveLength(2);

        const media = await call(
            "POST",
            "/v1/media",
            undefined,
            { ...producer, "content-type": "audio/mpeg" },
            Buffer.from("ID3 fake"),
        );
        expect(media.status).toBe(201);
        const url = (media.json as unknown as { url: string }).url;
        expect(url).toMatch(/^\/media\/[a-f0-9]{32}\.mp3$/);
        const file = await fetch(base + url, { headers: { cookie } });
        expect(file.status).toBe(200);
        expect(file.headers.get("content-type")).toBe("audio/mpeg");
        expect(await file.text()).toBe("ID3 fake");
        expect((await call("GET", url, undefined, { cookie: "" })).status).toBe(401);
        expect((await call("GET", "/media/00000000000000000000000000000000.mp3")).status).toBe(404);
        expect(
            (
                await call(
                    "POST",
                    "/v1/media",
                    undefined,
                    { ...producer, "content-type": "text/plain" },
                    Buffer.from("x"),
                )
            ).status,
        ).toBe(415);
    });

    it("builds a playlist, accepts events and exposes settings and stats", async () => {
        const feed = await call("GET", "/v1/feed?limit=5");
        expect(feed.status).toBe(200);
        const cards = (feed.json as unknown as { cards: FeedCard[] }).cards;
        expect(cards.map((c) => c.stream).sort()).toEqual(["news", "news", "nl"]);
        const nl = cards.find((c) => c.stream === "nl")!;
        expect(nl.html).toBe("<p>fiets</p>");
        expect(nl.grades).toBeDefined();

        expect((await call("POST", `/v1/feed/${encodeURIComponent(nl.id)}/events`, { type: "seen" })).json).toEqual({
            ok: true,
        });
        const graded = await call("POST", `/v1/feed/${encodeURIComponent(nl.id)}/events`, {
            type: "grade",
            grade: "good",
        });
        expect(graded.status).toBe(200);
        expect(graded.json).toMatchObject({ ok: true, state: "learning" });
        expect((await call("POST", "/v1/feed/bad/events", { type: "seen" })).status).toBe(400);
        expect(
            (
                await call(
                    "POST",
                    "/v1/feed/bad/events",
                    undefined,
                    { "content-type": "application/json" },
                    Buffer.from("{"),
                )
            ).status,
        ).toBe(400);
        expect((await call("GET", "/v1/feed?limit=0")).status).toBe(400);

        const settings = await call("PUT", "/v1/settings", { deck: { newPerDay: 7 }, sound: { enabled: true } });
        expect(settings.status).toBe(200);
        expect(settings.json).toMatchObject({ deck: { newPerDay: 7 }, sound: { enabled: true } });
        expect((await call("PATCH", "/v1/settings", { deck: { newPerDay: -1 } })).status).toBe(400);
        expect((await call("GET", "/v1/settings")).json).toMatchObject({ deck: { newPerDay: 7 } });
        // producers can read and turn knobs too
        expect((await call("GET", "/v1/settings", undefined, { ...producer, cookie: "" })).status).toBe(200);

        const stats = await call("GET", "/v1/stats");
        expect(stats.json).toMatchObject({ deck: { notes: 1, today: { newDone: 1 } } });
        const state = await call("GET", "/v1/nl/state", undefined, { ...producer, cookie: "" });
        expect(state.status).toBe(200);
        expect((state.json as unknown as { notes: unknown[] }).notes).toHaveLength(1);
    });

    it("logs out", async () => {
        const res = await call("POST", "/auth/logout");
        expect(res.status).toBe(302);
        cookie = "";
        expect((await call("GET", "/v1/me")).status).toBe(401);
    });
});
