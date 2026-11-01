// One global sound switch (Instagram style): on → every card plays as it appears; off → silence everywhere.
// Plays the card's mp3 when it has one, otherwise reads `meta.say` with the browser's Dutch voice.
import type { FeedCard } from "../../shared/types.ts";

export interface AudioLike {
    src: string;
    play(): Promise<void>;
    pause(): void;
    addEventListener(type: "ended" | "error", fn: () => void): void;
}

export interface SpeechLike {
    speak(text: string, lang: string, onEnd: () => void): void;
    cancel(): void;
}

export class BrowserSpeech implements SpeechLike {
    public speak(text: string, lang: string, onEnd: () => void): void {
        if (!("speechSynthesis" in window)) {
            onEnd();
            return;
        }
        const u = new SpeechSynthesisUtterance(text);
        u.lang = lang;
        u.rate = 0.88;
        const voice = speechSynthesis
            .getVoices()
            .find((v) => v.lang.toLowerCase().startsWith(lang.toLowerCase().slice(0, 2)));
        if (voice) u.voice = voice;
        u.onend = onEnd;
        u.onerror = onEnd;
        speechSynthesis.cancel();
        speechSynthesis.speak(u);
    }

    public cancel(): void {
        if ("speechSynthesis" in window) speechSynthesis.cancel();
    }
}

export type PlayingListener = (cardId: string | null) => void;

export interface PlayOptions {
    /** Another file instead of the card's own audio. */
    src?: string;
    /** Speak this text instead of playing a file: for pieces of a card (one digit, one line of a dialogue). */
    text?: string;
    /** An explicit "play it again": never treated as a duplicate. */
    force?: boolean;
}

/** The shell autoplays a card and the card itself may ask for the same sound a moment later: one is enough. */
const DUPLICATE_WINDOW = 1000;

export class SoundPlayer {
    private current: AudioLike | null = null;
    private currentCard: string | null = null;
    private last: { key: string; at: number } | null = null;
    private readonly listeners = new Set<PlayingListener>();

    public constructor(
        private readonly createAudio: (src: string) => AudioLike = (src) => new Audio(src),
        private readonly speech: SpeechLike = new BrowserSpeech(),
        private readonly now: () => number = Date.now,
    ) {}

    public get playing(): string | null {
        return this.currentCard;
    }

    public onChange(fn: PlayingListener): () => void {
        this.listeners.add(fn);
        return () => this.listeners.delete(fn);
    }

    public stop(): void {
        if (this.current) this.current.pause();
        this.current = null;
        this.speech.cancel();
        this.setPlaying(null);
    }

    /**
     * Plays the card's audio (or `src`, or speaks `text`); falls back to speech for `meta.say` when a file cannot
     * play. Resolves when done or when nothing could play. A repeat of the same request within a second is ignored,
     * and a sound that was stopped by a newer one never falls back to speech: that is how two voices overlapped.
     */
    public play(card: FeedCard, opts: PlayOptions = {}): Promise<void> {
        const key = `${card.id}|${opts.src ?? ""}|${opts.text ?? ""}`;
        const at = this.now();
        const repeat = this.last?.key === key && at - this.last.at < DUPLICATE_WINDOW && this.currentCard === card.id;
        if (repeat && !opts.force) {
            return Promise.resolve();
        }
        this.last = { key, at };
        this.stop();
        const url = opts.src ?? card.audio;
        const say = opts.text ?? (typeof card.meta.say === "string" ? card.meta.say : null);
        return new Promise((resolve) => {
            const done = () => {
                if (this.currentCard === card.id) this.setPlaying(null);
                resolve();
            };
            const speak = () => {
                if (!say) {
                    done();
                    return;
                }
                this.setPlaying(card.id);
                this.speech.speak(say, "nl-NL", done);
            };
            if (opts.text || !url) {
                speak();
                return;
            }
            const audio = this.createAudio(url);
            this.current = audio;
            // Only the sound that is still current may finish or fall back; a superseded one just resolves.
            const stillCurrent = () => this.current === audio;
            audio.addEventListener("ended", () => {
                if (stillCurrent()) done();
                else resolve();
            });
            const failed = () => {
                if (!stillCurrent()) {
                    resolve();
                    return;
                }
                this.current = null;
                speak();
            };
            audio.addEventListener("error", failed);
            this.setPlaying(card.id);
            audio.play().catch(failed);
        });
    }

    private setPlaying(cardId: string | null): void {
        this.currentCard = cardId;
        for (const fn of this.listeners) fn(cardId);
    }
}
