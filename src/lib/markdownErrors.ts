import { fromMarkdown } from "mdast-util-from-markdown";
import { mdxJsx } from "micromark-extension-mdx-jsx";
import { mdxMd } from "micromark-extension-mdx-md";
import { protectedMarkdownDiagnosticRanges } from "./markdown";

export interface MarkdownErrorLocation {
  line: number;
  column: number;
}

interface PositionedParseError {
  line?: unknown;
  column?: unknown;
  reason?: unknown;
  message?: unknown;
}

export function locateMarkdownError(
  source: string,
  message: string,
): MarkdownErrorLocation | null {
  try {
    fromMarkdown(source, { extensions: [mdxJsx(), mdxMd()] });
  } catch (caught) {
    const error = caught as PositionedParseError;
    const line = positiveInteger(error.line);
    const column = positiveInteger(error.column);
    const reason =
      typeof error.reason === "string"
        ? error.reason
        : typeof error.message === "string"
          ? error.message
          : "";
    const reportedReason = message.replace(/^Error parsing markdown:\s*/i, "");
    if (
      line &&
      column &&
      (!reason ||
        reportedReason.includes(reason) ||
        reason.includes(reportedReason))
    ) {
      return { line, column };
    }
  }

  return unexpectedMdxNameLocation(source, message) ?? explicitLocation(message);
}

export function markdownErrorSourceIdentity(source: string): string {
  return source.trim();
}

function explicitLocation(message: string): MarkdownErrorLocation | null {
  const lineAndColumn = message.match(
    /\bline\s+(\d+)\s*,?\s*column\s+(\d+)\b/i,
  );
  if (lineAndColumn) {
    return parsedLocation(lineAndColumn[1], lineAndColumn[2]);
  }

  const compact = message.match(/(?:\bat\s+|\()(\d+):(\d+)\)?(?:\s|$)/i);
  if (compact) {
    return parsedLocation(compact[1], compact[2]);
  }

  const lineOnly = message.match(/\bline\s+(\d+)\b/i);
  return lineOnly ? parsedLocation(lineOnly[1], "1") : null;
}

function parsedLocation(
  lineValue: string,
  columnValue: string,
): MarkdownErrorLocation | null {
  const line = Number.parseInt(lineValue, 10);
  const column = Number.parseInt(columnValue, 10);
  return line > 0 && column > 0 ? { line, column } : null;
}

function positiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : null;
}

function unexpectedMdxNameLocation(
  source: string,
  message: string,
): MarkdownErrorLocation | null {
  const codePointMatch = message.match(
    /Unexpected character `[^`]+` \(U\+([0-9A-F]{4,6})\) before name/i,
  );
  if (!codePointMatch) {
    return null;
  }
  const character = String.fromCodePoint(
    Number.parseInt(codePointMatch[1], 16),
  );
  const protectedRanges = protectedMarkdownDiagnosticRanges(source);
  for (let offset = 0; offset < source.length; offset += 1) {
    if (source[offset] !== "<" || isEscapedAt(source, offset)) {
      continue;
    }
    const characterOffset = source[offset + 1] === "/" ? offset + 2 : offset + 1;
    if (
      !source.startsWith(character, characterOffset) ||
      protectedRanges.some(
        ([start, end]) => characterOffset >= start && characterOffset < end,
      )
    ) {
      continue;
    }
    return offsetLocation(source, characterOffset);
  }
  return null;
}

function offsetLocation(
  source: string,
  offset: number,
): MarkdownErrorLocation {
  const lines = source.slice(0, offset).split("\n");
  return {
    line: lines.length,
    column: lines[lines.length - 1].length + 1,
  };
}

function isEscapedAt(source: string, offset: number): boolean {
  let slashCount = 0;
  for (let index = offset - 1; index >= 0 && source[index] === "\\"; index -= 1) {
    slashCount += 1;
  }
  return slashCount % 2 === 1;
}
