import type {
  PluginNoteGraphIndexRequest,
  PluginNoteGraphModel,
  PluginNoteGraphQuery,
} from "@denote/plugin-sdk";
import type { PluginNoteGraphContribution } from "./workerRuntime";
import {
  noteGraphIndexRequests,
  type NoteGraphSnapshot,
} from "./noteGraphs";

interface NoteGraphCoordinatorEntry {
  active: boolean;
  generation: number;
  providerKey: string;
  snapshot: NoteGraphSnapshot | null;
  tail: Promise<void>;
  workspaceKey: string | null;
}

export interface NoteGraphCoordinatorResult {
  indexMode: PluginNoteGraphIndexRequest["mode"] | null;
  model: PluginNoteGraphModel;
}

export class NoteGraphCoordinator {
  private readonly entries = new Map<string, NoteGraphCoordinatorEntry>();

  clear(): void {
    for (const entry of this.entries.values()) {
      entry.active = false;
    }
    this.entries.clear();
  }

  invalidateWorkspace(): void {
    for (const entry of this.entries.values()) {
      entry.generation += 1;
      entry.snapshot = null;
      entry.workspaceKey = null;
    }
  }

  retainProviders(providerKeys: ReadonlySet<string>): void {
    for (const [key, entry] of this.entries) {
      if (!providerKeys.has(entry.providerKey)) {
        entry.active = false;
        this.entries.delete(key);
      }
    }
  }

  run(
    provider: PluginNoteGraphContribution,
    snapshot: NoteGraphSnapshot,
    query: PluginNoteGraphQuery,
    indexNoteGraph: (
      pluginId: string,
      providerId: string,
      request: PluginNoteGraphIndexRequest,
    ) => Promise<void>,
    queryNoteGraph: (
      pluginId: string,
      providerId: string,
      request: PluginNoteGraphQuery,
    ) => Promise<PluginNoteGraphModel>,
  ): Promise<NoteGraphCoordinatorResult> {
    const providerKey = `${provider.pluginId}\u0000${provider.id}`;
    let entry = this.entries.get(providerKey);
    if (!entry) {
      entry = {
        active: true,
        generation: 0,
        providerKey,
        snapshot: null,
        tail: Promise.resolve(),
        workspaceKey: snapshot.workspaceKey,
      };
      this.entries.set(providerKey, entry);
    } else if (entry.workspaceKey !== snapshot.workspaceKey) {
      entry.generation += 1;
      entry.snapshot = null;
      entry.workspaceKey = snapshot.workspaceKey;
    }
    const generation = entry.generation;
    const operation = entry.tail.then(async () => {
      if (!entryCurrent(this.entries, entry, generation)) {
        throw new Error("The note graph provider is no longer available.");
      }
      let requests = noteGraphIndexRequests(entry.snapshot, snapshot);
      let indexMode = requests[0]?.mode ?? null;
      if (requests.length > 0) {
        try {
          await applyIndexRequests(
            provider,
            requests,
            indexNoteGraph,
            entry,
            generation,
          );
        } catch (error) {
          entry.snapshot = null;
          if (!entryCurrent(this.entries, entry, generation)) {
            throw error;
          }
          requests = noteGraphIndexRequests(null, snapshot);
          indexMode = "replace";
          await applyIndexRequests(
            provider,
            requests,
            indexNoteGraph,
            entry,
            generation,
          );
        }
        if (!entryCurrent(this.entries, entry, generation)) {
          throw new Error("The note graph provider changed while indexing.");
        }
        entry.snapshot = snapshot;
      }
      const model = await queryNoteGraph(
        provider.pluginId,
        provider.id,
        query,
      );
      if (!entryCurrent(this.entries, entry, generation)) {
        throw new Error("The note graph provider changed while querying.");
      }
      return { indexMode, model };
    });
    entry.tail = operation.then(
      () => {},
      () => {},
    );
    return operation;
  }
}

async function applyIndexRequests(
  provider: PluginNoteGraphContribution,
  requests: PluginNoteGraphIndexRequest[],
  indexNoteGraph: (
    pluginId: string,
    providerId: string,
    request: PluginNoteGraphIndexRequest,
  ) => Promise<void>,
  entry: NoteGraphCoordinatorEntry,
  generation: number,
): Promise<void> {
  for (const request of requests) {
    if (!entry.active || entry.generation !== generation) {
      throw new Error("The note graph provider changed while indexing.");
    }
    await indexNoteGraph(provider.pluginId, provider.id, request);
    if (!entry.active || entry.generation !== generation) {
      throw new Error("The note graph provider changed while indexing.");
    }
  }
}

function entryCurrent(
  entries: ReadonlyMap<string, NoteGraphCoordinatorEntry>,
  entry: NoteGraphCoordinatorEntry,
  generation: number,
): boolean {
  return (
    entry.active &&
    entry.generation === generation &&
    entries.get(entry.providerKey) === entry
  );
}
