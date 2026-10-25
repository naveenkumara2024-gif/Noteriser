/**
 * Runs once when the server starts. It loads the entailment and embedding models and opens the
 * store now, in the background, so the first run does not pay for that (seconds of model loading)
 * while someone is watching. Nothing waits on it: a request that arrives first shares the same
 * start-up, and a failure here is reported again, with its reason, by the first request.
 */
export function register(): void {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  void import("@/app/server/runtime").then(({ getRuntime }) => getRuntime()).catch(() => undefined);
}
