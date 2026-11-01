// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App, routeFromHash } from "./App.tsx";
import { deckCard, fakeApi, makeServices, Provide, SETTINGS, stubIntersectionObserver } from "./testUtils.tsx";

beforeEach(() => {
    stubIntersectionObserver();
    window.location.hash = "";
});
afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

describe("routeFromHash", () => {
    it("maps hashes to routes", () => {
        expect(routeFromHash("")).toBe("feed");
        expect(routeFromHash("#settings")).toBe("settings");
        expect(routeFromHash("#/stats")).toBe("stats");
        expect(routeFromHash("#weird")).toBe("feed");
    });
});

describe("App", () => {
    it("shows the login page when signed out, with the Google button only when configured", async () => {
        const api = fakeApi({ me: vi.fn(() => Promise.resolve({ signedOut: true as const, google: true })) });
        render(
            <Provide services={makeServices(api).services}>
                <App />
            </Provide>,
        );
        expect((await screen.findByText("Войти через Google")).getAttribute("href")).toBe("/auth/google");
        cleanup();
        const dev = fakeApi({ me: vi.fn(() => Promise.resolve({ signedOut: true as const, google: false })) });
        render(
            <Provide services={makeServices(dev).services}>
                <App />
            </Provide>,
        );
        expect((await screen.findByText("Войти (dev)")).getAttribute("href")).toBe("/auth/dev");
    });

    it("treats a failing /me as signed out", async () => {
        const api = fakeApi({ me: vi.fn(() => Promise.reject(new Error("offline"))) });
        render(
            <Provide services={makeServices(api).services}>
                <App />
            </Provide>,
        );
        await screen.findByText("Войти (dev)");
    });

    it("renders the top bar and switches pages by hash when signed in", async () => {
        const api = fakeApi();
        render(
            <Provide services={makeServices(api).services}>
                <App />
            </Provide>,
        );
        await screen.findByText("На сегодня всё");
        expect(screen.getByTitle("Выйти (o@e.c)")).toBeTruthy();
        act(() => {
            window.location.hash = "#settings";
            window.dispatchEvent(new HashChangeEvent("hashchange"));
        });
        await screen.findByText("Настройки");
        act(() => {
            window.location.hash = "#stats";
            window.dispatchEvent(new HashChangeEvent("hashchange"));
        });
        await screen.findByText("Статистика");
        expect(api.stats).toHaveBeenCalled();
    });

    it("keeps the feed mounted under the pages, so coming back does not reload it", async () => {
        const api = fakeApi({ feed: vi.fn(() => Promise.resolve({ cards: [deckCard("a")], settings: SETTINGS })) });
        render(
            <Provide services={makeServices(api).services}>
                <App />
            </Provide>,
        );
        await screen.findByLabelText("Карточка 1");
        expect(screen.getByText("хорошо")).toBeTruthy();
        act(() => {
            window.location.hash = "#settings";
            window.dispatchEvent(new HashChangeEvent("hashchange"));
        });
        await screen.findByText("Настройки");
        expect(screen.getByLabelText("Карточка 1")).toBeTruthy(); // still there, behind the page
        expect(screen.queryByText("хорошо")).toBeNull(); // but without the rail
        const loads = api.feed.mock.calls.length;
        act(() => {
            window.location.hash = "";
            window.dispatchEvent(new HashChangeEvent("hashchange"));
        });
        await screen.findByText("хорошо");
        expect(api.feed.mock.calls.length).toBe(loads); // no reload from scratch
    });
});
