import { describe, expect, it } from "vitest";
import { sourceLanguageName } from "./sourceLanguage";

describe("source language detection", () => {
  it("detects supported programming languages from filenames", () => {
    expect(sourceLanguageName("src/app.js")).toBe("JavaScript");
    expect(sourceLanguageName("src/app.ts")).toBe("TypeScript");
    expect(sourceLanguageName("script.py")).toBe("Python");
    expect(sourceLanguageName("public/index.php")).toBe("PHP");
    expect(sourceLanguageName("src/Main.java")).toBe("Java");
    expect(sourceLanguageName("src/main.cpp")).toBe("C++");
    expect(sourceLanguageName("src/main.go")).toBe("Go");
  });

  it("leaves unsupported files as plain text", () => {
    expect(sourceLanguageName("archive.custom-binary")).toBeNull();
  });
});
