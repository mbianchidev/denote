import { describe, expect, it } from "vitest";
import {
  codeDocumentUri,
  isPluginCodeRequest,
  isPluginCodeResult,
  isPluginCodeRegistration,
} from "./codeIntelligence";

describe("code intelligence contract", () => {
  it("accepts a versioned source request without exposing a filesystem root", () => {
    expect(isPluginCodeRequest({
      operation: "definition",
      language: "rust",
      scope: { projectId: "project-example", rootPath: "sample" },
      document: {
        path: "sample/src/main.rs",
        language: "rust",
        version: 2,
        text: "fn main() {}\n",
      },
      position: { line: 0, character: 3 },
    })).toBe(true);
    expect(codeDocumentUri("sample/space name/日本.rs"))
      .toBe("denote://vault/sample/space%20name/%E6%97%A5%E6%9C%AC.rs");
  });

  it("rejects stale, escaping, oversized and malformed protocol data", () => {
    const request = {
      operation: "definition", language: "rust",
      scope: { projectId: null, rootPath: "sample" },
      document: { path: "sample/main.rs", language: "rust", version: 1, text: "" },
      position: { line: 0, character: 0 },
    };
    for (const path of ["../secret.rs", "/absolute.rs", "other/main.rs", "sample/.denote/state", "sample\\main.rs"]) {
      expect(isPluginCodeRequest({ ...request, document: { ...request.document, path } })).toBe(false);
    }
    expect(isPluginCodeRequest({ ...request, document: { ...request.document, version: -1 } })).toBe(false);
    expect(isPluginCodeRequest({ ...request, position: { line: NaN, character: 0 } })).toBe(false);
    expect(isPluginCodeRequest({ ...request, document: { ...request.document, text: "a".repeat(4 * 1024 * 1024 + 1) } })).toBe(false);
    expect(isPluginCodeRequest({ ...request, operation: "debug" })).toBe(false);
    expect(isPluginCodeRequest({ ...request, operation: "definition", document: undefined })).toBe(false);
    expect(isPluginCodeResult({
      status: "Ready", locations: [{ path: "../outside.rs", range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } } }],
    })).toBe(false);
    expect(isPluginCodeResult({ status: "Ready", locations: Array.from({ length: 501 }, () => ({})) })).toBe(false);
    expect(isPluginCodeResult({ status: "Ready", hover: "<script>literal text</script>" })).toBe(true);
    expect(isPluginCodeRegistration({
      id: "denote.example.code", title: "Code intelligence",
      languages: [{ id: "rust", title: "Rust", server: "rust-analyzer", debugger: "CodeLLDB", setup: "Install rust-analyzer and choose its executable." }],
    })).toBe(true);
    expect(isPluginCodeRegistration({ id: "denote.example.code", title: "Code", languages: [] })).toBe(false);
  });
});
