import { expect, test } from "./fixtures.ts";

test("the app is installable: manifest, icon and a working service worker", async ({ page }) => {
    const manifest = await page.request.get("/manifest.webmanifest");
    expect(manifest.ok()).toBe(true);
    const json = (await manifest.json()) as { name?: string; start_url?: string; display?: string };
    expect(json.name).toContain("Mijn Feed");
    expect(json.display).toBe("standalone");
    expect((await page.request.get("/icon.svg")).ok()).toBe(true);

    await page.goto("/auth/dev");
    const active = await page.evaluate(async () => {
        const reg = await navigator.serviceWorker.ready;
        return reg.active?.state ?? null;
    });
    expect(["activating", "activated"]).toContain(active);
});

test("deep links and unknown paths fall back to the app shell, api paths do not", async ({ page }) => {
    await page.goto("/auth/dev");
    await page.goto("/settings");
    await expect(page.getByText("Mijn Feed").first()).toBeVisible();
    expect((await page.request.get("/v1/nope")).status()).toBe(404);
    expect((await page.request.get("/media/missing.mp3")).status()).toBe(404);
    expect((await page.request.get("/healthz")).ok()).toBe(true);
});
