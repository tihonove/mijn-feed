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

/** One showing of a card. A card may be shown again later in the session, so each showing gets its own uid. */
interface Showing {
    uid: string;
    card: FeedCard;
}

export function Feed() {
    const { api, sound, events } = useServices();
    const [showings, setShowings] = useState<Showing[]>([]);
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
    const seq = useRef(0);
    const indexRef = useRef(0);
    indexRef.current = index;
    const { toast, Toast } = useToast();

    const currentShowing = showings[index] ?? null;
    const current = currentShowing?.card ?? null;
    const showing = (card: FeedCard): Showing => ({ uid: `${card.id}#${++seq.current}`, card });

    const load = useCallback(
        async (append: boolean) => {
            setLoading(true);
            try {
                const res = await api.feed(PAGE);
                setSoundOn(res.settings.sound.enabled);
                setGradeButtons(res.settings.grading.buttons);
                setShowings((prev) => {
                    if (!append) return res.cards.map(showing);
                    // The feed loops: a card that is already behind may come round again (the server re-serves
                    // whatever is due or past the quota), but nothing is queued twice ahead of the viewer and a
                    // service card is shown once per session.
                    const ahead = new Set(prev.slice(Math.max(0, indexRef.current - BEHIND)).map((s) => s.card.id));
                    const infoSeen = new Set(prev.filter((s) => s.card.id.startsWith("info:")).map((s) => s.card.id));
                    const fresh = res.cards.filter((c) => !ahead.has(c.id) && !infoSeen.has(c.id));
                    if (fresh.length === 0) setExhausted(true);
                    return [...prev, ...fresh.map(showing)];
                });
                if (!append) setExhausted(res.cards.length === 0);
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
    }, [showings.length]);

    // Entering a card: sound, "seen", prefetch.
    useEffect(() => {
        if (!current || !currentShowing) return;
        if (soundOn) void sound.play(current);
        else sound.stop();
        const t = setTimeout(() => {
            if (seen.current.has(currentShowing.uid)) return;
            seen.current.add(currentShowing.uid);
            void events.send(current.id, { type: "seen" }).catch(() => undefined);
        }, SEEN_DELAY);
        if (!loading && !exhausted && index >= showings.length - 4) void load(true);
        return () => {
            clearTimeout(t);
        };
    }, [currentShowing?.uid]);

    // Messages from cards (protocol v1).
    useEffect(() => {
        const onMessage = (e: MessageEvent) => {
            if (!isCardMessage(e.data)) return;
            const msg = e.data;
            // Only a mounted card may speak; the uid comes from the bridge we injected into its document.
            const frame = frames.current.get(msg.card);
            if (!frame || (e.source !== null && frame.contentWindow !== e.source)) return;
            const card = showings.find((s) => s.uid === msg.card)?.card;
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
    }, [showings, sound, events]);

    const onFrame = useCallback((uid: string, frame: HTMLIFrameElement | null) => {
        if (frame) frames.current.set(uid, frame);
        else frames.current.delete(uid);
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
            showings.map(({ uid, card }, i) => (
                <CardSlot
                    key={uid}
                    uid={uid}
                    card={card}
                    index={i}
                    mounted={i >= index - BEHIND && i <= index + AHEAD}
                    active={i === index}
                    onFrame={onFrame}
                />
            )),
        [showings, index, onFrame],
    );

    if (error && showings.length === 0) {
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
                {(exhausted || (!loading && showings.length === 0)) && (
                    <section className="slot" data-index={showings.length}>
                        <div className="end">
                            <h2>На сегодня всё</h2>
                            <p>
                                Показывать больше нечего, даже сверх нормы. Новое появится, когда производитель
                                что‑нибудь принесёт.
                            </p>
                            <button className="btn secondary" onClick={() => void load(false)}>
                                Обновить
                            </button>
                        </div>
                    </section>
                )}
                {loading && showings.length === 0 && <div className="center">Загружаю…</div>}
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
