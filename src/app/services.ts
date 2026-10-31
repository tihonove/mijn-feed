// App-level singletons handed to components through context (the browser side of DI).
import { createContext, useContext } from "react";

import { type IApiClient } from "./api/apiClient.ts";
import type { SoundPlayer } from "./audio/soundPlayer.ts";
import type { EventQueue } from "./events/eventQueue.ts";

export interface Services {
    api: IApiClient;
    sound: SoundPlayer;
    events: EventQueue;
}

export const ServicesContext = createContext<Services | null>(null);

export function useServices(): Services {
    const s = useContext(ServicesContext);
    if (!s) throw new Error("ServicesContext is not provided");
    return s;
}
