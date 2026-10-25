import type { SearchDocument } from "../src/types";
import { createNoteGraphSnapshot, noteGraphIndexRequests } from "../src/plugins/noteGraphs";
import { createTaskListSnapshot, taskListIndexRequests } from "../src/plugins/taskLists";
import { createCalendarSnapshot } from "../src/plugins/calendars";

declare global {
  interface Window {
    __DENOTE_INDEX_PROJECTIONS__: () => {
      documents: number; elapsed: number; graphChanges: number; taskChanges: number;
      graphCount: number; taskCount: number; calendarCount: number;
      reusedGraph: number; reusedTasks: number; reusedCalendar: number;
    };
  }
}

window.__DENOTE_INDEX_PROJECTIONS__ = () => {
  const content = "---\ndate: 2026-09-01\n---\n\n# Synthetic\n\n" +
    "Synthetic text with [[Other]] and #synthetic. ".repeat(30) + "\n- [ ] Synthetic task";
  const contentBytes = new TextEncoder().encode(content).length;
  const documents: SearchDocument[] = Array.from({ length: 20_000 }, (_, index) => ({
    path: `Synthetic/${String(index).padStart(5, "0")}.md`, title: `Synthetic ${index}`, content, contentBytes,
    contentHash: `synthetic-${index}`, tags: ["synthetic"], kind: "markdown", encoding: "utf8", lineEnding: "lf",
    bookmarked: false, lastOpenedAt: null,
  }));
  const batch = { documents, skippedCount: 0, truncated: false };
  const files = documents.map((document) => ({ path: document.path, modifiedAt: null }));
  const graph = createNoteGraphSnapshot("synthetic", batch, [])!;
  const tasks = createTaskListSnapshot("synthetic", batch, null)!;
  const calendar = createCalendarSnapshot(files, batch);
  const changed = {
    ...documents[0], content: `${content}\nChanged`, contentBytes: contentBytes + 8,
    contentHash: "changed-synthetic",
  };
  const next = { ...batch, documents: [changed, ...documents.slice(1)] };
  const started = performance.now();
  const nextGraph = createNoteGraphSnapshot("synthetic", next, [])!;
  const nextTasks = createTaskListSnapshot("synthetic", next, null)!;
  const nextCalendar = createCalendarSnapshot(files, next);
  const graphRequests = noteGraphIndexRequests(graph, nextGraph);
  const taskRequests = taskListIndexRequests(tasks, nextTasks);
  return {
    documents: documents.length, elapsed: performance.now() - started,
    graphChanges: graphRequests.flatMap((request) => request.documents).length,
    taskChanges: taskRequests.flatMap((request) => request.documents).length,
    graphCount: graph.documents.length, taskCount: tasks.documents.length, calendarCount: calendar.documents.length,
    reusedGraph: nextGraph.documents.filter((document, index) => document === graph.documents[index]).length,
    reusedTasks: nextTasks.documents.filter((document, index) => document === tasks.documents[index]).length,
    reusedCalendar: nextCalendar.documents.filter((document, index) => document === calendar.documents[index]).length,
  };
};
