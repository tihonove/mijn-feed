import type { MeResponse } from "./api/apiClient.ts";
import type { Route } from "./App.tsx";
import { Icon } from "./feed/icons.tsx";

export function TopBar({ route, me }: { route: Route; me: MeResponse }) {
    return (
        <header className="top">
            <a className="brand" href="#">
                Mijn Feed<small>Nederlands</small>
            </a>
            <nav className="top-actions" aria-label="Разделы">
                <a
                    className="pill"
                    href="#stats"
                    aria-current={route === "stats" ? "page" : undefined}
                    title="Статистика"
                >
                    <Icon name="chart" />
                </a>
                <a
                    className="pill"
                    href="#settings"
                    aria-current={route === "settings" ? "page" : undefined}
                    title="Настройки"
                >
                    <Icon name="sliders" />
                </a>
                <a className="pill" href="/auth/logout" title={`Выйти (${me.email})`}>
                    {me.picture ? (
                        <img
                            src={me.picture}
                            alt=""
                            width={16}
                            height={16}
                            style={{ borderRadius: "50%" }}
                            referrerPolicy="no-referrer"
                        />
                    ) : (
                        <Icon name="user" />
                    )}
                </a>
            </nav>
        </header>
    );
}
