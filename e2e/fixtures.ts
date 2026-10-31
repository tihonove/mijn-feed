// Test fixtures: a fresh server (own port, own database in a temp dir) for every test, a producer client
// to seed content, and `baseURL` pointing at that server so `page.goto("/")` just works.
import { type ChildProcess, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { test as base } from "@playwright/test";

import type { DeckState, NoteInput, Settings, SettingsPatch } from "../src/shared/types.ts";

export { expect } from "@playwright/test";

export const PRODUCER_TOKEN = "e2e-producer-token";
export const OWNER_EMAIL = "e2e@example.com";
const root = resolve(import.meta.dirname, "..");

export interface AppServer {
    url: string;
    /** Calls the API as the producer (bearer token). */
    api<T>(method: string, path: string, body?: unknown): Promise<T>;
    addNote(note: NoteInput): Promise<void>;
    patchSettings(patch: SettingsPatch): Promise<Settings>;
    settings(): Promise<Settings>;
    deckState(): Promise<DeckState>;
}

const freePort = (): Promise<number> =>
    new Promise((res, rej) => {
        const probe = createServer();
        probe.listen(0, "127.0.0.1", () => {
            const address = probe.address();
            probe.close(() => {
                if (typeof address === "object" && address) res(address.port);
                else rej(new Error("no free port"));
            });
        });
    });

async function startServer(): Promise<{ server: AppServer; stop: () => void }> {
    const port = await freePort();
    const dataDir = mkdtempSync(join(tmpdir(), "mijn-feed-e2e-"));
    const url = `http://127.0.0.1:${port}`;
    let log = "";
    const child: ChildProcess = spawn(process.execPath, ["dist/server/main.js"], {
        cwd: root,
        env: {
            ...process.env,
            PORT: String(port),
            DATA_DIR: dataDir,
            DEV_LOGIN: "1",
            PRODUCER_TOKEN,
            OWNER_EMAILS: OWNER_EMAIL,
            PUBLIC_ORIGIN: "",
            SECURE_COOKIES: "0",
            GOOGLE_CLIENT_ID: "",
            GOOGLE_CLIENT_SECRET: "",
        },
        stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout?.on("data", (d: Buffer) => (log += d.toString()));
    child.stderr?.on("data", (d: Buffer) => (log += d.toString()));

    const deadline = Date.now() + 15_000;
    for (;;) {
        try {
            if ((await fetch(`${url}/healthz`)).ok) break;
        } catch {
            /* not up yet */
        }
        if (child.exitCode !== null || Date.now() > deadline) throw new Error(`server did not start:\n${log}`);
        await new Promise((r) => setTimeout(r, 50));
    }

    const api = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
        const res = await fetch(`${url}${path}`, {
            method,
            headers: { authorization: `Bearer ${PRODUCER_TOKEN}`, "content-type": "application/json" },
            body: body === undefined ? undefined : JSON.stringify(body),
        });
        const text = await res.text();
        if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text}`);
        return (text ? JSON.parse(text) : null) as T;
    };
    const server: AppServer = {
        url,
        api,
        addNote: async (note) => {
            await api("POST", "/v1/nl/notes", note);
        },
        patchSettings: (patch) => api<Settings>("PATCH", "/v1/settings", patch),
        settings: () => api<Settings>("GET", "/v1/settings"),
        deckState: () => api<DeckState>("GET", "/v1/nl/state"),
    };
    const stop = () => {
        child.kill("SIGTERM");
        rmSync(dataDir, { recursive: true, force: true });
    };
    return { server, stop };
}

export const test = base.extend<{ server: AppServer }>({
    // eslint-disable-next-line no-empty-pattern
    server: async ({}, use) => {
        const { server, stop } = await startServer();
        await use(server);
        stop();
    },
    baseURL: async ({ server }, use) => {
        await use(server.url);
    },
});
