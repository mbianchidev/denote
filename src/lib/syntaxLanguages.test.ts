import { EditorState } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
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
      expect.arrayContaining([
        "PowerShell",
        "SCSS",
        "LESS",
        "Dockerfile",
        "Go module",
        "CMake",
        "Makefile",
        "Groovy",
        "Properties",
        "Protocol Buffers",
        "Visual Studio solution",
        "Meson",
      ]),
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

  it("detects common project and build auxiliary files", () => {
    const auxiliaryFiles: Record<string, string> = {
      "go.mod": "Go module",
      "go.sum": "Go module",
      "go.work": "Go module",
      "go.work.sum": "Go module",
      "project.csproj": "XML",
      "project.fsproj": "XML",
      "project.vbproj": "XML",
      "project.vcxproj": "XML",
      "Directory.Build.props": "XML",
      "Directory.Build.targets": "XML",
      "package.nuspec": "XML",
      "solution.slnx": "XML",
      "solution.sln": "Visual Studio solution",
      "CMakeLists.txt": "CMake",
      "toolchain.cmake": "CMake",
      "template.cmake.in": "CMake",
      Makefile: "Makefile",
      GNUmakefile: "Makefile",
      "rules.mk": "Makefile",
      "Cargo.lock": "TOML",
      "poetry.lock": "TOML",
      "uv.lock": "TOML",
      Jenkinsfile: "Groovy",
      "build.gradle": "Groovy",
      ".editorconfig": "Properties",
      "settings.ini": "Properties",
      "tool.cfg": "Properties",
      "schema.proto": "Protocol Buffers",
      "meson.build": "Meson",
      "meson_options.txt": "Meson",
      ".env.local": "Shell",
      Procfile: "Shell",
      "Pipfile.lock": "JSON",
      "composer.lock": "JSON",
    };

    for (const [path, language] of Object.entries(auxiliaryFiles)) {
      expect(detectSourceLanguage(`synthetic/${path}`)?.name, path).toBe(
        language,
      );
    }
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

  it("highlights Go module and Makefile auxiliary syntax", async () => {
    const [goModule, makefile] = await Promise.all([
      loadSyntaxLanguage("gomod"),
      loadSyntaxLanguage("makefile"),
    ]);
    const goState = EditorState.create({
      doc: "module example.test/app\nrequire example.test/lib v1.2.3",
      extensions: [goModule],
    });
    const makeState = EditorState.create({
      doc: "build: input\n\techo ready",
      extensions: [makefile],
    });
    const goNodes: string[] = [];
    const makeNodes: string[] = [];

    syntaxTree(goState).iterate({
      enter: (node) => {
        goNodes.push(node.name);
      },
    });
    syntaxTree(makeState).iterate({
      enter: (node) => {
        makeNodes.push(node.name);
      },
    });

    expect(goNodes).toEqual(
      expect.arrayContaining(["keyword", "string", "number"]),
    );
    expect(makeNodes).toContain("labelName");
  });
});
