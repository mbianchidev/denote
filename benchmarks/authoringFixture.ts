/// <reference types="vite/client" />
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { parsePluginManifest } from "@denote/plugin-sdk";
import type { FileNode, NoteStats, PluginView, WorkspaceSnapshot } from "../src/types";
import { isNoteCommentsSnapshot, type NoteCommentsSnapshot } from "../src/lib/noteComments";
import stylingManifest from "../plugins/text-styling/plugin.json";
import commentsManifest from "../plugins/note-comments/plugin.json";
import slidesManifest from "../plugins/presentations/plugin.json";
import stylingCode from "../plugins/text-styling/dist/index.js?raw";
import commentsCode from "../plugins/note-comments/dist/index.js?raw";
import slidesCode from "../plugins/presentations/dist/index.js?raw";

interface AuthoringFixtureState {
  documents: Record<string, string>;
  comments: NoteCommentsSnapshot;
  saves: string[];
  unexpectedCommands: string[];
  terminatedWorkers: number;
  nativeFullscreen: boolean;
}
declare global { interface Window { __DENOTE_AUTHORING__: AuthoringFixtureState } }

const documents = {
  "Authoring.md": "# Local practice\n\nA short phrase for review.\n\n=red=Existing excerpt=red=\n\nKeep **this**, [a link](https://example.test/), and trailing spaces.  \n",
  "Deck.md": [
    "---", "title: Synthetic deck", "custom: keep this field", "presentation:", "  advance-seconds: 1",
    "  loop: false", "---", "# First slide", "", "- A synthetic list", "- [ ] A synthetic task", "",
    "| Item | Count |", "| --- | --- |", "| Example | 2 |", "",
    "===", "", "# Second slide", "", "> [!NOTE]", "> A local callout.", "",
    "```javascript", "const example = 1;", "```", "", "![Synthetic circle](assets/circle.svg)", "",
  ].join("\n"),
};
const state: AuthoringFixtureState = {
  documents, comments: { contentHash: "0".repeat(64), document: { schemaVersion: 1, owner: "denote.note-comments", notes: {} } },
  saves: [], unexpectedCommands: [], terminatedWorkers: 0, nativeFullscreen: false,
};
window.__DENOTE_AUTHORING__ = state;
const NativeWorker = window.Worker;
window.Worker = class extends NativeWorker {
  terminate() { state.terminatedWorkers++; super.terminate(); }
};
const sources = new Map([
  [stylingManifest.id, stylingCode], [commentsManifest.id, commentsCode], [slidesManifest.id, slidesCode],
]);
const plugins: PluginView[] = [stylingManifest, commentsManifest, slidesManifest].map((value) => {
  const manifest = parsePluginManifest(value);
  return {
    catalog: { manifest, artifact: {
      url: `https://github.com/mbianchidev/denote/releases/download/v0.11.0/${manifest.id}-${manifest.version}.tgz`,
      sha256: "a".repeat(64), sizeBytes: 100,
    }, provenance: { publisherId: "denote", sourceCommit: "a".repeat(40), trusted: true }, guide: "# Synthetic guide" },
    enabled: true, status: "enabled", error: null, approvedPermissions: manifest.permissions,
    settings: {}, hasCredentials: false, previouslyApproved: true,
  };
});
const nodes: FileNode[] = Object.entries(documents).map(([path, content]) => ({
  path, name: path, kind: "markdown", children: [], size: content.length, modifiedAt: null, bookmarked: false, pinned: false,
}));
const snapshot: WorkspaceSnapshot = {
  vaultPath: "/synthetic-authoring-vault", vaultName: "Synthetic authoring", pluginScopeId: "synthetic-authoring", default: false,
  tree: nodes, bookmarks: [], recent: [], trash: [], tagColors: [], markdownViewMode: "rich-text",
  restoreTabs: false, tabSession: null, welcomePage: { customPath: null, effectivePath: null },
  projectRoots: [], projectWorkspaces: [], suggestGitProject: false, ignoredPaths: [], fromCache: false,
  encryption: { enabled: false, unlocked: true, phase: null, remainingRecoveryCodes: 0 },
};
const stats: NoteStats = { openCount: 1, editCount: 0, saveCount: 0, lastOpenedAt: null, lastEditedAt: null, lastSavedAt: null, bookmarked: false };
const versions = new Map<string, number>();
const hash = (path: string) => `synthetic-${path}-${versions.get(path) ?? 0}`;
function field(payload: unknown, name: string): unknown {
  return payload && typeof payload === "object" ? Reflect.get(payload, name) : undefined;
}
function argument(payload: unknown, name: string): string {
  const value = field(payload, name);
  if (typeof value !== "string") throw new Error(`Missing synthetic argument: ${name}`);
  return value;
}
mockWindows("main");
mockIPC((command, payload) => {
  switch (command) {
    case "plugin:window|is_fullscreen": return state.nativeFullscreen;
    case "plugin:window|set_fullscreen": {
      const value = field(payload, "value");
      if (typeof value !== "boolean") throw new Error("Invalid synthetic fullscreen state");
      state.nativeFullscreen = value;
      return null;
    }
    case "get_runtime_info": return { operatingSystem: "macos", architecture: "aarch64", bundleType: "app", updateChannel: "stable", updaterConfigured: false };
    case "get_last_vault":
    case "refresh_vault": return structuredClone(snapshot);
    case "list_plugins": return structuredClone(plugins);
    case "list_plugin_bundles":
    case "list_known_vaults":
    case "list_history":
    case "get_plugin_tool_status": return [];
    case "list_known_vault_files": return { files: [], truncated: false };
    case "get_plugin_settings": return {};
    case "read_plugin_entrypoint": {
      const code = sources.get(argument(payload, "pluginId"));
      if (!code) throw new Error("Unknown synthetic plugin");
      return code;
    }
    case "disable_plugin": {
      const plugin = plugins.find((plugin) => plugin.catalog.manifest.id === argument(payload, "pluginId"));
      if (!plugin) throw new Error("Unknown synthetic plugin");
      plugin.enabled = false; plugin.status = "disabled";
      return null;
    }
    case "refresh_gitignore_status": return { scopePaths: [], ignoredPaths: [], complete: true };
    case "plugin:deep-link|get_current":
    case "recover_plugin_transactions":
    case "save_tab_session":
    case "prepare_exit": return null;
    case "list_search_documents": {
      const paths = field(payload, "paths");
      if (!Array.isArray(paths)) throw new Error("Expected scoped synthetic reads");
      return { documents: Object.entries(state.documents).filter(([path]) => paths.includes(path)).map(([path, content]) => ({
        path, content, contentHash: hash(path), contentBytes: new TextEncoder().encode(content).length, title: path,
        tags: [], encoding: "utf8", lineEnding: "lf", kind: "markdown", bookmarked: false, lastOpenedAt: null,
      })), skippedCount: 0, truncated: false };
    }
    case "read_note": {
      const path = argument(payload, "path");
      return { path, content: state.documents[path], contentHash: hash(path), encoding: "utf8", lineEnding: "lf", stats };
    }
    case "record_edit": return stats;
    case "save_note": {
      const path = argument(payload, "path");
      if (field(payload, "expectedHash") !== hash(path)) throw new Error("Synthetic note save conflict");
      state.documents[path] = argument(payload, "content");
      versions.set(path, (versions.get(path) ?? 0) + 1);
      state.saves.push(path);
      return { path, changed: true, savedAt: "2026-01-01T00:00:00Z", contentHash: hash(path), historyCount: 1, stats };
    }
    case "read_note_comments": return structuredClone(state.comments);
    case "save_note_comments": {
      const path = argument(payload, "notePath");
      if (argument(payload, "expectedNoteHash") !== hash(path) || argument(payload, "expectedHash") !== state.comments.contentHash) {
        throw new Error("Synthetic comment conflict");
      }
      const result = { contentHash: crypto.randomUUID().replace(/-/g, "").padEnd(64, "0"), document: field(payload, "document") };
      if (!isNoteCommentsSnapshot(result)) throw new Error("Invalid synthetic sidecar write");
      state.comments = structuredClone(result);
      return result;
    }
    case "read_image_data_url": return `data:image/svg+xml;base64,${btoa('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><circle cx="40" cy="40" r="25" fill="#9fbe85"/></svg>')}`;
    case "set_vault_markdown_view_mode": {
      const mode = argument(payload, "mode");
      if (mode !== "source" && mode !== "rich-text") throw new Error("Invalid synthetic mode");
      snapshot.markdownViewMode = mode;
      return null;
    }
    default:
      state.unexpectedCommands.push(command);
      throw new Error(`Unexpected authoring IPC command: ${command}`);
  }
}, { shouldMockEvents: true });
