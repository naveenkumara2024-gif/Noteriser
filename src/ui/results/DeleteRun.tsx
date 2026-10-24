"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { copy } from "../copy";

/** Two-step delete: the second step names what is lost, and nothing is removed until it is chosen. */
export function DeleteRun({ runId }: { runId: string }) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [failed, setFailed] = useState(false);

  async function remove() {
    setFailed(false);
    try {
      const res = await fetch(`/api/runs/${runId}`, { method: "DELETE" });
      if (res.ok || res.status === 404) {
        router.push("/?deleted=1");
        return;
      }
    } catch {
      // fall through to the message
    }
    setFailed(true);
  }

  if (!asking) {
    return (
      <button
        type="button"
        onClick={() => setAsking(true)}
        className="rounded border border-line-strong px-4 py-2 font-medium hover:bg-surface"
      >
        {copy.results.deleteRun}
      </button>
    );
  }
  return (
    <fieldset className="space-y-2">
      <legend>{copy.results.deleteConfirm}</legend>
      <div className="flex gap-3">
        <button
          type="button"
          onClick={remove}
          className="rounded bg-danger px-4 py-2 font-medium text-bg"
        >
          {copy.results.deleteYes}
        </button>
        <button
          type="button"
          onClick={() => setAsking(false)}
          className="rounded border border-line-strong px-4 py-2 font-medium hover:bg-surface"
        >
          {copy.results.deleteNo}
        </button>
      </div>
      {failed && (
        <p role="alert" className="text-danger">
          {copy.results.deleteFailed}
        </p>
      )}
    </fieldset>
  );
}
