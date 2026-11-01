import { describe, expect, it } from "vitest";

import { ClockDIToken, SystemClock } from "./clock.ts";
import { RandomDIToken } from "./deck/deckService.ts";
import { Container } from "./di/container.ts";
import { appModule } from "./modules.ts";

describe("appModule", () => {
    it("falls back to the system clock and Math.random when the context does not override them", () => {
        const c = new Container().use(appModule, {
            dbPath: ":memory:",
            mediaDir: "/nonexistent",
            appDir: null,
            auth: {
                ownerEmails: [],
                producerToken: "t",
                googleClientId: null,
                googleClientSecret: null,
                devLogin: false,
                publicOrigin: null,
                secureCookies: false,
            },
        });
        expect(c.get(ClockDIToken)).toBeInstanceOf(SystemClock);
        expect(c.get(RandomDIToken)).toBe(Math.random);
    });
});
