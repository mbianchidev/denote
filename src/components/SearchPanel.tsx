import { Search, SlidersHorizontal } from "lucide-react";
import { resolveTagColor, type TagColorMap } from "../lib/tagColors";
import type { SearchResult } from "../types";
import { TagChip } from "./TagChip";

interface SearchPanelProps {
  query: string;
  results: SearchResult[];
  searching: boolean;
  tagColors: TagColorMap;
  onQueryChange: (query: string) => void;
  onOpenResult: (path: string) => void;
}

export function SearchPanel({
  query,
  results,
  searching,
  tagColors,
  onQueryChange,
  onOpenResult,
}: SearchPanelProps) {
  return (
    <div className="search-panel">
      <label className="search-box">
        <Search aria-hidden="true" size={16} />
        <span className="sr-only">Search vault</span>
        <input
          value={query}
          autoFocus
          placeholder='Search, tag:work file:"meeting"'
          onChange={(event) => onQueryChange(event.currentTarget.value)}
        />
      </label>
      <details className="search-help">
        <summary>
          <SlidersHorizontal aria-hidden="true" size={14} />
          Filters
        </summary>
        <p>
          <code>tag:</code> <code>file:</code> <code>path:</code>{" "}
          <code>content:</code> <code>type:</code> <code>bookmarked:</code>{" "}
          <code>recent:7d</code>
        </p>
      </details>
      <div className="sidebar-list" aria-live="polite">
        {searching ? (
          <p className="sidebar-empty">Updating local index…</p>
        ) : results.length > 0 ? (
          results.map(({ document, snippet }) => (
            <button
              type="button"
              className="search-result"
              key={document.path}
              onClick={() => onOpenResult(document.path)}
            >
              <span className="search-result__title">{document.title}</span>
              <span className="search-result__path">{document.path}</span>
              <span className="search-result__snippet">{snippet}</span>
              {document.tags.length > 0 ? (
                <span className="tag-row" aria-label="Tags">
                  {document.tags.slice(0, 4).map((tag) => (
                    <TagChip
                      tag={tag}
                      color={resolveTagColor(tag, tagColors)}
                      key={tag}
                    />
                  ))}
                </span>
              ) : null}
            </button>
          ))
        ) : (
          <p className="sidebar-empty">
            {query ? "No notes match this query." : "Type to search this vault."}
          </p>
        )}
      </div>
    </div>
  );
}
