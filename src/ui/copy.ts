/** All user-facing strings live here so they can be localised later (CLAUDE.md §7). */
export const copy = {
  productName: "NoteBridge",
  tagline:
    "Turn instructor-approved lecture notes into a summary, a glossary and five practice questions, each tied to the exact source sentence it came from.",
  // Lore §10: persistent label against over-trust.
  trustNotice: "Generated from instructor-approved notes. Check flagged items against the source.",
} as const;
