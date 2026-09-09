import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { createPdfFixture } from "../test/pdfFixtures";
import {
  CORE_SYNTAX_LANGUAGES,
  detectSourceLanguage,
} from "./syntaxLanguages";

const welcomeRoot = join(process.cwd(), "docs", "user-guide");
const codeRoot = join(welcomeRoot, "code");

describe("Welcome vault example inventory", () => {
  it("represents every distinct core syntax language with invented code", () => {
    const files = collectFiles(codeRoot).map((path) =>
      relative(codeRoot, path).split(sep).join("/"),
    );
    const detected = new Set(
      files
        .map((path) => detectSourceLanguage(path)?.id ?? null)
        .filter((id): id is NonNullable<typeof id> => id !== null),
    );
    if (files.includes("hello.pp")) {
      detected.add("puppet");
    }

    expect([...detected].sort()).toEqual(
      CORE_SYNTAX_LANGUAGES.map((language) => language.id).sort(),
    );
    expect(files).toEqual(
      expect.arrayContaining([
        "Dockerfile",
        "CMakeLists.txt",
        "Makefile",
        "Jenkinsfile",
        ".editorconfig",
        ".env.example",
        "go.mod",
        "BUILD.bazel",
        "_helpers.tpl",
        "Cargo.lock",
        "hello.component.html",
        "hello.mariadb.sql",
        "hello.mssql.sql",
        "hello.sqlite.sql",
        "meson.build",
        "hello.pas",
        "hello.pp",
      ]),
    );
    expect(detectSourceLanguage("hello.pp")).toBeNull();
  });

  function collectFiles(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? collectFiles(path) : [path];
    });
  }

  it("keeps the checked-in PDF equal to the deterministic synthetic fixture", () => {
    const pdf = readFileSync(
      join(welcomeRoot, "examples", "Hello document.pdf"),
    );
    const expected = createPdfFixture([
      { lines: ["Hello document", "Synthetic local PDF."] },
    ]);

    expect(pdf).toEqual(Buffer.from(expected));
    expect(pdf.subarray(0, 8).toString("latin1")).toMatch(/^%PDF-1\.7/);
    expect(pdf.toString("latin1")).not.toMatch(
      /\/(?:JavaScript|JS|OpenAction|AA|AcroForm|Annots|EmbeddedFiles|URI)\b/,
    );
  });

  it("keeps JSON and YAML examples parseable, nested, and alias-free", async () => {
    const json = JSON.parse(
      readFileSync(join(welcomeRoot, "examples", "Sample data.json"), "utf8"),
    );
    expect(json).toMatchObject({
      project: { name: "Orbit notebook", active: true },
    });
    expect(Array.isArray(json.project.steps)).toBe(true);

    const { parseDocument } = await import("yaml");
    const yamlSource = readFileSync(
      join(welcomeRoot, "examples", "Sample data.yaml"),
      "utf8",
    );
    const yaml = parseDocument(yamlSource, {
      schema: "core",
      strict: true,
      merge: false,
      uniqueKeys: true,
    });
    expect(yaml.errors).toEqual([]);
    expect(yamlSource).not.toMatch(/[&*!][A-Za-z0-9_-]+/);
    expect(yaml.toJS()).toMatchObject({
      project: { name: "Orbit notebook", active: true },
    });
  });
});
