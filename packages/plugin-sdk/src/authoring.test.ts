import { describe, expect, it } from "vitest";
import {
  isPluginAuthoringRequest,
  isPluginAuthoringResultFor,
  verifiedAuthoringEdit,
  type PluginAuthoringRequest,
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
});
