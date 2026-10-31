// Public API contract (/v1). Stable: changes only by addition.

export type Grade = "again" | "hard" | "good" | "easy";
export type FacetState = "new" | "learning" | "review" | "relearning";

/** A card as the viewer receives it in a playlist. */
export interface FeedCard {
    /** Opaque id: "nl:<presentationId>" | "nl:facet:<facetId>" (built-in presentation) | "item:<itemId>". */
    id: string;
    stream: string;
    kind: string | null;
    html: string;
    audio: string | null;
    meta: Record<string, unknown>;
    /** Present for deck cards: what each grade would schedule (ms epoch), to show "1d / 4d" under buttons. */
    grades?: Record<Grade, number>;
}

export type FeedEventType = "seen" | "grade" | "answer" | "skip" | "boring" | "more";

export interface FeedEvent {
    type: FeedEventType;
    grade?: Grade;
    correct?: boolean;
}

export interface FeedEventResult {
    ok: true;
    /** For deck grades: the new schedule. */
    due?: number;
    state?: FacetState;
}

export interface StreamSettings {
    share: number;
    title?: string;
}

export interface Settings {
    streams: Record<string, StreamSettings>;
    mixer: { maxRun: number; freshnessHours: number; reactionWindowDays: number; reactionStep: number };
    modes: { onlyStream: string | null; mutedStreams: string[]; until: number | null };
    deck: {
        requestRetention: number;
        newPerDay: number;
        reviewsPerDay: number;
        learningSteps: string[];
        relearningSteps: string[];
        maximumInterval: number;
        newOrder: "added" | "random" | "level";
        burySiblings: boolean;
        leechThreshold: number;
        dayStartHour: number;
        timezone: string;
    };
    sound: { enabled: boolean };
    grading: { buttons: 2 | 4 };
}

/** Deep partial for PUT /v1/settings. */
export type SettingsPatch = {
    [K in keyof Settings]?: Settings[K] extends object ? Partial<Settings[K]> : Settings[K];
};

export interface DeckStats {
    today: { dueNow: number; newLeft: number; newDone: number; reviewsDone: number };
    forecast: { day: string; due: number }[];
    retention30d: number | null;
    cards: { new: number; learning: number; young: number; mature: number; suspended: number };
    reviewsPerDay30d: number[];
    notes: number;
}

// ---- producer side ----

export interface PresentationInput {
    id?: string;
    html: string;
    audio?: string | null;
    meta?: Record<string, unknown>;
}

export interface FacetInput {
    facet: string;
    presentations?: PresentationInput[];
}

export interface NoteInput {
    id?: string;
    kind: string;
    fields: Record<string, unknown>;
    tags?: string[];
    level?: string | null;
    facets?: FacetInput[];
}

export interface NoteResult {
    id: string;
    facets: { id: string; facet: string; presentations: string[] }[];
}

export interface ItemInput {
    id?: string;
    kind?: string | null;
    html: string;
    audio?: string | null;
    meta?: Record<string, unknown>;
    tags?: string[];
    /** ms epoch; omitted = never expires */
    expiresAt?: number | null;
    /** ms; omitted = show once */
    repeatAfter?: number | null;
}

export interface UpcomingFacet {
    facetId: string;
    noteId: string;
    facet: string;
    due: number;
    state: FacetState;
    kind: string;
    fields: Record<string, unknown>;
    tags: string[];
    level: string | null;
    presentations: number;
    unseen: number;
}

export interface DeckState {
    now: number;
    counts: { newDone: number; reviewsDone: number; newLeft: number; reviewsLeft: number };
    upcoming: UpcomingFacet[];
    needPresentations: UpcomingFacet[];
    tags: Record<string, number>;
    byKind: Record<string, number>;
    byState: Partial<Record<FacetState, number>>;
    recent: { kind: string; facet: string; lastShown: number }[];
    leeches: { facetId: string; noteId: string; facet: string; fields: Record<string, unknown> }[];
    notes: { id: string; kind: string; level: string | null; tags: string[] }[];
    settings: Settings["deck"];
}

export interface Me {
    email: string;
    name: string | null;
    picture: string | null;
}
