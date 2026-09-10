import { describe, expect, it } from "vitest";
import { vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { api } from "../lib/api";
import {
  DIAGRAM_SANDBOX_BOOTSTRAP_HASH,
  DiagramRendererHost,
  DiagramRenderCache,
  diagramSandboxDocument,
  sanitizeDiagramSvg,
} from "./diagramRenderers";

describe("diagram renderer host boundary", () => {
  it("sanitizes SVG with a static allowlist and removes active content", () => {
    const sanitized = sanitizeDiagramSvg(`
      <svg viewBox="0 0 20 20" onload="alert(1)">
        <style>@import "https://example.test/a.css"; .node { fill: red; }</style>
        <script>alert(1)</script>
        <foreignObject><div>unsafe</div></foreignObject>
        <a href="https://example.test"><text>link</text></a>
        <image href="https://example.test/a.png" />
        <use href="#outside" />
        <g class="node"><rect width="10" height="10" /><text>Safe</text></g>
      </svg>
    `);

    expect(sanitized).toContain("<svg");
    expect(sanitized).toContain("<rect");
    expect(sanitized).toContain("Safe");
    expect(sanitized).not.toMatch(
      /script|foreignObject|<a\b|<image\b|<use\b|onload|href=|@import|example\.test/i,
    );
    expect(
      sanitizeDiagramSvg(
        '<svg viewBox="0 0 10 10" style="background-image:url(//example.test/leak)"><rect width="10" height="10"/></svg>',
      ),
    ).not.toContain("example.test");
  });

  it("rejects malformed, oversized, or unexpectedly stripped SVG", () => {
    expect(() => sanitizeDiagramSvg("<div>not svg</div>")).toThrow(
      /malformed|root.*svg/i,
    );
    expect(() =>
      sanitizeDiagramSvg('<svg><path d="M0 0"/></svg>', {
        maxOutputBytes: 8,
      }),
    ).toThrow(/size limit/i);
    expect(() =>
      sanitizeDiagramSvg("<svg><script>only active content</script></svg>"),
    ).toThrow(/no renderable content/i);
  });

  it("bounds cached derived content by entry count and byte size per scope", () => {
    const cache = new DiagramRenderCache(2, 80);
    cache.set("tab-a", "one", {
      svg: "<svg><path /></svg>",
      accessibleName: "One",
      diagramType: "flowchart",
    });
    cache.set("tab-a", "two", {
      svg: "<svg><rect /></svg>",
      accessibleName: "Two",
      diagramType: "flowchart",
    });
    cache.set("tab-a", "three", {
      svg: "<svg><circle /></svg>",
      accessibleName: "Three",
      diagramType: "flowchart",
    });
    expect(cache.get("tab-a", "one")).toBeNull();
    expect(cache.get("tab-a", "three")?.accessibleName).toBe("Three");
    cache.clearScope("tab-a");
    expect(cache.size).toBe(0);
  });

  it("builds a fixed opaque no-network sandbox document", () => {
    const document = diagramSandboxDocument();
    expect(document).toContain("default-src 'none'");
    expect(document).toContain("connect-src 'none'");
    expect(document).toContain("img-src 'none'");
    expect(document).toContain(
      `script-src '${DIAGRAM_SANDBOX_BOOTSTRAP_HASH}' blob:`,
    );
    expect(document).toContain("worker-src 'none'");
    expect(document).toContain("<script type=\"module\">");
    expect(document).not.toContain("<script type=\"module\" src=");
    expect(document).not.toContain("allow-same-origin");
    expect(document).not.toContain("http:");
    expect(document).not.toContain("https:");
    const bootstrap = readFileSync(
      join(process.cwd(), "src/plugins/diagramSandboxBootstrap.js"),
      "utf8",
    );
    expect(DIAGRAM_SANDBOX_BOOTSTRAP_HASH).toBe(
      `sha256-${createHash("sha256").update(bootstrap).digest("base64")}`,
    );
    const tauriConfig = JSON.parse(
      readFileSync(join(process.cwd(), "src-tauri/tauri.conf.json"), "utf8"),
    ) as { app: { security: { csp: string } } };
    expect(tauriConfig.app.security.csp).toContain(
      `'${DIAGRAM_SANDBOX_BOOTSTRAP_HASH}'`,
    );
    expect(document).toContain(bootstrap);
    expect(bootstrap).toContain("RTCPeerConnection");
    expect(bootstrap).toContain("URL.createObjectURL");
    expect(bootstrap).toContain("URL.revokeObjectURL");
    expect(bootstrap).toContain("hash.slice(1)");
  });

  it("settles an aborted render before a delayed module read can execute", async () => {
    let finishRead: (source: string) => void = () => {};
    const read = vi.spyOn(api, "readPluginDiagramRenderer").mockImplementation(
      () =>
        new Promise((resolve) => {
          finishRead = resolve;
        }),
    );
    const fatal = vi.fn();
    const host = new DiagramRendererHost(fatal);
    const controller = new AbortController();
    const render = host.render(
      {
        pluginId: "denote.synthetic",
        id: "denote.synthetic.mermaid",
        title: "Mermaid",
        languages: ["mermaid"],
      },
      { source: "flowchart LR\nA-->B", theme: "light" },
      "tab-a",
      controller.signal,
    );
    await vi.waitFor(() => expect(read).toHaveBeenCalled());

    controller.abort();

    await expect(render).rejects.toMatchObject({ name: "AbortError" });
    expect(fatal).not.toHaveBeenCalled();
    finishRead("export async function renderDiagram() {}");
    host.dispose();
    read.mockRestore();
  });
});
