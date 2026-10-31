// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
    deckCard,
    fakeApi,
    flushEffects,
    itemCard,
    makeServices,
    Provide,
    SETTINGS,
    stubIntersectionObserver,
} from "../testUtils.tsx";
import { CARD_PROTOCOL } from "./cardFrame.ts";
import { Feed } from "./Feed.tsx";

let io: ReturnType<typeof stubIntersectionObserver>;

beforeEach(() => {
    io = stubIntersectionObserver();
    Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

const cards = [deckCard("a"), itemCard("b"), deckCard("c"), deckCard("d"), deckCard("e"), deckCard("f")];

const mount = (api = fakeApi({ feed: vi.fn(() => Promise.resolve({ cards, settings: SETTINGS })) })) => {
    const made = makeServices(api);
    const utils = render(
        <Provide services={made.services}>
            <Feed />
        </Provide>,
    );
    return { api, ...made, ...utils };
};

describe("Feed", () => {
    it("mounts iframes only around the current card and keeps placeholders elsewhere", async () => {
        const { container } = mount();
        await screen.findByLabelText("Карточка 1");
        const frames = () => container.querySelectorAll("iframe").length;
        expect(frames()).toBe(3); // current + 2 ahead
        const slot4 = container.querySelector('.slot[data-index="3"]')!;
        await flushEffects();
        act(() => {
            io.show(slot4);
        });
        await waitFor(() => {
            expect(frames()).toBe(4); // 1 behind + current + 2 ahead
        });
        expect(container.querySelector('.slot[data-index="0"] iframe')).toBeNull();
        expect(container.querySelector('.slot[data-index="0"] .placeholder')).toBeTruthy();
    });

    it("grades through the rail, reports the next interval and scrolls on", async () => {
        const event = vi.fn(() =>
            Promise.resolve({ ok: true as const, due: Date.now() + 600_000, state: "learning" as const }),
        );
        const { api } = mount(fakeApi({ feed: vi.fn(() => Promise.resolve({ cards, settings: SETTINGS })), event }));
        await screen.findByLabelText("Карточка 1");
        const good = screen.getByText("хорошо").closest("button")!;
        fireEvent.pointerDown(good);
        fireEvent.pointerUp(good);
        await waitFor(() => {
            expect(api.event).toHaveBeenCalledWith("nl:a", { type: "grade", grade: "good" });
        });
        await screen.findByText(/Хорошо · повтор через 10 мин/);
        expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    });

    it("sends 'seen' after a short dwell, 'skip' for items and reactions with a toast", async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        const { api, container } = mount();
        await screen.findByLabelText("Карточка 1");
        act(() => {
            vi.advanceTimersByTime(1000);
        });
        await waitFor(() => {
            expect(api.event).toHaveBeenCalledWith("nl:a", { type: "seen" });
        });
        await flushEffects();
        act(() => {
            io.show(container.querySelector('.slot[data-index="1"]')!);
        });
        await screen.findByText("дальше");
        fireEvent.click(screen.getByText("дальше"));
        fireEvent.click(screen.getByText("скучно"));
        await waitFor(() => {
            expect(api.event).toHaveBeenCalledWith("item:b", { type: "skip" });
            expect(api.event).toHaveBeenCalledWith("item:b", { type: "boring" });
        });
        await screen.findByText("Поняла, такого поменьше");
    });

    it("toggles the global sound, persists it and speaks the current card", async () => {
        const { api, speech } = mount();
        await screen.findByLabelText("Карточка 1");
        fireEvent.click(screen.getByTitle("Звук для всех карточек"));
        await waitFor(() => {
            expect(api.patchSettings).toHaveBeenCalledWith({ sound: { enabled: true } });
        });
        expect(speech.spoken).toEqual(["a"]);
        fireEvent.click(screen.getByText("ещё раз"));
        expect(speech.spoken).toEqual(["a", "a"]);
        fireEvent.click(screen.getByTitle("Звук для всех карточек"));
        await screen.findByText("Звук выключен");
    });

    it("handles messages from a card: play and answer", async () => {
        const { api, speech, container } = mount();
        await screen.findByLabelText("Карточка 1");
        expect(container.querySelector('.slot[data-index="0"] iframe')).toBeTruthy();
        await flushEffects();
        const post = (data: unknown) => {
            act(() => {
                window.dispatchEvent(new MessageEvent("message", { data }));
            });
        };
        post({ mijnfeed: CARD_PROTOCOL, card: "nl:a", type: "play" });
        expect(speech.spoken).toEqual(["a"]);
        post({ mijnfeed: CARD_PROTOCOL, card: "nl:zzz", type: "play" }); // unknown card: ignored
        expect(speech.spoken).toEqual(["a"]);
        post({ mijnfeed: CARD_PROTOCOL, card: "nl:a", type: "answer", correct: true });
        await waitFor(() => {
            expect(api.event).toHaveBeenCalledWith("nl:a", { type: "answer", correct: true });
        });
        await screen.findByText("Верно");
        post({ type: "answer", correct: false }); // not ours: ignored
        post({ mijnfeed: CARD_PROTOCOL, card: "nl:a", type: "ready" });
    });

    it("shows the end card when the feed is empty and an error with retry when loading fails", async () => {
        mount(fakeApi());
        await screen.findByText("На сегодня всё");
        cleanup();
        const feed = vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValue({ cards, settings: SETTINGS });
        mount(fakeApi({ feed }));
        await screen.findByText("Лента не загрузилась");
        fireEvent.click(screen.getByText("Попробовать ещё раз"));
        await screen.findByLabelText("Карточка 1");
    });

    it("loads more near the end and stops when nothing new arrives", async () => {
        const feed = vi.fn(() => Promise.resolve({ cards, settings: SETTINGS }));
        const { container } = mount(fakeApi({ feed }));
        await screen.findByLabelText("Карточка 1");
        await flushEffects();
        act(() => {
            io.show(container.querySelector('.slot[data-index="4"]')!);
        });
        await waitFor(() => {
            expect(feed).toHaveBeenCalledTimes(2);
        });
        await screen.findByText("На сегодня всё");
    });
});
