import "./styles.css";

import { createRoot } from "react-dom/client";

import { ApiClient } from "./api/apiClient.ts";
import { App } from "./App.tsx";
import { SoundPlayer } from "./audio/soundPlayer.ts";
import { EventQueue } from "./events/eventQueue.ts";
import { type Services, ServicesContext } from "./services.ts";

const api = new ApiClient();
const services: Services = {
    api,
    sound: new SoundPlayer(),
    events: new EventQueue(
        api,
        (() => {
            try {
                return window.localStorage;
            } catch {
                return null;
            }
        })(),
    ),
};

window.addEventListener("online", () => void services.events.flush());
void services.events.flush();

if (import.meta.env.PROD && "serviceWorker" in navigator) {
    window.addEventListener("load", () => void navigator.serviceWorker.register("/sw.js"));
}

const root = document.getElementById("root");
if (root) {
    createRoot(root).render(
        <ServicesContext value={services}>
            <App />
        </ServicesContext>,
    );
}
