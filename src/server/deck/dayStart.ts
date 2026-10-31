import { DAY } from "../clock.ts";

/** Start of the deck "day" (default 04:00 in the deck time zone, like Anki), as ms epoch. */
export function dayStart(now: number, dayStartHour: number, timezone: string): number {
    const parts = Object.fromEntries(
        new Intl.DateTimeFormat("en-US", {
            timeZone: timezone,
            hourCycle: "h23",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
        })
            .formatToParts(new Date(now))
            .map((p) => [p.type, Number(p.value)]),
    ) as Record<string, number>;
    const y = parts.year ?? 1970;
    const m = (parts.month ?? 1) - 1;
    const d = parts.day ?? 1;
    const localMs = Date.UTC(y, m, d, parts.hour ?? 0, parts.minute ?? 0, parts.second ?? 0);
    const offset = localMs - Math.floor(now / 1000) * 1000; // zone offset in ms
    let start = Date.UTC(y, m, d, dayStartHour) - offset;
    if (start > now) start -= DAY;
    return start;
}
