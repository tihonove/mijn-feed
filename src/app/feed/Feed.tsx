// The vertical feed: snap scrolling, a window of mounted iframes around the current card,
// the common rail, global sound, and events flowing back to the server.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { FeedCard, FeedEventResult, Grade } from "../../shared/types.ts";
import { useServices } from "../services.ts";
import { isCardMessage } from "./cardFrame.ts";
import { CardSlot } from "./CardSlot.tsx";
import { formatIn } from "./format.ts";
import { Rail } from "./Rail.tsx";
import { useToast } from "./useToast.tsx";

const PAGE = 20;
const BEHIND = 1;
const AHEAD = 2;
const SEEN_DELAY = 800;

export function Feed() {
    const { api, sound, events } = useServices();
    const [cards, setCards] = useState<FeedCard[]>([]);
    const [index, setIndex] = useState(0);
    const [exhausted, setExhausted] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [soundOn, setSoundOn] = useState(false);
    const [gradeButtons, setGradeButtons] = useState<2 | 4>(2);
    const [playing, setPlaying] = useState<string | null>(null);
    const feedRef = useRef<HTMLDivElement>(null);
    const frames = useRef(new Map<string, HTMLIFrameElement>());
    const seen = useRef(new Set<string>());
    const { toast, Toast } = useToast();

    const current = cards[index] ?? null;

    const load = useCallback(
        async (append: boolean) => {
            setLoading(true);
            try {
                const res = await api.feed(PAGE);
                setSoundOn(res.settings.sound.enabled);
                setGradeButtons(res.settings.grading.buttons);
                setCards((prev) => {
                    if (!append) return res.cards;
                    const known = new Set(prev.map((c) => c.id));
                    const fresh = res.cards.filter((c) => !known.has(c.id));
                    if (fresh.length === 0) setExhausted(true);
                    return [...prev, ...fresh];
                });
                if (!append && res.cards.length === 0) setExhausted(true);
                setError(null);
            } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
            } finally {
                setLoading(false);
            }
        },
        [api],
    );

    useEffect(() => {
        void load(false);
    }, [load]);

    useEffect(() => sound.onChange(setPlaying), [sound]);

    // Which slot is on screen.
    useEffect(() => {
        const root = feedRef.current;
        if (!root) return;
        const io = new IntersectionObserver(
            (entries) => {
                for (const e of entries) {
                    if (e.intersectionRatio > 0.6) {
                        const i = Number((e.target as HTMLElement).dataset.index);
                        if (Number.isFinite(i)) setIndex(i);
                    }
                }
            },
            { root, threshold: [0.6] },
        );
        for (const el of root.querySelectorAll(".slot")) io.observe(el);
        return () => {
            io.disconnect();
        };
    }, [cards.length]);

    // Entering a card: sound, "seen", prefetch.
    useEffect(() => {
        if (!current) return;
        if (soundOn) void sound.play(current);
        else sound.stop();
        const t = setTimeout(() => {
            if (seen.current.has(current.id)) return;
            seen.current.add(current.id);
            void events.send(current.id, { type: "seen" }).catch(() => undefined);
        }, SEEN_DELAY);
        if (!loading && !exhausted && index >= cards.length - 4) void load(true);
        return () => {
            clearTimeout(t);
        };
    }, [current?.id]);

    // Messages from cards (protocol v1).
    useEffect(() => {
        const onMessage = (e: MessageEvent) => {
            if (!isCardMessage(e.data)) return;
            const msg = e.data;
            // Only a mounted card may speak; the id comes from the bridge we injected into its document.
            const frame = frames.current.get(msg.card);
            if (!frame || (e.source !== null && frame.contentWindow !== e.source)) return;
            const card = cards.find((c) => c.id === msg.card);
            if (!card) return;
            if (msg.type === "play") void sound.play(card, msg.src);
            if (msg.type === "answer") {
                void events.send(card.id, { type: "answer", correct: msg.correct }).then((r) => {
                    announce(r, msg.correct ? "Верно" : "Мимо");
                });
            }
        };
        window.addEventListener("message", onMessage);
        return () => {
            window.removeEventListener("message", onMessage);
        };
    }, [cards, sound, events]);

    const onFrame = useCallback((id: string, frame: HTMLIFrameElement | null) => {
        if (frame) frames.current.set(id, frame);
        else frames.current.delete(id);
    }, []);

    const scrollTo = (i: number) => {
        const el = feedRef.current?.querySelector<HTMLElement>(`.slot[data-index="${i}"]`);
        el?.scrollIntoView({ behavior: "smooth" });
    };

    const announce = (r: FeedEventResult | null, prefix: string) => {
        if (r?.due !== undefined) toast(`${prefix} · повтор через ${formatIn(r.due - Date.now())}`);
        else toast(r ? prefix : `${prefix} · отправлю, когда появится сеть`);
    };

    const grade = (g: Grade) => {
        if (!current) return;
        void events
            .send(current.id, { type: "grade", grade: g })
            .then((r) => {
                announce(r, { again: "Снова", hard: "Трудно", good: "Хорошо", easy: "Легко" }[g]);
            })
            .catch((e: unknown) => {
                toast(e instanceof Error ? e.message : "Ошибка");
            });
        scrollTo(index + 1);
    };

    const react = (type: "boring" | "more") => {
        if (!current) return;
        void events.send(current.id, { type }).catch(() => undefined);
        toast(type === "boring" ? "Поняла, такого поменьше" : "Поняла, такого побольше");
    };

    const skip = () => {
        if (!current) return;
        void events.send(current.id, { type: "skip" }).catch(() => undefined);
        scrollTo(index + 1);
    };

    const toggleSound = () => {
        const next = !soundOn;
        setSoundOn(next);
        void api.patchSettings({ sound: { enabled: next } }).catch(() => undefined);
        if (next && current) void sound.play(current);
        else sound.stop();
        toast(next ? "Звук включён для всех карточек" : "Звук выключен");
    };

    const replay = () => {
        if (current) void sound.play(current);
    };

    const slots = useMemo(
        () =>
            cards.map((card, i) => (
                <CardSlot
                    key={card.id}
                    card={card}
                    index={i}
                    mounted={i >= index - BEHIND && i <= index + AHEAD}
                    active={i === index}
                    onFrame={onFrame}
                />
            )),
        [cards, index, onFrame],
    );

    if (error && cards.length === 0) {
        return (
            <div className="end">
                <h2>Лента не загрузилась</h2>
                <p>{error}</p>
                <button className="btn" onClick={() => void load(false)}>
                    Попробовать ещё раз
                </button>
            </div>
        );
    }

    return (
        <>
            <div className="feed" ref={feedRef}>
                {slots}
                {(exhausted || (!loading && cards.length === 0)) && (
                    <section className="slot" data-index={cards.length}>
                        <div className="end">
                            <h2>На сегодня всё</h2>
                            <p>
                                Новые карточки появятся, когда подойдут повторы или производитель что‑нибудь принесёт.
                            </p>
                            <button className="btn secondary" onClick={() => void load(false)}>
                                Обновить
                            </button>
                        </div>
                    </section>
                )}
                {loading && cards.length === 0 && <div className="center">Загружаю…</div>}
            </div>
            {current && (
                <Rail
                    card={current}
                    soundOn={soundOn}
                    playing={playing === current.id}
                    gradeButtons={gradeButtons}
                    onToggleSound={toggleSound}
                    onReplay={replay}
                    onGrade={grade}
                    onSkip={skip}
                    onReact={react}
                />
            )}
            <Toast />
        </>
    );
}
