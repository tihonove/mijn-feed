import { token } from "./di/container.ts";

export interface IClock {
    /** Unix epoch milliseconds. */
    now(): number;
}

export const ClockDIToken = token<IClock>("Clock");

export class SystemClock implements IClock {
    public static readonly dependencies = [] as const;

    public now(): number {
        return Date.now();
    }
}

/** Deterministic clock for tests. */
export class FakeClock implements IClock {
    private current: number;

    public constructor(start: number | string = "2026-10-31T10:00:00Z") {
        this.current = typeof start === "number" ? start : Date.parse(start);
    }

    public now(): number {
        return this.current;
    }

    public set(when: number | string): void {
        this.current = typeof when === "number" ? when : Date.parse(when);
    }

    public advance(ms: number): void {
        this.current += ms;
    }
}

export const MINUTE = 60_000;
export const HOUR = 3_600_000;
export const DAY = 86_400_000;
