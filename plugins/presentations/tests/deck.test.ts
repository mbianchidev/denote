import { describe, expect, it } from "vitest";
import { isPluginAuthoringResultFor, verifiedAuthoringEdit } from "@denote/plugin-sdk";
import { presentationRequest } from "../src/deck";

describe("Markdown presentation decks", () => {
  it("keeps separators standalone when moving a final slide or final empty slide without a trailing newline", () => {
    for (const source of ["# First\n\n===\n# Last", "# First\r\n===\r\n==="]) {
      const initial = presentationRequest({ feature: "presentation", action: "parse", source });
      if (initial.feature !== "presentation" || initial.action !== "parse") throw new Error("Expected deck");
      const request = { feature: "presentation", action: "reorder", source, order: initial.model.slides.map((_, index) => index).reverse() } as const;
      const changed = verifiedAuthoringEdit(request, presentationRequest(request));
      const result = presentationRequest({ feature: "presentation", action: "parse", source: changed });
      if (result.feature !== "presentation" || result.action !== "parse") throw new Error("Expected deck");
      expect(result.model.slides).toHaveLength(initial.model.slides.length);
      expect(changed).toContain("# First");
      if (source.includes("# Last")) expect(changed).toContain("# Last\n===");
    }
  });

  it("accepts empty frontmatter and bounds Unicode titles without hiding the deck", () => {
    const source = "---\n---\n# " + "題".repeat(100);
    const request = { feature: "presentation", action: "parse", source } as const;
    const result = presentationRequest(request);
    expect(isPluginAuthoringResultFor(request, result)).toBe(true);
    expect(result).toMatchObject({ model: { bodyStart: 8, notices: [] } });
  });

  it("splits only standalone separators outside frontmatter and fences and retains empty slides", () => {
    const source = "---\ntitle: Synthetic deck\ncustom: keep\n---\n# One\n\n===\n\n```md\n===\n```\n\n===\n===\n# Four";
    const request = { feature: "presentation", action: "parse", source } as const;
    const result = presentationRequest(request);
    expect(isPluginAuthoringResultFor(request, result)).toBe(true);
    expect(result).toMatchObject({
      model: { slides: [{ title: "One" }, { title: "Slide 2" }, { title: "Slide 3" }, { title: "Four" }] },
    });
    if (result.feature !== "presentation" || result.action !== "parse") throw new Error("Expected deck");
    expect(result.model.notices.join(" ")).toMatch(/Slide 3 is empty/);
    expect(source.slice(result.model.bodyStart)).toMatch(/^# One/);
  });

  it("validates frontmatter values independently and preserves unknown fields on reordering", () => {
    const source = [
      "---", "title: Synthetic deck", "author: Example team", "custom: {keep: true}", "presentation:",
      "  theme: dark", '  aspect-ratio: "4:3"', "  alignment: center", "  autoplay: true",
      "  advance-seconds: 0", "  loop: yes", "  transition: unsafe", "---", "# One", "", "===", "", "# Two", "",
    ].join("\r\n");
    const parsed = presentationRequest({ feature: "presentation", action: "parse", source });
    expect(parsed).toMatchObject({
      model: { options: { theme: "dark", aspectRatio: "4:3", alignment: "center", advanceSeconds: 10, loop: false, transition: "none" } },
    });
    if (parsed.feature !== "presentation" || parsed.action !== "parse") throw new Error("Expected deck");
    expect(parsed.model.notices).toHaveLength(3);
    const request = { feature: "presentation", action: "reorder", source, order: [1, 0] } as const;
    const mutable = { ...request, order: [...request.order] };
    const changed = verifiedAuthoringEdit(mutable, presentationRequest(mutable));
    expect(changed.slice(0, parsed.model.bodyStart)).toBe(source.slice(0, parsed.model.bodyStart));
    expect(changed.indexOf("# Two")).toBeLessThan(changed.indexOf("# One"));
    expect(changed).not.toMatch(/(?<!\r)\n/);
  });

  it("reports malformed, duplicate, aliased, or unclosed metadata without executing it", () => {
    for (const metadata of ["title: [", "title: One\ntitle: Two", "title: &x [*x]", "presentation: !!js/function evil"]) {
      const result = presentationRequest({ feature: "presentation", action: "parse", source: `---\n${metadata}\n---\n# Content` });
      expect(result).toMatchObject({ model: { options: { advanceSeconds: 10, autoplay: false } } });
      if (result.feature !== "presentation" || result.action !== "parse") throw new Error("Expected deck");
      expect(result.model.notices.length).toBeGreaterThan(0);
    }
    expect(presentationRequest({ feature: "presentation", action: "parse", source: "---\ntitle: unclosed\n# Content" }))
      .toMatchObject({ model: { notices: [expect.stringMatching(/close|closing/i)] } });
  });
});
