// Thin typed client over /v1. The only place the app talks to the network.
import type { DeckStats, FeedCard, FeedEvent, FeedEventResult, Settings, SettingsPatch } from "../../shared/types.ts";

export interface MeResponse {
    email: string;
    name: string | null;
    picture: string | null;
    kind: "user" | "producer";
}

export interface FeedResponse {
    cards: FeedCard[];
    settings: Pick<Settings, "sound" | "grading" | "streams" | "modes">;
}

export class ApiError extends Error {
    public constructor(
        public readonly status: number,
        message: string,
        public readonly body: unknown = null,
    ) {
        super(message);
    }
}

export interface IApiClient {
    me(): Promise<MeResponse | { signedOut: true; google: boolean }>;
    feed(limit: number): Promise<FeedResponse>;
    event(cardId: string, event: FeedEvent): Promise<FeedEventResult>;
    settings(): Promise<Settings>;
    patchSettings(patch: SettingsPatch): Promise<Settings>;
    stats(): Promise<{ deck: DeckStats }>;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class ApiClient implements IApiClient {
    public constructor(private readonly fetchImpl: FetchLike = (i, init) => fetch(i, init)) {}

    public async me(): Promise<MeResponse | { signedOut: true; google: boolean }> {
        const res = await this.fetchImpl("/v1/me", { credentials: "include" });
        if (res.status === 401) {
            const body = (await res.json()) as { google?: boolean };
            return { signedOut: true, google: body.google === true };
        }
        return this.unwrap<MeResponse>(res);
    }

    public feed(limit: number): Promise<FeedResponse> {
        return this.request<FeedResponse>("GET", `/v1/feed?limit=${limit}`);
    }

    public event(cardId: string, event: FeedEvent): Promise<FeedEventResult> {
        return this.request<FeedEventResult>("POST", `/v1/feed/${encodeURIComponent(cardId)}/events`, event);
    }

    public settings(): Promise<Settings> {
        return this.request<Settings>("GET", "/v1/settings");
    }

    public patchSettings(patch: SettingsPatch): Promise<Settings> {
        return this.request<Settings>("PUT", "/v1/settings", patch);
    }

    public stats(): Promise<{ deck: DeckStats }> {
        return this.request<{ deck: DeckStats }>("GET", "/v1/stats");
    }

    private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
        const res = await this.fetchImpl(path, {
            method,
            credentials: "include",
            headers: body === undefined ? {} : { "content-type": "application/json" },
            body: body === undefined ? undefined : JSON.stringify(body),
        });
        return this.unwrap<T>(res);
    }

    private async unwrap<T>(res: Response): Promise<T> {
        if (res.status === 204) return undefined as T;
        const text = await res.text();
        const json = parseJson(text);
        if (!res.ok) {
            const message = (json as { error?: string } | null)?.error ?? `${res.status} ${res.statusText}`;
            throw new ApiError(res.status, message, json);
        }
        return json as T;
    }
}

function parseJson(text: string): unknown {
    try {
        return text ? JSON.parse(text) : null;
    } catch {
        return null;
    }
}
