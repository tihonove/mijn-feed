import { scriptedCard } from "./cards.ts";
import { expect, test } from "./fixtures.ts";

test("settings: quick modes and the sound switch are written to the server", async ({ page, server }) => {
    await page.goto("/auth/dev");
    await page.goto("/#settings");
    await expect(page.getByRole("heading", { name: "Настройки" })).toBeVisible();
    await page.getByRole("button", { name: "Только голландский" }).click();
    await expect(page.getByText("Сохранено")).toBeVisible();
    await expect.poll(async () => (await server.settings()).modes.onlyStream).toBe("nl");
    await page.getByText("Озвучивать карточки").click();
    await expect.poll(async () => (await server.settings()).sound.enabled).toBe(true);
    await page.getByText("4 кнопки как в Anki").click();
    await expect.poll(async () => (await server.settings()).grading.buttons).toBe(4);
});

test("settings: the daily quota slider patches deck.newPerDay", async ({ page, server }) => {
    await page.goto("/auth/dev");
    await page.goto("/#settings");
    const slider = page.locator("#newPerDay");
    await expect(slider).toHaveValue("5");
    await slider.focus();
    for (let i = 0; i < 7; i++) await page.keyboard.press("ArrowRight");
    await expect(slider).toHaveValue("12");
    await expect.poll(async () => (await server.settings()).deck.newPerDay).toBe(12);
});

test("stats: today's numbers reflect the deck", async ({ page, server }) => {
    for (const id of ["a", "b", "c"]) await server.addNote(scriptedCard(id));
    await page.goto("/auth/dev");
    await page.goto("/#stats");
    await expect(page.getByRole("heading", { name: "Статистика" })).toBeVisible();
    await expect(page.getByText("новых осталось").locator("..")).toContainText("3");
    await expect(page.getByText("к повтору сейчас").locator("..")).toContainText("0");
});

test("navigation: the top bar switches between feed, stats and settings", async ({ page }) => {
    await page.goto("/auth/dev");
    await page.getByTitle("Статистика").click();
    await expect(page).toHaveURL(/#stats$/);
    await expect(page.getByRole("heading", { name: "Статистика" })).toBeVisible();
    await page.getByTitle("Настройки").click();
    await expect(page).toHaveURL(/#settings$/);
    await expect(page.getByRole("heading", { name: "Настройки" })).toBeVisible();
    await page.getByRole("link", { name: /Mijn Feed/ }).click();
    await expect(page.getByRole("heading", { name: "На сегодня всё" })).toBeVisible();
});

test("coming back from settings lands on the same card, without reloading the feed", async ({ page, server }) => {
    await server.patchSettings({ deck: { newPerDay: 10, shuffle: false }, modes: { onlyStream: "nl" } });
    for (const id of ["een", "twee", "drie", "vier", "vijf"]) await server.addNote(scriptedCard(id));
    await page.goto("/auth/dev");
    await expect(page.getByLabel("Карточка 1")).toBeVisible();
    const feedRequests: string[] = [];
    page.on("request", (r) => {
        if (r.url().includes("/v1/feed?")) feedRequests.push(r.url());
    });
    for (let i = 0; i < 2; i++) {
        await page.getByRole("button", { name: /хорошо/ }).click();
        await expect(page.locator(`.slot[data-index="${i + 1}"]`)).toBeInViewport({ ratio: 0.6 });
    }
    await page.getByTitle("Настройки").click();
    await expect(page.getByRole("heading", { name: "Настройки" })).toBeVisible();
    await expect(page.getByRole("button", { name: /хорошо/ })).toHaveCount(0);
    await page.getByRole("link", { name: /Mijn Feed/ }).click();
    await expect(page.locator('.slot[data-index="2"]')).toBeInViewport({ ratio: 0.6 });
    await expect(page.locator('.slot[data-index="2"] iframe').contentFrame().locator("h1.word")).toHaveText("drie");
    await expect(page.locator('.slot[data-index="2"] iframe').contentFrame().locator("#state")).toHaveText("active");
    expect(feedRequests.length).toBeLessThanOrEqual(2); // prefetches near the end, never a reload from scratch
});
