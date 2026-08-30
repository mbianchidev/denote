import { ListTree } from "lucide-react";
import type { HeadingItem } from "../types";

interface TableOfContentsProps {
  headings: HeadingItem[];
  onNavigate: (heading: HeadingItem) => void;
}

export function TableOfContents({
  headings,
  onNavigate,
}: TableOfContentsProps) {
  return (
    <aside className="toc-panel" aria-label="Table of contents">
      <div className="toc-panel__title">
        <ListTree aria-hidden="true" size={15} />
        Outline
      </div>
      {headings.length > 0 ? (
        <nav className="toc-list">
          {headings.map((heading, index) => (
            <button
              type="button"
              key={`${heading.slug}-${index}`}
              style={{ "--heading-depth": heading.depth } as React.CSSProperties}
              onClick={() => onNavigate(heading)}
            >
              {heading.text}
            </button>
          ))}
        </nav>
      ) : (
        <p className="toc-empty">Add headings to build an outline.</p>
      )}
    </aside>
  );
}
