import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";

import { describe, expect, it, vi } from "vitest";

import { HttpError } from "../httpError.ts";
import { Context, errorResponse, readBody, Router, send } from "./router.ts";

const fakeReq = (method: string, url: string, body?: string): IncomingMessage => {
    const req = new EventEmitter() as IncomingMessage & { destroyed: boolean };
    req.method = method;
    req.url = url;
    req.headers = { host: "localhost" };
    req.destroy = vi.fn(() => {
        req.destroyed = true;
        return req;
    });
    queueMicrotask(() => {
        if (body !== undefined) req.emit("data", Buffer.from(body));
        req.emit("end");
    });
    return req;
};

describe("Router", () => {
    it("matches methods, params and wildcards", () => {
        const r = new Router()
            .add("GET", "/v1/feed", () => "feed")
            .add("POST", "/v1/feed/:id/events", () => "events")
            .add("GET", "/media/*", () => "media");
        expect(r.match("GET", "/v1/feed")?.params).toEqual({});
        expect(r.match("POST", "/v1/feed")).toBeNull();
        expect(r.match("POST", "/v1/feed/nl%3Ap_1/events")?.params).toEqual({ id: "nl:p_1" });
        expect(r.match("GET", "/media/a/b.mp3")?.params).toEqual({ "*": "a/b.mp3" });
        expect(r.match("GET", "/nope")).toBeNull();
    });
});

describe("Context", () => {
    it("parses the url, reads JSON once and rejects malformed JSON", async () => {
        const ctx = new Context(fakeReq("POST", "/v1/x?limit=3", '{"a":1}'), { id: "1" }, null, "http://localhost");
        expect(ctx.url.searchParams.get("limit")).toBe("3");
        expect(ctx.params.id).toBe("1");
        expect(await ctx.json()).toEqual({ a: 1 });
        expect(await ctx.json()).toEqual({ a: 1 });
        const bad = new Context(fakeReq("POST", "/", "{nope"), {}, null, "http://localhost");
        await expect(bad.json()).rejects.toThrow(/invalid JSON/);
        const empty = new Context(fakeReq("POST", "/", ""), {}, null, "http://localhost");
        expect(await empty.json()).toEqual({});
    });

    it("rejects bodies over the limit", async () => {
        await expect(readBody(fakeReq("POST", "/", "0123456789"), 5)).rejects.toThrow(/413|larger/);
    });
});

describe("send / errorResponse", () => {
    const fakeRes = () => {
        const res = { writeHead: vi.fn(), end: vi.fn() };
        return res as unknown as ServerResponse & typeof res;
    };

    it("encodes plain values as JSON, honours explicit responses and 204 for empty", () => {
        const res = fakeRes();
        send(res, { ok: true });
        expect(res.writeHead).toHaveBeenCalledWith(200, { "content-type": "application/json; charset=utf-8" });
        expect(res.end).toHaveBeenCalledWith('{"ok":true}');

        const raw = fakeRes();
        send(raw, { status: 302, headers: { location: "/" } });
        expect(raw.writeHead).toHaveBeenCalledWith(302, { location: "/" });
        expect(raw.end).toHaveBeenCalledWith(undefined);

        const text = fakeRes();
        send(text, { rawBody: "hi", headers: { "content-type": "text/plain" } });
        expect(text.writeHead).toHaveBeenCalledWith(200, { "content-type": "text/plain" });

        const empty = fakeRes();
        send(empty, undefined);
        expect(empty.writeHead).toHaveBeenCalledWith(204, {});
    });

    it("maps HttpError to its status and everything else to 500", () => {
        expect(errorResponse(new HttpError(404, "nope"))).toEqual({ status: 404, body: { error: "nope" } });
        expect(errorResponse(new Error("boom"))).toEqual({ status: 500, body: { error: "boom" } });
        expect(errorResponse("x")).toEqual({ status: 500, body: { error: "x" } });
    });
});
