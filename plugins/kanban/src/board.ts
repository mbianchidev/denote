import {
  MAX_PLUGIN_KANBAN_CARD_BODY_BYTES,
  MAX_PLUGIN_KANBAN_CARDS,
  MAX_PLUGIN_KANBAN_COLUMNS,
  MAX_PLUGIN_KANBAN_SOURCE_BYTES,
  type PluginKanbanBoardModel,
  type PluginKanbanBoardRequest,
  type PluginKanbanCard,
  type PluginKanbanEditRequest,
  type PluginKanbanEditResult,
} from "@denote/plugin-sdk";

const BOARD_START = "<!-- denote-kanban:board:v1:start -->";
const BOARD_END = "<!-- denote-kanban:board:end -->";
const COLUMN_END = "<!-- denote-kanban:column:end -->";
const CARD_END = "<!-- denote-kanban:card:end -->";
const COLUMN_START =
  /^<!-- denote-kanban:column:start id="([a-z0-9][a-z0-9._-]{0,159})" -->$/;
const CARD_START =
  /^<!-- denote-kanban:card:start id="([a-z0-9][a-z0-9._-]{0,159})" -->$/;
const RESERVED_MARKER = /<!--\s*denote-kanban:/;
const MARKDOWN_LINK = /(?<!!)\[([^\]\r\n]{1,160})\]\(([^)\r\n]{1,1024})\)/g;
const HASHTAG =
  /(^|[\s([{])#([\p{L}\p{N}][\p{L}\p{N}_/-]{0,79})/gu;
const SAFE_MODEL_TEXT =
  /^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]*$/u;

interface SourceLine {
  text: string;
  start: number;
  end: number;
  nextStart: number;
  number: number;
}

interface ParsedCard {
  id: string;
  titleLine: SourceLine;
  bodyStart: number;
  bodyEnd: number;
  start: number;
  end: number;
  model: PluginKanbanCard;
}

interface ParsedColumn {
  id: string;
  titleLine: SourceLine;
  endMarker: SourceLine;
  start: number;
  end: number;
  cards: ParsedCard[];
}

interface ParsedBoard {
  lineEnding: "\n" | "\r\n" | "\r";
  titleLine: SourceLine;
  endMarker: SourceLine;
  columns: ParsedColumn[];
}

interface ParsedDocument {
  model: PluginKanbanBoardModel;
  board: ParsedBoard | null;
}

class KanbanParseError extends Error {
  constructor(
    message: string,
    readonly line?: number,
    readonly code = "INVALID_BOARD",
  ) {
    super(message);
  }
}

export function parseKanbanBoard(
  request: PluginKanbanBoardRequest,
): PluginKanbanBoardModel {
  return parseDocument(request.source).model;
}

export function editKanbanBoard(
  request: PluginKanbanEditRequest,
): PluginKanbanEditResult {
  const parsed = parseDocument(request.source);
  if (parsed.model.error) {
    throw new Error(parsed.model.error.message);
  }
  const lineEnding = parsed.board?.lineEnding ?? detectLineEnding(request.source);
  const edit = request.edit;
  let source = request.source;

  if (edit.type === "initialize") {
    if (parsed.board) {
      throw new Error("This file already contains a Kanban board.");
    }
    assertSafeEditableText(edit.title, "Board title");
    assertSafeEditableText(edit.initialColumnTitle, "Column title");
    const columnId = createId("column");
    const board = [
      BOARD_START,
      `# ${edit.title.trim()}`,
      "",
      columnBlock(columnId, edit.initialColumnTitle, lineEnding).replace(
        new RegExp(`${escapeRegExp(lineEnding)}$`),
        "",
      ),
      BOARD_END,
      "",
    ].join(lineEnding);
    source = `${source}${appendSeparator(source, lineEnding)}${board}`;
    return result(source);
  }

  const board = parsed.board;
  if (!board) {
    throw new Error("Initialize this Markdown file as a Kanban board first.");
  }

  switch (edit.type) {
    case "rename-board":
      assertSafeEditableText(edit.title, "Board title");
      source = replaceLine(source, board.titleLine, `# ${edit.title.trim()}`);
      break;
    case "add-column": {
      assertSafeEditableText(edit.title, "Column title");
      const insertion = edit.beforeColumnId
        ? requireColumn(board, edit.beforeColumnId).start
        : board.endMarker.start;
      source = insertBlock(
        source,
        insertion,
        columnBlock(createId("column"), edit.title, lineEnding),
        lineEnding,
      );
      break;
    }
    case "rename-column": {
      assertSafeEditableText(edit.title, "Column title");
      const column = requireColumn(board, edit.columnId);
      source = replaceLine(
        source,
        column.titleLine,
        `## ${edit.title.trim()}`,
      );
      break;
    }
    case "delete-column": {
      const column = requireColumn(board, edit.columnId);
      source = replaceRange(source, column.start, column.end, "");
      break;
    }
    case "move-column": {
      if (edit.beforeColumnId === edit.columnId) {
        break;
      }
      const column = requireColumn(board, edit.columnId);
      const block = source.slice(column.start, column.end);
      const without = replaceRange(source, column.start, column.end, "");
      const reparsed = requireParsedBoard(without);
      const insertion = edit.beforeColumnId
        ? requireColumn(reparsed, edit.beforeColumnId).start
        : reparsed.endMarker.start;
      source = insertBlock(without, insertion, block, lineEnding);
      break;
    }
    case "add-card": {
      assertSafeEditableText(edit.title, "Card title");
      assertSafeCardBody(edit.body);
      const column = requireColumn(board, edit.columnId);
      const insertion = edit.beforeCardId
        ? requireCard(column, edit.beforeCardId).start
        : column.endMarker.start;
      source = insertBlock(
        source,
        insertion,
        cardBlock(createId("card"), edit.title, edit.body, lineEnding),
        lineEnding,
      );
      break;
    }
    case "edit-card": {
      assertSafeEditableText(edit.title, "Card title");
      assertSafeCardBody(edit.body);
      const card = requireBoardCard(board, edit.cardId);
      source = replaceRange(
        source,
        card.bodyStart,
        card.bodyEnd,
        cardBodySource(edit.body, lineEnding),
      );
      source = replaceLine(
        source,
        card.titleLine,
        `### ${edit.title.trim()}`,
      );
      break;
    }
    case "delete-card": {
      const card = requireBoardCard(board, edit.cardId);
      source = replaceRange(source, card.start, card.end, "");
      break;
    }
    case "move-card": {
      if (edit.beforeCardId === edit.cardId) {
        break;
      }
      const card = requireBoardCard(board, edit.cardId);
      const block = source.slice(card.start, card.end);
      const without = replaceRange(source, card.start, card.end, "");
      const reparsed = requireParsedBoard(without);
      const target = requireColumn(reparsed, edit.targetColumnId);
      const insertion = edit.beforeCardId
        ? requireCard(target, edit.beforeCardId).start
        : target.endMarker.start;
      source = insertBlock(without, insertion, block, lineEnding);
      break;
    }
  }
  return result(source);
}

function parseDocument(source: string): ParsedDocument {
  if (stringBytes(source) > MAX_PLUGIN_KANBAN_SOURCE_BYTES) {
    return {
      board: null,
      model: errorModel(
        "Kanban board size limit is 4 MiB. Use Markdown view for this file.",
        undefined,
        "SOURCE_LIMIT",
      ),
    };
  }
  try {
    const lines = sourceLines(source);
    const boardStarts = markerLines(lines, BOARD_START);
    const boardEnds = markerLines(lines, BOARD_END);
    if (boardStarts.length === 0) {
      if (
        boardEnds.length > 0 ||
        lines.some((line) => isReservedStructureMarker(line.text.trim()))
      ) {
        throw new KanbanParseError(
          "Kanban marker found without a matching board start marker.",
          boardEnds[0]?.number,
        );
      }
      return {
        board: null,
        model: {
          title: "",
          columns: [],
          error: null,
          notices:
            source.trim().length > 0
              ? ["Existing Markdown will remain above the board."]
              : [],
          canInitialize: true,
        },
      };
    }
    if (boardStarts.length !== 1 || boardEnds.length !== 1) {
      throw new KanbanParseError(
        "A Kanban file must contain exactly one board start and end marker.",
        (boardStarts[1] ?? boardEnds[1] ?? boardStarts[0]).number,
      );
    }
    const startIndex = lines.indexOf(boardStarts[0]);
    const endIndex = lines.indexOf(boardEnds[0]);
    if (endIndex <= startIndex) {
      throw new KanbanParseError(
        "Kanban board end marker must follow its start marker.",
        boardEnds[0].number,
      );
    }
    const titleLine = firstNonBlank(lines, startIndex + 1, endIndex);
    const title = heading(titleLine, 1, "Board");
    const ids = new Set<string>();
    const columns: ParsedColumn[] = [];
    let cardCount = 0;
    let index = lines.indexOf(titleLine) + 1;
    while (index < endIndex) {
      const text = lines[index].text.trim();
      const columnMatch = COLUMN_START.exec(text);
      if (columnMatch) {
        if (columns.length >= MAX_PLUGIN_KANBAN_COLUMNS) {
          throw new KanbanParseError(
            `Kanban boards support at most ${MAX_PLUGIN_KANBAN_COLUMNS} columns.`,
            lines[index].number,
            "COLUMN_LIMIT",
          );
        }
        const parsed = parseColumn(source, lines, index, endIndex, ids);
        columns.push(parsed.column);
        cardCount += parsed.column.cards.length;
        if (cardCount > MAX_PLUGIN_KANBAN_CARDS) {
          throw new KanbanParseError(
            `Kanban boards support at most ${MAX_PLUGIN_KANBAN_CARDS} cards.`,
            lines[index].number,
            "CARD_LIMIT",
          );
        }
        index = parsed.nextIndex;
        continue;
      }
      if (text === COLUMN_END || CARD_START.test(text) || text === CARD_END) {
        throw new KanbanParseError(
          "Kanban card or column marker is outside its parent block.",
          lines[index].number,
        );
      }
      index += 1;
    }
    return {
      board: {
        lineEnding: detectLineEnding(source),
        titleLine,
        endMarker: boardEnds[0],
        columns,
      },
      model: {
        title,
        columns: columns.map((column) => ({
          id: column.id,
          title: heading(column.titleLine, 2, "Column"),
          cards: column.cards.map((card) => card.model),
        })),
        error: null,
        notices: [],
        canInitialize: false,
      },
    };
  } catch (error) {
    const parsedError =
      error instanceof KanbanParseError
        ? error
        : new KanbanParseError(
            error instanceof Error ? error.message : String(error),
          );
    return {
      board: null,
      model: errorModel(
        parsedError.message,
        parsedError.line,
        parsedError.code,
      ),
    };
  }
}

function parseColumn(
  source: string,
  lines: SourceLine[],
  startIndex: number,
  boardEndIndex: number,
  ids: Set<string>,
): { column: ParsedColumn; nextIndex: number } {
  const match = COLUMN_START.exec(lines[startIndex].text.trim());
  if (!match) {
    throw new KanbanParseError(
      "Invalid Kanban column start marker.",
      lines[startIndex].number,
    );
  }
  const id = uniqueId(match[1], ids, lines[startIndex].number);
  const endIndex = findClosingMarker(
    lines,
    startIndex + 1,
    boardEndIndex,
    COLUMN_END,
    COLUMN_START,
    "column",
  );
  const titleLine = firstNonBlank(lines, startIndex + 1, endIndex);
  heading(titleLine, 2, "Column");
  const cards: ParsedCard[] = [];
  let index = lines.indexOf(titleLine) + 1;
  while (index < endIndex) {
    const text = lines[index].text.trim();
    if (CARD_START.test(text)) {
      const parsed = parseCard(source, lines, index, endIndex, ids);
      cards.push(parsed.card);
      index = parsed.nextIndex;
      continue;
    }
    if (
      text === CARD_END ||
      COLUMN_START.test(text) ||
      text === BOARD_START ||
      text === BOARD_END
    ) {
      throw new KanbanParseError(
        "Kanban marker is nested in the wrong block.",
        lines[index].number,
      );
    }
    index += 1;
  }
  return {
    column: {
      id,
      titleLine,
      endMarker: lines[endIndex],
      start: lines[startIndex].start,
      end: lines[endIndex].nextStart,
      cards,
    },
    nextIndex: endIndex + 1,
  };
}

function parseCard(
  source: string,
  lines: SourceLine[],
  startIndex: number,
  columnEndIndex: number,
  ids: Set<string>,
): { card: ParsedCard; nextIndex: number } {
  const match = CARD_START.exec(lines[startIndex].text.trim());
  if (!match) {
    throw new KanbanParseError(
      "Invalid Kanban card start marker.",
      lines[startIndex].number,
    );
  }
  const id = uniqueId(match[1], ids, lines[startIndex].number);
  const endIndex = findClosingMarker(
    lines,
    startIndex + 1,
    columnEndIndex,
    CARD_END,
    CARD_START,
    "card",
  );
  const titleLine = firstNonBlank(lines, startIndex + 1, endIndex);
  const title = heading(titleLine, 3, "Card");
  const rawBodyStart = titleLine.nextStart;
  const rawBodyEnd = lines[endIndex].start;
  const titleIndex = lines.indexOf(titleLine);
  const firstBodyLine = lines[titleIndex + 1];
  const lastBodyLine = lines[endIndex - 1];
  const bodyStart =
    firstBodyLine &&
    firstBodyLine.text.length === 0 &&
    firstBodyLine.nextStart <= rawBodyEnd
      ? firstBodyLine.nextStart
      : rawBodyStart;
  const bodyEnd =
    lastBodyLine && lastBodyLine.nextStart === rawBodyEnd
      ? Math.max(bodyStart, lastBodyLine.end)
      : rawBodyEnd;
  for (let index = lines.indexOf(titleLine) + 1; index < endIndex; index += 1) {
    const text = lines[index].text.trim();
    if (
      text === BOARD_START ||
      text === BOARD_END ||
      text === COLUMN_END ||
      COLUMN_START.test(text) ||
      CARD_START.test(text)
    ) {
      throw new KanbanParseError(
        "Reserved Kanban marker is nested inside card details.",
        lines[index].number,
      );
    }
  }
  const body = normalizeLineEndings(
    source.slice(bodyStart, bodyEnd),
  );
  if (stringBytes(body) > MAX_PLUGIN_KANBAN_CARD_BODY_BYTES) {
    throw new KanbanParseError(
      "Kanban card details exceed the 64 KiB limit.",
      titleLine.number,
      "CARD_BODY_LIMIT",
    );
  }
  const searchable = `${title}\n${body}`;
  return {
    card: {
      id,
      titleLine,
      bodyStart: rawBodyStart,
      bodyEnd: rawBodyEnd,
      start: lines[startIndex].start,
      end: lines[endIndex].nextStart,
      model: {
        id,
        title,
        body,
        tags: extractTags(searchable),
        links: extractLinks(searchable),
      },
    },
    nextIndex: endIndex + 1,
  };
}

function result(source: string): PluginKanbanEditResult {
  const parsed = parseDocument(source);
  if (parsed.model.error || !parsed.board) {
    throw new Error(
      parsed.model.error?.message ?? "Kanban board edit produced no board.",
    );
  }
  return { source, model: parsed.model };
}

function requireParsedBoard(source: string): ParsedBoard {
  const parsed = parseDocument(source);
  if (!parsed.board || parsed.model.error) {
    throw new Error(
      parsed.model.error?.message ?? "Kanban board is no longer available.",
    );
  }
  return parsed.board;
}

function requireColumn(board: ParsedBoard, id: string): ParsedColumn {
  const column = board.columns.find((candidate) => candidate.id === id);
  if (!column) {
    throw new Error(`Kanban column ${id} is no longer available.`);
  }
  return column;
}

function requireCard(column: ParsedColumn, id: string): ParsedCard {
  const card = column.cards.find((candidate) => candidate.id === id);
  if (!card) {
    throw new Error(`Kanban card ${id} is not in the target column.`);
  }
  return card;
}

function requireBoardCard(board: ParsedBoard, id: string): ParsedCard {
  for (const column of board.columns) {
    const card = column.cards.find((candidate) => candidate.id === id);
    if (card) {
      return card;
    }
  }
  throw new Error(`Kanban card ${id} is no longer available.`);
}

function uniqueId(id: string, ids: Set<string>, line: number): string {
  if (ids.has(id)) {
    throw new KanbanParseError(`Duplicate Kanban marker ID: ${id}.`, line);
  }
  ids.add(id);
  return id;
}

function findClosingMarker(
  lines: SourceLine[],
  startIndex: number,
  limit: number,
  endMarker: string,
  nestedStart: RegExp,
  label: string,
): number {
  for (let index = startIndex; index < limit; index += 1) {
    const text = lines[index].text.trim();
    if (text === endMarker) {
      return index;
    }
    if (nestedStart.test(text)) {
      throw new KanbanParseError(
        `Kanban ${label} marker is not closed before the next ${label}.`,
        lines[index].number,
      );
    }
  }
  throw new KanbanParseError(
    `Kanban ${label} marker is missing its end marker.`,
    lines[Math.max(0, startIndex - 1)]?.number,
  );
}

function firstNonBlank(
  lines: SourceLine[],
  start: number,
  end: number,
): SourceLine {
  for (let index = start; index < end; index += 1) {
    if (lines[index].text.trim().length > 0) {
      return lines[index];
    }
  }
  throw new KanbanParseError(
    "Kanban block is missing its Markdown heading.",
    lines[start - 1]?.number,
  );
}

function heading(line: SourceLine, level: number, label: string): string {
  const match = new RegExp(`^#{${level}}(?!#)\\s+(.+?)\\s*$`).exec(
    line.text.trim(),
  );
  if (!match) {
    throw new KanbanParseError(
      `${label} must begin with a level ${level} Markdown heading.`,
      line.number,
    );
  }
  if (!SAFE_MODEL_TEXT.test(match[1])) {
    throw new KanbanParseError(
      `${label} heading contains unsupported control characters.`,
      line.number,
    );
  }
  return match[1];
}

function sourceLines(source: string): SourceLine[] {
  const lines: SourceLine[] = [];
  let start = 0;
  let number = 1;
  while (start < source.length) {
    let end = start;
    while (
      end < source.length &&
      source[end] !== "\n" &&
      source[end] !== "\r"
    ) {
      end += 1;
    }
    let nextStart = end;
    if (source[end] === "\r" && source[end + 1] === "\n") {
      nextStart += 2;
    } else if (source[end] === "\r" || source[end] === "\n") {
      nextStart += 1;
    }
    lines.push({
      text: source.slice(start, end),
      start,
      end,
      nextStart,
      number,
    });
    start = nextStart;
    number += 1;
  }
  return lines;
}

function markerLines(lines: SourceLine[], marker: string): SourceLine[] {
  return lines.filter((line) => line.text.trim() === marker);
}

function isReservedStructureMarker(text: string): boolean {
  return (
    text === COLUMN_END ||
    text === CARD_END ||
    COLUMN_START.test(text) ||
    CARD_START.test(text)
  );
}

function replaceLine(
  source: string,
  line: SourceLine,
  replacement: string,
): string {
  return replaceRange(source, line.start, line.end, replacement);
}

function replaceRange(
  source: string,
  start: number,
  end: number,
  replacement: string,
): string {
  return `${source.slice(0, start)}${replacement}${source.slice(end)}`;
}

function insertBlock(
  source: string,
  offset: number,
  block: string,
  lineEnding: string,
): string {
  const leading =
    offset > 0 &&
    source[offset - 1] !== "\n" &&
    source[offset - 1] !== "\r"
      ? lineEnding
      : "";
  const trailing =
    block.endsWith("\n") || block.endsWith("\r") ? "" : lineEnding;
  return `${source.slice(0, offset)}${leading}${block}${trailing}${source.slice(offset)}`;
}

function columnBlock(
  id: string,
  title: string,
  lineEnding: string,
): string {
  return [
    `<!-- denote-kanban:column:start id="${id}" -->`,
    `## ${title.trim()}`,
    "",
    COLUMN_END,
    "",
  ].join(lineEnding);
}

function cardBlock(
  id: string,
  title: string,
  body: string,
  lineEnding: string,
): string {
  return [
    `<!-- denote-kanban:card:start id="${id}" -->`,
    `### ${title.trim()}`,
    "",
    ...(body.length > 0 ? [normalizeToLineEnding(body, lineEnding)] : []),
    CARD_END,
    "",
  ].join(lineEnding);
}

function cardBodySource(body: string, lineEnding: string): string {
  return `${lineEnding}${
    body.length > 0
      ? `${normalizeToLineEnding(body, lineEnding)}${lineEnding}`
      : ""
  }`;
}

function detectLineEnding(source: string): "\n" | "\r\n" | "\r" {
  const match = /\r\n|\r|\n/.exec(source);
  return (match?.[0] as "\n" | "\r\n" | "\r" | undefined) ?? "\n";
}

function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n?|\n/g, "\n");
}

function normalizeToLineEnding(value: string, lineEnding: string): string {
  return normalizeLineEndings(value).replace(/\n/g, lineEnding);
}

function appendSeparator(source: string, lineEnding: string): string {
  if (source.length === 0) {
    return "";
  }
  if (source.endsWith(`${lineEnding}${lineEnding}`)) {
    return "";
  }
  if (source.endsWith(lineEnding)) {
    return lineEnding;
  }
  return `${lineEnding}${lineEnding}`;
}

function assertSafeEditableText(value: string, label: string): void {
  if (
    value.trim().length === 0 ||
    /[\r\n]/.test(value) ||
    RESERVED_MARKER.test(value)
  ) {
    throw new Error(`${label} must be one line without reserved Kanban markers.`);
  }
}

function assertSafeCardBody(body: string): void {
  if (stringBytes(body) > MAX_PLUGIN_KANBAN_CARD_BODY_BYTES) {
    throw new Error("Card details exceed the 64 KiB limit.");
  }
  if (body.split(/\r\n?|\n/).some((line) => RESERVED_MARKER.test(line))) {
    throw new Error("Card details cannot contain reserved Kanban marker lines.");
  }
}

function createId(prefix: "column" | "card"): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function extractLinks(value: string): PluginKanbanCard["links"] {
  const links: PluginKanbanCard["links"] = [];
  const seen = new Set<string>();
  for (const match of value.matchAll(MARKDOWN_LINK)) {
    const label = match[1].trim();
    const href = match[2].trim();
    if (!SAFE_MODEL_TEXT.test(label) || !SAFE_MODEL_TEXT.test(href)) {
      continue;
    }
    const key = `${label}\u0000${href}`;
    if (!seen.has(key)) {
      seen.add(key);
      links.push({ label, href });
    }
    if (links.length >= 32) {
      break;
    }
  }
  return links;
}

function extractTags(value: string): string[] {
  const tags: string[] = [];
  const seen = new Set<string>();
  for (const match of value.matchAll(HASHTAG)) {
    const tag = match[2];
    const key = tag.toLocaleLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      tags.push(tag);
    }
    if (tags.length >= 32) {
      break;
    }
  }
  return tags;
}

function errorModel(
  message: string,
  line?: number,
  code?: string,
): PluginKanbanBoardModel {
  return {
    title: "",
    columns: [],
    error: {
      message,
      ...(line ? { line } : {}),
      ...(code ? { code } : {}),
    },
    notices: [],
    canInitialize: false,
  };
}

function stringBytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
