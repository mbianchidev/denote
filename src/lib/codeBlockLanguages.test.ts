import { languages } from "@codemirror/language-data";
import { describe, expect, it } from "vitest";
import { CODE_BLOCK_LANGUAGES } from "./codeBlockLanguages";

describe("rich code-block languages", () => {
  it("loads every configured syntax from the CodeMirror catalog", () => {
    for (const language of Object.keys(CODE_BLOCK_LANGUAGES).filter(
      (value) => value !== "text",
    )) {
      expect(
        languages.some(
          (entry) =>
            entry.name === language ||
            entry.alias.includes(language) ||
            entry.extensions.includes(language),
        ),
        language,
      ).toBe(true);
    }
  });

  it("includes common JavaScript, TypeScript, PHP, and Java fences", () => {
    expect(CODE_BLOCK_LANGUAGES).toMatchObject({
      js: "JavaScript",
      javascript: "JavaScript",
      ts: "TypeScript",
      typescript: "TypeScript",
      php: "PHP",
      java: "Java",
    });
  });
});
