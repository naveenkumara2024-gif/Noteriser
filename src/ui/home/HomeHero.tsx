"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { formatBytes, isAllowedFile, LIMITS } from "@/app/limits";
import { copy } from "../copy";
import {
  createDictation,
  type Dictation,
  type DictationHost,
  dictationAvailable,
} from "../dictation";
import { ArrowUp, AudioLines, FileText, Mic, MicOff, Plus, Square, X } from "../icons";
import { stagesFor } from "../progress";
import { useRunSession } from "../shell/RunSession";

/**
 * The main page: a large headline and the composer where notes are pasted, dropped or dictated.
 * It keeps every rule the old form had (size limits, a file wins over pasted text, a parse error
 * keeps the form, the same messages); only the shape changed. The run itself belongs to the shell's
 * session, so it keeps going, and shows in the activity panel, if the person navigates away.
 */
export function HomeHero({
  sampleText,
  demoMode,
  notice,
}: {
  sampleText: string;
  demoMode: boolean;
  /** A one-time message, for example after deleting a run. */
  notice?: string;
}) {
  const session = useRunSession();
  const { phase, running } = session;
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [plain, setPlain] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [dropping, setDropping] = useState(false);
  const [canDictate, setCanDictate] = useState(false);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const dictation = useRef<Dictation | null>(null);
  const caret = useRef(0);
  const hintId = useId();

  // On-device dictation only: the button exists only if the browser says a local recognizer is ready.
  useEffect(() => {
    // Measured in Stage 12: SpeechRecognition.available() crashes a headless (automated) Chromium
    // renderer, while headed Chromium answers "downloadable" for an on-device pack that is not
    // installed. Automation therefore never probes; a person's browser does.
    if (navigator.webdriver) return;
    let alive = true;
    const host = window as unknown as DictationHost;
    const lang = navigator.language || "en-US";
    void dictationAvailable(host, lang).then((ok) => {
      if (!alive || !ok) return;
      dictation.current = createDictation(host, lang, {
        onFinal: (chunk) =>
          setText((prev) => {
            const at = Math.min(caret.current, prev.length);
            caret.current = at + chunk.length;
            return prev.slice(0, at) + chunk + prev.slice(at);
          }),
        onInterim: setInterim,
        onEnd: (failed) => {
          setListening(false);
          setStatus(failed ? copy.composer.dictationFailed : null);
        },
      });
      setCanDictate(dictation.current !== null);
    });
    return () => {
      alive = false;
      dictation.current?.stop();
    };
  }, []);

  // The box grows with the notes up to 40% of the window, then scrolls.
  // biome-ignore lint/correctness/useExhaustiveDependencies: resize whenever the text changes
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, window.innerHeight * 0.4)}px`;
  }, [text]);

  const chooseFile = useCallback((next: File | null) => {
    setProblem(null);
    setStatus(null);
    if (next && !isAllowedFile(next.name)) {
      setProblem(`That file type is not supported. Use ${LIMITS.extensions.join(", ")}.`);
      if (fileInput.current) fileInput.current.value = "";
      setFile(null);
      return;
    }
    if (next && next.size > LIMITS.fileBytes) {
      setProblem(`The file is larger than the ${formatBytes(LIMITS.fileBytes)} limit.`);
      if (fileInput.current) fileInput.current.value = "";
      setFile(null);
      return;
    }
    setFile(next);
  }, []);

  function loadSample() {
    setText(sampleText);
    setFile(null);
    if (fileInput.current) fileInput.current.value = "";
    setProblem(null);
    setStatus(copy.home.sampleLoaded);
    // The next step is the round button, which follows the notes box in the tab order.
    area.current?.focus();
  }

  function toggleDictation() {
    if (listening) {
      dictation.current?.stop();
      return;
    }
    caret.current = area.current?.selectionStart ?? text.length;
    setStatus(copy.composer.listening);
    setListening(true);
    dictation.current?.start();
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    // While a run is going the round button is "Cancel".
    if (running) {
      session.cancel();
      return;
    }
    setStatus(null);
    if (file) {
      setProblem(null);
      session.start({ kind: "file", file, plain });
    } else if (text.trim() !== "") {
      if (new TextEncoder().encode(text).byteLength > LIMITS.textBytes) {
        setProblem(`The text is larger than the ${formatBytes(LIMITS.textBytes)} limit.`);
        return;
      }
      setProblem(null);
      session.start({ kind: "text", text, plain });
    } else {
      setProblem(copy.home.noInput);
    }
  }

  const failedMessage = phase.name === "failed" ? phase.message : null;
  const active =
    text !== "" ||
    file !== null ||
    running ||
    problem !== null ||
    status !== null ||
    failedMessage !== null ||
    phase.name === "cancelled" ||
    notice !== undefined;

  const stages = stagesFor(session.plain);
  const progress = phase.name === "running" ? phase.progress : null;
  const stepIndex = progress
    ? progress.current
      ? stages.indexOf(progress.current) + 1
      : progress.finished.length
    : 0;
  const stepLabel = progress
    ? copy.progress.step(
        Math.max(1, stepIndex),
        stages.length,
        copy.progress.stageLabel[progress.current ?? "parse"],
      )
    : "";

  return (
    <section className="nb-hero" data-active={active ? "true" : "false"}>
      <div className="nb-hero-inner">
        <h1 className="nb-headline">
          <span className="nb-line">{copy.composer.heading[0]}</span>{" "}
          <span className="nb-line">{copy.composer.heading[1]}</span>{" "}
          <span className="nb-line">{copy.composer.heading[2]}</span>
        </h1>
        <div className="nb-guides" aria-hidden="true" />

        <form ref={form} className="nb-composer-block" onSubmit={submit} noValidate>
          {/* biome-ignore lint/a11y/noStaticElementInteractions: a drop target; the "+" button is the keyboard route to the same action */}
          <div
            className="nb-composer"
            data-drop={dropping ? "true" : undefined}
            onDragOver={(e) => {
              if (running) return;
              e.preventDefault();
              setDropping(true);
            }}
            onDragLeave={() => setDropping(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDropping(false);
              if (running) return;
              const dropped = e.dataTransfer.files[0];
              if (dropped) {
                chooseFile(dropped);
                setStatus(copy.composer.dropped);
              }
            }}
          >
            {file && (
              <div className="nb-chiprow">
                <span className="nb-file">
                  <FileText size={14} />
                  <span>
                    {file.name} ({formatBytes(file.size)})
                  </span>
                  <button
                    type="button"
                    className="nb-icon-btn is-bare"
                    style={{ width: "1.75rem", height: "1.75rem" }}
                    aria-label={copy.composer.removeFile}
                    disabled={running}
                    onClick={() => {
                      chooseFile(null);
                      if (fileInput.current) fileInput.current.value = "";
                    }}
                  >
                    <X size={14} />
                  </button>
                </span>
              </div>
            )}

            <button
              type="button"
              className="nb-circle"
              aria-label={copy.composer.upload}
              data-tip={copy.composer.upload}
              disabled={running}
              onClick={() => fileInput.current?.click()}
            >
              <Plus size={18} />
            </button>

            <label htmlFor="notes" className="sr-only">
              {copy.home.notesLabel}
            </label>
            <textarea
              id="notes"
              ref={area}
              name="text"
              rows={1}
              value={text}
              disabled={running}
              placeholder={copy.composer.placeholder}
              aria-describedby={hintId}
              onChange={(e) => {
                setText(e.target.value);
                setProblem(null);
                setStatus(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  form.current?.requestSubmit();
                }
              }}
            />

            {canDictate && (
              <button
                type="button"
                className="nb-icon-btn is-bare"
                aria-pressed={listening}
                aria-label={listening ? copy.composer.stopDictation : copy.composer.dictate}
                data-tip={listening ? copy.composer.stopDictation : copy.composer.dictate}
                disabled={running}
                onClick={toggleDictation}
              >
                {listening ? <MicOff size={18} /> : <Mic size={18} />}
              </button>
            )}

            <button
              type="submit"
              className="nb-send"
              aria-label={running ? copy.progress.cancel : copy.home.submit}
              data-tip={running ? copy.progress.cancel : copy.home.submit}
            >
              {running ? (
                <span className="relative grid place-items-center">
                  <AudioLines size={20} className="nb-bars" />
                  <Square size={8} fill="currentColor" className="absolute" />
                </span>
              ) : (
                <ArrowUp size={18} />
              )}
            </button>
          </div>

          {/* The file field stays in the page, hidden: the "+" button opens it. */}
          <label htmlFor="file" className="sr-only">
            {copy.home.fileLabel}
          </label>
          <input
            ref={fileInput}
            id="file"
            name="file"
            type="file"
            tabIndex={-1}
            className="sr-only"
            accept={LIMITS.extensions.join(",")}
            disabled={running}
            onChange={(e) => chooseFile(e.target.files?.[0] ?? null)}
          />

          <div className="nb-under">
            {notice && (
              <p role="status" className="nb-msg">
                {notice}
              </p>
            )}
            {demoMode && (
              <p role="note" className="nb-msg" data-tone="warn">
                {copy.home.demoMode}
              </p>
            )}
            {problem && (
              <p role="alert" className="nb-msg" data-tone="danger">
                {problem}
              </p>
            )}
            {failedMessage && (
              <p role="alert" className="nb-msg" data-tone="danger">
                {failedMessage}
              </p>
            )}
            {phase.name === "cancelled" && (
              <p role="status" className="nb-msg">
                {copy.home.cancelled}
              </p>
            )}
            {running && (
              <section aria-labelledby="working-heading" className="grid w-full gap-1">
                <h2 id="working-heading" className="text-base font-semibold">
                  {copy.progress.heading}
                </h2>
                <p role="status" className="nb-msg">
                  {stepLabel}. {copy.composer.runningStatus}
                </p>
              </section>
            )}
            {status && !running && (
              <p role="status" className="nb-small">
                {status}
              </p>
            )}
            {interim && (
              <p className="nb-small" aria-hidden="true">
                {interim}
              </p>
            )}

            <div className="nb-chips">
              <button type="button" className="nb-chip" disabled={running} onClick={loadSample}>
                <FileText size={16} />
                {copy.home.sampleButton}
              </button>
              <label className="nb-chip">
                <input
                  type="checkbox"
                  checked={plain}
                  disabled={running}
                  onChange={(e) => setPlain(e.target.checked)}
                  aria-describedby={plain ? "plain-hint" : undefined}
                />
                {copy.home.plainOption}
              </label>
            </div>

            <p id={hintId} className="nb-small">
              {copy.home.notesHint} {copy.home.fileHint}{" "}
              {copy.composer.limits(formatBytes(LIMITS.textBytes), formatBytes(LIMITS.fileBytes))}{" "}
              {copy.composer.submitHint}
            </p>
            {/* Said once the option is on, so the idle page stays short. */}
            {plain && (
              <p id="plain-hint" className="nb-small">
                {copy.home.plainHint}
              </p>
            )}
            <p className="nb-small">{copy.tagline}</p>
          </div>
        </form>
      </div>
    </section>
  );
}
