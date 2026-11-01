// Shared test doubles for the app: a scripted api, a silent sound player, in-memory events.
import { act } from "@testing-library/react";
import type { ReactNode } from "react";
import { type Mock, vi } from "vitest";

import type { DeckStats, FeedCard, Settings } from "../shared/types.ts";
import type { IApiClient } from "./api/apiClient.ts";
import { SoundPlayer, type SpeechLike } from "./audio/soundPlayer.ts";
import { EventQueue } from "./events/eventQueue.ts";
import { type Services, ServicesContext } from "./services.ts";

export const SETTINGS: Settings = {
    streams: {
        nl: { share: 60, title: "Nederlands" },
        news: { share: 25, title: "Новости" },
        facts: { share: 15, title: "Факты" },
    },
    mixer: { maxRun: 3, freshnessHours: 48, reactionWindowDays: 7, reactionStep: 0.15 },
    modes: { onlyStream: null, mutedStreams: [], until: null },
    deck: {
        requestRetention: 0.9,
        newPerDay: 5,
        reviewsPerDay: 100,
        learningSteps: ["1m", "10m"],
        relearningSteps: ["10m"],
        maximumInterval: 365,
        newOrder: "added",
        burySiblings: true,
        shuffle: true,
        leechThreshold: 8,
        dayStartHour: 4,
        timezone: "Europe/Amsterdam",
    },
    sound: { enabled: false },
    grading: { buttons: 2 },
};

export const STATS: DeckStats = {
    today: { dueNow: 3, newLeft: 2, newDone: 1, reviewsDone: 4 },
    forecast: Array.from({ length: 14 }, (_, i) => ({ day: `2026-11-${String(i + 1).padStart(2, "0")}`, due: i })),
    retention30d: 0.875,
    cards: { new: 10, learning: 2, young: 5, mature: 7, suspended: 1 },
    reviewsPerDay30d: new Array<number>(30).fill(2),
    notes: 12,
};

export const deckCard = (id: string, over: Partial<FeedCard> = {}): FeedCard => ({
    id: `nl:${id}`,
    stream: "nl",
    kind: "word",
    html: `<h1 class="word">${id}</h1>`,
    audio: null,
    meta: { say: id },
    grades: {
        again: Date.now() + 60_000,
        hard: Date.now() + 300_000,
        good: Date.now() + 600_000,
        easy: Date.now() + 86_400_000,
    },
    ...over,
});

export const itemCard = (id: string): FeedCard => ({
    id: `item:${id}`,
    stream: "news",
    kind: null,
    html: `<p>${id}</p>`,
    audio: null,
    meta: {},
});

export type MockedApi = { [K in keyof IApiClient]: Mock<IApiClient[K]> };

export function fakeApi(over: Partial<MockedApi> = {}): MockedApi {
    const api: MockedApi = {
        me: vi.fn(() => Promise.resolve({ email: "o@e.c", name: "O", picture: null, kind: "user" as const })),
        feed: vi.fn(() => Promise.resolve({ cards: [] as FeedCard[], settings: SETTINGS })),
        event: vi.fn(() => Promise.resolve({ ok: true as const })),
        settings: vi.fn(() => Promise.resolve(SETTINGS)),
        patchSettings: vi.fn(() => Promise.resolve(SETTINGS)),
        stats: vi.fn(() => Promise.resolve({ deck: STATS })),
        ...over,
    };
    return api;
}

export const silentSpeech = (): SpeechLike & { spoken: string[] } => ({
    spoken: [],
    speak(text, _lang, onEnd) {
        this.spoken.push(text);
        onEnd();
    },
    cancel: () => undefined,
});

export function makeServices(api: IApiClient = fakeApi()) {
    const speech = silentSpeech();
    const services: Services = {
        api,
        sound: new SoundPlayer(() => {
            throw new Error("no Audio in tests");
        }, speech),
        events: new EventQueue(api, null),
    };
    return { services, speech };
}

export function Provide({ services, children }: { services: Services; children: ReactNode }) {
    return <ServicesContext value={services}>{children}</ServicesContext>;
}

/** Lets React run passive effects scheduled by a non-act update (a resolved fetch). */
export const flushEffects = () => act(async () => Promise.resolve());

/** jsdom has no IntersectionObserver; this one reports the given ratio for every observed element. */
export function stubIntersectionObserver() {
    const instances: { cb: IntersectionObserverCallback; els: Element[] }[] = [];
    class IO {
        public readonly els: Element[] = [];
        public constructor(public readonly cb: IntersectionObserverCallback) {
            instances.push({ cb, els: this.els });
        }
        public observe(el: Element) {
            this.els.push(el);
        }
        public disconnect() {
            this.els.length = 0;
        }
        public unobserve() {
            /* noop */
        }
        public takeRecords() {
            return [];
        }
    }
    vi.stubGlobal("IntersectionObserver", IO);
    return {
        /** Pretend `el` is now the visible slot. */
        show(el: Element) {
            for (const i of instances) {
                if (i.els.includes(el)) {
                    i.cb(
                        [{ target: el, intersectionRatio: 1 } as IntersectionObserverEntry],
                        {} as IntersectionObserver,
                    );
                }
            }
        },
    };
}
