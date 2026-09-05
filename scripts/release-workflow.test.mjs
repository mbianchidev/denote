import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(
  join(process.cwd(), ".github", "workflows", "release.yml"),
  "utf8",
);

describe("release workflow", () => {
  it("checks out the release source before downloading publish artifacts", () => {
    const publishStart = workflow.indexOf("\n  publish:\n");
    const publishJob = workflow.slice(publishStart);
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
  });
});
