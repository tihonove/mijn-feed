import type { Page } from "@playwright/test";

import { bareCard, quizCard, realCard, scriptedCard } from "./cards.ts";
import { type AppServer, expect, test } from "./fixtures.ts";

const slotFrame = (page: Page, index: number) => page.locator(`.slot[data-index="${index}"] iframe`).contentFrame();

async function seedThree(server: AppServer) {
    await server.patchSettings({ deck: { newPerDay: 10, shuffle: false }, modes: { onlyStream: "nl" } });
    await server.addNote(scriptedCard("aap"));
    await server.addNote(quizCard("noot"));
    await server.addNote(bareCard("mies"));
}

test.beforeEach(async ({ server, page }) => {
    await seedThree(server);
    await page.goto("/auth/dev");
    await expect(page.getByLabel("Карточка 1")).toBeVisible();
});

test("a card renders in a sandboxed iframe, its script runs and gets active/inactive from the shell", async ({
    page,
}) => {
    const first = page.locator('.slot[data-index="0"] iframe');
    await expect(first).toHaveAttribute("sandbox", "allow-scripts");
    await expect(slotFrame(page, 0).locator("#state")).toHaveText("active");
    await expect(slotFrame(page, 0).locator("h1.word")).toHaveText("aap");
    // the next cards are mounted ahead of time but told they are not on screen
    await expect(slotFrame(page, 1).locator("h1.word")).toHaveText("de of het?");
    // only a window of iframes exists: 3 cards → 3 frames, no more
    await expect(page.locator("iframe")).toHaveCount(3);
    await expect(page.locator(".stream-tag").first()).toHaveText("Nederlands · новое");
});

test("grading through the rail reaches the scheduler and scrolls to the next card", async ({ page, server }) => {
    await page.getByRole("button", { name: /хорошо/ }).click();
    await expect(page.getByText(/Хорошо · повтор через/)).toBeVisible();
    await expect(slotFrame(page, 1).locator("h1.word")).toBeVisible();
    await expect(page.locator('.slot[data-index="1"]')).toBeInViewport({ ratio: 0.6 });
    await expect.poll(async () => (await server.deckState()).byState).toMatchObject({ learning: 1 });
});

test("a long press on 'хорошо' opens all four grades", async ({ page, server }) => {
    const good = page.getByRole("button", { name: /хорошо/ });
    await good.dispatchEvent("pointerdown");
    await page.waitForTimeout(600);
    await good.dispatchEvent("pointerup");
    const sheet = page.getByRole("menu", { name: "Оценка" });
    await expect(sheet.getByRole("menuitem")).toHaveCount(4);
    await sheet.getByRole("menuitem", { name: /легко/ }).click();
    await expect(page.getByText(/Легко · повтор через/)).toBeVisible();
    await expect.poll(async () => (await server.deckState()).byState).toMatchObject({ review: 1 });
});

test("a quiz card grades itself through the bridge", async ({ page, server }) => {
    await page.getByRole("button", { name: /хорошо/ }).click(); // leave "aap"
    const quiz = slotFrame(page, 1);
    await expect(quiz.locator("h1.word")).toHaveText("de of het?");
    await quiz.locator("#yes").click();
    await expect(page.getByText(/Верно · повтор через/)).toBeVisible();
    await expect.poll(async () => (await server.deckState()).byState).toMatchObject({ learning: 2 });
});

test("a facet without a presentation shows the built-in card with a reveal", async ({ page }) => {
    await page.getByRole("button", { name: /хорошо/ }).click();
    await page.getByRole("button", { name: /хорошо/ }).click();
    const builtin = slotFrame(page, 2);
    await expect(builtin.getByText("перевод mies")).toBeVisible();
    await expect(builtin.locator("#answer")).toBeHidden();
    await builtin.getByRole("button", { name: "Показать" }).click();
    await expect(builtin.locator("#answer")).toBeVisible();
    await expect(builtin.locator("#answer")).toContainText("mies");
});

test("the global sound switch is saved on the server; reactions give feedback", async ({ page, server }) => {
    await page.getByTitle("Звук для всех карточек").click();
    await expect(page.getByText("Звук включён для всех карточек")).toBeVisible();
    await expect.poll(async () => (await server.settings()).sound.enabled).toBe(true);
    await page.getByRole("button", { name: /скучно/ }).click();
    await expect(page.getByText("Поняла, такого поменьше")).toBeVisible();
});

test("a real production card: the word-order animation runs while active and the sentence alternates", async ({
    page,
    server,
}) => {
    await server.addNote(realCard("v2"));
    await server.patchSettings({ deck: { newOrder: "added" } });
    await page.reload();
    for (let i = 0; i < 3; i++) {
        await page.getByRole("button", { name: /хорошо/ }).click(); // aap, noot, mies
        await expect(page.locator(`.slot[data-index="${i + 1}"]`)).toBeInViewport({ ratio: 0.6 });
    }
    const seats = slotFrame(page, 3);
    await expect(seats.locator("html.active")).toBeAttached();
    await expect(seats.locator("#v2sent")).toContainText("Ik ga morgen naar huis.");
    await expect(seats.locator(".blk.verb")).toHaveText("ga");
    await expect(seats.locator("#v2sent")).toContainText("Morgen ga ik naar huis.", { timeout: 6000 });
});
