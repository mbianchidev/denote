import { describe, expect, it } from "vitest";
import {
  AUTOMATIC_LANGUAGE,
  CORE_SYNTAX_LANGUAGES,
  LANGUAGE_OPTIONS,
  PLAIN_TEXT_LANGUAGE,
  detectSourceLanguage,
  fenceIdentifierForChoice,
  languageChoiceForFence,
  languageForFence,
  loadSyntaxLanguage,
  resolveSourceLanguage,
} from "./syntaxLanguages";

const requiredLanguages = [
  "JavaScript",
  "JSX",
  "TypeScript",
  "TSX",
  "Java",
  "JSP",
  "Go",
  "Rust",
  "Python",
  "C",
  "C++",
  "C#",
  "Kotlin",
  "Swift",
  "Ruby",
  "PHP",
  "Dart",
  "Lua",
  "R",
  "Scala",
  "Elixir",
  "JSON",
  "XML",
  "HTML",
  "CSS",
  "Markdown",
  "Shell",
  "YAML",
  "TOML",
  "SQL",
] as const;

const requiredExtensions: Record<string, string> = {
  js: "JavaScript",
  jsx: "JSX",
  ts: "TypeScript",
  tsx: "TSX",
  java: "Java",
  jsp: "JSP",
  go: "Go",
  rs: "Rust",
  py: "Python",
  c: "C",
  h: "C",
  cc: "C++",
  cpp: "C++",
  cxx: "C++",
  hpp: "C++",
  cs: "C#",
  kt: "Kotlin",
  kts: "Kotlin",
  swift: "Swift",
  rb: "Ruby",
  php: "PHP",
  phtml: "PHP",
  dart: "Dart",
  lua: "Lua",
  r: "R",
  R: "R",
  scala: "Scala",
  sc: "Scala",
  ex: "Elixir",
  exs: "Elixir",
  json: "JSON",
  xml: "XML",
  html: "HTML",
  htm: "HTML",
  css: "CSS",
  md: "Markdown",
  sh: "Shell",
  yaml: "YAML",
  toml: "TOML",
  sql: "SQL",
};

describe("core syntax language registry", () => {
  it("contains every required language and retained documented format", () => {
    const names = CORE_SYNTAX_LANGUAGES.map((language) => language.name);
    expect(names).toEqual(expect.arrayContaining([...requiredLanguages]));
    expect(names).toEqual(
      expect.arrayContaining(["PowerShell", "SCSS", "LESS", "Dockerfile"]),
    );
  });

  it("detects every required source extension", () => {
    for (const [extension, language] of Object.entries(requiredExtensions)) {
      expect(detectSourceLanguage(`synthetic/example.${extension}`)?.name).toBe(
        language,
      );
    }
  });

  it("detects supported extensionless filenames and Windows paths", () => {
    expect(detectSourceLanguage("synthetic/Dockerfile")?.name).toBe(
      "Dockerfile",
    );
    expect(detectSourceLanguage("synthetic\\Gemfile")?.name).toBe("Ruby");
    expect(detectSourceLanguage("synthetic/BUILD")?.name).toBe("Python");
    expect(detectSourceLanguage("synthetic/PKGBUILD")?.name).toBe("Shell");
  });

  it("resolves fence aliases case-insensitively", () => {
    expect(languageForFence("JS")?.name).toBe("JavaScript");
    expect(languageForFence("c++")?.name).toBe("C++");
    expect(languageForFence("CSharp")?.name).toBe("C#");
    expect(languageForFence("EXS")?.name).toBe("Elixir");
    expect(languageForFence("unsupported")).toBeNull();
  });

  it("keeps Automatic and Plain text as distinct first choices", () => {
    expect(LANGUAGE_OPTIONS.slice(0, 2).map((option) => option.value)).toEqual([
      AUTOMATIC_LANGUAGE,
      PLAIN_TEXT_LANGUAGE,
    ]);
    expect(languageChoiceForFence("")).toBe(AUTOMATIC_LANGUAGE);
    expect(languageChoiceForFence("text")).toBe(PLAIN_TEXT_LANGUAGE);
    expect(fenceIdentifierForChoice(AUTOMATIC_LANGUAGE)).toBe("");
    expect(fenceIdentifierForChoice(PLAIN_TEXT_LANGUAGE)).toBe("text");
    expect(fenceIdentifierForChoice("typescript")).toBe("ts");
  });

  it("resolves automatic, explicit, and plain-text source choices", () => {
    expect(resolveSourceLanguage("synthetic/file.ts", null)).toMatchObject({
      label: "TypeScript",
      overridden: false,
    });
    expect(
      resolveSourceLanguage("synthetic/file.ts", PLAIN_TEXT_LANGUAGE),
    ).toEqual({
      language: null,
      label: "Plain text",
      overridden: true,
    });
    expect(
      resolveSourceLanguage("synthetic/file.unknown", "python"),
    ).toMatchObject({
      label: "Python",
      overridden: true,
    });
    expect(resolveSourceLanguage("synthetic/file.unknown", null)).toEqual({
      language: null,
      label: "Plain text",
      overridden: false,
    });
  });

  it("loads and caches bundled grammars including Elixir and JSP", async () => {
    const [elixir, elixirAgain, jsp] = await Promise.all([
      loadSyntaxLanguage("elixir"),
      loadSyntaxLanguage("elixir"),
      loadSyntaxLanguage("jsp"),
    ]);

    expect(elixirAgain).toBe(elixir);
    expect(elixir.extension).toBeTruthy();
    expect(jsp.extension).toBeTruthy();
  });
});
