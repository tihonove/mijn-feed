// Public API /v1 (stable: changes only by addition) plus /auth and /media.
import type { FeedEvent, ItemInput, NoteInput, PresentationInput, SettingsPatch } from "../../shared/types.ts";
import { AuthServiceDIToken, type IAuthService } from "../auth/authService.ts";
import { DeckServiceDIToken, type IDeckService } from "../deck/deckService.ts";
import { token } from "../di/container.ts";
import { FeedServiceDIToken, type IFeedService } from "../feed/feedService.ts";
import { HttpError } from "../httpError.ts";
import { type IItemService, ItemServiceDIToken } from "../items/itemService.ts";
import { type IMediaService, MediaServiceDIToken } from "../media/mediaService.ts";
import { type ISettingsService, SettingsServiceDIToken } from "../settings/settingsService.ts";
import type { HandlerResponse, RequestContext } from "./router.ts";
import { Router } from "./router.ts";
import { fileStream } from "./staticFiles.ts";

export const ApiDIToken = token<Api>("Api");

const clampLimit = (ctx: RequestContext, dflt: number, max: number): number => {
    const raw = Number(ctx.url.searchParams.get("limit") ?? dflt);
    if (!Number.isFinite(raw) || raw < 1) throw new HttpError(400, "limit: positive integer");
    return Math.min(max, Math.floor(raw));
};

export class Api {
    public static readonly dependencies = [
        AuthServiceDIToken,
        SettingsServiceDIToken,
        DeckServiceDIToken,
        ItemServiceDIToken,
        FeedServiceDIToken,
        MediaServiceDIToken,
    ] as const;

    public readonly router = new Router();

    public constructor(
        private readonly auth: IAuthService,
        private readonly settings: ISettingsService,
        deck: IDeckService,
        items: IItemService,
        feed: IFeedService,
        media: IMediaService,
    ) {
        const r = this.router;
        // Liveness for the cluster: no auth, no database.
        r.add("GET", "/healthz", () => ({ ok: true }));

        // --- auth ---
        r.add("GET", "/auth/google", (ctx) => auth.startGoogle(ctx));
        r.add("GET", "/auth/callback", (ctx) => auth.finishGoogle(ctx));
        r.add("GET", "/auth/dev", (ctx) => auth.devLogin(ctx));
        r.add("POST", "/auth/logout", (ctx) => auth.logout(ctx));
        r.add("GET", "/auth/logout", (ctx) => auth.logout(ctx));

        // --- viewer ---
        r.add("GET", "/v1/me", (ctx) => {
            const p = ctx.principal;
            if (!p) return { status: 401, body: { error: "sign in required", google: this.googleEnabled() } };
            return { email: p.email, name: p.name, picture: p.picture, kind: p.kind };
        });
        r.add("GET", "/v1/feed", (ctx) => {
            auth.requireAny(ctx);
            return { cards: feed.playlist(clampLimit(ctx, 20, 50)), settings: this.viewerSettings() };
        });
        r.add("POST", "/v1/feed/:id/events", async (ctx) => {
            auth.requireAny(ctx);
            const body = await ctx.json<FeedEvent>();
            return feed.event(ctx.params.id ?? "", body);
        });
        r.add("GET", "/v1/settings", (ctx) => {
            auth.requireAny(ctx);
            return settings.get();
        });
        r.add("PUT", "/v1/settings", async (ctx) => {
            auth.requireAny(ctx);
            return settings.patch(await ctx.json<SettingsPatch>());
        });
        r.add("PATCH", "/v1/settings", async (ctx) => {
            auth.requireAny(ctx);
            return settings.patch(await ctx.json<SettingsPatch>());
        });
        r.add("GET", "/v1/stats", (ctx) => {
            auth.requireAny(ctx);
            return { deck: deck.stats() };
        });

        // --- producers ---
        r.add("GET", "/v1/nl/state", (ctx) => {
            auth.requireAny(ctx);
            return deck.state();
        });
        r.add("POST", "/v1/nl/notes", async (ctx) => {
            auth.requireProducer(ctx);
            const body = await ctx.json<NoteInput | NoteInput[]>();
            const list = Array.isArray(body) ? body : [body];
            return { status: 201, body: { notes: list.map((n) => deck.addNote(n)) } };
        });
        r.add("POST", "/v1/nl/facets/:id/presentations", async (ctx) => {
            auth.requireProducer(ctx);
            const body = await ctx.json<PresentationInput>();
            return { status: 201, body: { id: deck.addPresentation(ctx.params.id ?? "", body) } };
        });
        r.add("POST", "/v1/streams/:stream/items", async (ctx) => {
            auth.requireProducer(ctx);
            const body = await ctx.json<ItemInput | ItemInput[]>();
            const list = Array.isArray(body) ? body : [body];
            return { status: 201, body: { items: list.map((i) => items.add(ctx.params.stream ?? "", i)) } };
        });
        r.add("POST", "/v1/media", async (ctx) => {
            auth.requireProducer(ctx);
            const bytes = await ctx.raw(25_000_000);
            const url = media.save(bytes, ctx.headers["content-type"] ?? "");
            return { status: 201, body: { url } };
        });
        r.add("GET", "/media/:name", (ctx): HandlerResponse => {
            auth.requireAny(ctx);
            const file = media.resolve(ctx.params.name ?? "");
            if (!file) throw new HttpError(404, "not found");
            return {
                headers: { "content-type": file.mime, "cache-control": "public, max-age=31536000, immutable" },
                stream: fileStream(file.path),
            } as HandlerResponse & { stream: NodeJS.ReadableStream };
        });
    }

    private googleEnabled(): boolean {
        try {
            this.auth.startGoogle({ headers: {}, url: new URL("http://x/") } as RequestContext);
            return true;
        } catch (e) {
            return !(e instanceof HttpError && e.status === 503);
        }
    }

    private viewerSettings() {
        const s = this.settings.get();
        return { sound: s.sound, grading: s.grading, streams: s.streams, modes: s.modes };
    }
}
