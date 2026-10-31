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

export class SoundPlayer {
    private current: AudioLike | null = null;
    private currentCard: string | null = null;
    private readonly listeners = new Set<PlayingListener>();

    public constructor(
        private readonly createAudio: (src: string) => AudioLike = (src) => new Audio(src),
        private readonly speech: SpeechLike = new BrowserSpeech(),
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

    /** Plays the card's audio; falls back to speech for `meta.say`; resolves when done or when nothing could play. */
    public play(card: FeedCard, src?: string): Promise<void> {
        this.stop();
        const url = src ?? card.audio;
        const say = typeof card.meta.say === "string" ? card.meta.say : null;
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
            if (!url) {
                speak();
                return;
            }
            const audio = this.createAudio(url);
            this.current = audio;
            audio.addEventListener("ended", done);
            audio.addEventListener("error", () => {
                this.current = null;
                speak();
            });
            this.setPlaying(card.id);
            audio.play().catch(() => {
                this.current = null;
                speak();
            });
        });
    }

    private setPlaying(cardId: string | null): void {
        this.currentCard = cardId;
        for (const fn of this.listeners) fn(cardId);
    }
}
