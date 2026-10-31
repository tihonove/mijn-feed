import { describe, expect, it, vi } from "vitest";

import type { FeedCard } from "../../shared/types.ts";
import { type AudioLike, SoundPlayer, type SpeechLike } from "./soundPlayer.ts";

const card = (audio: string | null, say?: string): FeedCard => ({
    id: `c-${audio ?? "none"}-${say ?? ""}`,
    stream: "nl",
    kind: null,
    html: "",
    audio,
    meta: say ? { say } : {},
});

class FakeAudio implements AudioLike {
    public static instances: FakeAudio[] = [];
    public paused = false;
    private readonly handlers: Record<string, (() => void)[]> = {};
    public constructor(
        public src: string,
        private readonly fail = false,
    ) {
        FakeAudio.instances.push(this);
    }
    public play(): Promise<void> {
        return this.fail ? Promise.reject(new Error("blocked")) : Promise.resolve();
    }
    public pause(): void {
        this.paused = true;
    }
    public addEventListener(type: "ended" | "error", fn: () => void): void {
        (this.handlers[type] ??= []).push(fn);
    }
    public emit(type: "ended" | "error"): void {
        for (const fn of this.handlers[type] ?? []) fn();
    }
}

const speech = (): SpeechLike & { spoken: string[] } => ({
    spoken: [],
    speak(text, _lang, onEnd) {
        this.spoken.push(text);
        onEnd();
    },
    cancel: vi.fn(),
});

describe("SoundPlayer", () => {
    it("plays the mp3 and reports the playing card until it ends", async () => {
        FakeAudio.instances = [];
        const s = speech();
        const p = new SoundPlayer((src) => new FakeAudio(src), s);
        const states: (string | null)[] = [];
        p.onChange((id) => states.push(id));
        const c = card("/media/a.mp3", "fallback");
        const done = p.play(c);
        expect(p.playing).toBe(c.id);
        FakeAudio.instances[0]!.emit("ended");
        await done;
        expect(states).toEqual([null, c.id, null]);
        expect(s.spoken).toEqual([]);
    });

    it("falls back to speech when the file fails or when there is no file", async () => {
        FakeAudio.instances = [];
        const s = speech();
        const p = new SoundPlayer((src) => new FakeAudio(src), s);
        const c = card("/media/missing.mp3", "Gezellig");
        const done = p.play(c);
        FakeAudio.instances[0]!.emit("error");
        await done;
        expect(s.spoken).toEqual(["Gezellig"]);
        await p.play(card(null, "Lekker"));
        expect(s.spoken).toEqual(["Gezellig", "Lekker"]);
        await p.play(card(null));
        expect(p.playing).toBeNull();
    });

    it("falls back to speech when autoplay is blocked and stops the previous sound", async () => {
        FakeAudio.instances = [];
        const s = speech();
        const p = new SoundPlayer((src) => new FakeAudio(src, true), s);
        await p.play(card("/media/x.mp3", "Fiets"));
        expect(s.spoken).toEqual(["Fiets"]);
        const p2 = new SoundPlayer((src) => new FakeAudio(src), s);
        void p2.play(card("/media/y.mp3"));
        const first = FakeAudio.instances.at(-1)!;
        p2.stop();
        expect(first.paused).toBe(true);
        expect(p2.playing).toBeNull();
        expect(s.cancel).toHaveBeenCalled();
    });
});
