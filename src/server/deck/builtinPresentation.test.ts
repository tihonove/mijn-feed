import { describe, expect, it } from "vitest";

import { builtinPresentation } from "./builtinPresentation.ts";
import type { PickedFacet } from "./deckService.ts";

const picked = (facet: string, fields: Record<string, unknown>): PickedFacet => ({
    id: "f1",
    noteId: "n1",
    facet,
    state: "new",
    due: 0,
    isNew: true,
    overflow: false,
    note: { kind: "word", fields, tags: [], level: null },
    presentation: null,
    grades: { again: 0, hard: 0, good: 0, easy: 0 },
});

describe("builtinPresentation", () => {
    it("shows the word first and the meaning on reveal", () => {
        const html = builtinPresentation(
            picked("recognize", {
                word: "fiets",
                article: "de",
                meaning: "bike",
                example: { nl: "Ik fiets.", ru: "Я еду." },
            }),
        );
        expect(html).toContain('<span class="art">de</span>fiets');
        expect(html).toContain('<div class="meaning">bike</div>');
        expect(html).toContain("Ik fiets.");
        expect(html).not.toContain("card.on('active'");
    });

    it("asks for production from the meaning and escapes html", () => {
        const html = builtinPresentation(picked("produce", { word: "<b>", meaning: "a & b" }));
        expect(html).toContain("a &amp; b");
        expect(html).toContain("&lt;b&gt;");
        expect(html).toContain("по‑голландски");
    });

    it("autoplays audio for listening and falls back to the note id without fields", () => {
        const html = builtinPresentation(picked("listen", {}));
        expect(html).toContain("card.on('active'");
        expect(html).toContain("n1");
    });
});
