import { fromMarkdown } from "mdast-util-from-markdown";
import { mdxJsx } from "micromark-extension-mdx-jsx";
import { mdxMd } from "micromark-extension-mdx-md";

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

  return explicitLocation(message);
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
