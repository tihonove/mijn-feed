import { describe, expect, it, vi } from "vitest";

import type { ApiError } from "./apiClient.ts";
import { ApiClient, type FetchLike } from "./apiClient.ts";

const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("ApiClient", () => {
    it("reports signed-out state from a 401 on /v1/me", async () => {
        const f = vi.fn<FetchLike>().mockResolvedValue(json({ error: "sign in required", google: true }, 401));
        expect(await new ApiClient(f).me()).toEqual({ signedOut: true, google: true });
        f.mockResolvedValue(json({ email: "o@e.c", name: null, picture: null, kind: "user" }));
        expect(await new ApiClient(f).me()).toMatchObject({ email: "o@e.c" });
    });

    it("sends JSON bodies with credentials and encodes card ids", async () => {
        const f = vi.fn<FetchLike>().mockImplementation(() => Promise.resolve(json({ ok: true })));
        const api = new ApiClient(f);
        await api.event("nl:p/1", { type: "grade", grade: "good" });
        expect(f).toHaveBeenCalledWith("/v1/feed/nl%3Ap%2F1/events", {
            method: "POST",
            credentials: "include",
            headers: { "content-type": "application/json" },
            body: '{"type":"grade","grade":"good"}',
        });
        await api.feed(7);
        expect(f).toHaveBeenLastCalledWith("/v1/feed?limit=7", expect.objectContaining({ method: "GET", headers: {} }));
        await api.settings();
        await api.patchSettings({ sound: { enabled: true } });
        await api.stats();
        expect(f.mock.calls.map((c) => c[0])).toEqual([
            "/v1/feed/nl%3Ap%2F1/events",
            "/v1/feed?limit=7",
            "/v1/settings",
            "/v1/settings",
            "/v1/stats",
        ]);
    });

    it("turns error responses into ApiError and tolerates empty bodies", async () => {
        const f = vi.fn<FetchLike>().mockResolvedValueOnce(json({ error: "nope" }, 404));
        await expect(new ApiClient(f).stats()).rejects.toMatchObject({
            status: 404,
            message: "nope",
        } satisfies Partial<ApiError>);
        f.mockResolvedValueOnce(new Response("not json", { status: 500, statusText: "Boom" }));
        await expect(new ApiClient(f).stats()).rejects.toThrow("500 Boom");
        f.mockResolvedValueOnce(new Response(null, { status: 204 }));
        expect(await new ApiClient(f).stats()).toBeUndefined();
    });
});
