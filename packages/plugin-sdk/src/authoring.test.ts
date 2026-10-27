import { describe, expect, it } from "vitest";
import {
  isPluginAuthoringRequest,
  isPluginAuthoringResultFor,
  verifiedAuthoringEdit,
  type PluginAuthoringRequest,
  type PluginPresentationModel,
} from "./authoring";

describe("bounded authoring contracts", () => {
  it("accepts only bounded source requests and explicit palette values", () => {
    const request = {
      feature: "text-styling",
      action: "format",
      source: "A synthetic note.",
      from: 2,
      to: 11,
      style: "highlight",
      color: "red",
    };
    expect(isPluginAuthoringRequest(request)).toBe(true);
    expect(isPluginAuthoringRequest({ ...request, color: "url(javascript:x)" })).toBe(false);
    expect(isPluginAuthoringRequest({ ...request, to: 500 })).toBe(false);
    expect(isPluginAuthoringRequest({ ...request, restore: () => {} })).toBe(false);
    expect(isPluginAuthoringRequest({ ...request, workspacePath: "/synthetic/private-vault" })).toBe(false);
    expect(isPluginAuthoringRequest({ ...request, source: "x".repeat(4 * 1024 * 1024 + 1) })).toBe(false);
    expect(isPluginAuthoringRequest({ feature: "note-comments", action: "anchor", source: "題".repeat(2000), from: 0, to: 2000 })).toBe(false);
  });

  it("independently rejects unrelated edits and mismatched worker results", () => {
    const source = "Keep **this**.\n\nColor me.";
    const from = source.indexOf("Color me");
    const to = from + "Color me".length;
    const request: PluginAuthoringRequest = {
      feature: "text-styling", action: "format", source,
      from, to, style: "highlight", color: "red",
    };
    const result = {
      feature: "text-styling", action: "format",
      edit: { from, to, text: "=red=Color me=red=" },
    };
    expect(isPluginAuthoringResultFor(request, result)).toBe(true);
    expect(verifiedAuthoringEdit(request, result)).toBe("Keep **this**.\n\n=red=Color me=red=.");
    expect(isPluginAuthoringResultFor(request, {
      ...result, edit: { from: 0, to, text: "=red=Color me=red=" },
    })).toBe(false);
    expect(isPluginAuthoringResultFor(request, {
      ...result, edit: { from, to, text: "=red=replaced=red=" },
    })).toBe(false);
    expect(isPluginAuthoringResultFor(request, { feature: "presentation", action: "parse" })).toBe(false);
  });

  it.each(["---", "==="])("verifies exact standalone %s presentation separators independently", (delimiter) => {
    const source = `# First\n${delimiter}\n# Second`;
    const model: PluginPresentationModel = {
      bodyStart: 0,
      slides: [{ from: 0, to: 8, line: 1, title: "First" }, { from: 12, to: source.length, line: 3, title: "Second" }],
      separators: [{ from: 8, to: 12 }],
      options: {
        title: "", author: "", theme: "system", aspectRatio: "16:9", alignment: "left",
        slideNumbers: true, autoplay: false, advanceSeconds: 10, loop: false, transition: "none",
      },
      notices: [],
    };
    const result = { feature: "presentation", action: "parse", model } as const;
    expect(isPluginAuthoringResultFor({ feature: "presentation", action: "parse", source }, result)).toBe(true);
    for (const changed of [
      source.replace(delimiter, "--- "),
      source.replace(delimiter, "----"),
      source.replace(`\n${delimiter}`, `x${delimiter}`),
    ]) {
      expect(isPluginAuthoringResultFor({ feature: "presentation", action: "parse", source: changed }, result)).toBe(false);
    }
  });
});
