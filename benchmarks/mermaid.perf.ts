import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { build } from "vite";
import { buildPlugin, pluginDirectories } from "../scripts/plugin-build";
import { MERMAID_COMPATIBILITY_FIXTURES } from "../plugins/mermaid/tests/fixtures";

let rendererSource = "";
let hostSource = "";
let pageErrors: string[] = [];
let unexpectedRequests: string[] = [];

test.beforeAll(async () => {
  await buildPlugin(pluginDirectories("denote.mermaid")[0]);
  rendererSource = await readFile("plugins/mermaid/dist/renderer.js", "utf8");
  const result = await build({
    configFile: false,
    logLevel: "error",
    build: {
      write: false,
      minify: true,
      lib: { entry: "src/plugins/diagramRenderers.ts", formats: ["es"] },
      rolldownOptions: { output: { codeSplitting: false } },
    },
  });
  const bundles = Array.isArray(result) ? result : [result];
  if (bundles.length !== 1 || !("output" in bundles[0])) {
    throw new Error("Expected one diagram host bundle.");
  }
  const chunk = bundles[0].output.find((output) => output.type === "chunk");
  if (!chunk || chunk.type !== "chunk") {
    throw new Error("Missing diagram host bundle.");
  }
  hostSource = chunk.code;
});

test.beforeEach(async ({ page }) => {
  pageErrors = [];
  unexpectedRequests = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const fixtureUrl = new URL("/mermaid-trial", test.info().project.use.baseURL).href;
  await page.route(/^https?:\/\//, async (route) => {
    if (route.request().url() === fixtureUrl && route.request().resourceType() === "document") {
      await route.fulfill({
        contentType: "text/html",
        body: '<!doctype html><html><head><link rel="icon" href="data:,"></head><body></body></html>',
      });
    } else {
      unexpectedRequests.push(route.request().url());
      await route.abort();
    }
  });
  await page.goto("/mermaid-trial");
});

test.afterEach(() => {
  expect(pageErrors).toEqual([]);
  expect(unexpectedRequests).toEqual([]);
});

for (const theme of ["light", "dark", "high-contrast"] as const) {
  test(`Pele renders every supported family through the opaque host in ${theme}`, async ({ page }) => {
    if (theme === "high-contrast") {
      await page.emulateMedia({ forcedColors: "active" });
    }
    const results = await page.evaluate(async ({ hostSource, rendererSource, fixtures, theme }) => {
      Object.defineProperty(window, "__TAURI_INTERNALS__", {
        value: {
          invoke: async (command: string, args: Record<string, unknown>) => {
            if (command !== "read_plugin_diagram_renderer" || args.pluginId !== "denote.mermaid") {
              throw new Error(`Unexpected diagram IPC: ${command}`);
            }
            return rendererSource;
          },
        },
        configurable: true,
      });
      const url = URL.createObjectURL(new Blob([hostSource], { type: "text/javascript" }));
      const module: typeof import("../src/plugins/diagramRenderers") = await import(url);
      URL.revokeObjectURL(url);
      const failures: string[] = [];
      const host = new module.DiagramRendererHost((_id, error) => failures.push(error.message));
      const renderer = {
        pluginId: "denote.mermaid",
        id: "denote.mermaid.renderer",
        title: "Mermaid diagrams",
        languages: ["mermaid"],
      };
      const rows = [];
      try {
        for (const [name, source] of fixtures) {
          const result = await host.render(renderer, { source, theme }, "synthetic-diagrams", new AbortController().signal);
          if (result.status !== "success") {
            throw new Error(`${name}: ${result.error.message}`);
          }
          const parsed = new DOMParser().parseFromString(result.svg, "image/svg+xml");
          const attributes = [...parsed.querySelectorAll("*")]
            .flatMap((element) => [...element.attributes].map((attribute) => attribute.value));
          const references = attributes
            .map((value) => /^url\(#([-A-Za-z0-9_.:]+)\)$/.exec(value)?.[1])
            .filter((value) => value !== undefined);
          const image = new Image();
          image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(result.svg)}`;
          await image.decode();
          const canvas = document.createElement("canvas");
          canvas.width = canvas.height = 1;
          const context = canvas.getContext("2d");
          if (!context) throw new Error("SVG export canvas is unavailable.");
          context.drawImage(image, 0, 0);
          rows.push({
            name,
            svg: result.svg,
            accessibleName: result.accessibleName,
            backgroundPixel: [...context.getImageData(0, 0, 1, 1).data],
            width: image.naturalWidth,
            height: image.naturalHeight,
            referencesIntact: references.every((id) => parsed.getElementById(id) !== null),
            stops: [...parsed.querySelectorAll("stop")].map((stop) => stop.getAttribute("stop-color")),
            sliceColors: [...parsed.querySelectorAll("path")].map((path) => path.getAttribute("fill"))
              .filter((fill): fill is string => fill !== null && fill !== "none"),
            percentageColors: [...parsed.querySelectorAll("text")]
              .filter((text) => text.textContent?.includes("%"))
              .map((text) => text.getAttribute("fill")),
          });
          if (name === "flowchart" || name === "Sankey" || name === "pie") {
            const figure = document.createElement("figure");
            const caption = document.createElement("figcaption");
            caption.textContent = `${name} (${theme})`;
            figure.append(caption, image);
            document.body.append(figure);
          }
        }
        const flow = fixtures.find(([name]) => name === "flowchart");
        if (!flow) throw new Error("Missing flowchart fixture.");
        const nodes = (prefix: string) => Array.from({ length: 18 }, (_, index) => `${prefix}${index}`).join(" & ");
        const edgeLimit = await host.render(renderer, {
          source: `flowchart LR\n${nodes("A")} --> ${nodes("B")}`,
          theme,
        }, "synthetic-diagrams", new AbortController().signal);
        host.releaseScope("synthetic-diagrams");
        const controller = new AbortController();
        const pending = host.render(renderer, { source: flow[1], theme }, "cancelled-diagram", controller.signal);
        controller.abort();
        let cancelled = false;
        try {
          await pending;
        } catch (error) {
          if (!(error instanceof Error) || error.name !== "AbortError") throw error;
          cancelled = true;
        }
        return { rows, failures, cancelled, edgeLimit };
      } finally {
        host.dispose();
      }
    }, { hostSource, rendererSource, fixtures: MERMAID_COMPATIBILITY_FIXTURES, theme });

    expect(results.failures).toEqual([]);
    expect(results.cancelled).toBe(true);
    expect(results.edgeLimit).toMatchObject({
      status: "error",
      error: { code: "SOURCE_LIMIT" },
    });
    await expect(page.locator("iframe")).toHaveCount(0);
    expect(results.rows).toHaveLength(MERMAID_COMPATIBILITY_FIXTURES.length);
    for (const result of results.rows) {
      expect(result.width, result.name).toBeGreaterThan(0);
      expect(result.height, result.name).toBeGreaterThan(0);
      expect(result.referencesIntact, result.name).toBe(true);
      expect(result.backgroundPixel[3], result.name).toBe(255);
      if (theme !== "high-contrast") {
        expect(result.backgroundPixel, result.name).toEqual(
          theme === "dark" ? [23, 25, 29, 255] : [255, 255, 255, 255],
        );
      }
      expect(result.svg, result.name).not.toMatch(
        /var\(|\b(?:style|class)=|<style\b|<script\b|<foreignObject\b|<image\b|<use\b|<a\b|\b(?:NaN|Infinity)\b/i,
      );
    }
    const flowchart = results.rows.find((row) => row.name === "flowchart");
    expect(flowchart?.svg).toContain(
      theme === "dark" ? "rgb(43, 49, 57)" : theme === "light" ? "rgb(244, 241, 232)" : "rgb(",
    );
    const sankey = results.rows.find((row) => row.name === "Sankey");
    expect(sankey?.stops).toHaveLength(2);
    expect(sankey?.stops.every((stop) => stop?.startsWith("rgb("))).toBe(true);
    expect(results.rows.find((row) => row.name === "literal math")?.svg)
      .toContain("$$\\frac{x}{y}$$");
    expect(results.rows.find((row) => row.name === "safe frontmatter")?.accessibleName)
      .toBe("Build flow");
    for (const [name, count] of [["pie", 2], ["chart palette", 8]] as const) {
      const pie = results.rows.find((row) => row.name === name);
      expect(pie?.percentageColors).toHaveLength(count);
      if (!pie) throw new Error(`Missing ${name} fixture.`);
      for (const foreground of pie.percentageColors) {
        for (const background of pie.sliceColors) {
          expect(contrast(foreground, background)).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });
}

function contrast(foreground: string | null, background: string): number {
  const luminance = (color: string | null): number => {
    const channels = color?.match(/^rgb\((\d+), (\d+), (\d+)\)$/)?.slice(1).map(Number);
    if (!channels) throw new Error(`Expected a resolved SVG color: ${color}`);
    return channels.reduce((sum, channel, index) => {
      const value = channel / 255;
      return sum + (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
        * [0.2126, 0.7152, 0.0722][index];
    }, 0);
  };
  const values = [luminance(foreground), luminance(background)].sort((a, b) => a - b);
  return (values[1] + 0.05) / (values[0] + 0.05);
}
