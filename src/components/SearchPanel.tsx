import { Search, SlidersHorizontal, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  createEmptySearchFilters,
  type SearchFilters,
} from "../lib/search";
import { resolveTagColor, type TagColorMap } from "../lib/tagColors";
import type { SearchResult } from "../types";
import { TagChip } from "./TagChip";

interface SearchPanelProps {
  query: string;
  location: string;
  filters: SearchFilters;
  focusQueryRequest: number;
  results: SearchResult[];
  searching: boolean;
  tagColors: TagColorMap;
  onQueryChange: (query: string) => void;
  onLocationChange: (location: string) => void;
  onFiltersChange: (filters: SearchFilters) => void;
  onOpenResult: (result: SearchResult) => void;
}

const FILE_KINDS = [
  ["markdown", "Markdown"],
  ["text", "Text and code"],
  ["image", "Images"],
  ["file", "Other files"],
] as const;

export function SearchPanel({
  query,
  location,
  filters,
  focusQueryRequest,
  results,
  searching,
  tagColors,
  onQueryChange,
  onLocationChange,
  onFiltersChange,
  onOpenResult,
}: SearchPanelProps) {
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [tagInput, setTagInput] = useState(filters.tags.join(", "));
  const queryInputRef = useRef<HTMLInputElement>(null);
  const activeFilterCount = countSearchFilters(filters);

  useEffect(() => {
    if (focusQueryRequest <= 0) {
      return;
    }
    queryInputRef.current?.focus();
    queryInputRef.current?.select();
  }, [focusQueryRequest]);

  useEffect(() => {
    if (
      commaSeparatedValues(tagInput).join("\u0000") !==
      filters.tags.join("\u0000")
    ) {
      setTagInput(filters.tags.join(", "));
    }
  }, [filters.tags, tagInput]);

  return (
    <div className="search-panel">
      <div className="search-controls">
        <div className="search-field search-location">
          <label htmlFor="search-location">Where to search</label>
          <input
            id="search-location"
            value={location}
            spellCheck={false}
            placeholder="* or *.html"
            aria-describedby="search-location-help"
            onChange={(event) => onLocationChange(event.currentTarget.value)}
          />
          <small id="search-location-help">
            Use <code>*</code> for the vault, an exact path for one file, or a
            pattern such as <code>*.html</code>.
          </small>
        </div>
        <label className="search-box">
          <Search aria-hidden="true" size={16} />
          <span className="sr-only">Search text</span>
          <input
            ref={queryInputRef}
            value={query}
            autoFocus
            placeholder="Search text"
            onChange={(event) => onQueryChange(event.currentTarget.value)}
          />
        </label>
        <button
          type="button"
          className="search-filters-toggle"
          aria-expanded={filtersOpen}
          aria-controls="search-filter-panel"
          onClick={() => setFiltersOpen((current) => !current)}
        >
          <SlidersHorizontal aria-hidden="true" size={14} />
          Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
        </button>
        <div
          id="search-filter-panel"
          className="search-filter-panel"
          hidden={!filtersOpen}
        >
          <label>
            <span>Tags</span>
            <input
              value={tagInput}
              placeholder="work, research"
              onChange={(event) => {
                setTagInput(event.currentTarget.value);
                onFiltersChange({
                  ...filters,
                  tags: commaSeparatedValues(event.currentTarget.value),
                });
              }}
            />
          </label>
          <fieldset>
            <legend>File type</legend>
            <div className="search-filter-types">
              {FILE_KINDS.map(([kind, label]) => (
                <label key={kind}>
                  <input
                    type="checkbox"
                    checked={filters.kinds.includes(kind)}
                    onChange={(event) =>
                      onFiltersChange({
                        ...filters,
                        kinds: event.currentTarget.checked
                          ? [...filters.kinds, kind]
                          : filters.kinds.filter((value) => value !== kind),
                      })
                    }
                  />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="search-filter-row">
            <label>
              <span>Recency</span>
              <select
                value={filters.recentDays?.toString() ?? ""}
                onChange={(event) =>
                  onFiltersChange({
                    ...filters,
                    recentDays: event.currentTarget.value
                      ? Number(event.currentTarget.value)
                      : undefined,
                  })
                }
              >
                <option value="">Any time</option>
                <option value="1">Past day</option>
                <option value="7">Past 7 days</option>
                <option value="30">Past 30 days</option>
                <option value="90">Past 90 days</option>
              </select>
            </label>
            <label>
              <span>Bookmark</span>
              <select
                value={
                  filters.bookmarked === undefined
                    ? ""
                    : filters.bookmarked
                      ? "true"
                      : "false"
                }
                onChange={(event) =>
                  onFiltersChange({
                    ...filters,
                    bookmarked:
                      event.currentTarget.value === ""
                        ? undefined
                        : event.currentTarget.value === "true",
                  })
                }
              >
                <option value="">Any</option>
                <option value="true">Bookmarked</option>
                <option value="false">Not bookmarked</option>
              </select>
            </label>
          </div>
          <label>
            <span>Filename contains</span>
            <input
              value={filters.filenames[0] ?? ""}
              onChange={(event) =>
                onFiltersChange({
                  ...filters,
                  filenames: optionalValue(event.currentTarget.value),
                })
              }
            />
          </label>
          <label>
            <span>Path contains</span>
            <input
              value={filters.paths[0] ?? ""}
              onChange={(event) =>
                onFiltersChange({
                  ...filters,
                  paths: optionalValue(event.currentTarget.value),
                })
              }
            />
          </label>
          <label>
            <span>Content contains</span>
            <input
              value={filters.content[0] ?? ""}
              onChange={(event) =>
                onFiltersChange({
                  ...filters,
                  content: optionalValue(event.currentTarget.value),
                })
              }
            />
          </label>
          <button
            type="button"
            className="search-filters-clear"
            disabled={activeFilterCount === 0}
            onClick={() => onFiltersChange(createEmptySearchFilters())}
          >
            <X aria-hidden="true" size={13} />
            Clear filters
          </button>
        </div>
      </div>
      <div className="sidebar-list" aria-live="polite" aria-busy={searching}>
        {searching ? (
          <p className="sidebar-empty">Updating local index…</p>
        ) : results.length > 0 ? (
          results.map((result) => (
            <button
              type="button"
              className="search-result"
              key={`${result.document.path}:${result.match?.from ?? "file"}:${result.match?.to ?? "file"}`}
              onClick={() => onOpenResult(result)}
            >
              <span className="search-result__title">
                {result.document.title}
              </span>
              <span className="search-result__path">
                {result.document.path}
                {result.occurrence ? ` · Match ${result.occurrence}` : ""}
              </span>
              <span className="search-result__snippet">{result.snippet}</span>
              {result.document.tags.length > 0 ? (
                <span className="tag-row" aria-label="Tags">
                  {result.document.tags.slice(0, 4).map((tag) => (
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
            {query || location !== "*" || activeFilterCount > 0
              ? "No files match this search."
              : "Type to search this vault."}
          </p>
        )}
      </div>
    </div>
  );
}

function commaSeparatedValues(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function optionalValue(value: string): string[] {
  const trimmed = value.trim();
  return trimmed ? [trimmed] : [];
}

function countSearchFilters(filters: SearchFilters): number {
  return (
    filters.tags.length +
    filters.filenames.length +
    filters.paths.length +
    filters.content.length +
    filters.kinds.length +
    (filters.bookmarked === undefined ? 0 : 1) +
    (filters.recentDays === undefined ? 0 : 1)
  );
}
