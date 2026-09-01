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

const requestedFollowupLanguages = [
  "LaTeX",
  "PostgreSQL",
  "MySQL",
  "MariaDB SQL",
  "MS SQL",
  "PL/SQL",
  "SQLite SQL",
  "CQL",
  "Jinja",
  "Vue",
  "Angular template",
  "Haskell",
  "Clojure",
  "ClojureScript",
  "Erlang",
  "OCaml",
  "F#",
  "Fortran",
  "Julia",
  "Perl",
  "Pascal",
  "VB.NET",
  "Cobol",
  "Puppet",
  "Terraform / HCL",
  "Helm template",
  "Common Lisp",
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
      expect.arrayContaining([...requestedFollowupLanguages]),
    );
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

  it("detects requested language and database dialect extensions", () => {
    const requestedFiles: Record<string, string> = {
      "paper.tex": "LaTeX",
      "query.psql": "PostgreSQL",
      "query.pgsql": "PostgreSQL",
      "query.mysql": "MySQL",
      "query.mariadb.sql": "MariaDB SQL",
      "query.mssql.sql": "MS SQL",
      "query.tsql": "MS SQL",
      "query.pls": "PL/SQL",
      "query.plsql": "PL/SQL",
      "package.pkb": "PL/SQL",
      "package.pks": "PL/SQL",
      "query.sqlite.sql": "SQLite SQL",
      "query.cql": "CQL",
      "template.j2": "Jinja",
      "template.jinja2": "Jinja",
      "component.vue": "Vue",
      "account.component.html": "Angular template",
      "Main.hs": "Haskell",
      "Main.lhs": "Haskell",
      "core.clj": "Clojure",
      "core.cljc": "Clojure",
      "browser.cljs": "ClojureScript",
      "server.erl": "Erlang",
      "server.hrl": "Erlang",
      "main.ml": "OCaml",
      "main.mli": "OCaml",
      "main.fs": "F#",
      "script.fsx": "F#",
      "model.f90": "Fortran",
      "model.f08": "Fortran",
      "analysis.jl": "Julia",
      "script.pl": "Perl",
      "module.pm": "Perl",
      "program.pas": "Pascal",
      "Program.vb": "VB.NET",
      "ledger.cob": "Cobol",
      "copybook.cpy": "Cobol",
      "main.tf": "Terraform / HCL",
      "variables.tfvars": "Terraform / HCL",
      ".terraform.lock.hcl": "Terraform / HCL",
      "_helpers.tpl": "Helm template",
      "macros.tpl": "Helm template",
      "system.cl": "Common Lisp",
      "system.lisp": "Common Lisp",
    };

    for (const [path, language] of Object.entries(requestedFiles)) {
      expect(detectSourceLanguage(`synthetic/${path}`)?.name, path).toBe(
        language,
      );
    }
  });

  it("falls back for the ambiguous Pascal and Puppet .pp extension", () => {
    expect(detectSourceLanguage("synthetic/ambiguous.pp")).toBeNull();
    expect(languageForFence("pp")).toBeNull();
    expect(languageForFence("pascal")?.name).toBe("Pascal");
    expect(languageForFence("puppet")?.name).toBe("Puppet");
  });

  it("keeps Helm YAML automatic detection as YAML until explicitly overridden", () => {
    expect(detectSourceLanguage("chart/templates/deployment.yaml")?.name).toBe(
      "YAML",
    );
    expect(detectSourceLanguage("chart/Chart.yaml")?.name).toBe("YAML");
    expect(languageForFence("helm")?.name).toBe("Helm template");
    expect(languageForFence("gotemplate")?.name).toBe("Helm template");
  });

  it("resolves fence aliases case-insensitively", () => {
    expect(languageForFence("JS")?.name).toBe("JavaScript");
    expect(languageForFence("c++")?.name).toBe("C++");
    expect(languageForFence("CSharp")?.name).toBe("C#");
    expect(languageForFence("EXS")?.name).toBe("Elixir");
    expect(languageForFence("react")?.name).toBe("JSX");
    expect(languageForFence("reacttsx")?.name).toBe("TSX");
    expect(languageForFence("postgres")?.name).toBe("PostgreSQL");
    expect(languageForFence("angular-template")?.name).toBe(
      "Angular template",
    );
    expect(languageForFence("terraform")?.name).toBe("Terraform / HCL");
    expect(languageForFence("hcl")?.name).toBe("Terraform / HCL");
    expect(languageForFence("common-lisp")?.name).toBe("Common Lisp");
    expect(languageForFence("unsupported")).toBeNull();
    expect(languageForFence("diff")).toBeNull();
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

  it("loads every requested bundled catalog grammar", async () => {
    const requestedIds = [
      "latex",
      "postgresql",
      "mysql",
      "mariadb",
      "mssql",
      "plsql",
      "sqlite",
      "cql",
      "jinja",
      "vue",
      "angular",
      "haskell",
      "clojure",
      "clojurescript",
      "erlang",
      "ocaml",
      "fsharp",
      "fortran",
      "julia",
      "perl",
      "pascal",
      "vbnet",
      "cobol",
      "puppet",
      "terraform",
      "helm",
      "commonlisp",
    ] as const;

    const supports = await Promise.all(requestedIds.map(loadSyntaxLanguage));

    expect(supports).toHaveLength(requestedIds.length);
    expect(supports.every((support) => Boolean(support.extension))).toBe(true);
  });

  it("highlights Terraform and Helm template syntax", async () => {
    const [terraform, helm] = await Promise.all([
      loadSyntaxLanguage("terraform"),
      loadSyntaxLanguage("helm"),
    ]);
    const terraformState = EditorState.create({
      doc: 'resource "synthetic_service" "example" {\n  enabled = true\n}',
      extensions: [terraform],
    });
    const helmState = EditorState.create({
      doc: 'image: "{{ required "image is required" .Values.image }}"\n{{- if .Values.enabled }}\nenabled: true\n{{- end }}',
      extensions: [helm],
    });
    const helmNodes: string[] = [];

    syntaxTree(helmState).iterate({
      enter: (node) => {
        helmNodes.push(node.name);
      },
    });

    expect(syntaxTree(terraformState).length).toBe(terraformState.doc.length);
    expect(helmNodes).toEqual(
      expect.arrayContaining([
        "propertyName",
        "operator",
        "helm-function",
        "variableName",
        "keyword",
      ]),
    );
  });

  it("keeps Helm comments outside quoted YAML strings", async () => {
    const helm = await loadSyntaxLanguage("helm");
    const doc =
      'name: "my-app" # pinned\nimage: "prefix-{{ .Values.image }}-suffix"\npath: "a\\"b c"';
    const state = EditorState.create({ doc, extensions: [helm] });
    const tokens: Array<{ name: string; text: string }> = [];

    syntaxTree(state).iterate({
      enter: (node) => {
        if (node.name !== "Document") {
          tokens.push({
            name: node.name,
            text: state.doc.sliceString(node.from, node.to),
          });
        }
      },
    });

    expect(tokens).toContainEqual({ name: "comment", text: "# pinned" });
    expect(
      tokens.some(
        ({ name, text }) => name === "string" && text.includes("# pinned"),
      ),
    ).toBe(false);
    expect(tokens).toContainEqual({
      name: "variableName",
      text: ".Values.image",
    });
    expect(
      tokens.some(
        ({ name, text }) => name === "string" && text.includes('"a\\"b c"'),
      ),
    ).toBe(true);
  });
});
