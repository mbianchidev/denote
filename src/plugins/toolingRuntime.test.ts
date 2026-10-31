import { describe, expect, it } from "vitest";
import { isPluginHostMessage, isPluginRuntimeMessage } from "./runtimeMessages";

describe("tooling worker protocol", () => {
  it("accepts bounded declarative registrations and run-bound parse messages only", () => {
    expect(isPluginRuntimeMessage({
      type: "register-tool", id: "denote.example.tools", title: "Example", kind: "linter", formats: ["unix"],
    })).toBe(true);
    expect(isPluginRuntimeMessage({
      type: "register-tool", id: "denote.example.terminal", title: "Terminal", kind: "terminal", formats: ["unix"],
    })).toBe(false);
    const request = {
      runId: "run-example", scope: { projectId: null, rootPath: "" }, format: "unix",
      stdout: "", stderr: "", documents: [{ path: "example.ts", version: "version-example" }],
    };
    expect(isPluginHostMessage({
      type: "parse-tool-output", providerId: "denote.example.tools", requestId: "request-example", request,
    })).toBe(true);
    expect(isPluginHostMessage({
      type: "parse-tool-output", providerId: "denote.example.tools", requestId: "request-example",
      request: { ...request, documents: [{ path: "../outside.ts", version: "version-example" }] },
    })).toBe(false);
    expect(isPluginRuntimeMessage({
      type: "tool-parse-result", requestId: "request-example", result: { runId: "run-example", diagnostics: [], notices: [] },
    })).toBe(true);
  });
});
