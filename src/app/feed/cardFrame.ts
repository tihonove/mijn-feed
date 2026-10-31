// Builds the iframe document for a card: base tokens + classes the cookbook relies on,
// and the bridge (`card.on` / `card.send`) that speaks the card protocol v1 with the shell.
import type { FeedCard } from "../../shared/types.ts";

export const CARD_PROTOCOL = 1;

/** Shell → card. */
export type ShellMessage =
    { type: "active" } | { type: "inactive" } | { type: "theme"; tokens: Record<string, string> };
/** Card → shell. */
export type CardMessage =
    { type: "ready" } | { type: "play"; src?: string } | { type: "answer"; correct: boolean } | { type: "reveal" };

export const isCardMessage = (data: unknown): data is CardMessage & { mijnfeed: number; card: string } => {
    if (typeof data !== "object" || data === null) return false;
    const d = data as { mijnfeed?: unknown; type?: unknown; card?: unknown };
    return d.mijnfeed === CARD_PROTOCOL && typeof d.type === "string" && typeof d.card === "string";
};

export const TINTS: Record<string, string> = {
    oranje: "#ff6a1a",
    teal: "#2ec4b6",
    mustard: "#ffc43d",
    pink: "#ff5d8f",
    lilac: "#9b8cff",
    mint: "#7ee081",
};

const FONTS =
    "https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,800&family=Nunito:wght@500;700;900&display=swap";

export const BASE_CSS = `
:root{--bg:#0d1020;--fg:#f4f1ea;--fg-dim:rgba(244,241,234,.66);--fg-faint:rgba(244,241,234,.14);
--oranje:#ff6a1a;--teal:#2ec4b6;--mustard:#ffc43d;--pink:#ff5d8f;--lilac:#9b8cff;--mint:#7ee081;--ok:#7ee081;--bad:#ff6b6b;
--display:"Bricolage Grotesque",ui-sans-serif,system-ui,sans-serif;--body:"Nunito",ui-rounded,system-ui,sans-serif;
--safe-top:env(safe-area-inset-top,0px);--safe-bottom:env(safe-area-inset-bottom,0px);
--pad-top:calc(var(--safe-top) + 88px);--pad-bottom:calc(var(--safe-bottom) + 24px);--pad-right:80px;color-scheme:dark}
*{box-sizing:border-box}html,body{height:100%}
body{margin:0;background:radial-gradient(120% 80% at 50% 0%,color-mix(in oklab,var(--tint) 32%,var(--bg)),var(--bg) 70%);
color:var(--fg);font-family:var(--body);font-size:16px;line-height:1.4;overflow:hidden}
body::after{content:"";position:fixed;inset:auto 0 0 0;height:34%;background:linear-gradient(to top,rgba(13,16,32,.9),transparent);pointer-events:none;z-index:0}
.inner{position:relative;z-index:1;height:100%;max-width:560px;margin:0 auto;display:grid;grid-template-rows:auto 1fr auto;
padding:var(--pad-top) var(--pad-right) var(--pad-bottom) 16px;gap:12px}
.eyebrow{display:flex;gap:8px;align-items:center;font-size:11px;font-weight:900;letter-spacing:.14em;text-transform:uppercase;color:var(--tint)}
.eyebrow .dot{width:8px;height:8px;border-radius:50%;background:var(--tint);box-shadow:0 0 12px var(--tint)}
.stage{display:flex;flex-direction:column;justify-content:center;gap:14px;min-height:0;min-width:0}
.caption{display:grid;gap:6px}
.caption h2{margin:0;font-family:var(--display);font-weight:800;font-size:clamp(20px,5.5vw,26px);line-height:1.15;text-wrap:balance;letter-spacing:-.015em}
.caption p{margin:0;color:var(--fg-dim);font-size:15px;max-width:34em}.caption p b{color:var(--fg)}
.nl{font-family:var(--display);font-weight:800;color:var(--fg)}.ru{color:var(--fg-dim)}
.word{font-family:var(--display);font-weight:800;font-size:clamp(44px,15vw,76px);line-height:.95;letter-spacing:-.03em;margin:0;text-wrap:balance}
.word .art{color:var(--fg-dim);font-weight:500;font-size:.42em;letter-spacing:0;vertical-align:.5em;margin-right:.1em}
.ipa{font-size:15px;color:var(--fg-dim);font-weight:700}.ipa b{color:var(--tint);font-weight:900}
.meaning{font-size:clamp(18px,5vw,22px);font-weight:700;line-height:1.3}
.ex{display:grid;gap:2px;padding:12px 14px;border-left:3px solid var(--tint);background:rgba(255,255,255,.04);border-radius:0 12px 12px 0}
.ex .nl{font-size:17px}.ex .ru{font-size:14px}
.hint{color:var(--fg-dim);font-weight:700}
.chips{display:flex;flex-wrap:wrap;gap:8px}.chip{padding:6px 12px;border-radius:999px;background:rgba(255,255,255,.08);font-size:14px;font-weight:700}
.chip b{font-family:var(--display);font-weight:800;color:var(--tint)}
.illus{width:100%;max-width:100%;height:auto;display:block;margin:0 auto}.illus svg{width:100%;height:auto;display:block;overflow:visible}
button{font:inherit;color:inherit;background:none;border:0;padding:0;cursor:pointer}
@media (prefers-reduced-motion:reduce){.active *{animation-duration:0s!important;transition-duration:0s!important}}
`;

export const BRIDGE_JS = `
(function(){
  var handlers={};
  var CARD_ID=window.__cardId||null;
  var card={
    on:function(type,fn){(handlers[type]=handlers[type]||[]).push(fn);return card;},
    send:function(msg){parent.postMessage(Object.assign({mijnfeed:${CARD_PROTOCOL},card:CARD_ID},msg),'*');},
    active:false
  };
  window.card=card;
  window.addEventListener('message',function(e){
    var d=e.data; if(!d||d.mijnfeed!==${CARD_PROTOCOL}) return;
    if(d.type==='active'){card.active=true;document.documentElement.classList.add('active');}
    if(d.type==='inactive'){card.active=false;document.documentElement.classList.remove('active');}
    if(d.type==='theme'&&d.tokens){for(var k in d.tokens)document.documentElement.style.setProperty(k,d.tokens[k]);}
    (handlers[d.type]||[]).forEach(function(f){try{f(d);}catch(err){console.error(err);}});
  });
  window.addEventListener('DOMContentLoaded',function(){card.send({type:'ready'});});
})();
`;

export function tintOf(card: FeedCard): string {
    const t = card.meta.tint;
    if (typeof t !== "string") return TINTS.oranje ?? "#ff6a1a";
    return TINTS[t] ?? t;
}

/**
 * Full HTML document for the card's iframe (`srcdoc`). The card's own html may bring style and script tags.
 * `frameId` is what the bridge sends back as `card`; the shell uses it to tell apart repeated showings of one card.
 */
export function cardDocument(card: FeedCard, frameId: string = card.id): string {
    const fullPage = /<html[\s>]/i.test(card.html);
    if (fullPage) {
        // A producer shipped a whole page: only inject the bridge.
        return card.html.replace(/<head([^>]*)>/i, `<head$1><script>${cardIdJs(frameId)}${BRIDGE_JS}</script>`);
    }
    const hasInner = card.html.includes('class="inner"');
    const body = hasInner ? card.html : `<div class="inner">${card.html}</div>`;
    return `<!doctype html><html lang="nl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<link rel="stylesheet" href="${FONTS}">
<style>:root{--tint:${tintOf(card)}}${BASE_CSS}</style>
<script>${cardIdJs(frameId)}${BRIDGE_JS}</script>
</head><body>${body}</body></html>`;
}

const cardIdJs = (frameId: string) => `window.__cardId=${JSON.stringify(frameId)};`;
