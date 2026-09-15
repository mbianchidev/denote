import {
  List,
  Network,
  RotateCcw,
  Search,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import type {
  PluginNoteGraphIndexRequest,
  PluginNoteGraphModel,
  PluginNoteGraphNode,
  PluginNoteGraphOrphanFilter,
  PluginNoteGraphQuery,
} from "@denote/plugin-sdk";
import type { PluginNoteGraphContribution } from "../plugins/workerRuntime";
import {
  noteGraphFolders,
  noteGraphIndexRequest,
  noteGraphTags,
  type NoteGraphSnapshot,
} from "../plugins/noteGraphs";

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
}: NoteGraphPanelProps) {
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
  const sequence = useRef<Promise<void>>(Promise.resolve());
  const generation = useRef(0);
  const previousSnapshot = useRef<NoteGraphSnapshot | null>(null);
  const previousProvider = useRef<string | null>(null);
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
    const run = async () => {
      if (!snapshot) {
        if (requestGeneration === generation.current) {
          setModel(null);
          setLoading(false);
          setStatus("Waiting for the local note index.");
        }
        return;
      }
      if (previousProvider.current !== providerKey) {
        previousProvider.current = providerKey;
        previousSnapshot.current = null;
      }
      setLoading(true);
      const indexRequest = noteGraphIndexRequest(
        previousSnapshot.current,
        snapshot,
      );
      if (indexRequest) {
        setStatus(
          indexRequest.mode === "replace"
            ? "Indexing note connections…"
            : "Updating changed note connections…",
        );
        await indexNoteGraph(provider.pluginId, provider.id, indexRequest);
        previousSnapshot.current = snapshot;
      }
      const nextModel = await queryNoteGraph(
        provider.pluginId,
        provider.id,
        query,
      );
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
    };
    const operation = sequence.current.then(run, run);
    sequence.current = operation.then(
      () => {},
      () => {},
    );
    void operation.catch((error) => {
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
    indexNoteGraph,
    onError,
    provider.id,
    provider.pluginId,
    providerKey,
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
    <section className="note-graph-panel" aria-labelledby="note-graph-title">
      <div className="sidebar-view__title">
        <h2 id="note-graph-title">{provider.title}</h2>
        {loading ? <span className="note-graph-panel__busy">Updating</span> : null}
      </div>
      <div className="note-graph-panel__body">
        <div className="note-graph-panel__switches">
          <div className="note-graph-panel__segment" aria-label="Graph scope">
            <button
              type="button"
              aria-pressed={scope === "global"}
              onClick={() => setScope("global")}
            >
              Global
            </button>
            <button
              type="button"
              aria-pressed={scope === "local"}
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
            model={model}
            selectedNodeId={selectedNodeId}
            zoom={zoom}
            onSelectedNodeChange={setSelectedNodeId}
            onOpenFile={onOpenFile}
            onZoomChange={setZoom}
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
  model,
  selectedNodeId,
  zoom,
  onSelectedNodeChange,
  onOpenFile,
  onZoomChange,
}: {
  model: PluginNoteGraphModel | null;
  selectedNodeId: string | null;
  zoom: number;
  onSelectedNodeChange: (id: string) => void;
  onOpenFile: (path: string) => void;
  onZoomChange: (zoom: number) => void;
}) {
  const layout = useMemo(() => graphLayout(model), [model]);
  const positions = new Map(layout.map((entry) => [entry.node.id, entry]));
  return (
    <div className="note-graph-plot">
      <div className="note-graph-plot__toolbar" aria-label="Graph zoom">
        <button
          type="button"
          aria-label="Zoom out"
          title="Zoom out"
          disabled={zoom <= 0.7}
          onClick={() => onZoomChange(Math.max(0.7, zoom - 0.15))}
        >
          <ZoomOut aria-hidden="true" size={14} />
        </button>
        <span>{Math.round(zoom * 100)}%</span>
        <button
          type="button"
          aria-label="Zoom in"
          title="Zoom in"
          disabled={zoom >= 1.75}
          onClick={() => onZoomChange(Math.min(1.75, zoom + 0.15))}
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
            viewBox="0 0 640 520"
          >
            <g transform={`translate(320 260) scale(${zoom}) translate(-320 -260)`}>
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
              {layout.map(({ node, x, y, radius }, index) => {
                const selected = node.id === selectedNodeId;
                const active = node.id === model.activeNodeId;
                const showLabel =
                  model.nodes.length <= 42 || selected || active || index < 8;
                return (
                  <g
                    className="note-graph-plot__node"
                    data-active={active}
                    data-selected={selected}
                    key={node.id}
                    onClick={() => onOpenFile(node.path)}
                    onMouseEnter={() => onSelectedNodeChange(node.id)}
                    transform={`translate(${x} ${y})`}
                  >
                    <title>{`${node.title} — ${connectionLabel(node)}`}</title>
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
            The visual graph is pointer operated. Use Show keyboard note list to
            inspect and open every visible note without a pointer.
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
      focusedNode.current = next.id;
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

interface PositionedNode {
  node: PluginNoteGraphNode;
  x: number;
  y: number;
  radius: number;
}

function graphLayout(model: PluginNoteGraphModel | null): PositionedNode[] {
  if (!model || model.nodes.length === 0) {
    return [];
  }
  const centerX = 320;
  const centerY = 260;
  const local = model.nodes.some((node) => node.distance !== null);
  if (local) {
    const byDistance = new Map<number, PluginNoteGraphNode[]>();
    for (const node of model.nodes) {
      const distance = node.distance ?? 3;
      byDistance.set(distance, [...(byDistance.get(distance) ?? []), node]);
    }
    const positioned: PositionedNode[] = [];
    for (const [distance, nodes] of [...byDistance.entries()].sort(
      (left, right) => left[0] - right[0],
    )) {
      nodes.forEach((node, index) => {
        const progress =
          nodes.length <= 1 ? 0 : index / Math.max(1, nodes.length - 1);
        const radius =
          distance === 0
            ? 0
            : Math.min(232, 54 + distance * 54 + progress * 34);
        const angle =
          -Math.PI / 2 +
          index * GOLDEN_ANGLE +
          stableAngle(node.path) * 0.04;
        positioned.push({
          node,
          x: centerX + Math.cos(angle) * radius,
          y: centerY + Math.sin(angle) * radius,
          radius: nodeRadius(node),
        });
      });
    }
    return positioned;
  }

  return model.nodes.map((node, index) => {
    if (index === 0) {
      return {
        node,
        x: centerX,
        y: centerY,
        radius: nodeRadius(node),
      };
    }
    const progress = Math.sqrt(index / Math.max(1, model.nodes.length - 1));
    const angle =
      -Math.PI / 2 +
      index * GOLDEN_ANGLE +
      stableAngle(node.path) * 0.035;
    const radius = 34 + progress * 198;
    return {
      node,
      x: centerX + Math.cos(angle) * radius,
      y: centerY + Math.sin(angle) * radius,
      radius: nodeRadius(node),
    };
  });
}

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

function nodeRadius(node: PluginNoteGraphNode): number {
  return 5 + Math.min(5, Math.log2(node.incoming + node.outgoing + 1) * 1.6);
}

function stableAngle(value: string): number {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) / 0xffffffff) * Math.PI * 2;
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
