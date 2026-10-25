"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { browserDeps, IDLE, Reader, type ReaderState, type Speakable, type VoiceInfo } from "./tts";

/** Speech controls for one page. Reports `supported: false` (so the controls are not drawn) where the browser has no synthesis. */
export function useReader() {
  const reader = useRef<Reader | null>(null);
  const [supported, setSupported] = useState(false);
  const [state, setState] = useState<ReaderState>(IDLE);
  const [voices, setVoices] = useState<VoiceInfo[]>([]);
  const [rate, setRateState] = useState(1);
  const [voiceURI, setVoiceState] = useState("");

  useEffect(() => {
    const deps = browserDeps();
    if (!deps) return;
    const r = new Reader(deps, setState);
    reader.current = r;
    setSupported(true);

    const loadVoices = (): void => setVoices(deps.synth.getVoices());
    loadVoices();
    window.speechSynthesis.addEventListener("voiceschanged", loadVoices);

    return () => {
      window.speechSynthesis.removeEventListener("voiceschanged", loadVoices);
      r.dispose(); // leaving the page stops the speech
      reader.current = null;
    };
  }, []);

  const play = useCallback((items: readonly Speakable[]) => reader.current?.play(items), []);
  const pause = useCallback(() => reader.current?.pause(), []);
  const resume = useCallback(() => reader.current?.resume(), []);
  const stop = useCallback(() => reader.current?.stop(), []);
  const setRate = useCallback((value: number) => {
    if (reader.current) reader.current.rate = value;
    setRateState(value);
  }, []);
  const setVoice = useCallback((uri: string) => {
    if (reader.current) reader.current.voiceURI = uri || null;
    setVoiceState(uri);
  }, []);

  return { supported, state, voices, rate, voiceURI, play, pause, resume, stop, setRate, setVoice };
}

export type ReaderApi = ReturnType<typeof useReader>;
