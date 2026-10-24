import Type from "typebox";

/**
 * `{ type: "string", enum: [...] }` for LLM-facing schemas. Mirrors pi-ai's `StringEnum`: plain
 * TypeBox unions/enums emit `anyOf`/`const`, which Google's API does not accept. Core cannot import
 * pi-ai, so the three-line helper lives here.
 */
export function stringEnum<const T extends readonly string[]>(
  values: T,
  description?: string,
): Type.TUnsafe<T[number]> {
  return Type.Unsafe<T[number]>({
    type: "string",
    enum: [...values],
    ...(description ? { description } : {}),
  });
}
