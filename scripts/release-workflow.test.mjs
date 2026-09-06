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
      "${{ needs.validate.outputs.updater_enabled == 'true' && '--config src-tauri/tauri.release.conf.json' || '' }}",
    );
    expect(workflow).not.toContain(
      "--target ${{ matrix.target }} --no-sign",
    );
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
