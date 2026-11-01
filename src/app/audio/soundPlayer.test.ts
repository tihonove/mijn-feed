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
    it("a sound stopped by a newer one never falls back to speech (no two voices at once)", async () => {
        FakeAudio.instances = [];
        const s = speech();
        // every file "fails" asynchronously, as a paused <audio> rejects its play() promise
        const p = new SoundPlayer((src) => new FakeAudio(src, true), s);
        const first = p.play(card("/media/first.mp3", "Eerste"));
        const second = p.play(card("/media/second.mp3", "Tweede"));
        await first;
        await second;
        expect(FakeAudio.instances[0]!.paused).toBe(true);
        expect(s.spoken).toEqual(["Tweede"]); // only the current one may fall back
    });

    it("a superseded sound that ends later does not touch the current one", async () => {
        FakeAudio.instances = [];
        const s = speech();
        const p = new SoundPlayer((src) => new FakeAudio(src), s);
        const c1 = card("/media/one.mp3");
        const c2 = card("/media/two.mp3");
        const first = p.play(c1);
        void p.play(c2);
        FakeAudio.instances[0]!.emit("ended"); // the old <audio> reports its end after being paused
        await first;
        expect(p.playing).toBe(c2.id);
        FakeAudio.instances[1]!.emit("ended");
        expect(p.playing).toBeNull();
    });

    it("ignores a repeat of the same request within a second, plays it again later or when forced", () => {
        FakeAudio.instances = [];
        let t = 1000;
        const p = new SoundPlayer(
            (src) => new FakeAudio(src),
            speech(),
            () => t,
        );
        const c = card("/media/a.mp3");
        void p.play(c);
        void p.play(c); // the card asking for what the shell already started
        expect(FakeAudio.instances).toHaveLength(1);
        void p.play(c, { src: "/media/other.mp3" }); // a different sound is not a repeat
        expect(FakeAudio.instances).toHaveLength(2);
        void p.play(c, { src: "/media/other.mp3", force: true }); // "ещё раз"
        expect(FakeAudio.instances).toHaveLength(3);
        t += 1500;
        void p.play(c, { src: "/media/other.mp3" });
        expect(FakeAudio.instances).toHaveLength(4);
    });

    it("speaks a text the card asks for instead of its file", async () => {
        FakeAudio.instances = [];
        const s = speech();
        const p = new SoundPlayer((src) => new FakeAudio(src), s);
        await p.play(card("/media/a.mp3", "Nul zes"), { text: "twaalf" });
        expect(s.spoken).toEqual(["twaalf"]);
        expect(FakeAudio.instances).toHaveLength(0);
    });

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
