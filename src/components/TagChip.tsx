import { Palette } from "lucide-react";
import { normalizeTag, tagColorStyle } from "../lib/tagColors";

interface TagChipProps {
  tag: string;
  color: string;
  editable?: boolean;
  onActivate?: (tag: string) => void;
  onColorChange?: (tag: string, color: string) => void;
}

export function TagChip({
  tag,
  color,
  editable = false,
  onActivate,
  onColorChange,
}: TagChipProps) {
  const normalized = normalizeTag(tag);
  const style = tagColorStyle(color);
  const chip = onActivate ? (
    <button
      type="button"
      className="tag-chip"
      style={style}
      aria-label={`Search for #${normalized}`}
      onClick={() => onActivate(normalized)}
    >
      #{normalized}
    </button>
  ) : (
    <span className="tag-chip" style={style}>
      #{normalized}
    </span>
  );

  if (!editable || !onColorChange) {
    return chip;
  }

  return (
    <span className="tag-chip-control">
      {chip}
      <label
        className="tag-color-picker"
        style={style}
        title={`Change color for #${normalized}`}
      >
        <Palette aria-hidden="true" size={12} />
        <input
          type="color"
          value={color}
          aria-label={`Change color for #${normalized}`}
          onChange={(event) =>
            onColorChange(normalized, event.currentTarget.value)
          }
        />
      </label>
    </span>
  );
}
