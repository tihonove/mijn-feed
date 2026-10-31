// The common reaction panel: sound, replay, grades (deck cards) or next (items), boring / more.
import { useState } from "react";

import type { FeedCard, Grade } from "../../shared/types.ts";
import { formatShort } from "./format.ts";
import { Icon } from "./icons.tsx";
import { useLongPress } from "./useLongPress.ts";

export interface RailProps {
    card: FeedCard;
    soundOn: boolean;
    playing: boolean;
    gradeButtons: 2 | 4;
    onToggleSound: () => void;
    onReplay: () => void;
    onGrade: (grade: Grade) => void;
    onSkip: () => void;
    onReact: (type: "boring" | "more") => void;
}

const GRADE_LABEL: Record<Grade, string> = { again: "снова", hard: "трудно", good: "хорошо", easy: "легко" };

export function Rail(p: RailProps) {
    const [sheet, setSheet] = useState(false);
    const grades = p.card.grades;
    const now = Date.now();
    const short = (g: Grade) => (grades ? formatShort(Math.max(0, grades[g] - now)) : "");
    const choose = (g: Grade) => {
        setSheet(false);
        p.onGrade(g);
    };
    const again = useLongPress(
        () => {
            choose("again");
        },
        () => {
            setSheet(true);
        },
    );
    const good = useLongPress(
        () => {
            choose("good");
        },
        () => {
            setSheet(true);
        },
    );

    return (
        <>
            <div className="rail" role="toolbar" aria-label="Реакции">
                <button
                    className="sound"
                    onClick={p.onToggleSound}
                    aria-pressed={p.soundOn}
                    title="Звук для всех карточек"
                >
                    <span className={`ic${p.soundOn ? " on" : ""}${p.playing ? " playing" : ""}`}>
                        <Icon name={p.soundOn ? "sound" : "muted"} />
                    </span>
                    звук
                </button>
                <button className="replay" onClick={p.onReplay} title="Проиграть ещё раз">
                    <span className="ic">
                        <Icon name="replay" />
                    </span>
                    ещё раз
                </button>
                {grades ? (
                    p.gradeButtons === 4 ? (
                        (["again", "hard", "good", "easy"] as Grade[]).map((g) => (
                            <button
                                key={g}
                                className={g}
                                onClick={() => {
                                    choose(g);
                                }}
                            >
                                <span className="ic">
                                    <Icon name={g === "again" ? "cross" : "check"} />
                                </span>
                                {GRADE_LABEL[g]}
                                <small>{short(g)}</small>
                            </button>
                        ))
                    ) : (
                        <>
                            <button className="again" {...again} title="Долгое нажатие: все оценки">
                                <span className="ic">
                                    <Icon name="cross" />
                                </span>
                                снова
                                <small>{short("again")}</small>
                            </button>
                            <button className="good" {...good} title="Долгое нажатие: все оценки">
                                <span className="ic">
                                    <Icon name="check" />
                                </span>
                                хорошо
                                <small>{short("good")}</small>
                            </button>
                        </>
                    )
                ) : (
                    <button className="skip" onClick={p.onSkip}>
                        <span className="ic">
                            <Icon name="down" />
                        </span>
                        дальше
                    </button>
                )}
                <button
                    className="boring"
                    onClick={() => {
                        p.onReact("boring");
                    }}
                    title="Меньше такого"
                >
                    <span className="ic">
                        <Icon name="yawn" />
                    </span>
                    скучно
                </button>
                <button
                    className="more"
                    onClick={() => {
                        p.onReact("more");
                    }}
                    title="Больше такого"
                >
                    <span className="ic">
                        <Icon name="heart" />
                    </span>
                    ещё такого
                </button>
            </div>
            {sheet && grades && (
                <div className="sheet" role="menu" aria-label="Оценка">
                    {(["again", "hard", "good", "easy"] as Grade[]).map((g) => (
                        <button
                            key={g}
                            className={g}
                            role="menuitem"
                            onClick={() => {
                                choose(g);
                            }}
                        >
                            {GRADE_LABEL[g]}
                            <small>{short(g)}</small>
                        </button>
                    ))}
                </div>
            )}
        </>
    );
}
