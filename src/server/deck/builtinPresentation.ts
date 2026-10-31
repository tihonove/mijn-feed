// Plain fallback presentation for a facet that has no creative one yet.
import type { PickedFacet } from "./deckService.ts";

const esc = (s: string | null | undefined): string =>
    (s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);

const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

export function builtinPresentation(facet: PickedFacet): string {
    const f = facet.note.fields;
    const front = str(f.word) ?? str(f.title) ?? str(f.front) ?? facet.noteId;
    const back = str(f.meaning) ?? str(f.back) ?? str(f.summary) ?? "";
    const article = str(f.article);
    const example = f.example as { nl?: string; ru?: string } | undefined;
    const exampleHtml = example?.nl
        ? `<div class="ex"><span class="nl">${esc(example.nl)}</span><span class="ru">${esc(example.ru)}</span></div>`
        : "";
    const headline = `<h1 class="word">${article ? `<span class="art">${esc(article)}</span>` : ""}${esc(front)}</h1>`;
    let question: string;
    let answer: string;
    switch (facet.facet) {
        case "produce":
            question = `<div class="meaning">${esc(back)}</div><div class="hint">Как это по‑голландски?</div>`;
            answer = headline + exampleHtml;
            break;
        case "listen":
            question = `<div class="hint">Послушай и вспомни слово</div>`;
            answer = headline + `<div class="meaning">${esc(back)}</div>` + exampleHtml;
            break;
        default:
            question = headline;
            answer = `<div class="meaning">${esc(back)}</div>` + exampleHtml;
    }
    const autoplay = facet.facet === "listen" ? "card.on('active', () => card.send({ type: 'play' }));" : "";
    return `<div class="builtin">
  <div class="q">${question}</div>
  <button class="reveal" id="reveal">Показать</button>
  <div class="a" id="answer" hidden>${answer}</div>
</div>
<style>.builtin{display:grid;gap:18px;justify-items:start}.hint{color:var(--fg-dim);font-weight:700}.reveal{padding:10px 18px;border-radius:999px;background:rgba(255,255,255,.1);font-weight:800}</style>
<script>
document.getElementById('reveal').addEventListener('click', () => {
  document.getElementById('answer').hidden = false;
  document.getElementById('reveal').hidden = true;
  card.send({ type: 'reveal' });
});
${autoplay}
</script>`;
}
