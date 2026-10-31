const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

const plural = (n: number, one: string, few: string, many: string): string => {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return one;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
    return many;
};

/** "через 10 мин", "через 3 дня" — how far a due date is from now. */
export function formatIn(ms: number): string {
    if (ms < MINUTE) return "меньше минуты";
    if (ms < HOUR) {
        const m = Math.round(ms / MINUTE);
        return `${m} мин`;
    }
    if (ms < DAY) {
        const h = Math.round(ms / HOUR);
        return `${h} ${plural(h, "час", "часа", "часов")}`;
    }
    const d = Math.round(ms / DAY);
    if (d >= 30) {
        const months = Math.round(d / 30);
        return `${months} ${plural(months, "месяц", "месяца", "месяцев")}`;
    }
    return `${d} ${plural(d, "день", "дня", "дней")}`;
}

/** Short form for under grade buttons: "10м", "3д", "2мес". */
export function formatShort(ms: number): string {
    if (ms < MINUTE) return "<1м";
    if (ms < HOUR) return `${Math.round(ms / MINUTE)}м`;
    if (ms < DAY) return `${Math.round(ms / HOUR)}ч`;
    const d = Math.round(ms / DAY);
    if (d >= 30) return `${Math.round(d / 30)}мес`;
    return `${d}д`;
}

export const STREAM_TITLES: Record<string, string> = { nl: "Nederlands", news: "Новости", facts: "Факты" };
