// Knobs: stream shares, quick modes, sound and grading, the deck's Anki-style parameters.
import { useEffect, useState } from "react";

import type { Settings, SettingsPatch } from "../../shared/types.ts";
import { useToast } from "../feed/useToast.tsx";
import { useServices } from "../services.ts";

const STREAM_COLORS: Record<string, string> = { nl: "var(--oranje)", news: "var(--teal)", facts: "var(--mustard)" };
const DAY = 86_400_000;

export function SettingsPage() {
    const { api } = useServices();
    const [s, setS] = useState<Settings | null>(null);
    const [error, setError] = useState<string | null>(null);
    const { toast, Toast } = useToast();

    useEffect(() => {
        api.settings()
            .then(setS)
            .catch((e: unknown) => {
                setError(e instanceof Error ? e.message : String(e));
            });
    }, [api]);

    if (error) return <div className="page">{error}</div>;
    if (!s) return <div className="center">…</div>;

    const apply = (patch: SettingsPatch, optimistic?: (prev: Settings) => Settings) => {
        if (optimistic) setS((prev) => (prev ? optimistic(prev) : prev));
        api.patchSettings(patch)
            .then((next) => {
                setS(next);
                toast("Сохранено");
            })
            .catch((e: unknown) => {
                toast(e instanceof Error ? e.message : "Не сохранилось");
            });
    };
    const deck = (patch: Partial<Settings["deck"]>) => {
        apply({ deck: patch }, (prev) => ({ ...prev, deck: { ...prev.deck, ...patch } }));
    };

    const total = Object.values(s.streams).reduce((a, v) => a + v.share, 0) || 1;
    const modeUntil = Date.now() + DAY;
    const streamShare = (name: string, share: number) => {
        apply({ streams: { [name]: { share } } }, (prev) => ({
            ...prev,
            streams: { ...prev.streams, [name]: { ...prev.streams[name], share } },
        }));
    };

    return (
        <main className="page">
            <div className="page-inner">
                <h1>Настройки</h1>

                <section className="card-box">
                    <h2>Потоки в ленте</h2>
                    <div className="share-bar" aria-hidden="true">
                        {Object.entries(s.streams).map(([name, v]) => (
                            <span
                                key={name}
                                style={{
                                    width: `${(v.share / total) * 100}%`,
                                    background: STREAM_COLORS[name] ?? "var(--lilac)",
                                }}
                            />
                        ))}
                    </div>
                    {Object.entries(s.streams).map(([name, v]) => (
                        <div className="field" key={name}>
                            <label htmlFor={`share-${name}`}>
                                {v.title ?? name}
                                <output>{Math.round((v.share / total) * 100)}%</output>
                            </label>
                            <input
                                id={`share-${name}`}
                                type="range"
                                min={0}
                                max={100}
                                value={v.share}
                                onChange={(e) => {
                                    streamShare(name, Number(e.target.value));
                                }}
                            />
                        </div>
                    ))}
                    <div className="field">
                        <label htmlFor="maxRun">
                            Не больше подряд одного потока<output>{s.mixer.maxRun}</output>
                        </label>
                        <input
                            id="maxRun"
                            type="range"
                            min={1}
                            max={6}
                            value={s.mixer.maxRun}
                            onChange={(e) => {
                                apply({ mixer: { maxRun: Number(e.target.value) } }, (prev) => ({
                                    ...prev,
                                    mixer: { ...prev.mixer, maxRun: Number(e.target.value) },
                                }));
                            }}
                        />
                    </div>
                </section>

                <section className="card-box">
                    <h2>Сегодня</h2>
                    <p>Быстрые режимы на сутки, потом всё возвращается к долям выше.</p>
                    <div className="chips">
                        <button
                            className="chip"
                            aria-pressed={s.modes.onlyStream === "nl"}
                            onClick={() => {
                                apply({
                                    modes: {
                                        onlyStream: s.modes.onlyStream === "nl" ? null : "nl",
                                        mutedStreams: [],
                                        until: modeUntil,
                                    },
                                });
                            }}
                        >
                            Только голландский
                        </button>
                        {Object.keys(s.streams)
                            .filter((n) => n !== "nl")
                            .map((n) => {
                                const muted = s.modes.mutedStreams.includes(n);
                                return (
                                    <button
                                        key={n}
                                        className="chip"
                                        aria-pressed={muted}
                                        onClick={() => {
                                            const mutedStreams = muted
                                                ? s.modes.mutedStreams.filter((x) => x !== n)
                                                : [...s.modes.mutedStreams, n];
                                            apply({ modes: { onlyStream: null, mutedStreams, until: modeUntil } });
                                        }}
                                    >
                                        Без «{s.streams[n]?.title ?? n}»
                                    </button>
                                );
                            })}
                        <button
                            className="chip"
                            onClick={() => {
                                apply({ modes: { onlyStream: null, mutedStreams: [], until: null } });
                            }}
                        >
                            Сбросить
                        </button>
                    </div>
                </section>

                <section className="card-box">
                    <h2>Звук и оценки</h2>
                    <div className="chips">
                        <button
                            className="chip"
                            aria-pressed={s.sound.enabled}
                            onClick={() => {
                                apply({ sound: { enabled: !s.sound.enabled } });
                            }}
                        >
                            Озвучивать карточки
                        </button>
                        <button
                            className="chip"
                            aria-pressed={s.grading.buttons === 2}
                            onClick={() => {
                                apply({ grading: { buttons: 2 } });
                            }}
                        >
                            2 кнопки + долгое нажатие
                        </button>
                        <button
                            className="chip"
                            aria-pressed={s.grading.buttons === 4}
                            onClick={() => {
                                apply({ grading: { buttons: 4 } });
                            }}
                        >
                            4 кнопки как в Anki
                        </button>
                    </div>
                </section>

                <section className="card-box">
                    <h2>Колода Nederlands</h2>
                    <div className="field">
                        <label htmlFor="retention">
                            Желаемое удержание<output>{Math.round(s.deck.requestRetention * 100)}%</output>
                        </label>
                        <input
                            id="retention"
                            type="range"
                            min={70}
                            max={97}
                            value={Math.round(s.deck.requestRetention * 100)}
                            onChange={(e) => {
                                deck({ requestRetention: Number(e.target.value) / 100 });
                            }}
                        />
                        <small>Главная ручка FSRS. Выше — чаще повторы, но меньше забываний.</small>
                    </div>
                    <div className="field">
                        <label htmlFor="newPerDay">
                            Норма новых в день<output>{s.deck.newPerDay}</output>
                        </label>
                        <input
                            id="newPerDay"
                            type="range"
                            min={0}
                            max={40}
                            value={s.deck.newPerDay}
                            onChange={(e) => {
                                deck({ newPerDay: Number(e.target.value) });
                            }}
                        />
                    </div>
                    <div className="field">
                        <label htmlFor="reviewsPerDay">
                            Потолок повторов в день<output>{s.deck.reviewsPerDay}</output>
                        </label>
                        <input
                            id="reviewsPerDay"
                            type="range"
                            min={10}
                            max={500}
                            step={10}
                            value={s.deck.reviewsPerDay}
                            onChange={(e) => {
                                deck({ reviewsPerDay: Number(e.target.value) });
                            }}
                        />
                    </div>
                    <div className="field">
                        <label htmlFor="maxInterval">
                            Максимальный интервал, дней<output>{s.deck.maximumInterval}</output>
                        </label>
                        <input
                            id="maxInterval"
                            type="range"
                            min={30}
                            max={3650}
                            step={30}
                            value={s.deck.maximumInterval}
                            onChange={(e) => {
                                deck({ maximumInterval: Number(e.target.value) });
                            }}
                        />
                    </div>
                    <div className="field">
                        <label htmlFor="steps">Шаги обучения</label>
                        <input
                            id="steps"
                            type="text"
                            defaultValue={s.deck.learningSteps.join(" ")}
                            onBlur={(e) => {
                                const steps = e.target.value.split(/[\s,]+/).filter((x) => /^\d+m$/.test(x));
                                if (steps.length > 0) deck({ learningSteps: steps });
                            }}
                        />
                        <small>
                            Через пробел, в минутах: «1m 10m». Переобучение после ошибки:{" "}
                            {s.deck.relearningSteps.join(" ")}.
                        </small>
                    </div>
                    <div className="field">
                        <label htmlFor="newOrder">Порядок новых</label>
                        <select
                            id="newOrder"
                            value={s.deck.newOrder}
                            onChange={(e) => {
                                deck({ newOrder: e.target.value as Settings["deck"]["newOrder"] });
                            }}
                        >
                            <option value="added">как добавлены</option>
                            <option value="level">по уровню</option>
                            <option value="random">случайно</option>
                        </select>
                    </div>
                    <div className="chips">
                        <button
                            className="chip"
                            aria-pressed={s.deck.burySiblings}
                            onClick={() => {
                                deck({ burySiblings: !s.deck.burySiblings });
                            }}
                        >
                            Одна грань заметки в день
                        </button>
                    </div>
                    <div className="field">
                        <label htmlFor="leech">
                            Пиявка после ошибок
                            <output>{s.deck.leechThreshold === 0 ? "выкл" : s.deck.leechThreshold}</output>
                        </label>
                        <input
                            id="leech"
                            type="range"
                            min={0}
                            max={16}
                            value={s.deck.leechThreshold}
                            onChange={(e) => {
                                deck({ leechThreshold: Number(e.target.value) });
                            }}
                        />
                        <small>Столько раз «снова», и карточка откладывается до разбора.</small>
                    </div>
                </section>
            </div>
            <Toast />
        </main>
    );
}
