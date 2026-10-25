import pino, { type DestinationStream, type Logger } from "pino";

/**
 * Field names that hold the lecture notes or text derived from them. Application code must not log
 * these at all; this list is the safety net if one slips in (invariant 7). pino's redaction covers
 * the top level and one level of nesting, so code should log identifiers and counts only.
 */
export const REDACT_FIELDS = [
  "doc",
  "sentences",
  "source",
  "text",
  "claim",
  "premise",
  "hypothesis",
  "evidenceQuote",
  "answer",
  "answerStatement",
  "question",
  "term",
  "prompt",
  "system",
  "user",
  "body",
  "content",
  "note",
  "apiKey",
  "authorization",
] as const;

const REDACT_PATHS = REDACT_FIELDS.flatMap((f) => [f, `*.${f}`]);

export function createLogger(options: { stream?: DestinationStream; level?: string } = {}): Logger {
  return pino(
    {
      level: options.level ?? process.env.LOG_LEVEL ?? "info",
      redact: { paths: REDACT_PATHS, censor: "[redacted]" },
    },
    options.stream,
  );
}
