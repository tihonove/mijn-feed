// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { fakeApi, makeServices, Provide, SETTINGS } from "../testUtils.tsx";
import { SettingsPage } from "./SettingsPage.tsx";

afterEach(cleanup);

const byId = (id: string): HTMLElement => {
    const el = document.getElementById(id);
    if (!el) throw new Error(`no #${id}`);
    return el;
};

const mount = (api = fakeApi()) => {
    render(
        <Provide services={makeServices(api).services}>
            <SettingsPage />
        </Provide>,
    );
    return api;
};

describe("SettingsPage", () => {
    it("renders the knobs from the server and patches on change", async () => {
        const api = mount();
        await screen.findByText("Настройки");
        fireEvent.change(byId("share-nl"), { target: { value: "80" } });
        await waitFor(() => {
            expect(api.patchSettings).toHaveBeenCalledWith({ streams: { nl: { share: 80 } } });
        });
        fireEvent.change(byId("retention"), { target: { value: "85" } });
        fireEvent.change(byId("newPerDay"), { target: { value: "12" } });
        fireEvent.change(byId("reviewsPerDay"), { target: { value: "200" } });
        fireEvent.change(byId("maxInterval"), { target: { value: "90" } });
        fireEvent.change(byId("maxRun"), { target: { value: "2" } });
        fireEvent.change(byId("leech"), { target: { value: "0" } });
        fireEvent.change(byId("newOrder"), { target: { value: "level" } });
        fireEvent.blur(byId("steps"), { target: { value: "2m 15m" } });
        fireEvent.blur(byId("steps"), { target: { value: "garbage" } });
        await waitFor(() => {
            const patches = api.patchSettings.mock.calls.map((c) => c[0]);
            expect(patches).toContainEqual({ deck: { requestRetention: 0.85 } });
            expect(patches).toContainEqual({ deck: { newPerDay: 12 } });
            expect(patches).toContainEqual({ deck: { reviewsPerDay: 200 } });
            expect(patches).toContainEqual({ deck: { maximumInterval: 90 } });
            expect(patches).toContainEqual({ mixer: { maxRun: 2 } });
            expect(patches).toContainEqual({ deck: { leechThreshold: 0 } });
            expect(patches).toContainEqual({ deck: { newOrder: "level" } });
            expect(patches).toContainEqual({ deck: { learningSteps: ["2m", "15m"] } });
            expect(patches.filter((p) => JSON.stringify(p).includes("learningSteps"))).toHaveLength(1);
        });
        await screen.findByText("Сохранено");
    });

    it("quick modes, sound and grading chips", async () => {
        const api = mount();
        await screen.findByText("Настройки");
        fireEvent.click(screen.getByText("Только голландский"));
        fireEvent.click(screen.getByText("Без «Новости»"));
        fireEvent.click(screen.getByText("Сбросить"));
        fireEvent.click(screen.getByText("Озвучивать карточки"));
        fireEvent.click(screen.getByText("4 кнопки как в Anki"));
        fireEvent.click(screen.getByText("2 кнопки + долгое нажатие"));
        fireEvent.click(screen.getByText("Одна грань заметки в день"));
        fireEvent.click(screen.getByText("Слегка перемешивать"));
        await waitFor(() => {
            const patches = api.patchSettings.mock.calls.map((c) => c[0] as Record<string, unknown>);
            expect(patches[0]).toMatchObject({ modes: { onlyStream: "nl", mutedStreams: [] } });
            expect(patches[1]).toMatchObject({ modes: { onlyStream: null, mutedStreams: ["news"] } });
            expect(patches[2]).toEqual({ modes: { onlyStream: null, mutedStreams: [], until: null } });
            expect(patches[3]).toEqual({ sound: { enabled: true } });
            expect(patches[4]).toEqual({ grading: { buttons: 4 } });
            expect(patches[5]).toEqual({ grading: { buttons: 2 } });
            expect(patches[6]).toEqual({ deck: { burySiblings: false } });
            expect(patches[7]).toEqual({ deck: { shuffle: false } });
        });
    });

    it("unmutes a muted stream and toggles 'only nl' off", async () => {
        const muted = { ...SETTINGS, modes: { onlyStream: "nl", mutedStreams: ["news"], until: null } };
        const api = mount(fakeApi({ settings: vi.fn(() => Promise.resolve(muted)) }));
        await screen.findByText("Настройки");
        fireEvent.click(screen.getByText("Без «Новости»"));
        fireEvent.click(screen.getByText("Только голландский"));
        await waitFor(() => {
            const patches = api.patchSettings.mock.calls.map((c) => c[0] as Record<string, unknown>);
            expect(patches[0]).toMatchObject({ modes: { mutedStreams: [] } });
            expect(patches[1]).toMatchObject({ modes: { onlyStream: null } });
        });
    });

    it("shows errors from loading and saving", async () => {
        mount(fakeApi({ settings: vi.fn(() => Promise.reject(new Error("nope"))) }));
        await screen.findByText("nope");
        cleanup();
        mount(fakeApi({ patchSettings: vi.fn(() => Promise.reject(new Error("save failed"))) }));
        await screen.findByText("Настройки");
        fireEvent.click(screen.getByText("Озвучивать карточки"));
        await screen.findByText("save failed");
    });
});
