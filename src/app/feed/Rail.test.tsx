// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { FeedCard } from "../../shared/types.ts";
import { Rail, type RailProps } from "./Rail.tsx";

const now = Date.now();
const deckCard: FeedCard = {
    id: "nl:p1",
    stream: "nl",
    kind: "word",
    html: "",
    audio: null,
    meta: {},
    grades: { again: now + 60_000, hard: now + 6 * 60_000, good: now + 10 * 60_000, easy: now + 4 * 86_400_000 },
};
const item: FeedCard = { id: "item:1", stream: "news", kind: null, html: "", audio: null, meta: {} };

const props = (over: Partial<RailProps> = {}): RailProps => ({
    card: deckCard,
    soundOn: false,
    playing: false,
    gradeButtons: 2,
    onToggleSound: vi.fn(),
    onReplay: vi.fn(),
    onGrade: vi.fn(),
    onSkip: vi.fn(),
    onReact: vi.fn(),
    ...over,
});

afterEach(cleanup);

describe("Rail", () => {
    it("shows two grade buttons with interval previews and grades on tap", () => {
        const p = props();
        render(<Rail {...p} />);
        const good = screen.getByText("хорошо").closest("button")!;
        expect(good.textContent).toContain("10м");
        expect(screen.getByText("снова").closest("button")!.textContent).toContain("1м");
        fireEvent.pointerDown(good);
        fireEvent.pointerUp(good);
        expect(p.onGrade).toHaveBeenCalledWith("good");
        expect(screen.queryByRole("menu")).toBeNull();
    });

    it("opens the four-grade sheet on a long press", () => {
        vi.useFakeTimers();
        const p = props();
        render(<Rail {...p} />);
        const again = screen.getByText("снова").closest("button")!;
        fireEvent.pointerDown(again);
        act(() => {
            vi.advanceTimersByTime(500);
        });
        fireEvent.pointerUp(again);
        expect(p.onGrade).not.toHaveBeenCalled();
        const menu = screen.getByRole("menu");
        expect(menu.textContent).toContain("трудно");
        fireEvent.click(screen.getByText("легко"));
        expect(p.onGrade).toHaveBeenCalledWith("easy");
        expect(screen.queryByRole("menu")).toBeNull();
        vi.useRealTimers();
    });

    it("renders four buttons when configured and 'next' for items", () => {
        const p = props({ gradeButtons: 4 });
        render(<Rail {...p} />);
        fireEvent.click(screen.getByText("трудно"));
        expect(p.onGrade).toHaveBeenCalledWith("hard");
        cleanup();
        const q = props({ card: item });
        render(<Rail {...q} />);
        expect(screen.queryByText("хорошо")).toBeNull();
        fireEvent.click(screen.getByText("дальше"));
        expect(q.onSkip).toHaveBeenCalled();
        fireEvent.click(screen.getByText("скучно"));
        fireEvent.click(screen.getByText("ещё такого"));
        expect(q.onReact).toHaveBeenNthCalledWith(1, "boring");
        expect(q.onReact).toHaveBeenNthCalledWith(2, "more");
    });

    it("reflects sound state and calls sound/replay handlers", () => {
        const p = props({ soundOn: true, playing: true });
        render(<Rail {...p} />);
        const sound = screen.getByTitle("Звук для всех карточек");
        expect(sound.getAttribute("aria-pressed")).toBe("true");
        expect(sound.querySelector(".ic")!.className).toContain("playing");
        fireEvent.click(sound);
        fireEvent.click(screen.getByText("ещё раз"));
        expect(p.onToggleSound).toHaveBeenCalled();
        expect(p.onReplay).toHaveBeenCalled();
    });

    it("cancels a pending long press when the pointer leaves", () => {
        vi.useFakeTimers();
        const p = props();
        render(<Rail {...p} />);
        const good = screen.getByText("хорошо").closest("button")!;
        fireEvent.pointerDown(good);
        fireEvent.pointerLeave(good);
        act(() => {
            vi.advanceTimersByTime(600);
        });
        expect(screen.queryByRole("menu")).toBeNull();
        fireEvent.contextMenu(good);
        vi.useRealTimers();
    });
});
