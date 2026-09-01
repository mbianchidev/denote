import { describe, expect, it } from "vitest";
import type { CoreSyntaxLanguageId } from "./syntaxLanguages";
import {
  buildSourceMinimap,
  extractSourceSymbols,
} from "./sourceOutline";

describe("source outline extraction", () => {
  it("extracts Python functions, classes, lines, and nesting", () => {
    expect(
      extractSourceSymbols(
        [
          "# synthetic example",
          "class ProfileReader:",
          "  def load(self):",
          "    return None",
          "",
          "async def main():",
          "  pass",
        ].join("\n"),
        "python",
      ),
    ).toEqual([
      { name: "ProfileReader", kind: "class", line: 2, depth: 0 },
      { name: "load", kind: "function", line: 3, depth: 1 },
      { name: "main", kind: "function", line: 6, depth: 0 },
    ]);
  });

  it.each(
    [
      ["typescript", "export function loadConfig() {", "loadConfig"],
      ["typescript", "const parseItem = (value: string) => value", "parseItem"],
      ["go", "func (reader *Reader) Load() {}", "Load"],
      ["rust", "pub async fn load_config() {}", "load_config"],
      ["c", "int calculate_total(int value) {", "calculate_total"],
      ["swift", "public func loadProfile() {", "loadProfile"],
      ["ruby", "def load_profile", "load_profile"],
      ["php", "public function loadProfile() {", "loadProfile"],
      ["lua", "local function load_profile()", "load_profile"],
      ["r", "load_profile <- function(path) {", "load_profile"],
      ["elixir", "defp load_profile(path) do", "load_profile"],
      ["haskell", "loadProfile path = path", "loadProfile"],
      ["clojure", "(defn load-profile [path]", "load-profile"],
      ["commonlisp", "(defun load-profile (path)", "load-profile"],
      ["erlang", "load_profile(Path) ->", "load_profile"],
      ["ocaml", "let rec load_profile path =", "load_profile"],
      ["fsharp", "let loadProfile path =", "loadProfile"],
      ["fortran", "subroutine calculate_total(value)", "calculate_total"],
      ["julia", "function load_profile!(path)", "load_profile!"],
      ["perl", "sub load_profile {", "load_profile"],
      ["pascal", "procedure LoadProfile;", "LoadProfile"],
      ["vbnet", "Public Function LoadProfile() As String", "LoadProfile"],
      ["cobol", "PROCESS-RECORD.", "PROCESS-RECORD"],
      ["puppet", "class profile::web {", "profile::web"],
      [
        "terraform",
        'resource "synthetic_service" "example" {',
        "resource synthetic_service.example",
      ],
      ["helm", '{{- define "synthetic.labels" -}}', "synthetic.labels"],
      ["postgresql", "CREATE FUNCTION calculate_total()", "calculate_total"],
      ["latex", "\\section{Synthetic Results}", "Synthetic Results"],
      ["jinja", "{% macro render_item(value) %}", "render_item"],
    ] satisfies Array<[CoreSyntaxLanguageId, string, string]>,
  )("extracts %s symbols", (languageId, line, expectedName) => {
    expect(extractSourceSymbols(line, languageId)[0]?.name).toBe(expectedName);
  });

  it("bounds results and skips comments or pathological lines", () => {
    const source = [
      "# def ignored():",
      "x".repeat(20_001),
      ...Array.from({ length: 1_100 }, (_, index) => `def symbol_${index}():`),
    ].join("\n");
    const symbols = extractSourceSymbols(source, "python");

    expect(symbols).toHaveLength(1_000);
    expect(symbols[0]).toMatchObject({ name: "symbol_0", line: 3 });
    expect(symbols[999]).toMatchObject({ name: "symbol_999" });
  });

  it("returns no symbols when no language is resolved", () => {
    expect(extractSourceSymbols("def synthetic():", null)).toEqual([]);
  });

  it("builds a bounded miniature code map with symbol emphasis", () => {
    const source = Array.from({ length: 1_200 }, (_, index) =>
      index === 599
        ? "def central_symbol():"
        : `${" ".repeat(index % 8)}value_${index} = ${index}`,
    ).join("\n");
    const symbols = extractSourceSymbols(source, "python");
    const minimap = buildSourceMinimap(source, symbols);

    expect(minimap.length).toBeLessThanOrEqual(500);
    expect(
      minimap.some(
        (line) => line.line === 600 && line.kind === "symbol",
      ),
    ).toBe(true);
    expect(
      minimap.every(
        (line) =>
          line.top >= 0 &&
          line.top <= 1 &&
          line.left >= 0 &&
          line.left <= 0.4 &&
          line.width >= 0.04 &&
          line.width <= 0.92,
      ),
    ).toBe(true);
  });
});
