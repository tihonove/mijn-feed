// Tiny router over node:http: method + path pattern with ":params", JSON in/out, HttpError → status.
import type { IncomingMessage, ServerResponse } from "node:http";

import { HttpError } from "../httpError.ts";

export interface Principal {
    kind: "user" | "producer";
    email: string | null;
    name: string | null;
    picture: string | null;
}

export interface RequestContext {
    readonly method: string;
    readonly url: URL;
    readonly params: Record<string, string>;
    readonly headers: IncomingMessage["headers"];
    readonly principal: Principal | null;
    readonly req: IncomingMessage;
    json<T = unknown>(): Promise<T>;
    raw(maxBytes?: number): Promise<Buffer>;
}

export interface HandlerResponse {
    status?: number;
    headers?: Record<string, string | string[]>;
    body?: unknown;
    /** Raw body (not JSON-encoded). */
    rawBody?: Buffer | string;
}

export type Handler = (ctx: RequestContext) => unknown;

export const isHandlerResponse = (v: unknown): v is HandlerResponse =>
    typeof v === "object" && v !== null && ("status" in v || "rawBody" in v || "headers" in v || "body" in v);

interface Route {
    method: string;
    pattern: RegExp;
    keys: string[];
    handler: Handler;
}

export class Router {
    private readonly routes: Route[] = [];

    public add(method: string, path: string, handler: Handler): this {
        const keys: string[] = [];
        const source = path
            .split("/")
            .map((seg) => {
                if (seg.startsWith(":")) {
                    keys.push(seg.slice(1));
                    return "([^/]+)";
                }
                if (seg === "*") return "(.*)";
                return seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            })
            .join("/");
        this.routes.push({ method, pattern: new RegExp(`^${source}$`), keys, handler });
        return this;
    }

    public match(method: string, pathname: string): { handler: Handler; params: Record<string, string> } | null {
        for (const r of this.routes) {
            if (r.method !== method && r.method !== "*") continue;
            const m = r.pattern.exec(pathname);
            if (!m) continue;
            const params: Record<string, string> = {};
            r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1] ?? "")));
            if (r.keys.length === 0 && m[1] !== undefined) params["*"] = m[1];
            return { handler: r.handler, params };
        }
        return null;
    }
}

export function readBody(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        let size = 0;
        req.on("data", (chunk: Buffer) => {
            size += chunk.length;
            if (size > maxBytes) {
                reject(new HttpError(413, `body larger than ${maxBytes} bytes`));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on("end", () => {
            resolve(Buffer.concat(chunks));
        });
        req.on("error", reject);
    });
}

export class Context implements RequestContext {
    public readonly method: string;
    public readonly url: URL;
    public readonly headers: IncomingMessage["headers"];
    private body: Promise<Buffer> | null = null;

    public constructor(
        public readonly req: IncomingMessage,
        public readonly params: Record<string, string>,
        public readonly principal: Principal | null,
        origin: string,
    ) {
        this.method = req.method ?? "GET";
        this.url = new URL(req.url ?? "/", origin);
        this.headers = req.headers;
    }

    public raw(maxBytes = 5_000_000): Promise<Buffer> {
        this.body ??= readBody(this.req, maxBytes);
        return this.body;
    }

    public async json<T = unknown>(): Promise<T> {
        const buf = await this.raw();
        if (buf.length === 0) return {} as T;
        try {
            return JSON.parse(buf.toString("utf8")) as T;
        } catch {
            throw new HttpError(400, "invalid JSON body");
        }
    }
}

export function send(res: ServerResponse, out: unknown): void {
    const r: HandlerResponse = isHandlerResponse(out) ? out : { body: out };
    const status = r.status ?? (r.body === undefined && r.rawBody === undefined ? 204 : 200);
    const headers: Record<string, string | string[]> = { ...r.headers };
    let payload: Buffer | string | undefined = r.rawBody;
    if (payload === undefined && r.body !== undefined) {
        payload = JSON.stringify(r.body);
        headers["content-type"] ??= "application/json; charset=utf-8";
    }
    res.writeHead(status, headers);
    res.end(payload);
}

export function errorResponse(e: unknown): HandlerResponse {
    if (e instanceof HttpError) return { status: e.status, body: { error: e.message } };
    const message = e instanceof Error ? e.message : String(e);
    return { status: 500, body: { error: message } };
}
