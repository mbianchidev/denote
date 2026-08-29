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
  const explicit = explicitLocation(message);
  if (explicit) {
    return explicit;
  }

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

  return null;
}

function explicitLocation(message: string): MarkdownErrorLocation | null {
  const lineAndColumn =
    message.match(/\bline\s+(\d+)\s*,?\s*column\s+(\d+)\b/i) ??
    message.match(/\((\d+):(\d+)\)\s*$/);
  if (!lineAndColumn) {
    return null;
  }
  const line = Number.parseInt(lineAndColumn[1], 10);
  const column = Number.parseInt(lineAndColumn[2], 10);
  return line > 0 && column > 0 ? { line, column } : null;
}

function positiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : null;
}
