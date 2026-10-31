import { expect, OWNER_EMAIL, test } from "./fixtures.ts";

test("without a session the login page is shown and the viewer api is closed", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: "Войти (dev)" })).toBeVisible();
    // no Google client configured on this server → only the dev login is offered
    await expect(page.getByRole("link", { name: "Войти через Google" })).toHaveCount(0);
    expect((await page.request.get("/v1/feed")).status()).toBe(401);
    expect((await page.request.get("/v1/settings")).status()).toBe(401);
});

test("dev login opens the feed as the owner; logout returns to the login page", async ({ page }) => {
    await page.goto("/auth/dev");
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { name: "На сегодня всё" })).toBeVisible();
    await expect(page.getByTitle(`Выйти (${OWNER_EMAIL})`)).toBeVisible();
    const me = await page.request.get("/v1/me");
    expect(me.ok()).toBe(true);
    expect(await me.json()).toMatchObject({ email: OWNER_EMAIL, kind: "user" });

    await page.goto("/auth/logout");
    await expect(page.getByRole("link", { name: "Войти (dev)" })).toBeVisible();
    expect((await page.request.get("/v1/me")).status()).toBe(401);
});

test("the producer token opens the content api but not with a wrong token", async ({ server }) => {
    const ok = await fetch(`${server.url}/v1/nl/state`, { headers: { authorization: "Bearer e2e-producer-token" } });
    expect(ok.status).toBe(200);
    const bad = await fetch(`${server.url}/v1/nl/state`, { headers: { authorization: "Bearer nope" } });
    expect(bad.status).toBe(401);
});
