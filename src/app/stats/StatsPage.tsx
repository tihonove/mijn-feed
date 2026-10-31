import { useEffect, useState } from "react";

import type { DeckStats } from "../../shared/types.ts";
import { useServices } from "../services.ts";

export function StatsPage() {
    const { api } = useServices();
    const [stats, setStats] = useState<DeckStats | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        api.stats()
            .then((r) => {
                setStats(r.deck);
            })
            .catch((e: unknown) => {
                setError(e instanceof Error ? e.message : String(e));
            });
    }, [api]);

    if (error) return <div className="page">{error}</div>;
    if (!stats) return <div className="center">…</div>;

    const max = Math.max(1, ...stats.forecast.map((f) => f.due));
    const total = stats.cards.new + stats.cards.learning + stats.cards.young + stats.cards.mature;
    return (
        <main className="page">
            <div className="page-inner">
                <h1>Статистика</h1>
                <section className="card-box">
                    <h2>Сегодня</h2>
                    <div className="stat-row">
                        <div className="stat">
                            <b>{stats.today.dueNow}</b>
                            <span>к повтору сейчас</span>
                        </div>
                        <div className="stat">
                            <b>{stats.today.newLeft}</b>
                            <span>новых осталось</span>
                        </div>
                        <div className="stat">
                            <b>{stats.today.reviewsDone + stats.today.newDone}</b>
                            <span>ответов сегодня</span>
                        </div>
                        <div className="stat">
                            <b>{stats.retention30d === null ? "—" : `${Math.round(stats.retention30d * 100)}%`}</b>
                            <span>удержание за 30 дней</span>
                        </div>
                    </div>
                </section>
                <section className="card-box">
                    <h2>Прогноз на две недели</h2>
                    <div className="bars" role="img" aria-label="Повторов по дням">
                        {stats.forecast.map((f) => (
                            <div key={f.day} title={`${f.day}: ${f.due}`}>
                                <i style={{ height: `${(f.due / max) * 70}px` }} />
                                {f.day.slice(8)}
                            </div>
                        ))}
                    </div>
                </section>
                <section className="card-box">
                    <h2>Карточки</h2>
                    <p>
                        Заметок: {stats.notes}, граней в работе: {total}
                        {stats.cards.suspended > 0 ? `, отложено пиявок: ${stats.cards.suspended}` : ""}.
                    </p>
                    <div className="stat-row">
                        <div className="stat">
                            <b>{stats.cards.new}</b>
                            <span>новые</span>
                        </div>
                        <div className="stat">
                            <b>{stats.cards.learning}</b>
                            <span>учатся</span>
                        </div>
                        <div className="stat">
                            <b>{stats.cards.young}</b>
                            <span>молодые</span>
                        </div>
                        <div className="stat">
                            <b>{stats.cards.mature}</b>
                            <span>зрелые</span>
                        </div>
                    </div>
                </section>
                <section className="card-box">
                    <h2>Ответов в день, 30 дней</h2>
                    <div className="bars" role="img" aria-label="Ответов по дням">
                        {stats.reviewsPerDay30d.map((n, i) => (
                            <div key={i} title={`${n}`}>
                                <i
                                    style={{
                                        height: `${(n / Math.max(1, ...stats.reviewsPerDay30d)) * 70}px`,
                                        background: "var(--oranje)",
                                    }}
                                />
                            </div>
                        ))}
                    </div>
                </section>
            </div>
        </main>
    );
}
