/** Input limits shared by the server (enforced) and the browser (early feedback only). */
export const LIMITS = {
  /** Pasted text, in UTF-8 bytes. */
  textBytes: 200 * 1024,
  /** Uploaded file. */
  fileBytes: 5 * 1024 * 1024,
  extensions: [".txt", ".md", ".pdf", ".docx"],
} as const;

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot).toLowerCase();
}

export const isAllowedFile = (name: string): boolean =>
  (LIMITS.extensions as readonly string[]).includes(extensionOf(name));

export const formatBytes = (n: number): string =>
  n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(0)} MB` : `${Math.round(n / 1024)} KB`;
