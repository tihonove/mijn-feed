import { describe, expect, it } from "vitest";

import { formatIn, formatShort } from "./format.ts";

const m = 60_000;
const h = 60 * m;
const d = 24 * h;

describe("formatIn", () => {
    it("picks the unit and the Russian plural", () => {
        expect(formatIn(10_000)).toBe("меньше минуты");
        expect(formatIn(10 * m)).toBe("10 мин");
        expect(formatIn(1 * h)).toBe("1 час");
        expect(formatIn(3 * h)).toBe("3 часа");
        expect(formatIn(11 * h)).toBe("11 часов");
        expect(formatIn(1 * d)).toBe("1 день");
        expect(formatIn(2 * d)).toBe("2 дня");
        expect(formatIn(21 * d)).toBe("21 день");
        expect(formatIn(25 * d)).toBe("25 дней");
        expect(formatIn(45 * d)).toBe("2 месяца");
        expect(formatIn(150 * d)).toBe("5 месяцев");
        expect(formatIn(370 * d)).toBe("12 месяцев");
    });
});

describe("formatShort", () => {
    it("is compact", () => {
        expect(formatShort(1000)).toBe("<1м");
        expect(formatShort(10 * m)).toBe("10м");
        expect(formatShort(5 * h)).toBe("5ч");
        expect(formatShort(4 * d)).toBe("4д");
        expect(formatShort(90 * d)).toBe("3мес");
    });
});
