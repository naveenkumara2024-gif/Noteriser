import Type from "typebox";
import Value from "typebox/value";
import type { DocumentInput } from "@/core/ingest";
import { err, ok, type Result } from "@/core/ports/result";
import { extensionOf, formatBytes, isAllowedFile, LIMITS } from "../limits";
import { ApiError } from "./errors";

const JsonBody = Type.Object(
  {
    text: Type.String(),
    options: Type.Optional(
      Type.Object(
        { format: Type.Optional(Type.Union([Type.Literal("plain"), Type.Literal("markdown")])) },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);

/** Escaping can make JSON several times larger than the text it carries, so the body cap is looser. */
const JSON_BODY_BYTES = LIMITS.textBytes * 6 + 4096;
/** Multipart framing around a file. */
const MULTIPART_OVERHEAD = 64 * 1024;

const tooLarge = (what: string, max: number): ApiError =>
  new ApiError(413, "too_large", `${what} is larger than the ${formatBytes(max)} limit.`);

/** Reads the body but stops as soon as it passes `max`, so an oversized upload is never held in memory. */
async function readCapped(request: Request, max: number): Promise<Uint8Array | undefined> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) return undefined;
  if (!request.body) return new Uint8Array();

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      return undefined;
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    body.set(c, at);
    at += c.byteLength;
  }
  return body;
}

/** Request -> `DocumentInput`, or the 4xx explaining what to change. */
export async function readDocument(request: Request): Promise<Result<DocumentInput, ApiError>> {
  const type = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";

  if (type === "application/json") {
    const body = await readCapped(request, JSON_BODY_BYTES);
    if (!body) return err(tooLarge("The text", LIMITS.textBytes));
    let parsed: unknown;
    try {
      parsed = JSON.parse(new TextDecoder().decode(body));
    } catch {
      return err(new ApiError(400, "invalid_request", "The request body is not valid JSON."));
    }
    if (!Value.Check(JsonBody, parsed)) {
      return err(
        new ApiError(
          400,
          "invalid_request",
          'Send JSON like {"text": "...", "options": {"format": "plain" | "markdown"}}.',
        ),
      );
    }
    if (parsed.text.trim() === "") {
      return err(new ApiError(400, "empty", "There is no text to work from. Paste your notes."));
    }
    if (new TextEncoder().encode(parsed.text).byteLength > LIMITS.textBytes) {
      return err(tooLarge("The text", LIMITS.textBytes));
    }
    return ok({ kind: "text", text: parsed.text, format: parsed.options?.format });
  }

  if (type === "multipart/form-data") {
    const body = await readCapped(request, LIMITS.fileBytes + MULTIPART_OVERHEAD);
    if (!body) return err(tooLarge("The file", LIMITS.fileBytes));
    let form: FormData;
    try {
      form = await new Response(body as BodyInit, {
        headers: { "content-type": request.headers.get("content-type") ?? "" },
      }).formData();
    } catch {
      return err(new ApiError(400, "invalid_request", "The upload could not be read."));
    }
    const file = form.get("file");
    if (!(file instanceof File)) {
      return err(
        new ApiError(400, "invalid_request", 'Send the notes as a form field named "file".'),
      );
    }
    if (!isAllowedFile(file.name)) {
      const got = extensionOf(file.name);
      return err(
        new ApiError(
          415,
          "unsupported_type",
          `${got ? `${got} files are` : "That file type is"} not supported. Use ${LIMITS.extensions.join(", ")}.`,
        ),
      );
    }
    if (file.size === 0) {
      return err(new ApiError(400, "empty", "The file is empty."));
    }
    if (file.size > LIMITS.fileBytes) return err(tooLarge("The file", LIMITS.fileBytes));
    return ok({
      kind: "file",
      name: file.name,
      bytes: new Uint8Array(await file.arrayBuffer()),
    });
  }

  return err(
    new ApiError(
      415,
      "unsupported_type",
      "Send JSON (application/json) or a file upload (multipart/form-data).",
    ),
  );
}
