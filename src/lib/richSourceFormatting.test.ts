import { describe, expect, it } from "vitest";
import { preserveRichSourceFormatting } from "./richSourceFormatting";

describe("Rich source formatting", () => {
  it("preserves untouched symbols, spaces, tabs, and hard breaks around an edit", () => {
    const source = "= literal. \t\n\nKept. \n\nBreak.  \nNext.\t\n\nEdit";
    const serialized = "\\= literal.\n\nKept.\n\nBreak.\nNext.\n\nEdit\n";
    expect(preserveRichSourceFormatting("\\= literal.\n\nKept.\n\nBreak.\nNext.\n\nEdit!", { source, serialized }))
      .toBe(`${source}!`);
  });

  it("does not partially restore paired emphasis delimiters around a word edit", () => {
    expect(preserveRichSourceFormatting("*words*", { source: "_word_", serialized: "*word*\n" }))
      .toBe("*words*");
  });

  it("does not restore old delimiters after an explicit formatting change", () => {
    expect(preserveRichSourceFormatting("**word**", { source: "_word_", serialized: "*word*\n" }))
      .toBe("**word**");
  });

  it("does not restore trivia belonging to a deleted paragraph", () => {
    expect(preserveRichSourceFormatting("Kept.", { source: "Removed. \t\n\nKept.", serialized: "Removed.\n\nKept.\n" }))
      .toBe("Kept.");
  });

  it("preserves explicit source escapes on an untouched line", () => {
    expect(preserveRichSourceFormatting("= literal\n\nEdited!", { source: "\\= literal\n\nEdited", serialized: "= literal\n\nEdited\n" }))
      .toBe("\\= literal\n\nEdited!");
  });

  it("keeps newly typed and intentionally deleted spaces authoritative", () => {
    expect(preserveRichSourceFormatting("Synthetic. ", { source: "Synthetic.", serialized: "Synthetic.\n" })).toBe("Synthetic. ");
    expect(preserveRichSourceFormatting("Synthetic.", { source: "Synthetic. ", serialized: "Synthetic.&#x20;\n" })).toBe("Synthetic.");
  });
});
