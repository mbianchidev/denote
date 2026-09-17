import {
  List,
  Maximize2,
  Network,
  RotateCcw,
  Search,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import type {
  PluginNoteGraphIndexRequest,
  PluginNoteGraphModel,
  PluginNoteGraphNode,
  PluginNoteGraphOrphanFilter,
  PluginNoteGraphQuery,
} from "@denote/plugin-sdk";
import type { PluginNoteGraphContribution } from "../plugins/workerRuntime";
import { NoteGraphCoordinator } from "../plugins/noteGraphCoordinator";
import {
  NOTE_GRAPH_VIEW_HEIGHT,
  NOTE_GRAPH_VIEW_WIDTH,
  noteGraphPointFromClient,
} from "../lib/noteGraphForce";
import {
  noteGraphFolders,
  noteGraphTags,
  type NoteGraphSnapshot,
} from "../plugins/noteGraphs";
import { useNoteGraphForceLayout } from "./useNoteGraphForceLayout";

interface NoteGraphPanelProps {
  provider: PluginNoteGraphContribution;
  snapshot: NoteGraphSnapshot | null;
  activePath: string | null;
  indexNoteGraph: (
    pluginId: string,
    providerId: string,
    request: PluginNoteGraphIndexRequest,
  ) => Promise<void>;
  queryNoteGraph: (
    pluginId: string,
    providerId: string,
    request: PluginNoteGraphQuery,
  ) => Promise<PluginNoteGraphModel>;
  onOpenFile: (path: string) => void;
  onError: (error: unknown) => void;
  surface?: "sidebar" | "tab";
  onOpenInTab?: () => void;
  coordinator?: NoteGraphCoordinator;
}

type Presentation = "graph" | "list";

export function NoteGraphPanel({
  provider,
  snapshot,
  activePath,
  indexNoteGraph,
  queryNoteGraph,
  onOpenFile,
  onError,
  surface = "sidebar",
  onOpenInTab,
  coordinator,
}: NoteGraphPanelProps) {
  const headingId = useId();
  const [localCoordinator] = useState(() => new NoteGraphCoordinator());
  const graphCoordinator = coordinator ?? localCoordinator;
  const [scope, setScope] = useState<PluginNoteGraphQuery["scope"]>("global");
  const [presentation, setPresentation] = useState<Presentation>("graph");
  const [folder, setFolder] = useState<string | null>(null);
  const [tag, setTag] = useState<string | null>(null);
  const [orphanFilter, setOrphanFilter] =
    useState<PluginNoteGraphOrphanFilter>("all");
  const [depth, setDepth] = useState<PluginNoteGraphQuery["depth"]>(2);
  const [model, setModel] = useState<PluginNoteGraphModel | null>(null);
  const [status, setStatus] = useState("Waiting for the local note index.");
  const [loading, setLoading] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [listQuery, setListQuery] = useState("");
  const [zoom, setZoom] = useState(1);
  const generation = useRef(0);
  const providerKey = `${provider.pluginId}:${provider.id}`;
  const folders = useMemo(
    () => noteGraphFolders(snapshot?.documents ?? []),
    [snapshot],
  );
  const tags = useMemo(
    () => noteGraphTags(snapshot?.documents ?? []),
    [snapshot],
  );
  const indexedActivePath =
    activePath &&
    snapshot?.documents.some((document) => document.path === activePath)
      ? activePath
      : null;
  const query = useMemo<PluginNoteGraphQuery>(
    () => ({
      scope,
      activePath: indexedActivePath,
      folder,
      tag,
      orphanFilter,
      depth,
    }),
    [depth, folder, indexedActivePath, orphanFilter, scope, tag],
  );

  useEffect(() => {
    if (!coordinator) {
      localCoordinator.invalidateWorkspace();
    }
  }, [coordinator, localCoordinator, snapshot?.workspaceKey]);

  useEffect(
    () => () => {
      if (!coordinator) {
        localCoordinator.clear();
      }
    },
    [coordinator, localCoordinator],
  );

  useEffect(() => {
    generation.current += 1;
    setModel(null);
    setSelectedNodeId(null);
    setStatus("Waiting for the local note index.");
  }, [providerKey, snapshot?.workspaceKey]);

  useEffect(() => {
    if (folder !== null && !folders.includes(folder)) {
      setFolder(null);
    }
  }, [folder, folders]);

  useEffect(() => {
    if (tag !== null && !tags.includes(tag)) {
      setTag(null);
    }
  }, [tag, tags]);

  useEffect(() => {
    const requestGeneration = ++generation.current;
    if (!snapshot) {
      setModel(null);
      setLoading(false);
      setStatus("Waiting for the local note index.");
      return;
    }
    setLoading(true);
    setStatus("Updating note connections…");
    void graphCoordinator
      .run(
        provider,
        snapshot,
        query,
        indexNoteGraph,
        queryNoteGraph,
      )
      .then(({ model: nextModel }) => {
        if (requestGeneration !== generation.current) {
          return;
        }
        setModel(nextModel);
        setLoading(false);
        setStatus(
          nextModel.matchingNotes === nextModel.totalNotes
            ? `${nextModel.totalNotes} indexed note${
                nextModel.totalNotes === 1 ? "" : "s"
              }.`
            : `${nextModel.matchingNotes} of ${nextModel.totalNotes} indexed notes match.`,
        );
      })
      .catch((error) => {
      if (requestGeneration !== generation.current) {
        return;
      }
      setLoading(false);
      setModel(null);
      setStatus("The note graph could not be updated.");
      onError(error);
      });
    return () => {
      if (generation.current === requestGeneration) {
        generation.current += 1;
      }
    };
  }, [
    graphCoordinator,
    indexNoteGraph,
    onError,
    provider,
    query,
    queryNoteGraph,
    snapshot,
  ]);

  useEffect(() => {
    if (!model || model.nodes.length === 0) {
      setSelectedNodeId(null);
      return;
    }
    if (
      selectedNodeId &&
      model.nodes.some((node) => node.id === selectedNodeId)
    ) {
      return;
    }
    setSelectedNodeId(model.activeNodeId ?? model.nodes[0].id);
  }, [model, selectedNodeId]);

  const selectedNode =
    model?.nodes.find((node) => node.id === selectedNodeId) ?? null;
  const graphControlsDisabled = loading && model === null;
  const filteredListNodes = useMemo(() => {
    const term = listQuery.trim().toLocaleLowerCase();
    if (!model || !term) {
      return model?.nodes ?? [];
    }
    return model.nodes.filter((node) =>
      `${node.title}\n${node.path}\n${node.tags.join(" ")}`
        .toLocaleLowerCase()
        .includes(term),
    );
  }, [listQuery, model]);

  return (
    <section
      className={`note-graph-panel note-graph-panel--${surface}`}
      aria-labelledby={headingId}
    >
      <div
        className={`note-graph-panel__header${
          surface === "sidebar" ? " sidebar-view__title" : ""
        }`}
      >
        <h2 id={headingId}>{provider.title}</h2>
        <div className="note-graph-panel__header-actions">
          {loading ? (
            <span className="note-graph-panel__busy">Updating</span>
          ) : null}
          {onOpenInTab ? (
            <button
              type="button"
              className="icon-button"
              aria-label={`Open ${provider.title} in a tab`}
              title={`Open ${provider.title} in a tab`}
              onClick={onOpenInTab}
            >
              <Maximize2 aria-hidden="true" size={14} />
            </button>
          ) : null}
        </div>
      </div>
      <div className="note-graph-panel__body">
        <div className="note-graph-panel__switches">
          <div className="note-graph-panel__segment" aria-label="Graph scope">
            <button
              type="button"
              aria-pressed={scope === "global"}
              disabled={graphControlsDisabled}
              onClick={() => setScope("global")}
            >
              Global
            </button>
            <button
              type="button"
              aria-pressed={scope === "local"}
              disabled={graphControlsDisabled}
              onClick={() => setScope("local")}
            >
              Local
            </button>
          </div>
          <div
            className="note-graph-panel__segment"
            aria-label="Graph presentation"
          >
            <button
              type="button"
              aria-label="Show graph"
              title="Show graph"
              aria-pressed={presentation === "graph"}
              onClick={() => setPresentation("graph")}
            >
              <Network aria-hidden="true" size={14} />
            </button>
            <button
              type="button"
              aria-label="Show keyboard note list"
              title="Show keyboard note list"
              aria-pressed={presentation === "list"}
              onClick={() => setPresentation("list")}
            >
              <List aria-hidden="true" size={14} />
            </button>
          </div>
        </div>
        <div className="note-graph-panel__filters">
          <label>
            Folder
            <select
              value={folder === null ? "*" : folder || "."}
              disabled={graphControlsDisabled}
              onChange={(event) =>
                setFolder(
                  event.currentTarget.value === "*"
                    ? null
                    : event.currentTarget.value === "."
                      ? ""
                      : event.currentTarget.value,
                )
              }
            >
              <option value="*">All folders</option>
              {folders.map((value) => (
                <option value={value || "."} key={value || "."}>
                  {value || "Vault root"}
                </option>
              ))}
            </select>
          </label>
          <label>
            Tag
            <select
              value={tag ?? "*"}
              disabled={graphControlsDisabled}
              onChange={(event) =>
                setTag(
                  event.currentTarget.value === "*"
                    ? null
                    : event.currentTarget.value,
                )
              }
            >
              <option value="*">All tags</option>
              {tags.map((value) => (
                <option value={value} key={value}>
                  #{value}
                </option>
              ))}
            </select>
          </label>
          <label>
            Connections
            <select
              value={orphanFilter}
              disabled={graphControlsDisabled}
              onChange={(event) =>
                setOrphanFilter(
                  event.currentTarget.value as PluginNoteGraphOrphanFilter,
                )
              }
            >
              <option value="all">All notes</option>
              <option value="only">Orphans only</option>
              <option value="connected">Connected only</option>
            </select>
          </label>
          {scope === "local" ? (
            <label>
              Depth
              <select
                value={depth}
                disabled={graphControlsDisabled}
                onChange={(event) =>
                  setDepth(Number(event.currentTarget.value) as 1 | 2 | 3)
                }
              >
                <option value={1}>1 connection</option>
                <option value={2}>2 connections</option>
                <option value={3}>3 connections</option>
              </select>
            </label>
          ) : null}
        </div>
        <p className="note-graph-panel__status" role="status" aria-live="polite">
          {status}
        </p>
        {model?.notices.length ? (
          <ul className="note-graph-panel__notices">
            {model.notices.map((notice) => (
              <li key={notice}>{notice}</li>
            ))}
          </ul>
        ) : null}
        {!model ? (
          <div className="note-graph-panel__empty">
            <Network aria-hidden="true" size={24} />
            <p>
              {loading
                ? "Building the local note graph…"
                : "The local note graph is not available."}
            </p>
          </div>
        ) : presentation === "graph" ? (
          <GraphPlot
            large={surface === "tab"}
            model={model}
            selectedNodeId={selectedNodeId}
            zoom={zoom}
            onSelectedNodeChange={setSelectedNodeId}
            onOpenFile={onOpenFile}
            onZoomChange={setZoom}
            onNodeMoved={(node) =>
              setStatus(
                `Moved ${node.title}; connected notes followed.`,
              )
            }
          />
        ) : (
          <GraphList
            nodes={filteredListNodes}
            activePath={activePath}
            selectedNodeId={selectedNodeId}
            query={listQuery}
            onQueryChange={setListQuery}
            onSelectedNodeChange={setSelectedNodeId}
            onOpenFile={onOpenFile}
          />
        )}
        {presentation === "graph" && selectedNode ? (
          <button
            className="note-graph-panel__selection"
            type="button"
            onClick={() => onOpenFile(selectedNode.path)}
          >
            <strong>{selectedNode.title}</strong>
            <span>{selectedNode.path}</span>
            <small>{connectionLabel(selectedNode)}</small>
          </button>
        ) : null}
      </div>
    </section>
  );
}

function GraphPlot({
  large,
  model,
  selectedNodeId,
  zoom,
  onSelectedNodeChange,
  onOpenFile,
  onZoomChange,
  onNodeMoved,
}: {
  large: boolean;
  model: PluginNoteGraphModel | null;
  selectedNodeId: string | null;
  zoom: number;
  onSelectedNodeChange: (id: string) => void;
  onOpenFile: (path: string) => void;
  onZoomChange: (zoom: number) => void;
  onNodeMoved: (node: PluginNoteGraphNode) => void;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const gesture = useRef<{
    nodeId: string;
    pointerId: number;
    startX: number;
    startY: number;
    moved: boolean;
  } | null>(null);
  const {
    nodes: layout,
    draggingNodeId,
    beginDrag,
    moveDrag,
    endDrag,
    cancelDrag,
  } = useNoteGraphForceLayout(model);
  const modelNodes = new Map(
    model?.nodes.map((node) => [node.id, node] as const) ?? [],
  );
  useEffect(() => {
    if (
      gesture.current &&
      !model?.nodes.some(
        (node) => node.id === gesture.current?.nodeId,
      )
    ) {
      gesture.current = null;
    }
  }, [model]);
  const positions = new Map(layout.map((entry) => [entry.id, entry]));
  const minimumZoom = large ? 0.45 : 0.7;
  const maximumZoom = large ? 2.5 : 1.75;
  const graphPoint = (clientX: number, clientY: number) => {
    const bounds = svg.current?.getBoundingClientRect();
    return bounds
      ? noteGraphPointFromClient(clientX, clientY, bounds, zoom)
      : null;
  };
  const pointerDown = (
    event: PointerEvent<SVGGElement>,
    node: PluginNoteGraphNode,
  ) => {
    if (
      event.button !== 0 ||
      gesture.current !== null
    ) {
      return;
    }
    const point = graphPoint(event.clientX, event.clientY);
    if (!point) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    gesture.current = {
      nodeId: node.id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    };
    onSelectedNodeChange(node.id);
  };
  const pointerMove = (
    event: PointerEvent<SVGGElement>,
    node: PluginNoteGraphNode,
  ) => {
    const current = gesture.current;
    if (
      !current ||
      current.nodeId !== node.id ||
      current.pointerId !== event.pointerId
    ) {
      return;
    }
    if (
      !current.moved &&
      Math.hypot(
        event.clientX - current.startX,
        event.clientY - current.startY,
      ) >= 4
    ) {
      current.moved = true;
    }
    const point = graphPoint(event.clientX, event.clientY);
    if (point && current.moved) {
      if (draggingNodeId !== node.id) {
        beginDrag({ id: node.id, ...point });
        return;
      }
      moveDrag({ id: node.id, ...point });
    }
  };
  const pointerEnd = (
    event: PointerEvent<SVGGElement>,
    node: PluginNoteGraphNode,
    cancelled: boolean,
  ) => {
    const current = gesture.current;
    if (
      !current ||
      current.nodeId !== node.id ||
      current.pointerId !== event.pointerId
    ) {
      return;
    }
    gesture.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    if (cancelled) {
      if (current.moved) {
        cancelDrag();
      }
      return;
    }
    if (current.moved) {
      endDrag();
      onNodeMoved(node);
    } else {
      onOpenFile(node.path);
    }
  };
  return (
    <div
      className="note-graph-plot"
      data-dragging={draggingNodeId !== null}
    >
      <div className="note-graph-plot__toolbar" aria-label="Graph zoom">
        <button
          type="button"
          aria-label="Zoom out"
          title="Zoom out"
          disabled={zoom <= minimumZoom}
          onClick={() =>
            onZoomChange(Math.max(minimumZoom, zoom - 0.15))
          }
        >
          <ZoomOut aria-hidden="true" size={14} />
        </button>
        <span>{Math.round(zoom * 100)}%</span>
        <button
          type="button"
          aria-label="Zoom in"
          title="Zoom in"
          disabled={zoom >= maximumZoom}
          onClick={() =>
            onZoomChange(Math.min(maximumZoom, zoom + 0.15))
          }
        >
          <ZoomIn aria-hidden="true" size={14} />
        </button>
        <button
          type="button"
          aria-label="Reset graph zoom"
          title="Reset graph zoom"
          disabled={zoom === 1}
          onClick={() => onZoomChange(1)}
        >
          <RotateCcw aria-hidden="true" size={13} />
        </button>
      </div>
      {model && model.nodes.length > 0 ? (
        <>
          <svg
            aria-hidden="true"
            className="note-graph-plot__canvas"
            ref={svg}
            viewBox={`0 0 ${NOTE_GRAPH_VIEW_WIDTH} ${NOTE_GRAPH_VIEW_HEIGHT}`}
          >
            <g
              transform={`translate(${NOTE_GRAPH_VIEW_WIDTH / 2} ${
                NOTE_GRAPH_VIEW_HEIGHT / 2
              }) scale(${zoom}) translate(${-NOTE_GRAPH_VIEW_WIDTH / 2} ${
                -NOTE_GRAPH_VIEW_HEIGHT / 2
              })`}
            >
              {model.edges.map((edge) => {
                const source = positions.get(edge.sourceId);
                const target = positions.get(edge.targetId);
                return source && target ? (
                  <line
                    className="note-graph-plot__edge"
                    key={`${edge.sourceId}\u0000${edge.targetId}`}
                    x1={source.x}
                    y1={source.y}
                    x2={target.x}
                    y2={target.y}
                  />
                ) : null;
              })}
              {layout.map(({ id, x, y, radius }, index) => {
                const node = modelNodes.get(id);
                if (!node) {
                  return null;
                }
                const selected = node.id === selectedNodeId;
                const active = node.id === model.activeNodeId;
                const showLabel =
                  model.nodes.length <= (large ? 120 : 42) ||
                  selected ||
                  active ||
                  index < (large ? 16 : 8);
                return (
                  <g
                    className="note-graph-plot__node"
                    data-active={active}
                    data-selected={selected}
                    data-dragging={draggingNodeId === node.id}
                    key={node.id}
                    onMouseEnter={() => onSelectedNodeChange(node.id)}
                    onPointerDown={(event) => pointerDown(event, node)}
                    onPointerMove={(event) => pointerMove(event, node)}
                    onPointerUp={(event) =>
                      pointerEnd(event, node, false)
                    }
                    onPointerCancel={(event) =>
                      pointerEnd(event, node, true)
                    }
                    onLostPointerCapture={(event) =>
                      pointerEnd(event, node, true)
                    }
                    transform={`translate(${x} ${y})`}
                  >
                    <title>{`${node.title} — ${connectionLabel(
                      node,
                    )}. Drag to rearrange; click to open.`}</title>
                    <circle r={radius} />
                    {showLabel ? (
                      <text x={radius + 5} y={4}>
                        {truncateLabel(node.title)}
                      </text>
                    ) : null}
                  </g>
                );
              })}
            </g>
          </svg>
          <p className="sr-only">
            The visual graph supports pointer dragging. Use Show keyboard note
            list to inspect and open every visible note without a pointer.
          </p>
        </>
      ) : (
        <div className="note-graph-panel__empty">
          <Network aria-hidden="true" size={24} />
          <p>No notes match these graph filters.</p>
        </div>
      )}
    </div>
  );
}

function GraphList({
  nodes,
  activePath,
  selectedNodeId,
  query,
  onQueryChange,
  onSelectedNodeChange,
  onOpenFile,
}: {
  nodes: PluginNoteGraphNode[];
  activePath: string | null;
  selectedNodeId: string | null;
  query: string;
  onQueryChange: (query: string) => void;
  onSelectedNodeChange: (id: string) => void;
  onOpenFile: (path: string) => void;
}) {
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const root = useRef<HTMLDivElement>(null);
  const focusedNode = useRef<string | null>(null);
  useEffect(() => {
    if (
      nodes.length > 0 &&
      !nodes.some((node) => node.id === selectedNodeId)
    ) {
      const next = nodes[0];
      const restoreFocus = focusedNode.current === selectedNodeId;
      onSelectedNodeChange(next.id);
      if (restoreFocus) {
        queueMicrotask(() => buttons.current.get(next.id)?.focus());
      }
    }
  }, [nodes, onSelectedNodeChange, selectedNodeId]);

  const moveFocus = (currentId: string, key: string) => {
    const index = nodes.findIndex((node) => node.id === currentId);
    if (index < 0 || nodes.length === 0) {
      return;
    }
    const nextIndex =
      key === "Home"
        ? 0
        : key === "End"
          ? nodes.length - 1
          : key === "ArrowUp"
            ? Math.max(0, index - 1)
            : Math.min(nodes.length - 1, index + 1);
    const next = nodes[nextIndex];
    if (next) {
      onSelectedNodeChange(next.id);
      buttons.current.get(next.id)?.focus();
    }
  };

  return (
    <div
      className="note-graph-list"
      ref={root}
      onBlurCapture={(event) => {
        if (!root.current?.contains(event.relatedTarget as Node | null)) {
          focusedNode.current = null;
        }
      }}
    >
      <label className="note-graph-list__search">
        <Search aria-hidden="true" size={14} />
        <span className="sr-only">Filter graph notes</span>
        <input
          type="search"
          value={query}
          placeholder="Filter visible notes"
          onFocus={() => {
            focusedNode.current = null;
          }}
          onChange={(event) => onQueryChange(event.currentTarget.value)}
        />
      </label>
      {nodes.length > 0 ? (
        <ul aria-label="Notes in graph">
          {nodes.map((node, index) => (
            <li key={node.id}>
              <button
                type="button"
                ref={(element) => {
                  if (element) {
                    buttons.current.set(node.id, element);
                  } else {
                    buttons.current.delete(node.id);
                  }
                }}
                aria-current={node.path === activePath ? "page" : undefined}
                aria-label={`${node.title}, ${node.path}, ${connectionLabel(node)}`}
                data-selected={node.id === selectedNodeId}
                tabIndex={
                  node.id === selectedNodeId ||
                  (selectedNodeId === null && index === 0)
                    ? 0
                    : -1
                }
                onFocus={() => {
                  focusedNode.current = node.id;
                  onSelectedNodeChange(node.id);
                }}
                onKeyDown={(event: KeyboardEvent<HTMLButtonElement>) => {
                  if (
                    ["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)
                  ) {
                    event.preventDefault();
                    moveFocus(node.id, event.key);
                  }
                }}
                onClick={() => onOpenFile(node.path)}
              >
                <span>
                  <strong>{node.title}</strong>
                  <small>{node.path}</small>
                </span>
                <em>{node.orphan ? "Orphan" : node.incoming + node.outgoing}</em>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="note-graph-panel__empty">No visible notes match.</p>
      )}
    </div>
  );
}

function truncateLabel(value: string): string {
  return value.length <= 24 ? value : `${value.slice(0, 21)}…`;
}

function connectionLabel(node: PluginNoteGraphNode): string {
  if (node.orphan) {
    return "no note connections";
  }
  return `${node.incoming} backlink${node.incoming === 1 ? "" : "s"}, ${
    node.outgoing
  } outgoing link${node.outgoing === 1 ? "" : "s"}`;
}
