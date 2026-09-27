import type {
  PluginTaskListIndexRequest,
  PluginTaskListModel,
  PluginTaskListQuery,
} from "@denote/plugin-sdk";
import type { PluginTaskListContribution } from "./workerRuntime";
import {
  taskListIndexRequests,
  type TaskListSnapshot,
} from "./taskLists";

interface Entry {
  active: boolean;
  generation: number;
  providerKey: string;
  snapshot: TaskListSnapshot | null;
  tail: Promise<void>;
  workspaceKey: string | null;
}

export class TaskListCoordinator {
  private readonly entries = new Map<string, Entry>();

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
    provider: PluginTaskListContribution,
    snapshot: TaskListSnapshot,
    query: PluginTaskListQuery,
    indexTaskList: (
      pluginId: string,
      providerId: string,
      request: PluginTaskListIndexRequest,
    ) => Promise<void>,
    queryTaskList: (
      pluginId: string,
      providerId: string,
      request: PluginTaskListQuery,
    ) => Promise<PluginTaskListModel>,
  ): Promise<PluginTaskListModel> {
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
        throw new Error("The task list provider is no longer available.");
      }
      let requests = taskListIndexRequests(entry.snapshot, snapshot);
      if (requests.length > 0) {
        try {
          await applyIndexRequests(
            provider,
            requests,
            indexTaskList,
            entry,
            generation,
          );
        } catch (error) {
          entry.snapshot = null;
          if (!entryCurrent(this.entries, entry, generation)) {
            throw error;
          }
          requests = taskListIndexRequests(null, snapshot);
          await applyIndexRequests(
            provider,
            requests,
            indexTaskList,
            entry,
            generation,
          );
        }
        if (!entryCurrent(this.entries, entry, generation)) {
          throw new Error("The task list provider changed while indexing.");
        }
        entry.snapshot = snapshot;
      }
      const model = await queryTaskList(
        provider.pluginId,
        provider.id,
        query,
      );
      if (!entryCurrent(this.entries, entry, generation)) {
        throw new Error("The task list provider changed while querying.");
      }
      return model;
    });
    entry.tail = operation.then(
      () => {},
      () => {},
    );
    return operation;
  }
}

async function applyIndexRequests(
  provider: PluginTaskListContribution,
  requests: PluginTaskListIndexRequest[],
  indexTaskList: (
    pluginId: string,
    providerId: string,
    request: PluginTaskListIndexRequest,
  ) => Promise<void>,
  entry: Entry,
  generation: number,
): Promise<void> {
  for (const request of requests) {
    if (!entry.active || entry.generation !== generation) {
      throw new Error("The task list provider changed while indexing.");
    }
    await indexTaskList(provider.pluginId, provider.id, request);
  }
}

function entryCurrent(
  entries: ReadonlyMap<string, Entry>,
  entry: Entry,
  generation: number,
): boolean {
  return (
    entry.active &&
    entry.generation === generation &&
    entries.get(entry.providerKey) === entry
  );
}
