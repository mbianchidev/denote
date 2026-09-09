import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type {
  PluginStructuredNode,
  PluginStructuredViewerFormat,
  PluginStructuredViewerParseRequest,
  PluginStructuredViewModel,
} from "@denote/plugin-sdk";

const ROW_HEIGHT = 30;
const OVERSCAN = 8;
const FULL_RENDER_THRESHOLD = 80;
const FALLBACK_VIEWPORT_HEIGHT = ROW_HEIGHT * 14;
export const MAX_EXPAND_ALL_CONTAINERS = 5_000;

interface StructuredDataViewerProps {
  title: string;
  path: string;
  format: PluginStructuredViewerFormat;
  source: string;
  parse: (
    request: PluginStructuredViewerParseRequest,
  ) => Promise<PluginStructuredViewModel>;
  expandedNodeIds?: string[];
  onExpandedNodeIdsChange: (ids: string[]) => void;
}

export function StructuredDataViewer({
  title,
  path,
  format,
  source,
  parse,
  expandedNodeIds,
  onExpandedNodeIdsChange,
}: StructuredDataViewerProps) {
  const [model, setModel] = useState<PluginStructuredViewModel | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(expandedNodeIds ?? []),
  );
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(
    FALLBACK_VIEWPORT_HEIGHT,
  );
  const request = useRef(0);
  const parseRef = useRef(parse);
  const expandedNodeIdsRef = useRef(expandedNodeIds);
  const onExpandedNodeIdsChangeRef = useRef(onExpandedNodeIdsChange);
  const initializedRoot = useRef<string | null>(null);
  const treeRef = useRef<HTMLDivElement | null>(null);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  parseRef.current = parse;
  expandedNodeIdsRef.current = expandedNodeIds;
  onExpandedNodeIdsChangeRef.current = onExpandedNodeIdsChange;

  useEffect(() => {
    if (expandedNodeIds) {
      setExpanded(new Set(expandedNodeIds));
    }
  }, [expandedNodeIds]);

  useEffect(() => {
    const current = ++request.current;
    setParseError(null);
    setModel(null);
    const timer = window.setTimeout(() => {
      void parseRef.current({ path, format, source })
        .then((next) => {
          if (request.current !== current) {
            return;
          }
          setModel(next);
          if (next.rootId && initializedRoot.current !== next.rootId) {
            initializedRoot.current = next.rootId;
            if (expandedNodeIdsRef.current === undefined) {
              const initial = new Set([next.rootId]);
              setExpanded(initial);
              onExpandedNodeIdsChangeRef.current([next.rootId]);
            }
            setFocusedId(next.rootId);
          }
        })
        .catch((error) => {
          if (request.current === current) {
            setParseError(
              error instanceof Error ? error.message : String(error),
            );
          }
        });
    }, 120);
    return () => {
      window.clearTimeout(timer);
      request.current += 1;
    };
  }, [format, path, source]);

  useLayoutEffect(() => {
    const tree = treeRef.current;
    if (!tree || typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(([entry]) => {
      setViewportHeight(Math.max(ROW_HEIGHT, entry.contentRect.height));
    });
    observer.observe(tree);
    return () => observer.disconnect();
  }, []);

  const nodeById = useMemo(
    () => new Map(model?.nodes.map((node) => [node.id, node]) ?? []),
    [model],
  );
  const childrenById = useMemo(() => {
    const children = new Map<string, PluginStructuredNode[]>();
    for (const node of model?.nodes ?? []) {
      if (!node.parentId) {
        continue;
      }
      const siblings = children.get(node.parentId) ?? [];
      siblings.push(node);
      children.set(node.parentId, siblings);
    }
    return children;
  }, [model]);
  const visibleNodes = useMemo(() => {
    if (!model?.rootId) {
      return [];
    }
    const root = nodeById.get(model.rootId);
    if (!root) {
      return [];
    }
    const visible: PluginStructuredNode[] = [];
    const stack = [root];
    while (stack.length > 0) {
      const node = stack.pop()!;
      visible.push(node);
      if (!expanded.has(node.id)) {
        continue;
      }
      const children = childrenById.get(node.id) ?? [];
      for (let index = children.length - 1; index >= 0; index -= 1) {
        stack.push(children[index]);
      }
    }
    return visible;
  }, [childrenById, expanded, model?.rootId, nodeById]);
  const containerIds = useMemo(
    () =>
      (model?.nodes ?? [])
        .filter((node) => node.childCount > 0)
        .map((node) => node.id),
    [model],
  );

  useEffect(() => {
    if (!focusedId || visibleNodes.some((node) => node.id === focusedId)) {
      return;
    }
    let candidate = nodeById.get(focusedId)?.parentId ?? model?.rootId ?? null;
    while (
      candidate &&
      !visibleNodes.some((node) => node.id === candidate)
    ) {
      candidate = nodeById.get(candidate)?.parentId ?? null;
    }
    setFocusedId(candidate ?? model?.rootId ?? null);
  }, [focusedId, model?.rootId, nodeById, visibleNodes]);

  useLayoutEffect(() => {
    if (!focusedId) {
      return;
    }
    rowRefs.current.get(focusedId)?.focus({ preventScroll: true });
  }, [focusedId, visibleNodes]);

  const virtualized = visibleNodes.length > FULL_RENDER_THRESHOLD;
  const focusedIndex = focusedId
    ? visibleNodes.findIndex((node) => node.id === focusedId)
    : -1;
  const firstVisible = virtualized
    ? Math.floor(scrollTop / ROW_HEIGHT)
    : 0;
  let startIndex = virtualized
    ? Math.max(0, firstVisible - OVERSCAN)
    : 0;
  let endIndex = virtualized
    ? Math.min(
        visibleNodes.length,
        Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + OVERSCAN,
      )
    : visibleNodes.length;
  if (focusedIndex >= 0) {
    startIndex = Math.min(startIndex, focusedIndex);
    endIndex = Math.max(endIndex, focusedIndex + 1);
  }
  const renderedNodes = visibleNodes.slice(startIndex, endIndex);

  const commitExpanded = (next: Set<string>, message: string) => {
    setExpanded(next);
    const ordered = (model?.nodes ?? [])
      .filter((node) => next.has(node.id))
      .map((node) => node.id);
    onExpandedNodeIdsChange(ordered);
    setAnnouncement(message);
  };

  const toggleNode = (node: PluginStructuredNode) => {
    if (node.childCount === 0) {
      setFocusedId(node.id);
      return;
    }
    const next = new Set(expanded);
    if (next.has(node.id)) {
      next.delete(node.id);
      commitExpanded(next, `Collapsed ${node.label}`);
    } else {
      next.add(node.id);
      commitExpanded(next, `Expanded ${node.label}`);
    }
    setFocusedId(node.id);
  };

  const focusIndex = (index: number) => {
    const bounded = Math.max(0, Math.min(visibleNodes.length - 1, index));
    const node = visibleNodes[bounded];
    const tree = treeRef.current;
    if (!node || !tree) {
      return;
    }
    const top = bounded * ROW_HEIGHT;
    const bottom = top + ROW_HEIGHT;
    if (top < tree.scrollTop) {
      tree.scrollTop = top;
      setScrollTop(top);
    } else if (bottom > tree.scrollTop + tree.clientHeight) {
      const nextTop = Math.max(0, bottom - Math.max(tree.clientHeight, ROW_HEIGHT));
      tree.scrollTop = nextTop;
      setScrollTop(nextTop);
    }
    setFocusedId(node.id);
  };

  const onTreeKeyDown = (
    event: React.KeyboardEvent<HTMLDivElement>,
    node: PluginStructuredNode,
  ) => {
    const index = visibleNodes.findIndex((candidate) => candidate.id === node.id);
    if (index < 0) {
      return;
    }
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        focusIndex(index + 1);
        return;
      case "ArrowUp":
        event.preventDefault();
        focusIndex(index - 1);
        return;
      case "Home":
        event.preventDefault();
        focusIndex(0);
        return;
      case "End":
        event.preventDefault();
        focusIndex(visibleNodes.length - 1);
        return;
      case "ArrowLeft":
        event.preventDefault();
        if (expanded.has(node.id) && node.childCount > 0) {
          toggleNode(node);
        } else if (node.parentId) {
          setFocusedId(node.parentId);
        }
        return;
      case "ArrowRight":
        event.preventDefault();
        if (node.childCount > 0 && !expanded.has(node.id)) {
          toggleNode(node);
        } else {
          const firstChild = childrenById.get(node.id)?.[0];
          if (firstChild) {
            setFocusedId(firstChild.id);
          }
        }
        return;
      case "Enter":
      case " ":
        if (node.childCount > 0) {
          event.preventDefault();
          toggleNode(node);
        }
        return;
      default:
        return;
    }
  };

  const parseFailure =
    model?.error ??
    (parseError ? { message: parseError } : null);

  return (
    <section className="structured-data-viewer" aria-label={title}>
      <header className="structured-data-viewer__toolbar">
        <button
          type="button"
          onClick={() => {
            if (!model?.rootId) {
              return;
            }
            commitExpanded(
              new Set([model.rootId]),
              "Collapsed nested containers; root and first-level entries remain visible",
            );
            setFocusedId(model.rootId);
          }}
          disabled={!model?.rootId}
        >
          Collapse all
        </button>
        <button
          type="button"
          onClick={() => {
            const ids = containerIds.slice(0, MAX_EXPAND_ALL_CONTAINERS);
            commitExpanded(
              new Set(ids),
              containerIds.length > ids.length
                ? `Expanded ${ids.length} containers; expansion limit reached`
                : `Expanded all ${ids.length} containers`,
            );
          }}
          disabled={containerIds.length === 0}
        >
          Expand all
        </button>
        {model?.truncated ? (
          <span className="structured-data-viewer__limit">Bounded view</span>
        ) : null}
      </header>
      {parseFailure ? (
        <div className="structured-data-viewer__error" role="alert">
          <strong>Structured view unavailable.</strong>
          <span>{parseFailure.message}</span>
          {parseFailure.line && parseFailure.column ? (
            <span>
              Line {parseFailure.line}, column {parseFailure.column}
            </span>
          ) : null}
          <span>Switch to Raw to inspect and edit the exact source.</span>
        </div>
      ) : model?.rootId ? (
        <>
          {model.notices.map((notice) => (
            <div key={notice} className="structured-data-viewer__notice" role="note">
              {notice}
            </div>
          ))}
          <div
            ref={treeRef}
            className="structured-data-viewer__tree"
            role="tree"
            aria-label={title}
            onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
          >
            {startIndex > 0 ? (
              <div
                aria-hidden="true"
                style={{ height: startIndex * ROW_HEIGHT }}
              />
            ) : null}
            {renderedNodes.map((node) => {
              const isContainer = node.childCount > 0;
              const isExpanded = isContainer && expanded.has(node.id);
              const siblings = node.parentId
                ? (childrenById.get(node.parentId) ?? [])
                : [node];
              const position = siblings.findIndex(
                (candidate) => candidate.id === node.id,
              );
              return (
                <div
                  key={node.id}
                  ref={(element) => {
                    if (element) {
                      rowRefs.current.set(node.id, element);
                    } else {
                      rowRefs.current.delete(node.id);
                    }
                  }}
                  id={`structured-node-${node.id.replace(/[^a-z0-9_-]/gi, "-")}`}
                  className="structured-data-viewer__row"
                  role="treeitem"
                  aria-expanded={isContainer ? isExpanded : undefined}
                  aria-level={node.depth + 1}
                  aria-setsize={siblings.length}
                  aria-posinset={position + 1}
                  aria-label={nodeAccessibleName(node, isExpanded)}
                  tabIndex={node.id === (focusedId ?? model.rootId) ? 0 : -1}
                  style={{ paddingInlineStart: 10 + node.depth * 18 }}
                  onClick={() => toggleNode(node)}
                  onFocus={() => setFocusedId(node.id)}
                  onKeyDown={(event) => onTreeKeyDown(event, node)}
                >
                  {isContainer ? (
                    <button
                      type="button"
                      className="structured-data-viewer__disclosure"
                      tabIndex={-1}
                      aria-expanded={isExpanded}
                      aria-label={`${node.label}, ${
                        isExpanded ? "expanded" : "collapsed"
                      }`}
                      onClick={(event) => {
                        event.stopPropagation();
                        toggleNode(node);
                      }}
                    >
                      {isExpanded ? (
                        <ChevronDown aria-hidden="true" size={14} />
                      ) : (
                        <ChevronRight aria-hidden="true" size={14} />
                      )}
                    </button>
                  ) : (
                    <span
                      className="structured-data-viewer__disclosure"
                      aria-hidden="true"
                    />
                  )}
                  <span className="structured-data-viewer__key">{node.label}</span>
                  {node.anchor ? (
                    <span className="structured-data-viewer__anchor">
                      &amp;{node.anchor}
                    </span>
                  ) : null}
                  <span className="structured-data-viewer__type">{node.type}</span>
                  {node.value !== undefined ? (
                    <span className="structured-data-viewer__value">
                      {node.value}
                    </span>
                  ) : (
                    <span className="structured-data-viewer__count">
                      {node.childCount} {node.childCount === 1 ? "entry" : "entries"}
                    </span>
                  )}
                </div>
              );
            })}
            {endIndex < visibleNodes.length ? (
              <div
                aria-hidden="true"
                style={{ height: (visibleNodes.length - endIndex) * ROW_HEIGHT }}
              />
            ) : null}
          </div>
        </>
      ) : (
        <div className="structured-data-viewer__loading" role="status">
          Parsing locally…
        </div>
      )}
      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </span>
    </section>
  );
}

function nodeAccessibleName(
  node: PluginStructuredNode,
  expanded: boolean,
): string {
  if (node.childCount > 0) {
    return `${node.label}, ${node.type}, ${expanded ? "expanded" : "collapsed"}`;
  }
  const value =
    node.type === "string" && node.value === ""
      ? "empty string"
      : (node.value ?? "empty");
  return `${node.label}, ${node.type}, ${value}`;
}
