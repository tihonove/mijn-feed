// Knobs: one resource for the in-app settings screen and for external scripts (GET/PUT /v1/settings).
import type { Settings, SettingsPatch } from "../../shared/types.ts";
import { ClockDIToken, type IClock } from "../clock.ts";
import { DatabaseDIToken, fromJson, type IDatabase, toJson } from "../db/database.ts";
import { token } from "../di/container.ts";
import { HttpError } from "../httpError.ts";

export const DEFAULT_SETTINGS: Settings = {
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

export interface ISettingsService {
    get(): Settings;
    patch(patch: SettingsPatch): Settings;
}

export const SettingsServiceDIToken = token<ISettingsService>("SettingsService");

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

/** Deep merge: objects recurse, everything else (arrays included) is replaced. */
export function deepMerge<T>(base: T, patch: unknown): T {
    if (!isObject(base) || !isObject(patch)) return (patch === undefined ? base : patch) as T;
    const out: Json = { ...base };
    for (const [k, v] of Object.entries(patch)) out[k] = k in base ? deepMerge(base[k], v) : v;
    return out as T;
}

export class SettingsService implements ISettingsService {
    public static readonly dependencies = [DatabaseDIToken, ClockDIToken] as const;

    private readonly read;
    private readonly write;

    public constructor(
        db: IDatabase,
        private readonly clock: IClock,
    ) {
        this.read = db.raw.prepare("SELECT value FROM settings WHERE key = 'all'");
        this.write = db.raw.prepare(
            "INSERT INTO settings (key, value) VALUES ('all', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        );
    }

    public get(): Settings {
        const stored = fromJson<Json>(this.read.get()?.value, {});
        const settings = deepMerge(DEFAULT_SETTINGS, stored);
        if (settings.modes.until !== null && settings.modes.until < this.clock.now()) {
            settings.modes = { ...DEFAULT_SETTINGS.modes };
        }
        return settings;
    }

    public patch(patch: SettingsPatch): Settings {
        validate(patch);
        const stored = fromJson<Json>(this.read.get()?.value, {});
        this.write.run(toJson(deepMerge(stored, patch)));
        return this.get();
    }
}

function validate(patch: unknown): asserts patch is SettingsPatch {
    if (!isObject(patch)) throw new HttpError(400, "settings: expected an object");
    const deck = patch.deck;
    if (isObject(deck)) {
        const r = deck.requestRetention;
        if (r !== undefined && !(typeof r === "number" && r >= 0.7 && r <= 0.99)) {
            throw new HttpError(400, "deck.requestRetention: 0.7..0.99");
        }
        for (const key of ["newPerDay", "reviewsPerDay", "maximumInterval", "leechThreshold"]) {
            const v = deck[key];
            if (v !== undefined && !(Number.isInteger(v) && (v as number) >= 0)) {
                throw new HttpError(400, `deck.${key}: integer >= 0`);
            }
        }
        if (deck.newOrder !== undefined && !["added", "random", "level"].includes(deck.newOrder as string)) {
            throw new HttpError(400, "deck.newOrder: added|random|level");
        }
    }
    if (isObject(patch.streams)) {
        for (const [name, s] of Object.entries(patch.streams)) {
            if (!isObject(s)) throw new HttpError(400, `streams.${name}: expected an object`);
            const share = s.share;
            if (share !== undefined && !(typeof share === "number" && share >= 0 && share <= 1000)) {
                throw new HttpError(400, `streams.${name}.share: 0..1000`);
            }
        }
    }
    const maxRun = isObject(patch.mixer) ? patch.mixer.maxRun : undefined;
    if (maxRun !== undefined && !(Number.isInteger(maxRun) && (maxRun as number) >= 1)) {
        throw new HttpError(400, "mixer.maxRun: integer >= 1");
    }
    const buttons = isObject(patch.grading) ? patch.grading.buttons : undefined;
    if (buttons !== undefined && buttons !== 2 && buttons !== 4) throw new HttpError(400, "grading.buttons: 2|4");
}
