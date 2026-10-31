// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FeedCard } from "../../shared/types.ts";
import { ApiError } from "../api/apiClient.ts";
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

    it("shows the error when a grade cannot be sent", async () => {
        // a 4xx is our bug, not the network: the queue rethrows it and the feed shows it
        const event = vi.fn(() => Promise.reject(new ApiError(400, "плохая оценка")));
        mount(fakeApi({ feed: vi.fn(() => Promise.resolve({ cards, settings: SETTINGS })), event }));
        await screen.findByLabelText("Карточка 1");
        const good = screen.getByText("хорошо").closest("button")!;
        fireEvent.pointerDown(good);
        fireEvent.pointerUp(good);
        await screen.findByText("плохая оценка");
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
        post({ mijnfeed: CARD_PROTOCOL, card: "nl:a#1", type: "play" });
        expect(speech.spoken).toEqual(["a"]);
        post({ mijnfeed: CARD_PROTOCOL, card: "nl:zzz#1", type: "play" }); // unknown card: ignored
        expect(speech.spoken).toEqual(["a"]);
        post({ mijnfeed: CARD_PROTOCOL, card: "nl:a", type: "answer", correct: true }); // bare id: not a showing
        expect(api.event).not.toHaveBeenCalledWith("nl:a", { type: "answer", correct: true });
        post({ mijnfeed: CARD_PROTOCOL, card: "nl:a#1", type: "answer", correct: true });
        await waitFor(() => {
            expect(api.event).toHaveBeenCalledWith("nl:a", { type: "answer", correct: true });
        });
        await screen.findByText("Верно");
        post({ type: "answer", correct: false }); // not ours: ignored
        post({ mijnfeed: CARD_PROTOCOL, card: "nl:a#1", type: "ready" });
    });

    it("loops: cards already behind come round again, cards ahead and info cards do not repeat", async () => {
        const info: FeedCard = { ...itemCard("q"), id: "info:quota:1", stream: "nl", kind: "info" };
        const page = [deckCard("a"), deckCard("b"), info, deckCard("c"), deckCard("d"), deckCard("e")];
        const feed = vi.fn(() => Promise.resolve({ cards: page, settings: SETTINGS }));
        const { container } = mount(fakeApi({ feed }));
        await screen.findByLabelText("Карточка 1");
        await flushEffects();
        act(() => {
            io.show(container.querySelector('.slot[data-index="3"]')!); // on "c": a, b, info are behind
        });
        await waitFor(() => {
            expect(feed).toHaveBeenCalledTimes(2);
        });
        await waitFor(() => {
            expect(container.querySelectorAll(".slot").length).toBe(8); // + a and b again, not info nor c/d/e
        });
        const ids = [...container.querySelectorAll(".slot[aria-label]")].map((el) => el.getAttribute("aria-label"));
        expect(ids).toHaveLength(8);
        expect(screen.queryByText("На сегодня всё")).toBeNull();
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

    it("refreshing from the end card brings the feed back when the server has cards again", async () => {
        const feed = vi
            .fn()
            .mockResolvedValueOnce({ cards: [], settings: SETTINGS })
            .mockResolvedValue({ cards, settings: SETTINGS });
        mount(fakeApi({ feed }));
        await screen.findByText("На сегодня всё");
        fireEvent.click(screen.getByText("Обновить"));
        await screen.findByLabelText("Карточка 1");
        expect(screen.queryByText("На сегодня всё")).toBeNull();
    });

    it("loads more near the end and ends only when the server has nothing beyond what is already ahead", async () => {
        const feed = vi
            .fn()
            .mockResolvedValueOnce({ cards, settings: SETTINGS })
            .mockResolvedValue({ cards: cards.slice(4), settings: SETTINGS }); // e, f: still ahead of the viewer
        const { container } = mount(fakeApi({ feed }));
        await screen.findByLabelText("Карточка 1");
        await flushEffects();
        act(() => {
            io.show(container.querySelector('.slot[data-index="4"]')!);
        });
        await waitFor(() => {
            expect(feed).toHaveBeenCalledTimes(2);
        });
        // nothing new, but the viewer is not on the last card yet: no end card, the question is asked again later
        expect(screen.queryByText("На сегодня всё")).toBeNull();
        act(() => {
            io.show(container.querySelector('.slot[data-index="5"]')!);
        });
        await waitFor(() => {
            expect(feed).toHaveBeenCalledTimes(3);
        });
        await screen.findByText("На сегодня всё");
        expect(container.querySelectorAll(".slot[aria-label]")).toHaveLength(6);
    });

    it("asks again after an empty page once the viewer moves on, and continues when cards come back", async () => {
        const three = cards.slice(0, 3);
        const feed = vi
            .fn()
            .mockResolvedValueOnce({ cards: three, settings: SETTINGS }) // initial
            .mockResolvedValueOnce({ cards: three, settings: SETTINGS }) // prefetch at card 1: nothing new
            .mockResolvedValue({ cards: [three[2]!, three[0]!], settings: SETTINGS }); // later: a is behind → fresh
        const { container } = mount(fakeApi({ feed }));
        await screen.findByLabelText("Карточка 1");
        await waitFor(() => {
            expect(feed).toHaveBeenCalledTimes(2);
        });
        await flushEffects();
        act(() => {
            io.show(container.querySelector('.slot[data-index="2"]')!);
        });
        await waitFor(() => {
            expect(container.querySelectorAll(".slot[aria-label]")).toHaveLength(4);
        });
        expect(screen.queryByText("На сегодня всё")).toBeNull();
    });
});
