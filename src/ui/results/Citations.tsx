import { copy } from "../copy";
import type { Select, Selection } from "./types";

/** Source references as buttons: choosing one shows that sentence in the Source column. */
export function Citations({
  itemId,
  ids,
  selection,
  onSelect,
}: {
  itemId: string;
  ids: readonly string[];
  selection: Selection | null;
  onSelect: Select;
}) {
  return (
    <ul aria-label={copy.results.citations} className="flex flex-wrap gap-1.5">
      {ids.map((id) => {
        const pressed =
          selection?.itemId === itemId && selection.ids.length === 1 && selection.ids[0] === id;
        return (
          <li key={id}>
            <button
              type="button"
              aria-pressed={pressed}
              aria-label={`Source sentence ${id}`}
              onClick={() => onSelect(pressed ? null : { itemId, ids: [id] })}
              className={`rounded border px-2 py-0.5 font-mono text-sm ${
                pressed
                  ? "border-mark-fg bg-mark-bg text-mark-fg"
                  : "border-line-strong hover:bg-surface"
              }`}
            >
              {id}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
