// Serves the built React app (dist/app) with SPA fallback, and media files.
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";

import type { HandlerResponse } from "./router.ts";

const TYPES: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".webmanifest": "application/manifest+json",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
    ".woff2": "font/woff2",
    ".txt": "text/plain; charset=utf-8",
};

export interface FileResponse extends HandlerResponse {
    filePath: string;
}

export class StaticFiles {
    private readonly root: string | null;

    public constructor(root: string | null) {
        this.root = root ? resolve(root) : null;
    }

    /** null when the app is not built (dev: Vite serves it) or the path escapes the root. */
    public resolve(pathname: string): FileResponse | null {
        if (!this.root || !existsSync(this.root)) return null;
        let path = normalize(join(this.root, decodeURIComponent(pathname)));
        if (!path.startsWith(this.root + sep) && path !== this.root) return null;
        if (!existsSync(path) || statSync(path).isDirectory()) {
            if (extname(pathname) !== "") return null;
            path = join(this.root, "index.html");
            if (!existsSync(path)) return null;
        }
        const ext = extname(path);
        const hashed = /[.-][a-zA-Z0-9_]{8,}\.(js|css|woff2)$/.test(path);
        return {
            filePath: path,
            headers: {
                "content-type": TYPES[ext] ?? "application/octet-stream",
                "cache-control": hashed ? "public, max-age=31536000, immutable" : "no-cache",
            },
        };
    }
}

export const fileStream = (path: string) => createReadStream(path);
