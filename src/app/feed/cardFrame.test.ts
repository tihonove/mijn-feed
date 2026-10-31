import { describe, expect, it } from "vitest";

import type { FeedCard } from "../../shared/types.ts";
import { BRIDGE_JS, cardDocument, isCardMessage, tintOf } from "./cardFrame.ts";

const card = (html: string, meta: Record<string, unknown> = {}): FeedCard => ({
    id: "nl:p1",
    stream: "nl",
    kind: "word",
    html,
    audio: null,
    meta,
});

describe("cardDocument", () => {
    it("wraps a fragment in the base document with the bridge and the tint", () => {
        const doc = cardDocument(card('<h1 class="word">fiets</h1>', { tint: "teal" }));
        expect(doc).toContain("<!doctype html>");
        expect(doc).toContain("--tint:#2ec4b6");
        expect(doc).toContain('<div class="inner"><h1 class="word">fiets</h1></div>');
        expect(doc).toContain("window.card=card");
        expect(doc).toContain('window.__cardId="nl:p1";');
        expect(doc).toContain("fonts.googleapis.com");
    });

    it("keeps a producer's own .inner layout and its script tags verbatim", () => {
        const html = '<div class="inner">x</div><script>card.on("active", function () {});</script>';
        const doc = cardDocument(card(html));
        expect(doc).not.toContain('<div class="inner"><div class="inner">');
        expect(doc).toContain(`<body>${html}</body>`);
    });

    it("only injects the bridge into a full page", () => {
        const doc = cardDocument(card("<html><head><title>t</title></head><body>b</body></html>"));
        expect(doc.startsWith("<html><head><script>")).toBe(true);
        expect(doc).toContain(BRIDGE_JS);
        expect(doc).not.toContain("--tint");
    });

    it("resolves tints by name or raw color", () => {
        expect(tintOf(card("", {}))).toBe("#ff6a1a");
        expect(tintOf(card("", { tint: "pink" }))).toBe("#ff5d8f");
        expect(tintOf(card("", { tint: "#123456" }))).toBe("#123456");
    });
});

describe("isCardMessage", () => {
    it("accepts only protocol messages", () => {
        expect(isCardMessage({ mijnfeed: 1, type: "ready", card: "nl:p1" })).toBe(true);
        expect(isCardMessage({ mijnfeed: 1, type: "ready" })).toBe(false);
        expect(isCardMessage({ type: "ready", card: "x" })).toBe(false);
        expect(isCardMessage({ mijnfeed: 2, type: "ready", card: "x" })).toBe(false);
        expect(isCardMessage(null)).toBe(false);
        expect(isCardMessage("x")).toBe(false);
    });
});
