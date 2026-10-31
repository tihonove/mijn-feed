// Uploaded files (mp3, images) on the data volume, addressed by content hash.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, normalize, resolve, sep } from "node:path";

import { token } from "../di/container.ts";
import { HttpError } from "../httpError.ts";

export interface IMediaService {
    /** Stores the bytes; returns the public URL (/media/<hash>.<ext>). */
    save(bytes: Buffer, mime: string): string;
    /** Absolute path for a public name, or null when the name is not ours. */
    resolve(name: string): { path: string; mime: string } | null;
}

export const MediaServiceDIToken = token<IMediaService>("MediaService");
export const MediaDirDIToken = token<string>("MediaDir");

export const MIME_TO_EXT: Record<string, string> = {
    "audio/mpeg": "mp3",
    "audio/mp4": "m4a",
    "audio/ogg": "ogg",
    "audio/webm": "weba",
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/svg+xml": "svg",
};
const EXT_TO_MIME = Object.fromEntries(Object.entries(MIME_TO_EXT).map(([m, e]) => [e, m]));

export class MediaService implements IMediaService {
    public static readonly dependencies = [MediaDirDIToken] as const;

    private readonly dir: string;

    public constructor(dir: string) {
        this.dir = resolve(dir);
        mkdirSync(this.dir, { recursive: true });
    }

    public save(bytes: Buffer, mime: string): string {
        const ext = MIME_TO_EXT[mime.split(";")[0]?.trim() ?? ""];
        if (!ext) throw new HttpError(415, `unsupported media type: ${mime}`);
        if (bytes.length === 0) throw new HttpError(400, "empty body");
        const name = `${createHash("sha256").update(bytes).digest("hex").slice(0, 32)}.${ext}`;
        writeFileSync(join(this.dir, name), bytes);
        return `/media/${name}`;
    }

    public resolve(name: string): { path: string; mime: string } | null {
        if (!/^[a-f0-9]{32}\.[a-z0-9]+$/.test(name)) return null;
        const path = normalize(join(this.dir, name));
        if (!path.startsWith(this.dir + sep)) return null;
        const mime = EXT_TO_MIME[name.split(".")[1] ?? ""];
        return mime && existsSync(path) ? { path, mime } : null;
    }
}
