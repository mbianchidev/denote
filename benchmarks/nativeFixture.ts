import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import type { DocumentBatch, FileNode, NoteStats, WorkspaceSnapshot } from "../src/types";

interface BenchmarkState {
  inputLatencies: number[];
  openingLatency: number | null;
  unexpectedCommands: string[];
  documents: Record<string, string>;
  indexReads: string[][];
}

declare global {
  interface Window {
    __DENOTE_BENCHMARK__: BenchmarkState;
    __DENOTE_LARGE_INDEX__?: boolean;
  }
}

function markdown(sections: number): string {
  const paragraphs = Array.from({ length: sections }, (_, index) => [
    `## Synthetic section ${index}`,
    "",
    "Synthetic prose with **emphasis**, `inline code`, and [a reference][guide]. " +
      "The document is invented and contains no user data.",
    "",
    "- Synthetic first item",
    "- Synthetic second item",
    "",
    ...(index % 20 === 0
      ? ["```javascript", 'const synthetic = "local";', "```", ""]
      : []),
  ].join("\n"));
  return [
    "---",
    "title: Synthetic benchmark",
    "---",
    "",
    "# Synthetic benchmark",
    "",
    "<!-- toc -->",
    "- [Synthetic section 0](#synthetic-section-0)",
    "<!-- /toc -->",
    "",
    ...paragraphs,
    "[guide]: https://example.test/synthetic",
    "",
    "Typing target",
  ].join("\n");
}

const documents: Record<string, string> = {
  "Small.md": "# Small synthetic page\n\nReady.",
  "Typing.md": markdown(180),
  "Reading.md": markdown(500),
  "Source.txt": "Synthetic source line, no personal data.\n".repeat(2500),
};
if (window.__DENOTE_LARGE_INDEX__) {
  const body = "---\ndate: 2026-09-01\n---\n\n# Synthetic index\n\n" +
    "Invented local text for incremental indexing and responsiveness. ".repeat(36) +
    "\n- [ ] Synthetic task\n\n#synthetic";
  for (let index = 0; index < 20_000; index += 1) {
    documents[`Archive/Synthetic-${String(index).padStart(5, "0")}.md`] = `${body}\n${index}`;
  }
}
const state: BenchmarkState = {
  inputLatencies: [],
  openingLatency: null,
  unexpectedCommands: [],
  documents,
  indexReads: [],
};
window.__DENOTE_BENCHMARK__ = state;
const node = (path: string): FileNode => ({
  path,
  name: path.split("/").pop() ?? path,
  kind: path.endsWith(".md") ? "markdown" : "text",
  children: [],
  size: state.documents[path]?.length ?? 0,
  modifiedAt: null,
  bookmarked: false,
  pinned: false,
});
const snapshot: WorkspaceSnapshot = {
  vaultPath: "/synthetic-performance-vault",
  vaultName: "Synthetic performance vault",
  pluginScopeId: "synthetic-performance",
  default: false,
  tree: [
    ...["Small.md", "Typing.md", "Reading.md", "Source.txt"].map(node),
    ...(window.__DENOTE_LARGE_INDEX__ ? [{
      ...node("Archive"), kind: "folder" as const,
      children: Object.keys(documents).filter((path) => path.startsWith("Archive/")).map(node),
    }] : Array.from({ length: 3000 }, (_, index) => node(`Synthetic ${index}.txt`))),
  ],
  bookmarks: [],
  recent: [],
  trash: [],
  tagColors: [],
  markdownViewMode: "rich-text",
  restoreTabs: false,
  tabSession: null,
  welcomePage: { customPath: null, effectivePath: null },
  projectRoots: [],
  projectWorkspaces: [],
  suggestGitProject: false,
  ignoredPaths: [],
  fromCache: false,
  encryption: {
    enabled: false,
    unlocked: true,
    phase: null,
    remainingRecoveryCodes: 0,
  },
};
const stats: NoteStats = {
  openCount: 1,
  editCount: 1,
  saveCount: 1,
  lastOpenedAt: null,
  lastEditedAt: null,
  lastSavedAt: null,
  bookmarked: false,
};
let hash = 0;
const fileVersions = new Map<string, number>();
const documentHash = (path: string) => `synthetic-${path}-${fileVersions.get(path) ?? 0}`;

function argument(payload: unknown, name: string): string {
  if (!payload || typeof payload !== "object" || !(name in payload)) {
    throw new Error(`Missing synthetic argument ${name}`);
  }
  const value = Reflect.get(payload, name);
  if (typeof value !== "string") throw new Error(`Invalid synthetic argument ${name}`);
  return value;
}

mockWindows("main");
mockIPC((command, payload) => {
  switch (command) {
    case "get_runtime_info":
      return {
        operatingSystem: "linux",
        architecture: "x86_64",
        bundleType: "deb",
        updateChannel: "stable",
        updaterConfigured: false,
      };
    case "get_last_vault":
    case "refresh_vault":
      return snapshot;
    case "list_plugins":
    case "list_plugin_bundles":
    case "list_known_vaults":
    case "list_history":
      return [];
    case "list_known_vault_files":
      return { files: [], truncated: false };
    case "list_search_documents": {
      if (!window.__DENOTE_LARGE_INDEX__) return { documents: [], skippedCount: 0, truncated: false };
      const value: unknown = payload && typeof payload === "object" ? Reflect.get(payload, "paths") : undefined;
      if (!Array.isArray(value) || !value.every((path) => typeof path === "string")) {
        throw new Error("Large-vault indexing must request bounded file paths.");
      }
      const paths: string[] = value;
      state.indexReads.push([...paths]);
      const budget: unknown = payload && typeof payload === "object" ? Reflect.get(payload, "maxBytes") : undefined;
      if (typeof budget !== "number") throw new Error("Missing synthetic index byte budget");
      const batch: DocumentBatch = { documents: [], skippedCount: 0, skippedPaths: [], truncated: false };
      let bytes = 0;
      for (const path of paths) {
        const content = state.documents[path];
        if (content === undefined) continue;
        const size = new TextEncoder().encode(content).length;
        if (bytes + size > budget) { batch.truncated = true; break; }
        bytes += size;
        batch.documents.push({
          path, content, contentBytes: size, contentHash: documentHash(path),
          title: path.split("/").pop() ?? path, tags: ["synthetic"], kind: path.endsWith(".md") ? "markdown" : "text",
          encoding: "utf8", lineEnding: "lf", bookmarked: false, lastOpenedAt: null,
        });
      }
      return new Promise<DocumentBatch>((resolve) => setTimeout(() => resolve(batch), 0));
    }
    case "refresh_gitignore_status":
      return { scopePaths: [], ignoredPaths: [], complete: true };
    case "plugin:deep-link|get_current":
    case "recover_plugin_transactions":
    case "save_tab_session":
    case "prepare_exit":
      return null;
    case "read_note": {
      const path = argument(payload, "path");
      if (!(path in state.documents)) throw new Error(`Unknown synthetic document ${path}`);
      return {
        path,
        content: state.documents[path],
        contentHash: documentHash(path),
        encoding: "utf8",
        lineEnding: "lf",
        stats,
      };
    }
    case "record_edit":
      return stats;
    case "save_note": {
      const path = argument(payload, "path");
      state.documents[path] = argument(payload, "content");
      fileVersions.set(path, ++hash);
      return {
        path,
        changed: true,
        savedAt: "2026-01-01T00:00:00Z",
        contentHash: documentHash(path),
        historyCount: 1,
        stats,
      };
    }
    case "set_vault_markdown_view_mode": {
      const mode = argument(payload, "mode");
      if (mode !== "source" && mode !== "rich-text") throw new Error("Invalid synthetic view mode");
      snapshot.markdownViewMode = mode;
      return null;
    }
    default:
      state.unexpectedCommands.push(command);
      throw new Error(`Unexpected benchmark IPC command: ${command}`);
  }
}, { shouldMockEvents: true });

document.addEventListener("beforeinput", (event) => {
  if (!(event.target instanceof HTMLElement) ||
      !event.target.closest('[contenteditable="true"]')) return;
  const start = event.timeStamp;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    state.inputLatencies.push(performance.now() - start);
  }));
}, true);
