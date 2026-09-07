import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(
  join(process.cwd(), ".github", "workflows", "release.yml"),
  "utf8",
).replace(/\r\n?/g, "\n");

describe("release workflow", () => {
  it("allows updater signing only when updater releases are enabled", () => {
    expect(workflow).toContain(
      "${{ needs.validate.outputs.updater_enabled != 'true' && '--no-sign' || '' }}",
    );
    expect(workflow).toContain(
      "${{ needs.validate.outputs.updater_enabled == 'true' && '--config src-tauri/tauri.workflow.release.conf.json' || '' }}",
    );
    expect(workflow).toContain(
      "node .release-workflow-tools/scripts/updater-release.mjs configure",
    );
    expect(workflow).not.toContain(
      "--target ${{ matrix.target }} --no-sign",
    );
  });

  it("prepares updater config with workflow tools before building tagged source", () => {
    const buildStart = workflow.indexOf("\n  build:\n");
    const publishStart = workflow.indexOf("\n  publish:\n");
    const buildJob = workflow.slice(buildStart, publishStart);
    const toolsCheckout = buildJob.indexOf(
      "- name: Check out release workflow tools",
    );
    const prepareConfig = buildJob.indexOf(
      "- name: Prepare updater signing configuration",
    );
    const buildBundles = buildJob.indexOf("- name: Build bundles");

    expect(buildStart).toBeGreaterThan(-1);
    expect(toolsCheckout).toBeGreaterThan(-1);
    expect(prepareConfig).toBeGreaterThan(toolsCheckout);
    expect(buildBundles).toBeGreaterThan(prepareConfig);
    expect(
      buildJob.match(/- name: Check out release workflow tools/g),
    ).toHaveLength(1);
  });

  it.each([
    ["LF", "\n"],
    ["CRLF", "\r\n"],
  ])(
    "checks out the release source before downloading publish artifacts with %s line endings",
    (_name, lineEnding) => {
      const source = workflow
        .replaceAll("\n", lineEnding)
        .replace(/\r\n?/g, "\n");
      const publishStart = source.indexOf("\n  publish:\n");
      const publishJob = source.slice(publishStart);
      const checkout = publishJob.indexOf("- name: Check out release source");
      const platformDownload = publishJob.indexOf(
        "- name: Download platform bundles",
      );
      const sourceStaging = publishJob.indexOf(
        "- name: Stage corresponding Git source and legal notices",
      );

      expect(publishStart).toBeGreaterThan(-1);
      expect(checkout).toBeGreaterThan(-1);
      expect(platformDownload).toBeGreaterThan(checkout);
      expect(sourceStaging).toBeGreaterThan(platformDownload);
    },
  );
});
