import { describe, expect, it } from "vitest";
import { buildBugReportBody, buildBugReportUrl, redactDiagnosticText } from "./bugReport";

const buildInfo = {
  version: "1.2.3",
  commitHash: "1234567890abcdef1234567890abcdef12345678",
  dirty: false,
};
const runtimeInfo = {
  operatingSystem: "macos",
  architecture: "aarch64",
  bundleType: "app",
  updateChannel: "stable",
  updaterConfigured: true,
};

describe("bug report", () => {
  it("prefills immutable build and platform metadata for review", () => {
    const body = buildBugReportBody({
      buildInfo,
      runtimeInfo,
      currentError: null,
      diagnostics: [],
    });
    expect(body).toContain("Version: 1.2.3");
    expect(body).toContain(`Source SHA: ${buildInfo.commitHash}`);
    expect(body).toContain("Operating system: macos");
    expect(body).toContain("Architecture: aarch64");
    expect(body).toContain("Current error code: NO_CURRENT_ERROR");
  });

  it("includes a stable current-error code and bounded diagnostic excerpt", () => {
    const body = buildBugReportBody({
      buildInfo,
      runtimeInfo,
      currentError: {
        id: 1,
        kind: "link",
        message: "Unable to open a private remote",
      },
      diagnostics: Array.from({ length: 12 }, (_, index) => ({
        code: `ERROR_${index}`,
        summary: "x".repeat(600),
      })),
    });
    expect(body).toContain("Current error code: EXTERNAL_LINK_ERROR");
    expect(body).not.toContain("ERROR_0");
    expect(body.length).toBeLessThan(5_500);
  });

  it("redacts paths, URLs, credentials, and token-shaped values", () => {
    const redacted = redactDiagnosticText(
      "Open /Users/example/Private/note.md and C:\\Users\\example\\vault\\note.md from https://user:password@example.test/private.git?token=secret token=abc123",
    );
    expect(redacted).not.toContain("example");
    expect(redacted).not.toContain("note.md");
    expect(redacted).not.toContain("abc123");
    expect(redacted).toContain("[redacted path]");
    expect(redacted).toContain("[redacted URL]");
  });

  it("builds a GitHub draft URL without submitting an issue", () => {
    const url = new URL(
      buildBugReportUrl({
        buildInfo,
        runtimeInfo,
        currentError: null,
        diagnostics: [],
      }),
    );
    expect(url.origin).toBe("https://github.com");
    expect(url.pathname).toBe("/mbianchidev/denote/issues/new");
    expect(url.searchParams.get("template")).toBe("bug_report.md");
    expect(url.searchParams.get("body")).toContain("NO_CURRENT_ERROR");
  });
});
