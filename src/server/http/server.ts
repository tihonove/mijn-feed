// node:http glue: principal → route → handler → response; static app as the fallback.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import { AuthServiceDIToken, type IAuthService } from "../auth/authService.ts";
import { token } from "../di/container.ts";
import type { Api } from "./api.ts";
import { ApiDIToken } from "./api.ts";
import { Context, errorResponse, type HandlerResponse, isHandlerResponse, send } from "./router.ts";
import type { StaticFiles } from "./staticFiles.ts";
import { fileStream } from "./staticFiles.ts";

export const StaticFilesDIToken = token<StaticFiles>("StaticFiles");
export const HttpServerDIToken = token<HttpServer>("HttpServer");

type StreamResponse = HandlerResponse & { stream?: NodeJS.ReadableStream };

export class HttpServer {
    public static readonly dependencies = [ApiDIToken, AuthServiceDIToken, StaticFilesDIToken] as const;

    public readonly server: Server;

    public constructor(
        private readonly api: Api,
        private readonly auth: IAuthService,
        private readonly staticFiles: StaticFiles,
    ) {
        this.server = createServer((req, res) => {
            void this.handle(req, res);
        });
    }

    public listen(port: number, host = "0.0.0.0"): Promise<void> {
        return new Promise((resolve) => this.server.listen(port, host, resolve));
    }

    public close(): Promise<void> {
        this.server.closeAllConnections();
        return new Promise((resolve, reject) =>
            this.server.close((e) => {
                if (e) reject(e);
                else resolve();
            }),
        );
    }

    public async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
        const method = req.method ?? "GET";
        const origin = `http://${req.headers.host ?? "localhost"}`;
        const pathname = new URL(req.url ?? "/", origin).pathname;
        try {
            const match = this.api.router.match(method, pathname);
            if (match) {
                const probe = new Context(req, match.params, null, origin);
                const principal = this.auth.principal(probe);
                const ctx = new Context(req, match.params, principal, origin);
                const out = await match.handler(ctx);
                if (isHandlerResponse(out) && (out as StreamResponse).stream) {
                    const { stream, ...rest } = out as StreamResponse;
                    stream?.on("error", (e: Error) => {
                        console.error(e);
                        res.destroy();
                    });
                    res.writeHead(rest.status ?? 200, rest.headers);
                    stream?.pipe(res);
                    return;
                }
                send(res, out);
                return;
            }
            const apiPath = /^\/(v1|auth|media)(\/|$)/.test(pathname);
            if (!apiPath && (method === "GET" || method === "HEAD")) {
                const file = this.staticFiles.resolve(pathname);
                if (file) {
                    res.writeHead(200, file.headers);
                    if (method === "HEAD") res.end();
                    else fileStream(file.filePath).pipe(res);
                    return;
                }
            }
            send(res, { status: 404, body: { error: "not found" } });
        } catch (e) {
            const out = errorResponse(e);
            if (out.status === 500) console.error(e);
            send(res, out);
        }
    }
}
