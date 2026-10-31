import { useEffect, useState } from "react";

import type { MeResponse } from "./api/apiClient.ts";
import { Feed } from "./feed/Feed.tsx";
import { LoginPage } from "./login/LoginPage.tsx";
import { useServices } from "./services.ts";
import { SettingsPage } from "./settings/SettingsPage.tsx";
import { StatsPage } from "./stats/StatsPage.tsx";
import { TopBar } from "./TopBar.tsx";

export type Route = "feed" | "settings" | "stats";

export function routeFromHash(hash: string): Route {
    const h = hash.replace(/^#\/?/, "");
    return h === "settings" || h === "stats" ? h : "feed";
}

export function useHashRoute(): Route {
    const [route, setRoute] = useState<Route>(() => routeFromHash(window.location.hash));
    useEffect(() => {
        const onHash = () => {
            setRoute(routeFromHash(window.location.hash));
        };
        window.addEventListener("hashchange", onHash);
        return () => {
            window.removeEventListener("hashchange", onHash);
        };
    }, []);
    return route;
}

type Auth = { status: "loading" } | { status: "out"; google: boolean } | { status: "in"; me: MeResponse };

export function App() {
    const { api } = useServices();
    const route = useHashRoute();
    const [auth, setAuth] = useState<Auth>({ status: "loading" });

    useEffect(() => {
        api.me()
            .then((me) => {
                setAuth("signedOut" in me ? { status: "out", google: me.google } : { status: "in", me });
            })
            .catch(() => {
                setAuth({ status: "out", google: false });
            });
    }, [api]);

    if (auth.status === "loading") return <div className="center">…</div>;
    if (auth.status === "out") return <LoginPage google={auth.google} />;
    return (
        <>
            <TopBar route={route} me={auth.me} />
            {route === "feed" && <Feed />}
            {route === "settings" && <SettingsPage />}
            {route === "stats" && <StatsPage />}
        </>
    );
}
