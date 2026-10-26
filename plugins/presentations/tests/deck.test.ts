import { describe, expect, it } from "vitest";
import { isPluginAuthoringResultFor, verifiedAuthoringEdit, type PluginAuthoringRequest } from "@denote/plugin-sdk";
import { presentationRequest } from "../src/deck";

describe("Markdown presentation decks", () => {
  it("supports Markdown slides separated by standalone dash lines without frontmatter", () => {
    const source = [
      "# Presentations using Slides", "",
      "A demo on how to build presentations using Slides.", "", "---", "",
      "## Formatting", "",
      "You can use regular Markdown formatting, like *emphasised* and **bold** text.", "", "---", "",
      "## Slides", "", "Use `---` to separate slides.", "",
    ].join("\n");
    const request = { feature: "presentation", action: "parse", source } as const;
    const result = presentationRequest(request);
    expect(result).toMatchObject({
      model: {
        bodyStart: 0,
        slides: [{ title: "Presentations using Slides" }, { title: "Formatting" }, { title: "Slides" }],
        notices: [],
      },
    });
    expect(isPluginAuthoringResultFor(request, result)).toBe(true);
    if (result.feature !== "presentation" || result.action !== "parse") throw new Error("Expected deck");
    expect(result.model.slides.map((slide) => source.slice(slide.from, slide.to))).toEqual(source.split("---\n"));
  });

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

  it.each(["\n", "\r\n", "\r"])("preserves frontmatter, fenced separators, and mixed delimiter bytes with %j endings", (newline) => {
    const source = [
      "---", "title: Synthetic deck", "custom: keep", "---", "# First", "",
      "```markdown", "---", "===", "```", "", "---", "", "# Second", "",
      "~~~", "---", "===", "~~~", "", "===", "", "# Third", "",
    ].join(newline);
    const parsed = presentationRequest({ feature: "presentation", action: "parse", source });
    if (parsed.feature !== "presentation" || parsed.action !== "parse") throw new Error("Expected deck");
    expect(parsed.model.slides).toHaveLength(3);
    const slices = parsed.model.slides.map((slide) => source.slice(slide.from, slide.to));
    const request = { feature: "presentation", action: "reorder", source, order: [2, 0, 1] } satisfies PluginAuthoringRequest;
    const changed = verifiedAuthoringEdit(request, presentationRequest(request));
    const result = presentationRequest({ feature: "presentation", action: "parse", source: changed });
    if (result.feature !== "presentation" || result.action !== "parse") throw new Error("Expected deck");
    expect(isPluginAuthoringResultFor({ feature: "presentation", action: "parse", source: changed }, result)).toBe(true);
    expect(changed.slice(0, result.model.bodyStart)).toBe(source.slice(0, parsed.model.bodyStart));
    expect(result.model.slides.map((slide) => changed.slice(slide.from, slide.to))).toEqual([slices[2], slices[0], slices[1]]);
    expect(result.model.separators.map((separator) => changed.slice(separator.from, separator.to))).toEqual([
      `---${newline}`, `===${newline}`,
    ]);
  });

  it.each(["\n", "\r\n", "\r"])("does not turn a moved empty first slide into YAML frontmatter with %j endings", (newline) => {
    const source = ["# First", "", "---", "# Last", "---"].join(newline);
    const request = { feature: "presentation", action: "reorder", source, order: [2, 0, 1] } satisfies PluginAuthoringRequest;
    const changed = verifiedAuthoringEdit(request, presentationRequest(request));
    const result = presentationRequest({ feature: "presentation", action: "parse", source: changed });
    expect(result).toMatchObject({
      model: { bodyStart: 0, slides: [{ title: "Slide 1" }, { title: "First" }, { title: "Last" }] },
    });
    expect(changed).toBe(["", "---", "# First", "", "---", "# Last", ""].join(newline));
  });

  it("does not split inline, escaped, indented, or non-exact dash lines", () => {
    const source = ["# Example", "", "Use `---` here.", "\\---", " ---", "--- ", "----", "", "# Still one slide"].join("\n");
    expect(presentationRequest({ feature: "presentation", action: "parse", source }))
      .toMatchObject({ model: { bodyStart: 0, slides: [{ from: 0, to: source.length, title: "Example" }], notices: [] } });
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
      .toMatchObject({ model: { slides: [{ from: 0, title: "Content" }], notices: [expect.stringMatching(/close|closing/i)] } });
  });
});
