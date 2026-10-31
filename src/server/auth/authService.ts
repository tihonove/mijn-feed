// Who is calling: a signed-in owner (cookie session), a producer (bearer token) or nobody.
// Google OAuth with openid/email/profile only; a dev login for local work.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { ClockDIToken, DAY, type IClock } from "../clock.ts";
import { DatabaseDIToken, fromJson, type IDatabase, toJson } from "../db/database.ts";
import { token } from "../di/container.ts";
import type { HandlerResponse, Principal, RequestContext } from "../http/router.ts";
import { HttpError } from "../httpError.ts";

export interface AuthConfig {
    ownerEmails: string[];
    producerToken: string | null;
    googleClientId: string | null;
    googleClientSecret: string | null;
    devLogin: boolean;
    /** Public origin, e.g. https://feed.tihonove.dev; null = derive from the request. */
    publicOrigin: string | null;
    secureCookies: boolean;
}

export const AuthConfigDIToken = token<AuthConfig>("AuthConfig");

/** Injectable so tests never touch the network. */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
export const FetchDIToken = token<FetchLike>("Fetch");

export interface IAuthService {
    principal(ctx: RequestContext): Principal | null;
    requireUser(ctx: RequestContext): Principal;
    requireProducer(ctx: RequestContext): Principal;
    requireAny(ctx: RequestContext): Principal;
    startGoogle(ctx: RequestContext): HandlerResponse;
    finishGoogle(ctx: RequestContext): Promise<HandlerResponse>;
    devLogin(ctx: RequestContext): HandlerResponse;
    logout(ctx: RequestContext): HandlerResponse;
    origin(ctx: RequestContext): string;
}

export const AuthServiceDIToken = token<IAuthService>("AuthService");

const SESSION_COOKIE = "sid";
const STATE_COOKIE = "oauth_state";
const SESSION_TTL = 365 * DAY;

export function parseCookies(header: string | undefined): Record<string, string> {
    const out: Record<string, string> = {};
    for (const part of (header ?? "").split(";")) {
        const i = part.indexOf("=");
        if (i < 0) continue;
        out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    }
    return out;
}

const safeEqual = (a: string, b: string): boolean => {
    const ha = createHash("sha256").update(a).digest();
    const hb = createHash("sha256").update(b).digest();
    return timingSafeEqual(ha, hb);
};

interface GoogleTokenInfo {
    aud?: string;
    email?: string;
    email_verified?: string | boolean;
    name?: string;
    picture?: string;
}

export class AuthService implements IAuthService {
    public static readonly dependencies = [DatabaseDIToken, ClockDIToken, AuthConfigDIToken, FetchDIToken] as const;

    private readonly q;

    public constructor(
        db: IDatabase,
        private readonly clock: IClock,
        private readonly config: AuthConfig,
        private readonly fetch: FetchLike,
    ) {
        this.q = {
            get: db.raw.prepare("SELECT user, expires_at FROM sessions WHERE id = ?"),
            put: db.raw.prepare("INSERT INTO sessions (id, user, expires_at) VALUES (?,?,?)"),
            del: db.raw.prepare("DELETE FROM sessions WHERE id = ?"),
            purge: db.raw.prepare("DELETE FROM sessions WHERE expires_at < ?"),
        };
    }

    public principal(ctx: RequestContext): Principal | null {
        const auth = ctx.headers.authorization;
        if (auth?.startsWith("Bearer ")) {
            const presented = auth.slice(7).trim();
            if (this.config.producerToken && presented.length > 0 && safeEqual(presented, this.config.producerToken)) {
                return { kind: "producer", email: null, name: "producer", picture: null };
            }
            return null;
        }
        const sid = parseCookies(ctx.headers.cookie)[SESSION_COOKIE];
        if (!sid) return null;
        const row = this.q.get.get(sid) as { user: string; expires_at: number } | undefined;
        if (!row || row.expires_at < this.clock.now()) return null;
        const user = fromJson<Omit<Principal, "kind"> | null>(row.user, null);
        return user ? { kind: "user", ...user } : null;
    }

    public requireUser(ctx: RequestContext): Principal {
        const p = ctx.principal;
        if (p?.kind !== "user") throw new HttpError(401, "sign in required");
        return p;
    }

    public requireProducer(ctx: RequestContext): Principal {
        const p = ctx.principal;
        if (p?.kind !== "producer") throw new HttpError(401, "producer token required");
        return p;
    }

    public requireAny(ctx: RequestContext): Principal {
        const p = ctx.principal;
        if (!p) throw new HttpError(401, "sign in required");
        return p;
    }

    public origin(ctx: RequestContext): string {
        if (this.config.publicOrigin) return this.config.publicOrigin;
        const proto = (ctx.headers["x-forwarded-proto"] as string | undefined) ?? "http";
        const host = (ctx.headers["x-forwarded-host"] as string | undefined) ?? ctx.headers.host ?? "localhost";
        return `${proto}://${host}`;
    }

    public startGoogle(ctx: RequestContext): HandlerResponse {
        if (!this.config.googleClientId) throw new HttpError(503, "Google sign-in is not configured");
        const state = randomBytes(16).toString("hex");
        const params = new URLSearchParams({
            client_id: this.config.googleClientId,
            redirect_uri: `${this.origin(ctx)}/auth/callback`,
            response_type: "code",
            scope: "openid email profile",
            state,
            prompt: "select_account",
        });
        return {
            status: 302,
            headers: {
                location: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
                "set-cookie": this.cookie(STATE_COOKIE, state, 600),
            },
        };
    }

    public async finishGoogle(ctx: RequestContext): Promise<HandlerResponse> {
        const { googleClientId, googleClientSecret } = this.config;
        if (!googleClientId || !googleClientSecret) throw new HttpError(503, "Google sign-in is not configured");
        const code = ctx.url.searchParams.get("code");
        const state = ctx.url.searchParams.get("state");
        const expected = parseCookies(ctx.headers.cookie)[STATE_COOKIE];
        if (!code || !state || !expected || !safeEqual(state, expected)) throw new HttpError(400, "bad oauth state");
        const tokenRes = await this.fetch("https://oauth2.googleapis.com/token", {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                code,
                client_id: googleClientId,
                client_secret: googleClientSecret,
                redirect_uri: `${this.origin(ctx)}/auth/callback`,
                grant_type: "authorization_code",
            }).toString(),
        });
        if (!tokenRes.ok) throw new HttpError(502, `token exchange failed: ${tokenRes.status}`);
        const tokens = (await tokenRes.json()) as { id_token?: string };
        if (!tokens.id_token) throw new HttpError(502, "no id_token from Google");
        const infoRes = await this.fetch(
            `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(tokens.id_token)}`,
        );
        if (!infoRes.ok) throw new HttpError(502, `tokeninfo failed: ${infoRes.status}`);
        const info = (await infoRes.json()) as GoogleTokenInfo;
        const verified = info.email_verified === true || info.email_verified === "true";
        if (info.aud !== googleClientId || !verified || !info.email) throw new HttpError(401, "token not accepted");
        if (!this.isOwner(info.email)) throw new HttpError(403, `${info.email} is not allowed here`);
        return {
            status: 302,
            headers: {
                location: "/",
                "set-cookie": [
                    this.createSession({ email: info.email, name: info.name ?? null, picture: info.picture ?? null }),
                    this.cookie(STATE_COOKIE, "", 0),
                ],
            },
        };
    }

    public devLogin(ctx: RequestContext): HandlerResponse {
        const email = this.config.ownerEmails[0];
        if (!this.config.devLogin || !email) throw new HttpError(404, "not found");
        const requested = ctx.url.searchParams.get("email") ?? email;
        if (!this.isOwner(requested)) throw new HttpError(403, `${requested} is not allowed here`);
        return {
            status: 302,
            headers: {
                location: "/",
                "set-cookie": this.createSession({ email: requested, name: "dev", picture: null }),
            },
        };
    }

    public logout(ctx: RequestContext): HandlerResponse {
        const sid = parseCookies(ctx.headers.cookie)[SESSION_COOKIE];
        if (sid) this.q.del.run(sid);
        return { status: 302, headers: { location: "/", "set-cookie": this.cookie(SESSION_COOKIE, "", 0) } };
    }

    private isOwner(email: string): boolean {
        return this.config.ownerEmails.some((e) => e.toLowerCase() === email.toLowerCase());
    }

    private createSession(user: Omit<Principal, "kind">): string {
        const now = this.clock.now();
        this.q.purge.run(now);
        const id = randomBytes(32).toString("hex");
        this.q.put.run(id, toJson(user), now + SESSION_TTL);
        return this.cookie(SESSION_COOKIE, id, SESSION_TTL / 1000);
    }

    private cookie(name: string, value: string, maxAgeSeconds: number): string {
        const parts = [
            `${name}=${encodeURIComponent(value)}`,
            "Path=/",
            "HttpOnly",
            "SameSite=Lax",
            `Max-Age=${maxAgeSeconds}`,
        ];
        if (this.config.secureCookies) parts.push("Secure");
        return parts.join("; ");
    }
}
