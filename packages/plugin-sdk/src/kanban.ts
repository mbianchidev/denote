import type {
  PluginKanbanBoardModel,
  PluginKanbanCard,
  PluginKanbanColumn,
  PluginKanbanEdit,
  PluginKanbanEditRequest,
  PluginKanbanEditResult,
} from "./contracts";

export const MAX_PLUGIN_KANBAN_FILE_SUFFIXES = 4;
export const MAX_PLUGIN_KANBAN_SOURCE_BYTES = 4 * 1024 * 1024;
export const MAX_PLUGIN_KANBAN_MODEL_BYTES = 8 * 1024 * 1024;
export const MAX_PLUGIN_KANBAN_COLUMNS = 128;
export const MAX_PLUGIN_KANBAN_CARDS = 5_000;
export const MAX_PLUGIN_KANBAN_CARD_BODY_BYTES = 64 * 1024;
export const MAX_PLUGIN_KANBAN_TAGS_PER_CARD = 32;
export const MAX_PLUGIN_KANBAN_LINKS_PER_CARD = 32;

const SAFE_TEXT =
  /^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]*$/u;
const SAFE_ID = /^[a-z0-9][a-z0-9._-]{0,159}$/;
const FILE_SUFFIX = /^\.[a-z0-9][a-z0-9.-]{0,30}\.(?:md|markdown)$/;

export function isPluginKanbanRegistration(
  value: unknown,
): value is {
  id: string;
  title: string;
  fileSuffixes: string[];
  defaultFileName: string;
} {
  if (
    !isRecord(value) ||
    !safeSingleLine(value.id, 160) ||
    !safeSingleLine(value.title, 160) ||
    !Array.isArray(value.fileSuffixes) ||
    value.fileSuffixes.length === 0 ||
    value.fileSuffixes.length > MAX_PLUGIN_KANBAN_FILE_SUFFIXES ||
    !safeSingleLine(value.defaultFileName, 128)
  ) {
    return false;
  }
  const defaultFileName = value.defaultFileName;
  if (defaultFileName.includes("/") || defaultFileName.includes("\\")) {
    return false;
  }
  const suffixes = new Set<string>();
  for (const suffix of value.fileSuffixes) {
    if (
      typeof suffix !== "string" ||
      suffix !== suffix.toLowerCase() ||
      !FILE_SUFFIX.test(suffix) ||
      suffixes.has(suffix)
    ) {
      return false;
    }
    suffixes.add(suffix);
  }
  return [...suffixes].some((suffix) =>
    defaultFileName.toLowerCase().endsWith(suffix),
  );
}

export function isPluginKanbanBoardModel(
  value: unknown,
): value is PluginKanbanBoardModel {
  if (
    !isRecord(value) ||
    !safeDisplayText(value.title, 200) ||
    typeof value.canInitialize !== "boolean" ||
    !Array.isArray(value.notices) ||
    value.notices.length > 16 ||
    !value.notices.every((notice) => safeDisplayText(notice, 512)) ||
    !Array.isArray(value.columns) ||
    value.columns.length > MAX_PLUGIN_KANBAN_COLUMNS
  ) {
    return false;
  }
  let bytes = stringBytes(value.title);
  for (const notice of value.notices) {
    bytes += stringBytes(notice);
  }
  if (value.error !== null) {
    return (
      !value.canInitialize &&
      value.title === "" &&
      value.columns.length === 0 &&
      isKanbanError(value.error) &&
      bytes + errorBytes(value.error as Record<string, unknown>) <=
        MAX_PLUGIN_KANBAN_MODEL_BYTES
    );
  }
  if (value.canInitialize) {
    return (
      value.title === "" &&
      value.columns.length === 0 &&
      bytes <= MAX_PLUGIN_KANBAN_MODEL_BYTES
    );
  }
  if (!safeSingleLine(value.title, 200)) {
    return false;
  }

  const ids = new Set<string>();
  let cardCount = 0;
  for (const column of value.columns) {
    if (!isKanbanColumn(column, ids)) {
      return false;
    }
    bytes += columnBytes(column);
    cardCount += column.cards.length;
    if (
      cardCount > MAX_PLUGIN_KANBAN_CARDS ||
      bytes > MAX_PLUGIN_KANBAN_MODEL_BYTES
    ) {
      return false;
    }
  }
  return true;
}

export function isPluginKanbanEditRequest(
  value: unknown,
): value is PluginKanbanEditRequest {
  return (
    isRecord(value) &&
    safePath(value.path) &&
    sourceWithinLimit(value.source) &&
    isPluginKanbanEdit(value.edit)
  );
}

export function isPluginKanbanEditResult(
  value: unknown,
): value is PluginKanbanEditResult {
  return (
    isRecord(value) &&
    sourceWithinLimit(value.source) &&
    isPluginKanbanBoardModel(value.model)
  );
}

export function isPluginKanbanEdit(value: unknown): value is PluginKanbanEdit {
  if (!isRecord(value) || typeof value.type !== "string") {
    return false;
  }
  switch (value.type) {
    case "initialize":
      return (
        safeTitle(value.title) && safeTitle(value.initialColumnTitle)
      );
    case "rename-board":
      return safeTitle(value.title);
    case "add-column":
      return safeTitle(value.title) && nullableId(value.beforeColumnId);
    case "rename-column":
      return safeId(value.columnId) && safeTitle(value.title);
    case "delete-column":
      return safeId(value.columnId);
    case "move-column":
      return safeId(value.columnId) && nullableId(value.beforeColumnId);
    case "add-card":
      return (
        safeId(value.columnId) &&
        safeTitle(value.title) &&
        safeBody(value.body) &&
        nullableId(value.beforeCardId)
      );
    case "edit-card":
      return (
        safeId(value.cardId) &&
        safeTitle(value.title) &&
        safeBody(value.body)
      );
    case "delete-card":
      return safeId(value.cardId);
    case "move-card":
      return (
        safeId(value.cardId) &&
        safeId(value.targetColumnId) &&
        nullableId(value.beforeCardId)
      );
    default:
      return false;
  }
}

export function isPluginKanbanBoardRequest(
  value: unknown,
): value is { path: string; source: string } {
  return (
    isRecord(value) &&
    safePath(value.path) &&
    sourceWithinLimit(value.source)
  );
}

function isKanbanColumn(
  value: unknown,
  ids: Set<string>,
): value is PluginKanbanColumn {
  if (
    !isRecord(value) ||
    !safeId(value.id) ||
    ids.has(value.id) ||
    !safeTitle(value.title) ||
    !Array.isArray(value.cards) ||
    value.cards.length > MAX_PLUGIN_KANBAN_CARDS
  ) {
    return false;
  }
  ids.add(value.id);
  return value.cards.every((card) => isKanbanCard(card, ids));
}

function isKanbanCard(
  value: unknown,
  ids: Set<string>,
): value is PluginKanbanCard {
  if (
    !isRecord(value) ||
    !safeId(value.id) ||
    ids.has(value.id) ||
    !safeTitle(value.title) ||
    !safeBody(value.body) ||
    !Array.isArray(value.tags) ||
    value.tags.length > MAX_PLUGIN_KANBAN_TAGS_PER_CARD ||
    !value.tags.every((tag) => safeSingleLine(tag, 80)) ||
    !Array.isArray(value.links) ||
    value.links.length > MAX_PLUGIN_KANBAN_LINKS_PER_CARD ||
    !value.links.every(
      (link) =>
        isRecord(link) &&
        safeDisplayText(link.label, 160) &&
        safeDisplayText(link.href, 1024),
    )
  ) {
    return false;
  }
  ids.add(value.id);
  return true;
}

function isKanbanError(value: unknown): boolean {
  return (
    isRecord(value) &&
    safeDisplayText(value.message, 1024) &&
    value.message.length > 0 &&
    (value.line === undefined || positiveInteger(value.line)) &&
    (value.column === undefined || positiveInteger(value.column)) &&
    (value.code === undefined || safeSingleLine(value.code, 80))
  );
}

function errorBytes(value: Record<string, unknown>): number {
  return (
    stringBytes(String(value.message)) +
    stringBytes(String(value.code ?? "")) +
    32
  );
}

function columnBytes(column: PluginKanbanColumn): number {
  return column.cards.reduce(
    (total, card) =>
      total +
      stringBytes(card.id) +
      stringBytes(card.title) +
      stringBytes(card.body) +
      card.tags.reduce((sum, tag) => sum + stringBytes(tag), 0) +
      card.links.reduce(
        (sum, link) =>
          sum + stringBytes(link.label) + stringBytes(link.href),
        0,
      ) +
      48,
    stringBytes(column.id) + stringBytes(column.title) + 24,
  );
}

function safeId(value: unknown): value is string {
  return typeof value === "string" && SAFE_ID.test(value);
}

function nullableId(value: unknown): value is string | null {
  return value === null || safeId(value);
}

function safeTitle(value: unknown): value is string {
  return safeSingleLine(value, 200);
}

function safeBody(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= MAX_PLUGIN_KANBAN_CARD_BODY_BYTES &&
    stringBytes(value) <= MAX_PLUGIN_KANBAN_CARD_BODY_BYTES
  );
}

function safePath(value: unknown): value is string {
  return (
    safeDisplayText(value, 4096) &&
    value.length > 0 &&
    !value.startsWith("/") &&
    !value.startsWith("\\")
  );
}

function safeSingleLine(value: unknown, maxLength: number): value is string {
  return (
    safeDisplayText(value, maxLength) &&
    value.trim().length > 0 &&
    !/[\r\n]/.test(value)
  );
}

function safeDisplayText(value: unknown, maxLength: number): value is string {
  return (
    typeof value === "string" &&
    value.length <= maxLength &&
    SAFE_TEXT.test(value)
  );
}

function sourceWithinLimit(value: unknown): value is string {
  return (
    typeof value === "string" &&
    stringBytes(value) <= MAX_PLUGIN_KANBAN_SOURCE_BYTES
  );
}

function positiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function stringBytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
