import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { StaticFiles } from "./staticFiles.ts";

let root: string;
beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "mijn-feed-static-"));
    writeFileSync(join(root, "index.html"), "<h1>app</h1>");
    mkdirSync(join(root, "assets"));
    writeFileSync(join(root, "assets", "index-Ab12Cd34.js"), "js");
    writeFileSync(join(root, "sw.js"), "sw");
});
afterAll(() => {
    rmSync(root, { recursive: true, force: true });
});

describe("StaticFiles", () => {
    it("serves files with types and caching, falls back to index.html for app routes", () => {
        const s = new StaticFiles(root);
        expect(s.resolve("/")?.filePath).toBe(join(root, "index.html"));
        expect(s.resolve("/settings")?.headers?.["content-type"]).toBe("text/html; charset=utf-8");
        const asset = s.resolve("/assets/index-Ab12Cd34.js");
        expect(asset?.headers?.["cache-control"]).toContain("immutable");
        expect(s.resolve("/sw.js")?.headers?.["cache-control"]).toBe("no-cache");
        expect(s.resolve("/missing.png")).toBeNull();
        expect(s.resolve("/../../etc/passwd")).toBeNull();
    });

    it("returns null without a build directory", () => {
        expect(new StaticFiles(null).resolve("/")).toBeNull();
        expect(new StaticFiles(join(root, "nope")).resolve("/")).toBeNull();
        const empty = mkdtempSync(join(tmpdir(), "mijn-feed-empty-"));
        expect(new StaticFiles(empty).resolve("/x")).toBeNull();
        rmSync(empty, { recursive: true, force: true });
    });
});
