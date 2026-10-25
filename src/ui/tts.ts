/**
 * Read-aloud on top of the browser's speech synthesis. The controller depends on a small interface
 * rather than `window.speechSynthesis`, so queueing, pause/resume and cancel-on-unmount are tested
 * against a mock. It reports which item is being read and, where the browser and voice send
 * `boundary` events, which word (confirmed in Chromium with local voices; other browsers and
 * network voices may send none, in which case only the item is marked).
 */

export interface UtteranceLike {
  text: string;
  rate: number;
  voice: unknown;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  onboundary?: ((event: { name: string; charIndex: number; charLength?: number }) => void) | null;
}

export interface VoiceInfo {
  voiceURI: string;
  name: string;
  lang: string;
}

export interface SynthLike {
  speak(utterance: UtteranceLike): void;
  cancel(): void;
  pause(): void;
  resume(): void;
  getVoices(): VoiceInfo[];
}

export interface ReaderDeps {
  synth: SynthLike;
  createUtterance: (text: string) => UtteranceLike;
}

/** One thing to say, with the id of the item on screen it belongs to. */
export interface Speakable {
  id: string;
  text: string;
  /** Where the item's displayed text begins inside `text` (a glossary entry says its term first). */
  textOffset?: number;
}

export interface ReaderState {
  status: "idle" | "playing" | "paused";
  /** The id being spoken right now, for highlighting. */
  currentId: string | null;
  /** The word being spoken, as offsets into the displayed text; absent when the engine sends none. */
  word?: { start: number; end: number };
}

export const IDLE: ReaderState = { status: "idle", currentId: null };

export class Reader {
  private queue: Speakable[] = [];
  /** Bumped on every play/stop so a late `end` from a cancelled utterance is ignored. */
  private generation = 0;
  private current: ReaderState = IDLE;
  rate = 1;
  voiceURI: string | null = null;

  constructor(
    private readonly deps: ReaderDeps,
    private readonly onChange: (state: ReaderState) => void = () => {},
  ) {}

  get state(): ReaderState {
    return this.current;
  }

  /** Starts reading `items` in order, replacing anything already being read. */
  play(items: readonly Speakable[]): void {
    this.deps.synth.cancel();
    this.generation++;
    this.queue = items.filter((i) => i.text.trim() !== "");
    this.speakNext(this.generation);
  }

  pause(): void {
    if (this.current.status !== "playing") return;
    this.deps.synth.pause();
    this.set({ ...this.current, status: "paused" });
  }

  resume(): void {
    if (this.current.status !== "paused") return;
    this.deps.synth.resume();
    this.set({ ...this.current, status: "playing" });
  }

  stop(): void {
    this.generation++;
    this.queue = [];
    this.deps.synth.cancel();
    this.set(IDLE);
  }

  /** Call when the page goes away: speech must not carry on without its controls. */
  dispose(): void {
    this.stop();
  }

  private speakNext(generation: number): void {
    if (generation !== this.generation) return;
    const next = this.queue.shift();
    if (!next) {
      this.set(IDLE);
      return;
    }
    const utterance = this.deps.createUtterance(next.text);
    utterance.rate = this.rate;
    if (this.voiceURI) {
      utterance.voice =
        this.deps.synth.getVoices().find((v) => v.voiceURI === this.voiceURI) ?? null;
    }
    const offset = next.textOffset ?? 0;
    utterance.onboundary = (e) => {
      if (generation !== this.generation || e.name !== "word") return;
      const end = e.charLength ? e.charIndex + e.charLength : wordEnd(next.text, e.charIndex);
      this.set({
        status: this.current.status,
        currentId: next.id,
        word: { start: e.charIndex - offset, end: end - offset },
      });
    };
    utterance.onstart = () => {
      if (generation === this.generation) this.set({ status: "playing", currentId: next.id });
    };
    const advance = (): void => this.speakNext(generation);
    utterance.onend = advance;
    // A failed utterance must not stall the rest of the queue.
    utterance.onerror = advance;
    this.set({ status: "playing", currentId: next.id });
    this.deps.synth.speak(utterance);
  }

  private set(state: ReaderState): void {
    this.current = state;
    this.onChange(state);
  }
}

/** The end of the word that starts at `from`, without its trailing punctuation. */
function wordEnd(text: string, from: number): number {
  const word = /^\S+/.exec(text.slice(from))?.[0] ?? "";
  return from + word.replace(/[.,;:!?)"'”’]+$/, "").length;
}

/** The browser's synthesis, or undefined where it does not exist (the controls are then hidden). */
export function browserDeps(): ReaderDeps | undefined {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return undefined;
  if (typeof SpeechSynthesisUtterance === "undefined") return undefined;
  const synth = window.speechSynthesis;
  return {
    synth: {
      speak: (u) => synth.speak(u as SpeechSynthesisUtterance),
      cancel: () => synth.cancel(),
      pause: () => synth.pause(),
      resume: () => synth.resume(),
      getVoices: () => synth.getVoices(),
    },
    createUtterance: (text) => new SpeechSynthesisUtterance(text) as UtteranceLike,
  };
}
