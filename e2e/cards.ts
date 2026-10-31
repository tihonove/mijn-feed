// Card fixtures: small presentations that exercise the card protocol the way real producers' cards do.
import type { NoteInput } from "../src/shared/types.ts";

/** A card whose script reports what the bridge told it: "script ran" → "active" / "inactive". */
export const scriptedCard = (id: string, word = id): NoteInput => ({
    id,
    kind: "word",
    level: "A1",
    tags: ["e2e"],
    fields: { word, meaning: `meaning of ${word}` },
    facets: [
        {
            facet: "recognize",
            presentations: [
                {
                    id: `${id}:main`,
                    html: `<div class="eyebrow"><span class="dot"></span>Слово</div>
<div class="stage"><h1 class="word">${word}</h1><p id="state">loaded</p></div>
<div class="caption"><h2>${word}</h2><p>e2e</p></div>
<script>
  var s = document.getElementById("state");
  s.textContent = "script ran";
  card.on("active", function () { s.textContent = "active"; });
  card.on("inactive", function () { s.textContent = "inactive"; });
</script>`,
                    meta: { tint: "teal", say: word, title: word },
                },
            ],
        },
    ],
});

/** A quiz: two buttons that grade the card through the bridge. */
export const quizCard = (id: string): NoteInput => ({
    id,
    kind: "grammar",
    level: "A1",
    tags: ["e2e", "quiz"],
    fields: { topic: id },
    facets: [
        {
            facet: "apply",
            presentations: [
                {
                    id: `${id}:quiz`,
                    html: `<div class="eyebrow"><span class="dot"></span>Квиз</div>
<div class="stage"><h1 class="word">de of het?</h1>
<button id="yes">het</button> <button id="no">de</button></div>
<div class="caption"><h2>${id}</h2></div>
<script>
  document.getElementById("yes").onclick = function () { card.send({ type: "answer", correct: true }); };
  document.getElementById("no").onclick = function () { card.send({ type: "answer", correct: false }); };
</script>`,
                    meta: { tint: "lilac" },
                },
            ],
        },
    ],
});

/** A note with a facet but no presentation: the shell renders the built-in card. */
export const bareCard = (id: string): NoteInput => ({
    id,
    kind: "word",
    fields: { word: id, article: "de", meaning: `перевод ${id}` },
    facets: [{ facet: "produce" }],
});
