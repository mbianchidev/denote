import { describe, expect, it } from "vitest";
import { isPluginAuthoringResultFor, verifiedAuthoringEdit } from "@denote/plugin-sdk";
import { styleRequest } from "../src/styling";

describe("portable text styles", () => {
  it("indexes prose excerpts but not frontmatter, code, escaped markers, or unsupported colors", () => {
    const source = [
      "---", "title: '=red=metadata=red='", "---", "",
      "=red=Visible excerpt=red= and =blue:text=blue words=blue:text=.",
      "`=green=inline=green=`", "```md", "=yellow=fenced=yellow=", "```",
      "    =purple=indented=purple=", "\\=red=literal=red=", "=orange=unknown=orange=",
    ].join("\n");
    const request = { feature: "text-styling", action: "parse", source } as const;
    const result = styleRequest(request);
    expect(isPluginAuthoringResultFor(request, result)).toBe(true);
    expect(result).toMatchObject({
      spans: [
        { text: "Visible excerpt", style: "highlight", color: "red" },
        { text: "blue words", style: "color", color: "blue" },
      ],
    });
  });

  it("wraps only an explicit selection and clears the complete extension without reserializing Markdown", () => {
    const source = "---\r\ntitle: untouched\r\n---\r\n\r\n## Keep   \r\n\r\nA selected phrase.  \r\n";
    const from = source.indexOf("selected phrase");
    const request = {
      feature: "text-styling", action: "format", source, from, to: from + 15,
      style: "highlight", color: "red",
    } as const;
    const styled = verifiedAuthoringEdit(request, styleRequest(request));
    expect(styled).toBe(source.replace("selected phrase", "=red=selected phrase=red="));
    const clear = {
      ...request, source: styled, to: from + "=red=selected phrase=red=".length, style: "clear",
    } as const;
    expect(verifiedAuthoringEdit(clear, styleRequest(clear))).toBe(source);
  });

  it("refuses formatting code, frontmatter, multiline text, or nested styles", () => {
    for (const source of ["`code`", "---\ntitle: data\n---", "line\nline", "=red=already styled=red="]) {
      const request = {
        feature: "text-styling", action: "format", source, from: 0, to: source.length,
        style: "color", color: "blue",
      } as const;
      expect(() => styleRequest(request)).toThrow();
    }
  });
});
