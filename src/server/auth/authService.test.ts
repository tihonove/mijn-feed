import { beforeEach, describe, expect, it, vi } from "vitest";

import { DAY, FakeClock } from "../clock.ts";
import { SqliteDatabase } from "../db/database.ts";
import type { Principal, RequestContext } from "../http/router.ts";
import { type AuthConfig, AuthService, type FetchLike, parseCookies } from "./authService.ts";

const config: AuthConfig = {
    ownerEmails: ["owner@example.com"],
    producerToken: "secret-token",
    googleClientId: "client-id",
    googleClientSecret: "client-secret",
    devLogin: true,
    publicOrigin: null,
    secureCookies: false,
};

const ctxOf = (headers: Record<string, string>, url = "/", principal: Principal | null = null): RequestContext =>
    ({ headers, url: new URL(url, "http://localhost"), principal, method: "GET", params: {} }) as RequestContext;

const cookieValue = (setCookie: string | string[] | undefined, name: string): string => {
    const list = Array.isArray(setCookie) ? setCookie : [setCookie ?? ""];
    const hit = list.find((c) => c.startsWith(`${name}=`)) ?? "";
    return decodeURIComponent(hit.split(";")[0]!.slice(name.length + 1));
};

let clock: FakeClock;
let fetchMock: ReturnType<typeof vi.fn<FetchLike>>;
let auth: AuthService;

beforeEach(() => {
    clock = new FakeClock();
    fetchMock = vi.fn<FetchLike>();
    auth = new AuthService(new SqliteDatabase(":memory:"), clock, config, fetchMock);
});

describe("parseCookies", () => {
    it("splits and decodes", () => {
        expect(parseCookies("a=1; b=%20x; broken")).toEqual({ a: "1", b: " x" });
        expect(parseCookies(undefined)).toEqual({});
    });
});

describe("AuthService principal", () => {
    it("accepts the producer bearer token and rejects others", () => {
        expect(auth.principal(ctxOf({ authorization: "Bearer secret-token" }))?.kind).toBe("producer");
        expect(auth.principal(ctxOf({ authorization: "Bearer wrong" }))).toBeNull();
        expect(auth.principal(ctxOf({ authorization: "Bearer " }))).toBeNull();
        expect(auth.principal(ctxOf({}))).toBeNull();
        const noToken = new AuthService(
            new SqliteDatabase(":memory:"),
            clock,
            { ...config, producerToken: null },
            fetchMock,
        );
        expect(noToken.principal(ctxOf({ authorization: "Bearer secret-token" }))).toBeNull();
    });

    it("creates a session on dev login, reads it back from the cookie and expires it", () => {
        const res = auth.devLogin(ctxOf({}));
        const sid = cookieValue(res.headers?.["set-cookie"], "sid");
        expect(sid).toHaveLength(64);
        const p = auth.principal(ctxOf({ cookie: `sid=${sid}` }));
        expect(p).toEqual({ kind: "user", email: "owner@example.com", name: "dev", picture: null });
        clock.advance(366 * DAY);
        expect(auth.principal(ctxOf({ cookie: `sid=${sid}` }))).toBeNull();
    });

    it("dev login respects the allowlist and the flag", () => {
        expect(() => auth.devLogin(ctxOf({}, "/auth/dev?email=x@y.z"))).toThrow(/not allowed/);
        const off = new AuthService(new SqliteDatabase(":memory:"), clock, { ...config, devLogin: false }, fetchMock);
        expect(() => off.devLogin(ctxOf({}))).toThrow(/not found/);
    });

    it("logout deletes the session", () => {
        const sid = cookieValue(auth.devLogin(ctxOf({})).headers?.["set-cookie"], "sid");
        const res = auth.logout(ctxOf({ cookie: `sid=${sid}` }));
        expect(res.headers?.["set-cookie"]).toMatch(/^sid=; .*Max-Age=0/);
        expect(auth.principal(ctxOf({ cookie: `sid=${sid}` }))).toBeNull();
    });

    it("guards throw 401 with the right kind", () => {
        const user: Principal = { kind: "user", email: "o@e.c", name: null, picture: null };
        const producer: Principal = { kind: "producer", email: null, name: null, picture: null };
        expect(auth.requireUser(ctxOf({}, "/", user))).toBe(user);
        expect(() => auth.requireUser(ctxOf({}, "/", producer))).toThrow(/sign in/);
        expect(auth.requireProducer(ctxOf({}, "/", producer))).toBe(producer);
        expect(() => auth.requireProducer(ctxOf({}, "/", user))).toThrow(/producer token/);
        expect(auth.requireAny(ctxOf({}, "/", producer))).toBe(producer);
        expect(() => auth.requireAny(ctxOf({}))).toThrow(/sign in/);
    });

    it("derives the origin from forwarded headers unless configured", () => {
        expect(auth.origin(ctxOf({ host: "localhost:3000" }))).toBe("http://localhost:3000");
        expect(
            auth.origin(ctxOf({ host: "x", "x-forwarded-proto": "https", "x-forwarded-host": "feed.example" })),
        ).toBe("https://feed.example");
        const fixed = new AuthService(
            new SqliteDatabase(":memory:"),
            clock,
            { ...config, publicOrigin: "https://p" },
            fetchMock,
        );
        expect(fixed.origin(ctxOf({ host: "x" }))).toBe("https://p");
    });
});

describe("AuthService Google", () => {
    const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

    it("redirects to Google with a state cookie", () => {
        const res = auth.startGoogle(ctxOf({ host: "localhost:3000" }));
        const location = new URL(String(res.headers?.location));
        expect(location.origin + location.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
        expect(location.searchParams.get("redirect_uri")).toBe("http://localhost:3000/auth/callback");
        expect(location.searchParams.get("scope")).toBe("openid email profile");
        expect(cookieValue(res.headers?.["set-cookie"], "oauth_state")).toBe(location.searchParams.get("state"));
    });

    it("exchanges the code, verifies the id token and signs the owner in", async () => {
        fetchMock.mockResolvedValueOnce(jsonResponse({ id_token: "idt" })).mockResolvedValueOnce(
            jsonResponse({
                aud: "client-id",
                email: "Owner@example.com",
                email_verified: "true",
                name: "O",
                picture: "p",
            }),
        );
        const res = await auth.finishGoogle(
            ctxOf({ cookie: "oauth_state=st", host: "h" }, "/auth/callback?code=c&state=st"),
        );
        expect(res.status).toBe(302);
        const sid = cookieValue(res.headers?.["set-cookie"], "sid");
        expect(auth.principal(ctxOf({ cookie: `sid=${sid}` }))).toEqual({
            kind: "user",
            email: "Owner@example.com",
            name: "O",
            picture: "p",
        });
        const init = fetchMock.mock.calls[0]![1]!;
        const body = init.body as string;
        expect(body).toContain("code=c");
        expect(body).toContain("redirect_uri=http%3A%2F%2Fh%2Fauth%2Fcallback");
    });

    it("rejects a wrong state, failed exchanges, unverified tokens and strangers", async () => {
        const cb = (cookie = "oauth_state=st", url = "/auth/callback?code=c&state=st") =>
            auth.finishGoogle(ctxOf({ cookie }, url));
        await expect(cb("oauth_state=other")).rejects.toThrow(/bad oauth state/);
        await expect(cb("", "/auth/callback")).rejects.toThrow(/bad oauth state/);
        fetchMock.mockResolvedValueOnce(jsonResponse({}, 400));
        await expect(cb()).rejects.toThrow(/token exchange failed: 400/);
        fetchMock.mockResolvedValueOnce(jsonResponse({}));
        await expect(cb()).rejects.toThrow(/no id_token/);
        fetchMock.mockResolvedValueOnce(jsonResponse({ id_token: "x" })).mockResolvedValueOnce(jsonResponse({}, 500));
        await expect(cb()).rejects.toThrow(/tokeninfo failed/);
        fetchMock
            .mockResolvedValueOnce(jsonResponse({ id_token: "x" }))
            .mockResolvedValueOnce(jsonResponse({ aud: "other", email: "owner@example.com", email_verified: true }));
        await expect(cb()).rejects.toThrow(/not accepted/);
        fetchMock
            .mockResolvedValueOnce(jsonResponse({ id_token: "x" }))
            .mockResolvedValueOnce(
                jsonResponse({ aud: "client-id", email: "stranger@example.com", email_verified: true }),
            );
        await expect(cb()).rejects.toThrow(/not allowed/);
    });

    it("reports when Google is not configured", async () => {
        const off = new AuthService(
            new SqliteDatabase(":memory:"),
            clock,
            { ...config, googleClientId: null },
            fetchMock,
        );
        expect(() => off.startGoogle(ctxOf({}))).toThrow(/not configured/);
        await expect(off.finishGoogle(ctxOf({}))).rejects.toThrow(/not configured/);
    });
});
