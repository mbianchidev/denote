import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import type { FileNode, NoteStats, WorkspaceSnapshot } from "../src/types";

interface BenchmarkState {
  inputLatencies: number[];
  openingLatency: number | null;
  unexpectedCommands: string[];
  documents: Record<string, string>;
}

declare global {
  interface Window {
    __DENOTE_BENCHMARK__: BenchmarkState;
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

const documents = {
  "Small.md": "# Small synthetic page\n\nReady.",
  "Typing.md": markdown(180),
  "Reading.md": markdown(500),
  "Source.txt": "Synthetic source line, no personal data.\n".repeat(2500),
};
const state: BenchmarkState = {
  inputLatencies: [],
  openingLatency: null,
  unexpectedCommands: [],
  documents,
};
window.__DENOTE_BENCHMARK__ = state;
const node = (path: string): FileNode => ({
  path,
  name: path,
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
    ...Object.keys(documents).map(node),
    ...Array.from({ length: 3000 }, (_, index) => node(`Synthetic ${index}.txt`)),
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
    case "list_search_documents":
      return { documents: [], skippedCount: 0, truncated: false };
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
        contentHash: `synthetic-${hash}`,
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
      return {
        path,
        changed: true,
        savedAt: "2026-01-01T00:00:00Z",
        contentHash: `synthetic-${++hash}`,
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
