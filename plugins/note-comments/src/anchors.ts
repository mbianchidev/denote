import {
  commentAnchorMatches,
  isPluginAuthoringRequest,
  type PluginAuthoringRequest,
  type PluginAuthoringResult,
} from "@denote/plugin-sdk";

export function commentRequest(request: PluginAuthoringRequest): PluginAuthoringResult {
  if (!isPluginAuthoringRequest(request) || request.feature !== "note-comments") {
    throw new Error("Comments require a valid note of at most 4 MiB and a selection of at most 4 KiB.");
  }
  if (request.action === "anchor") {
    if (request.from === request.to) return { feature: "note-comments", action: "anchor", anchor: null };
    const quote = request.source.slice(request.from, request.to);
    let matchCount = 0;
    for (let at = request.source.indexOf(quote); at >= 0; at = request.source.indexOf(quote, at + 1)) matchCount++;
    return {
      feature: "note-comments", action: "anchor",
      anchor: {
        from: request.from, to: request.to, quote, matchCount,
        prefix: context(request.source.slice(Math.max(0, request.from - 96), request.from), true),
        suffix: context(request.source.slice(request.to, request.to + 96), false),
      },
    };
  }
  return {
    feature: "note-comments", action: "locate",
    anchors: request.anchors.map(({ id, anchor }) => {
      if (anchor === null) return { id, status: "attached", from: 0, to: 0 };
      const matches = commentAnchorMatches(request.source, anchor);
      if (matches.length === 1) return { id, status: "attached", from: matches[0], to: matches[0] + anchor.quote.length };
      return {
        id, status: request.source.includes(anchor.quote) ? "ambiguous" : "missing", from: null, to: null,
      };
    }),
  };
}

function context(value: string, before: boolean): string {
  const characters = [...value];
  return (before ? characters.slice(-24) : characters.slice(0, 24)).join("");
}
