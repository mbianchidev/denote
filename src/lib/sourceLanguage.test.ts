import { describe, expect, it } from "vitest";
import { sourceLanguageName } from "./sourceLanguage";

describe("source language detection", () => {
  it("detects supported programming languages from filenames", () => {
    expect(sourceLanguageName("src/app.js")).toBe("JavaScript");
    expect(sourceLanguageName("src/app.ts")).toBe("TypeScript");
    expect(sourceLanguageName("script.py")).toBe("Python");
  });

  it("leaves unsupported files as plain text", () => {
    expect(sourceLanguageName("archive.custom-binary")).toBeNull();
  });
});
