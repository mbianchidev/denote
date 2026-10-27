import {
  isPluginAuthoringRequest,
  textStyleDelimiter,
  type PluginAuthoringRequest,
  type PluginAuthoringResult,
  type PluginAuthoringColor,
  type PluginTextStyle,
} from "@denote/plugin-sdk";
import { fromMarkdown } from "mdast-util-from-markdown";
import type { Nodes } from "mdast";

export function styleRequest(request: PluginAuthoringRequest): PluginAuthoringResult {
  if (!isPluginAuthoringRequest(request) || request.feature !== "text-styling") {
    throw new Error("Text styling requires a valid Markdown request of at most 4 MiB.");
  }
  const spans: PluginTextStyle[] = [];
  const prose: Array<{ from: number; to: number }> = [];
  const frontmatter = /^---(?:\r\n|\n|\r)[\s\S]*?^---(?:\r\n|\n|\r|$)/m.exec(request.source);
  const masked = frontmatter?.index === 0
    ? frontmatter[0].replace(/[^\r\n]/g, " ") + request.source.slice(frontmatter[0].length) : request.source;
  const visit = (node: Nodes) => {
    if (node.type === "text") {
      const from = node.position?.start.offset;
      const to = node.position?.end.offset;
      if (from === undefined || to === undefined) return;
      prose.push({ from, to });
      const raw = request.source.slice(from, to);
      for (const match of raw.matchAll(/=(yellow|red|green|blue|purple)(:text)?=([^\r\n]+?)=\1\2=/g)) {
        const offset = match.index;
        const escapes = /\\*$/.exec(raw.slice(0, offset))?.[0].length ?? 0;
        if (escapes % 2 || new TextEncoder().encode(match[3]).length > 4096 ||
            /=(?:yellow|red|green|blue|purple)(?::text)?=/.test(match[3])) continue;
        spans.push({
          from: from + offset, to: from + offset + match[0].length,
          text: match[3], color: match[1] as PluginAuthoringColor, style: match[2] ? "color" : "highlight",
        });
      }
    } else if ("children" in node) node.children.forEach(visit);
  };
  visit(fromMarkdown(masked));
  if (request.action === "parse") {
    return {
      feature: "text-styling", action: "parse", spans: spans.slice(0, 2000),
      notices: spans.length > 2000 ? ["Only the first 2,000 text styles are shown. All source remains unchanged."] : [],
    };
  }
  const selected = request.source.slice(request.from, request.to);
  if (request.style === "clear") {
    const span = spans.find((span) => span.from === request.from && span.to === request.to);
    if (!span) throw new Error("Select the complete text-style extension to clear it, or use its excerpt action.");
    return { feature: "text-styling", action: "format", edit: { from: request.from, to: request.to, text: span.text } };
  }
  if (!selected.trim() || /[\r\n]/.test(selected) || new TextEncoder().encode(selected).length > 4096 ||
      !prose.some((range) => request.from >= range.from && request.to <= range.to) ||
      spans.some((span) => request.from < span.to && request.to > span.from) ||
      /=(?:yellow|red|green|blue|purple)(?::text)?=/.test(selected)) {
    throw new Error("Select up to 4 KiB of plain text on one line, outside code, frontmatter, and existing styles.");
  }
  const delimiter = textStyleDelimiter(request.style, request.color);
  return {
    feature: "text-styling", action: "format",
    edit: { from: request.from, to: request.to, text: delimiter + selected + delimiter },
  };
}
