import type { Page } from "@playwright/test";

import { scriptedCard } from "./cards.ts";
import { expect, test } from "./fixtures.ts";

const frame = (page: Page, index: number) => page.locator(`.slot[data-index="${index}"] iframe`).contentFrame();

test.beforeEach(async ({ server }) => {
    await server.patchSettings({ deck: { newPerDay: 1, shuffle: false }, modes: { onlyStream: "nl" } });
    for (const id of ["een", "twee", "drie"]) await server.addNote(scriptedCard(id));
});

test("past the daily quota the feed shows a divider and goes on with cards 'сверх нормы'", async ({ page }) => {
    await page.goto("/auth/dev");
    await expect(page.getByLabel("Карточка 1")).toBeVisible();
    await expect(frame(page, 0).locator("h1.word")).toHaveText("een");
    await expect(frame(page, 1).getByText("Норма на сегодня сделана")).toBeVisible();
    await expect(page.locator('.slot[data-index="2"] .stream-tag')).toHaveText("Nederlands · новое · сверх нормы");
    await expect(page.getByRole("heading", { name: "На сегодня всё" })).toHaveCount(0);
});

test("the feed loops: after the last card the first ones come round again as reviews", async ({ page }) => {
    await page.goto("/auth/dev");
    await expect(page.getByLabel("Карточка 1")).toBeVisible();
    const good = page.getByRole("button", { name: /хорошо/ });
    await good.click(); // een → learning
    await expect(page.locator('.slot[data-index="1"]')).toBeInViewport({ ratio: 0.6 });
    await page.getByRole("button", { name: /дальше/ }).click(); // the divider
    await expect(page.locator('.slot[data-index="2"]')).toBeInViewport({ ratio: 0.6 });
    await good.click(); // twee
    await expect(page.locator('.slot[data-index="3"]')).toBeInViewport({ ratio: 0.6 });
    await good.click(); // drie: the deck is exhausted for the first pass
    // ...but the feed has already fetched the next page: een and twee again, now as scheduled reviews
    await expect(page.locator(".slot[aria-label]")).toHaveCount(6);
    await expect(page.locator('.slot[data-index="4"] .stream-tag')).toHaveText("Nederlands · сверх нормы");
    await expect(frame(page, 4).locator("h1.word")).toHaveText("een");
    await expect(page.getByRole("heading", { name: "На сегодня всё" })).toHaveCount(0);
});
