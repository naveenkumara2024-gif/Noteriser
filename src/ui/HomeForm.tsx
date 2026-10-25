"use client";

import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import { formatBytes, isAllowedFile, LIMITS } from "@/app/limits";
import { copy } from "./copy";
import { RunProgress } from "./RunProgress";
import { useRun } from "./use-run";

export function HomeForm({
  sampleText,
  demoMode,
  notice,
}: {
  sampleText: string;
  demoMode: boolean;
  /** A one-time message, for example after deleting a run. */
  notice?: string;
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [plain, setPlain] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const onFinished = useCallback((runId: string) => router.push(`/runs/${runId}`), [router]);
  const { phase, start, cancel } = useRun(onFinished);
  const running = phase.name === "running";

  function chooseFile(next: File | null) {
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
  }

  function loadSample() {
    setText(sampleText);
    setFile(null);
    if (fileInput.current) fileInput.current.value = "";
    setProblem(null);
    setStatus(copy.home.sampleLoaded);
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (running) return;
    setStatus(null);
    if (file) {
      setProblem(null);
      void start({ kind: "file", file, plain });
    } else if (text.trim() !== "") {
      if (new TextEncoder().encode(text).byteLength > LIMITS.textBytes) {
        setProblem(`The text is larger than the ${formatBytes(LIMITS.textBytes)} limit.`);
        return;
      }
      setProblem(null);
      void start({ kind: "text", text, plain });
    } else {
      setProblem(copy.home.noInput);
    }
  }

  return (
    <div className="space-y-6">
      {notice && (
        <p role="status" className="rounded border border-line-strong bg-surface px-4 py-3">
          {notice}
        </p>
      )}
      {demoMode && (
        <p role="note" className="rounded border border-warn bg-warn-bg px-4 py-3 text-warn">
          {copy.home.demoMode}
        </p>
      )}

      <form onSubmit={submit} className="space-y-5" noValidate>
        <div>
          <label htmlFor="notes" className="block text-lg font-medium">
            {copy.home.notesLabel}
          </label>
          <p id="notes-hint" className="text-sm text-muted">
            {copy.home.notesHint}
          </p>
          <textarea
            id="notes"
            name="text"
            rows={12}
            value={text}
            disabled={running}
            onChange={(e) => {
              setText(e.target.value);
              setProblem(null);
              setStatus(null);
            }}
            aria-describedby="notes-hint"
            className="mt-2 w-full rounded border border-line-strong bg-bg p-3 font-mono text-sm"
          />
          <button
            type="button"
            onClick={loadSample}
            disabled={running}
            className="mt-2 rounded border border-line-strong px-4 py-2 font-medium hover:bg-surface"
          >
            {copy.home.sampleButton}
          </button>
        </div>

        <div>
          <label htmlFor="file" className="block text-lg font-medium">
            {copy.home.fileLabel}
          </label>
          <p id="file-hint" className="text-sm text-muted">
            {copy.home.fileHint} Up to {formatBytes(LIMITS.fileBytes)}.
          </p>
          <input
            ref={fileInput}
            id="file"
            name="file"
            type="file"
            accept={LIMITS.extensions.join(",")}
            disabled={running}
            onChange={(e) => chooseFile(e.target.files?.[0] ?? null)}
            aria-describedby="file-hint"
            className="mt-2 block w-full"
          />
          {file && (
            <p className="mt-1 text-sm">
              Selected: {file.name}. It will be used instead of the pasted text.
            </p>
          )}
        </div>

        <div>
          <label className="inline-flex min-h-6 items-center gap-2 font-medium">
            <input
              type="checkbox"
              checked={plain}
              disabled={running}
              onChange={(e) => setPlain(e.target.checked)}
              aria-describedby="plain-hint"
            />
            {copy.home.plainOption}
          </label>
          <p id="plain-hint" className="measure text-sm text-muted">
            {copy.home.plainHint}
          </p>
        </div>

        {problem && (
          <p
            role="alert"
            className="rounded border border-danger bg-danger-bg px-4 py-3 text-danger"
          >
            {problem}
          </p>
        )}
        {phase.name === "failed" && (
          <p
            role="alert"
            className="rounded border border-danger bg-danger-bg px-4 py-3 text-danger"
          >
            {phase.message}
          </p>
        )}
        {phase.name === "cancelled" && (
          <p role="status" className="rounded border border-line-strong bg-surface px-4 py-3">
            {copy.home.cancelled}
          </p>
        )}
        {status && (
          <p role="status" className="text-sm text-muted">
            {status}
          </p>
        )}

        <button
          type="submit"
          disabled={running}
          className="rounded bg-accent px-6 py-3 text-lg font-semibold text-accent-fg disabled:opacity-60"
        >
          {copy.home.submit}
        </button>
      </form>

      {phase.name === "running" && (
        <RunProgress progress={phase.progress} plain={plain} onCancel={cancel} />
      )}
    </div>
  );
}
