// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { fakeApi, makeServices, Provide, STATS } from "../testUtils.tsx";
import { StatsPage } from "./StatsPage.tsx";

afterEach(cleanup);

describe("StatsPage", () => {
    it("renders today's numbers, the forecast and the card breakdown", async () => {
        render(
            <Provide services={makeServices(fakeApi()).services}>
                <StatsPage />
            </Provide>,
        );
        await screen.findByText("Статистика");
        expect(screen.getByText("к повтору сейчас").previousSibling?.textContent).toBe("3");
        expect(screen.getByText("88%")).toBeTruthy();
        expect(screen.getByLabelText("Повторов по дням").children).toHaveLength(14);
        expect(screen.getByText(/Заметок: 12, граней в работе: 24, отложено пиявок: 1/)).toBeTruthy();
    });

    it("shows a dash without retention data and reports errors", async () => {
        const api = fakeApi({
            stats: vi.fn(() =>
                Promise.resolve({ deck: { ...STATS, retention30d: null, cards: { ...STATS.cards, suspended: 0 } } }),
            ),
        });
        render(
            <Provide services={makeServices(api).services}>
                <StatsPage />
            </Provide>,
        );
        await screen.findByText("—");
        cleanup();
        render(
            <Provide
                services={makeServices(fakeApi({ stats: vi.fn(() => Promise.reject(new Error("down"))) })).services}
            >
                <StatsPage />
            </Provide>,
        );
        await screen.findByText("down");
    });
});
