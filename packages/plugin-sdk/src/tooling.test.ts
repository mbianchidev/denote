import { describe, expect, it } from "vitest";
import { parseToolDiagnostics, isToolParseResultFor } from "./tooling";

describe("shared external-tool diagnostics", () => {
  it("binds parsed locations to the captured project, document version and run", () => {
    const request = {
      runId: "run-example",
      scope: { projectId: "project-example", rootPath: "sample" },
      format: "unix" as const,
      stdout: "src/example.ts:3:7: warning: unused name [unused]\n",
      stderr: "",
      documents: [{ path: "sample/src/example.ts", version: "version-example" }],
    };
    const result = parseToolDiagnostics(request);
    expect(result.diagnostics).toEqual([{
      path: "sample/src/example.ts", version: "version-example",
      range: { start: { line: 2, character: 6 }, end: { line: 2, character: 6 } },
      severity: "warning", message: "unused name", rule: "unused",
    }]);
    expect(isToolParseResultFor(request, result)).toBe(true);
    expect(isToolParseResultFor({ ...request, runId: "another-run" }, result)).toBe(false);
    expect(isToolParseResultFor(request, {
      ...result, diagnostics: [{ ...result.diagnostics[0], path: "outside/example.ts" }],
    })).toBe(false);
  });

  it("parses ESLint fixes as proposals without changing source", () => {
    const request = {
      runId: "lint-example", scope: { projectId: null, rootPath: "" },
      format: "eslint-json" as const, stderr: "",
      stdout: JSON.stringify([{ filePath: "example.js", messages: [{
        line: 1, column: 7, severity: 2, ruleId: "quotes", message: "Use single quotes.",
        fix: { range: [6, 12], text: "'demo'" },
      }] }]),
      documents: [{ path: "example.js", version: "source-example" }],
    };
    expect(parseToolDiagnostics(request).diagnostics[0]).toMatchObject({
      path: "example.js", rule: "quotes", severity: "error",
      fix: { from: 6, to: 12, text: "'demo'" },
    });
    expect(() => parseToolDiagnostics({ ...request, stdout: "not JSON" })).toThrow(/JSON/);
  });

  it("parses compiler formats through the shared contract", () => {
    const request = {
      runId: "build-example", scope: { projectId: "project-example", rootPath: "project" },
      format: "msvc" as const, stdout: "src/example.cpp(4,2): error C1000: Invalid expression.\n",
      stderr: "", documents: [{ path: "project/src/example.cpp", version: "cpp-example" }],
    };
    expect(parseToolDiagnostics(request).diagnostics[0]).toMatchObject({
      path: "project/src/example.cpp", rule: "C1000", range: { start: { line: 3, character: 1 } },
    });
    const cargo = { ...request, format: "cargo-json" as const,
      documents: [{ path: "project/src/example.rs", version: "rust-example" }],
      stdout: JSON.stringify({ reason: "compiler-message", message: {
        level: "error", message: "Unknown name.", code: { code: "E0001" },
        spans: [{ file_name: "src/example.rs", line_start: 2, column_start: 3, is_primary: true }],
      } }),
    };
    expect(parseToolDiagnostics(cargo).diagnostics[0]).toMatchObject({
      path: "project/src/example.rs", rule: "E0001", message: "Unknown name.",
    });
  });

  it("reports excluded paths and rejects malformed fixes and unbound versions", () => {
    const request = {
      runId: "run-example", scope: { projectId: null, rootPath: "" },
      format: "unix" as const, stdout: "../outside.ts:1:1: error: Outside.\n",
      stderr: "", documents: [{ path: "example.ts", version: "current-example" }],
    };
    expect(parseToolDiagnostics(request)).toMatchObject({ diagnostics: [], notices: [expect.stringContaining("omitted")] });
    const result = parseToolDiagnostics({ ...request, stdout: "example.ts:1:1: error: Example." });
    expect(isToolParseResultFor(request, { ...result, diagnostics: [{
      ...result.diagnostics[0], version: "old-example",
    }] })).toBe(false);
    expect(isToolParseResultFor(request, { ...result, diagnostics: [{
      ...result.diagnostics[0], fix: { from: 10, to: 2, text: "" },
    }] })).toBe(false);
  });
});
