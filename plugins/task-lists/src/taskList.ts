import {
  MAX_PLUGIN_TASK_LIST_TAGS,
  MAX_PLUGIN_TASK_LIST_TASKS,
  isTaskListDate,
  type PluginTaskListDocument,
  type PluginTaskListIndexRequest,
  type PluginTaskListItem,
  type PluginTaskListModel,
  type PluginTaskListQuery,
  type PluginTaskListToggleRequest,
  type PluginTaskListToggleResult,
} from "@denote/plugin-sdk";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmTaskListItemFromMarkdown } from "mdast-util-gfm-task-list-item";
import { gfmTaskListItem } from "micromark-extension-gfm-task-list-item";

interface MarkdownNode {
  type: string;
  depth?: number;
  value?: string;
  checked?: boolean | null;
  children?: MarkdownNode[];
  position?: {
    start: { line: number };
  };
}

interface ParsedTask extends PluginTaskListItem {
  markerOffset: number;
}

interface IndexedDocument {
  path: string;
  title: string;
  tasks: ParsedTask[];
  parseError: boolean;
  invalidDueDates: number;
}

const TASK_LINE = /^(\s*[-*+]\s+\[)([ xX])(\]\s+)(.+)$/u;
const TAG = /(?:^|\s)#([\p{L}\p{N}_/-]+)/gu;
const DUE_DATE = /(?:^|\s)due:(\d{4}-\d{2}-\d{2})(?=$|\s)/giu;
const SAFE_TEXT =
  /^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]*$/u;

export class TaskListIndex {
  private readonly documents = new Map<string, IndexedDocument>();
  private skippedCount = 0;
  private hostTruncated = false;

  index(request: PluginTaskListIndexRequest): void {
    if (request.mode === "replace") {
      this.documents.clear();
    }
    for (const path of request.removedPaths) {
      this.documents.delete(path);
    }
    for (const document of request.documents) {
      this.documents.set(document.path, parseTaskDocument(document));
    }
    this.skippedCount = request.skippedCount;
    this.hostTruncated = request.truncated;
  }

  query(request: PluginTaskListQuery): PluginTaskListModel {
    const allTasks = [...this.documents.values()].flatMap(
      (document) => document.tasks,
    );
    const normalizedTag = request.tag?.toLocaleLowerCase() ?? null;
    const normalizedPath = request.path.trim().toLocaleLowerCase();
    const matching = allTasks
      .filter((task) =>
        (request.status === "all" ||
          (request.status === "completed") === task.checked) &&
        (normalizedTag === null ||
          task.tags.some(
            (tag) => tag.toLocaleLowerCase() === normalizedTag,
          )) &&
        (!normalizedPath ||
          task.path.toLocaleLowerCase().includes(normalizedPath)) &&
        matchesDueFilter(task.dueDate, request.due, request.today),
      )
      .sort(compareTasks);
    const availableTags = [
      ...new Set(allTasks.flatMap((task) => task.tags)),
    ].sort((left, right) => left.localeCompare(right));
    const selectedTags = availableTags.slice(0, MAX_PLUGIN_TASK_LIST_TAGS);
    const selectedTasks = matching.slice(0, MAX_PLUGIN_TASK_LIST_TASKS);
    const parseErrors = [...this.documents.values()].filter(
      (document) => document.parseError,
    ).length;
    const invalidDueDates = [...this.documents.values()].reduce(
      (total, document) => total + document.invalidDueDates,
      0,
    );
    const notices: string[] = [];
    if (this.skippedCount > 0) {
      notices.push(
        `Denote skipped ${this.skippedCount} vault file${
          this.skippedCount === 1 ? "" : "s"
        } while preparing the bounded task index.`,
      );
    }
    if (this.hostTruncated) {
      notices.push(
        "The host index reached its document or byte bound, so this task list is incomplete.",
      );
    }
    if (parseErrors > 0) {
      notices.push(
        `${parseErrors} Markdown note${parseErrors === 1 ? "" : "s"} could not be parsed for tasks.`,
      );
    }
    if (invalidDueDates > 0) {
      notices.push(
        `${invalidDueDates} invalid due date token${
          invalidDueDates === 1 ? " was" : "s were"
        } ignored.`,
      );
    }
    if (matching.length > selectedTasks.length) {
      notices.push(
        `Showing the first ${MAX_PLUGIN_TASK_LIST_TASKS.toLocaleString("en")} matching tasks.`,
      );
    }
    if (availableTags.length > selectedTags.length) {
      notices.push(
        `Showing the first ${MAX_PLUGIN_TASK_LIST_TAGS.toLocaleString("en")} task tags.`,
      );
    }
    return {
      tasks: selectedTasks.map(stripMarkerOffset),
      totalTasks: allTasks.length,
      matchingTasks: matching.length,
      availableTags: selectedTags,
      truncated:
        this.hostTruncated ||
        this.skippedCount > 0 ||
        matching.length > selectedTasks.length ||
        availableTags.length > selectedTags.length,
      notices,
    };
  }

  toggle(request: PluginTaskListToggleRequest): PluginTaskListToggleResult {
    const parsed = parseTaskDocument({
      path: request.path,
      title: request.path,
      source: request.source,
    });
    const matches = parsed.tasks.filter(
      (task) =>
        task.locator.sourceLine === request.locator.sourceLine &&
        sameHeadingPath(
          task.locator.headingPath,
          request.locator.headingPath,
        ),
    );
    if (matches.length === 0) {
      return { status: "conflict", reason: "missing" };
    }
    if (matches.length !== request.locator.matchCount) {
      return { status: "conflict", reason: "ambiguous" };
    }
    const target = matches[request.locator.occurrence - 1];
    if (
      !target ||
      target.checked !== request.locator.checked ||
      target.checked === request.checked
    ) {
      return { status: "conflict", reason: "changed" };
    }
    const marker = request.checked ? "x" : " ";
    return {
      status: "applied",
      source:
        request.source.slice(0, target.markerOffset) +
        marker +
        request.source.slice(target.markerOffset + 1),
    };
  }
}

export function parseTaskDocument(
  document: PluginTaskListDocument,
): IndexedDocument {
  let root: MarkdownNode;
  try {
    root = fromMarkdown(maskFrontmatter(document.source), {
      extensions: [gfmTaskListItem()],
      mdastExtensions: [gfmTaskListItemFromMarkdown()],
    }) as MarkdownNode;
  } catch {
    return {
      path: document.path,
      title: document.title,
      tasks: [],
      parseError: true,
      invalidDueDates: 0,
    };
  }
  const headings = (root.children ?? [])
    .filter(
      (node) =>
        node.type === "heading" &&
        typeof node.depth === "number" &&
        node.position?.start.line,
    )
    .map((node) => ({
      depth: node.depth as number,
      line: node.position!.start.line,
      text: nodeText(node).replace(/\s+/g, " ").trim().slice(0, 200),
    }))
    .filter((heading) => heading.text.length > 0);
  const lines = document.source.split("\n");
  const lineStarts: number[] = [];
  let offset = 0;
  for (const line of lines) {
    lineStarts.push(offset);
    offset += line.length + 1;
  }
  const tasks: ParsedTask[] = [];
  visit(root, (node) => {
    if (
      node.type !== "listItem" ||
      typeof node.checked !== "boolean" ||
      !node.position?.start.line
    ) {
      return;
    }
    const lineNumber = node.position.start.line;
    const sourceLine = lines[lineNumber - 1] ?? "";
    const match = TASK_LINE.exec(sourceLine);
    if (!match || !SAFE_TEXT.test(sourceLine)) {
      return;
    }
    const text = match[4].trim();
    if (!text) {
      return;
    }
    const headingPath = headingPathAtLine(headings, lineNumber);
    const tags = [
      ...new Set(
        [...text.matchAll(TAG)]
          .map((candidate) => candidate[1])
          .filter((tag) => tag.length <= 80 && SAFE_TEXT.test(tag)),
      ),
    ].slice(0, 32);
    const dueTokens = [...text.matchAll(DUE_DATE)].map(
      (candidate) => candidate[1],
    );
    const dueDate = dueTokens.find(isTaskListDate) ?? null;
    tasks.push({
      id: `${document.path}:${lineNumber}:${tasks.length + 1}`,
      path: document.path,
      noteTitle: document.title,
      line: lineNumber,
      text,
      checked: node.checked,
      headingPath,
      tags,
      dueDate,
      locator: {
        path: document.path,
        sourceLine,
        headingPath,
        occurrence: 0,
        matchCount: 0,
        checked: node.checked,
      },
      markerOffset: lineStarts[lineNumber - 1] + match[1].length,
    });
  });
  const groups = new Map<string, ParsedTask[]>();
  for (const task of tasks) {
    const key = `${JSON.stringify(task.headingPath)}\u0000${task.locator.sourceLine}`;
    const group = groups.get(key) ?? [];
    group.push(task);
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    group.forEach((task, index) => {
      task.locator.occurrence = index + 1;
      task.locator.matchCount = group.length;
    });
  }
  return {
    path: document.path,
    title: document.title,
    tasks,
    parseError: false,
    invalidDueDates: tasks.reduce(
      (total, task) =>
        total +
        [...task.text.matchAll(DUE_DATE)].filter(
          (candidate) => !isTaskListDate(candidate[1]),
        ).length,
      0,
    ),
  };
}

function headingPathAtLine(
  headings: Array<{ depth: number; line: number; text: string }>,
  line: number,
): string[] {
  const path: string[] = [];
  for (const heading of headings) {
    if (heading.line >= line) {
      break;
    }
    path.length = Math.min(path.length, heading.depth - 1);
    path[heading.depth - 1] = heading.text;
  }
  return path.filter(Boolean).slice(0, 12);
}

function maskFrontmatter(source: string): string {
  const lines = source.split("\n");
  if (lines[0]?.trim() !== "---") {
    return source;
  }
  const end = lines.findIndex(
    (line, index) =>
      index > 0 && (line.trim() === "---" || line.trim() === "..."),
  );
  if (end === -1) {
    return source;
  }
  return lines
    .map((line, index) => (index <= end ? " ".repeat(line.length) : line))
    .join("\n");
}

function visit(node: MarkdownNode, callback: (node: MarkdownNode) => void): void {
  callback(node);
  for (const child of node.children ?? []) {
    visit(child, callback);
  }
}

function nodeText(node: MarkdownNode): string {
  if (typeof node.value === "string") {
    return node.value;
  }
  return (node.children ?? []).map(nodeText).join("");
}

function matchesDueFilter(
  dueDate: string | null,
  filter: PluginTaskListQuery["due"],
  today: string,
): boolean {
  switch (filter) {
    case "overdue":
      return dueDate !== null && dueDate < today;
    case "today":
      return dueDate === today;
    case "upcoming":
      return dueDate !== null && dueDate > today;
    case "undated":
      return dueDate === null;
    default:
      return true;
  }
}

function compareTasks(left: ParsedTask, right: ParsedTask): number {
  return (
    Number(left.checked) - Number(right.checked) ||
    (left.dueDate ?? "9999-99-99").localeCompare(
      right.dueDate ?? "9999-99-99",
    ) ||
    left.path.localeCompare(right.path) ||
    left.line - right.line
  );
}

function sameHeadingPath(left: string[], right: string[]): boolean {
  return (
    left.length === right.length &&
    left.every((heading, index) => heading === right[index])
  );
}

function stripMarkerOffset(task: ParsedTask): PluginTaskListItem {
  const { markerOffset: _markerOffset, ...item } = task;
  return item;
}
