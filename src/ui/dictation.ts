/**
 * Dictation into the notes box, on this device only.
 *
 * Browser speech recognition normally sends the audio to a cloud service. A lecture's words must
 * not leave the page (invariant 7), so this module only ever starts a recognizer that the browser
 * reports as available for ON-DEVICE use, asks it for `processLocally`, and refuses to run if the
 * browser did not accept that setting. When any of that is missing the button is simply not shown.
 *
 * The browser objects are passed in (`DictationHost`) so tests use a fake and need no microphone.
 */

export interface RecognitionResult {
  isFinal: boolean;
  [index: number]: { transcript: string };
  length: number;
}

export interface RecognitionEvent {
  resultIndex: number;
  results: ArrayLike<RecognitionResult>;
}

export interface RecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  processLocally?: boolean;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

export interface RecognitionConstructor {
  new (): RecognitionLike;
  /** Chromium's check for a language pack: "available" means installed and usable offline. */
  available?: (options: { langs: string[]; processLocally: boolean }) => Promise<string>;
}

export interface DictationHost {
  SpeechRecognition?: RecognitionConstructor;
  webkitSpeechRecognition?: RecognitionConstructor;
}

const constructorOf = (host: DictationHost): RecognitionConstructor | undefined =>
  host.SpeechRecognition ?? host.webkitSpeechRecognition;

/** True only when the browser says an on-device recognizer is installed for `lang`. */
export async function dictationAvailable(host: DictationHost, lang: string): Promise<boolean> {
  const Recognition = constructorOf(host);
  if (!Recognition || typeof Recognition.available !== "function") return false;
  try {
    return (await Recognition.available({ langs: [lang], processLocally: true })) === "available";
  } catch {
    return false;
  }
}

export interface DictationHandlers {
  /** Text the recognizer has settled on; append it. */
  onFinal(text: string): void;
  /** What it is currently guessing; show it, do not keep it. */
  onInterim(text: string): void;
  /** Recognition stopped. `failed` is set when it stopped because of an error. */
  onEnd(failed: boolean): void;
}

export interface Dictation {
  start(): void;
  stop(): void;
}

/** Null when this browser cannot recognise on-device. */
export function createDictation(
  host: DictationHost,
  lang: string,
  handlers: DictationHandlers,
): Dictation | null {
  const Recognition = constructorOf(host);
  if (!Recognition) return null;
  let recognition: RecognitionLike | null = null;
  let failed = false;

  return {
    start() {
      failed = false;
      const rec = new Recognition();
      rec.lang = lang;
      rec.continuous = true;
      rec.interimResults = true;
      rec.processLocally = true;
      // A browser that ignores the setting would use its cloud service: do not record at all.
      if (rec.processLocally !== true) {
        handlers.onEnd(true);
        return;
      }
      rec.onresult = (event) => {
        let finals = "";
        let interim = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          const transcript = result?.[0]?.transcript ?? "";
          if (result?.isFinal) finals += transcript;
          else interim += transcript;
        }
        if (finals) handlers.onFinal(finals);
        handlers.onInterim(interim);
      };
      rec.onerror = (event) => {
        // "no-speech" and "aborted" are ordinary ends, not faults.
        failed = event.error !== "no-speech" && event.error !== "aborted";
      };
      rec.onend = () => {
        recognition = null;
        handlers.onInterim("");
        handlers.onEnd(failed);
      };
      recognition = rec;
      rec.start();
    },
    stop() {
      recognition?.stop();
    },
  };
}
