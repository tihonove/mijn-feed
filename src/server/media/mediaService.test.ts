import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { MediaService } from "./mediaService.ts";

const dirs: string[] = [];
const make = () => {
    const dir = mkdtempSync(join(tmpdir(), "mijn-feed-media-"));
    dirs.push(dir);
    return { dir, media: new MediaService(dir) };
};
afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("MediaService", () => {
    it("saves by content hash and resolves the public name back", () => {
        const { dir, media } = make();
        const url = media.save(Buffer.from("mp3-bytes"), "audio/mpeg; charset=binary");
        expect(url).toMatch(/^\/media\/[a-f0-9]{32}\.mp3$/);
        expect(media.save(Buffer.from("mp3-bytes"), "audio/mpeg")).toBe(url);
        const name = url.slice("/media/".length);
        const resolved = media.resolve(name);
        expect(resolved?.mime).toBe("audio/mpeg");
        expect(resolved?.path).toBe(join(dir, name));
        expect(existsSync(resolved!.path)).toBe(true);
    });

    it("rejects unknown types, empty bodies and foreign names", () => {
        const { media } = make();
        expect(() => media.save(Buffer.from("x"), "application/zip")).toThrow(/unsupported media type/);
        expect(() => media.save(Buffer.alloc(0), "image/png")).toThrow(/empty body/);
        expect(media.resolve("../etc/passwd")).toBeNull();
        expect(media.resolve("0123456789abcdef0123456789abcdef.exe")).toBeNull();
        expect(media.resolve("not-a-hash.mp3")).toBeNull();
    });
});
