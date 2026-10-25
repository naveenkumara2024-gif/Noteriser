import { describe, expect, it } from "vitest";
import {
  Reader,
  type ReaderState,
  type SynthLike,
  type UtteranceLike,
  type VoiceInfo,
} from "@/ui/tts";

/** A speech engine that records what it was asked to do and lets a test finish utterances by hand. */
function mockSynth(voices: VoiceInfo[] = []) {
  const spoken: UtteranceLike[] = [];
  const calls: string[] = [];
  const synth: SynthLike = {
    speak: (u) => {
      spoken.push(u);
      calls.push(`speak:${u.text}`);
    },
    cancel: () => calls.push("cancel"),
    pause: () => calls.push("pause"),
    resume: () => calls.push("resume"),
    getVoices: () => voices,
  };
  const createUtterance = (text: string): UtteranceLike => ({
    text,
    rate: 1,
    voice: null,
    onstart: null,
    onend: null,
    onerror: null,
    onboundary: null,
  });
  return { synth, spoken, calls, deps: { synth, createUtterance } };
}

const items = [
  { id: "a", text: "First." },
  { id: "b", text: "Second." },
  { id: "c", text: "Third." },
];

describe("Reader", () => {
  it("speaks one item at a time, in order, moving on when each finishes", () => {
    const m = mockSynth();
    const states: ReaderState[] = [];
    const r = new Reader(m.deps, (s) => states.push(s));
    r.play(items);

    expect(m.spoken.map((u) => u.text)).toEqual(["First."]);
    expect(r.state).toEqual({ status: "playing", currentId: "a" });

    m.spoken[0]?.onend?.();
    expect(m.spoken.map((u) => u.text)).toEqual(["First.", "Second."]);
    expect(r.state.currentId).toBe("b");

    m.spoken[1]?.onend?.();
    m.spoken[2]?.onend?.();
    expect(m.spoken.map((u) => u.text)).toEqual(["First.", "Second.", "Third."]);
    expect(r.state).toEqual({ status: "idle", currentId: null });
  });

  it("starts by cancelling anything already being read, and a new play replaces the old queue", () => {
    const m = mockSynth();
    const r = new Reader(m.deps);
    r.play(items);
    r.play([{ id: "z", text: "Only this." }]);
    expect(m.calls).toEqual(["cancel", "speak:First.", "cancel", "speak:Only this."]);

    // the cancelled utterance reports its end late; it must not resume the old queue
    m.spoken[0]?.onend?.();
    expect(m.spoken.map((u) => u.text)).toEqual(["First.", "Only this."]);
    expect(r.state.currentId).toBe("z");
  });

  it("pauses and resumes, and ignores pause when nothing is playing", () => {
    const m = mockSynth();
    const r = new Reader(m.deps);
    r.pause();
    r.resume();
    expect(m.calls).toEqual([]);

    r.play(items);
    r.pause();
    expect(r.state).toEqual({ status: "paused", currentId: "a" });
    r.resume();
    expect(r.state).toEqual({ status: "playing", currentId: "a" });
    expect(m.calls).toEqual(["cancel", "speak:First.", "pause", "resume"]);
  });

  it("stops: cancels speech, empties the queue, and ignores the cancelled utterance's end", () => {
    const m = mockSynth();
    const r = new Reader(m.deps);
    r.play(items);
    r.stop();
    expect(r.state).toEqual({ status: "idle", currentId: null });
    m.spoken[0]?.onend?.();
    expect(m.spoken).toHaveLength(1);
    expect(m.calls.at(-1)).toBe("cancel");
  });

  it("dispose (the page going away) cancels speech", () => {
    const m = mockSynth();
    const r = new Reader(m.deps);
    r.play(items);
    r.dispose();
    expect(m.calls.at(-1)).toBe("cancel");
    expect(r.state.status).toBe("idle");
  });

  it("carries on with the rest of the queue when one utterance fails", () => {
    const m = mockSynth();
    const r = new Reader(m.deps);
    r.play(items);
    m.spoken[0]?.onerror?.();
    expect(m.spoken.map((u) => u.text)).toEqual(["First.", "Second."]);
  });

  it("skips blank text and finishes cleanly when there is nothing to say", () => {
    const m = mockSynth();
    const r = new Reader(m.deps);
    r.play([{ id: "x", text: "   " }]);
    expect(m.spoken).toHaveLength(0);
    expect(r.state.status).toBe("idle");
  });

  it("applies the chosen rate and voice to each utterance", () => {
    const voice: VoiceInfo = { voiceURI: "v1", name: "Voice One", lang: "en-GB" };
    const m = mockSynth([voice]);
    const r = new Reader(m.deps);
    r.rate = 1.5;
    r.voiceURI = "v1";
    r.play(items.slice(0, 2));
    m.spoken[0]?.onend?.();
    for (const u of m.spoken) {
      expect(u.rate).toBe(1.5);
      expect(u.voice).toEqual(voice);
    }
  });

  it("uses the default voice when none is chosen or the chosen one has gone", () => {
    const m = mockSynth([]);
    const r = new Reader(m.deps);
    r.voiceURI = "gone";
    r.play(items.slice(0, 1));
    expect(m.spoken[0]?.voice).toBeNull();
  });

  describe("word boundaries", () => {
    it("reports the word being spoken as offsets into the displayed text", () => {
      const m = mockSynth();
      const r = new Reader(m.deps);
      // spoken: "Dispatcher. The component hands it over." ; the displayed text starts after "Dispatcher. "
      r.play([{ id: "g", text: "Dispatcher. The component hands it over.", textOffset: 12 }]);
      const u = m.spoken[0];
      u?.onboundary?.({ name: "word", charIndex: 16 }); // "component"
      expect(r.state.word).toEqual({ start: 4, end: 13 });
      u?.onboundary?.({ name: "word", charIndex: 35, charLength: 5 }); // "over." uses the engine's length
      expect(r.state.word).toEqual({ start: 23, end: 28 });
    });

    it("strips trailing punctuation when the engine gives no length", () => {
      const m = mockSynth();
      const r = new Reader(m.deps);
      r.play([{ id: "a", text: "Stop, now." }]);
      m.spoken[0]?.onboundary?.({ name: "word", charIndex: 0 });
      expect(r.state.word).toEqual({ start: 0, end: 4 });
      m.spoken[0]?.onboundary?.({ name: "word", charIndex: 6 });
      expect(r.state.word).toEqual({ start: 6, end: 9 });
    });

    it("ignores sentence boundaries, and boundaries from a stopped or replaced utterance", () => {
      const m = mockSynth();
      const r = new Reader(m.deps);
      r.play(items);
      m.spoken[0]?.onboundary?.({ name: "sentence", charIndex: 0 });
      expect(r.state.word).toBeUndefined();

      r.stop();
      m.spoken[0]?.onboundary?.({ name: "word", charIndex: 0 });
      expect(r.state).toEqual({ status: "idle", currentId: null });
    });

    it("clears the word when the next item starts, and keeps the pause state", () => {
      const m = mockSynth();
      const r = new Reader(m.deps);
      r.play(items);
      m.spoken[0]?.onboundary?.({ name: "word", charIndex: 0 });
      r.pause();
      expect(r.state.status).toBe("paused");
      expect(r.state.word).toBeDefined();
      r.resume();
      m.spoken[0]?.onend?.();
      expect(r.state.currentId).toBe("b");
      expect(r.state.word).toBeUndefined();
    });

    it("an engine that sends no boundary events still gives item-level state", () => {
      const m = mockSynth();
      const r = new Reader(m.deps);
      r.play(items);
      expect(r.state).toEqual({ status: "playing", currentId: "a" });
    });
  });
});
