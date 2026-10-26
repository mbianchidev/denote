import { describe, expect, it } from "vitest";
import { isPluginAuthoringResultFor, type PluginCommentAnchor } from "@denote/plugin-sdk";
import { commentRequest } from "../src/anchors";

function anchor(source: string, quote: string): PluginCommentAnchor {
  const from = source.indexOf(quote);
  const result = commentRequest({ feature: "note-comments", action: "anchor", source, from, to: from + quote.length });
  if (result.feature !== "note-comments" || result.action !== "anchor" || !result.anchor) throw new Error("Expected range anchor");
  return result.anchor;
}

describe("source-anchored comments", () => {
  it("reanchors an exact unique quote after nearby edits without touching Markdown", () => {
    const original = "# Invented note\n\nA unique phrase to discuss.\n";
    const saved = anchor(original, "unique phrase");
    const source = "A new introduction.\n\n" + original;
    const request = { feature: "note-comments", action: "locate", source, anchors: [{ id: "comment-1", anchor: saved }] } as const;
    const result = commentRequest({ ...request, anchors: [...request.anchors] });
    expect(isPluginAuthoringResultFor({ ...request, anchors: [...request.anchors] }, result)).toBe(true);
    expect(result).toMatchObject({
      anchors: [{ id: "comment-1", status: "attached", from: source.indexOf("unique phrase") }],
    });
  });

  it("never silently attaches a newly duplicated or deleted quote", () => {
    const saved = anchor("A unique phrase.", "unique phrase");
    for (const [source, status] of [["unique phrase. Another unique phrase.", "ambiguous"], ["A replacement sentence.", "missing"]]) {
      expect(commentRequest({
        feature: "note-comments", action: "locate", source,
        anchors: [{ id: "comment-1", anchor: saved }],
      })).toMatchObject({ anchors: [{ status, from: null, to: null }] });
    }
  });

  it("uses exact surrounding context for unchanged duplicates, and refuses indistinguishable copies", () => {
    const source = "First paragraph: repeated.\n\nSecond paragraph: repeated.";
    const saved = anchor(source, "repeated");
    expect(commentRequest({
      feature: "note-comments", action: "locate", source: "Intro.\n" + source,
      anchors: [{ id: "comment-1", anchor: saved }],
    })).toMatchObject({ anchors: [{ status: "attached" }] });
    const repeated = "x".repeat(120);
    const ambiguous = anchor(repeated + "quote" + repeated + "quote" + repeated, "quote");
    expect(commentRequest({
      feature: "note-comments", action: "locate",
      source: repeated + "quote" + repeated + "quote" + repeated,
      anchors: [{ id: "comment-1", anchor: ambiguous }],
    })).toMatchObject({ anchors: [{ status: "ambiguous" }] });
  });

  it("keeps whole-note comments independent of text and supports Unicode ranges", () => {
    expect(commentRequest({ feature: "note-comments", action: "anchor", source: "", from: 0, to: 0 }))
      .toMatchObject({ anchor: null });
    const source = "A synthetic 日本語 🌿 example.";
    const saved = anchor(source, "日本語 🌿");
    expect(commentRequest({
      feature: "note-comments", action: "locate", source,
      anchors: [{ id: "range", anchor: saved }, { id: "note", anchor: null }],
    })).toMatchObject({ anchors: [{ status: "attached" }, { status: "attached", from: 0, to: 0 }] });
  });
});
