import { describe, expect, it } from "vitest";
import {
  createDictation,
  type DictationHost,
  dictationAvailable,
  type RecognitionConstructor,
  type RecognitionEvent,
  type RecognitionLike,
} from "@/ui/dictation";

/** A recognizer the test drives by hand. `honoursLocal` false models a browser that ignores the setting. */
function fakeHost(options: { available?: string; honoursLocal?: boolean } = {}) {
  const made: FakeRecognition[] = [];
  class FakeRecognition implements RecognitionLike {
    lang = "";
    continuous = false;
    interimResults = false;
    onresult: RecognitionLike["onresult"] = null;
    onerror: RecognitionLike["onerror"] = null;
    onend: RecognitionLike["onend"] = null;
    started = false;
    stopped = false;
    #local: boolean | undefined;
    get processLocally(): boolean | undefined {
      return this.#local;
    }
    set processLocally(v: boolean | undefined) {
      this.#local = options.honoursLocal === false ? false : v;
    }
    constructor() {
      made.push(this);
    }
    start() {
      this.started = true;
    }
    stop() {
      this.stopped = true;
      this.onend?.();
    }
    abort() {}
  }
  const Ctor = FakeRecognition as unknown as RecognitionConstructor;
  if (options.available !== undefined) {
    Ctor.available = async () => options.available as string;
  }
  const host: DictationHost = { SpeechRecognition: Ctor };
  return { host, made };
}

const event = (parts: [string, boolean][], resultIndex = 0): RecognitionEvent => ({
  resultIndex,
  results: parts.map(([t, isFinal]) => Object.assign([{ transcript: t }], { isFinal })) as never,
});

describe("dictationAvailable", () => {
  it("is true only when the browser says an on-device recognizer is installed", async () => {
    expect(await dictationAvailable(fakeHost({ available: "available" }).host, "en-US")).toBe(true);
    for (const state of ["downloadable", "downloading", "unavailable"]) {
      expect(await dictationAvailable(fakeHost({ available: state }).host, "en-US")).toBe(false);
    }
  });

  it("is false when the browser cannot tell, has no recognizer, or the check throws", async () => {
    expect(await dictationAvailable(fakeHost().host, "en-US")).toBe(false);
    expect(await dictationAvailable({}, "en-US")).toBe(false);
    const { host } = fakeHost({ available: "available" });
    (host.SpeechRecognition as RecognitionConstructor).available = async () => {
      throw new Error("nope");
    };
    expect(await dictationAvailable(host, "en-US")).toBe(false);
  });
});

describe("createDictation", () => {
  const handlers = () => {
    const log = { final: [] as string[], interim: [] as string[], ended: [] as boolean[] };
    return {
      log,
      h: {
        onFinal: (t: string) => log.final.push(t),
        onInterim: (t: string) => log.interim.push(t),
        onEnd: (failed: boolean) => log.ended.push(failed),
      },
    };
  };

  it("is null without a recognizer", () => {
    expect(createDictation({}, "en-US", handlers().h)).toBeNull();
  });

  it("asks for on-device recognition and passes only settled text on", () => {
    const { host, made } = fakeHost({ available: "available" });
    const { log, h } = handlers();
    const d = createDictation(host, "en-GB", h);
    d?.start();
    const rec = made[0];
    expect(rec).toMatchObject({
      lang: "en-GB",
      continuous: true,
      interimResults: true,
      started: true,
    });
    expect(rec?.processLocally).toBe(true);

    rec?.onresult?.(event([["hello wor", false]]));
    expect(log.final).toEqual([]);
    expect(log.interim.at(-1)).toBe("hello wor");

    rec?.onresult?.(
      event([
        ["hello world ", true],
        ["next", false],
      ]),
    );
    expect(log.final).toEqual(["hello world "]);
    expect(log.interim.at(-1)).toBe("next");

    d?.stop();
    expect(log.ended).toEqual([false]);
    expect(log.interim.at(-1)).toBe("");
  });

  it("refuses to record when the browser does not accept the on-device setting", () => {
    const { host, made } = fakeHost({ honoursLocal: false });
    const { log, h } = handlers();
    createDictation(host, "en-US", h)?.start();
    expect(made[0]?.started).toBe(false);
    expect(log.ended).toEqual([true]);
  });

  it("reports a fault but not a silence or a manual stop", () => {
    for (const [error, failed] of [
      ["no-speech", false],
      ["aborted", false],
      ["audio-capture", true],
      ["not-allowed", true],
    ] as const) {
      const { host, made } = fakeHost();
      const { log, h } = handlers();
      createDictation(host, "en-US", h)?.start();
      made[0]?.onerror?.({ error });
      made[0]?.onend?.();
      expect(log.ended, error).toEqual([failed]);
    }
  });
});
