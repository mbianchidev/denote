import { fromMarkdown } from "mdast-util-from-markdown";
import { toMarkdown } from "mdast-util-to-markdown";
import { describe, expect, it } from "vitest";
import {
  hasIncompleteStandardMarkdownAngle,
  restoreStandardMarkdownAngles,
} from "./mdxCompatibility";

function parse(markdown: string) {
  return fromMarkdown(markdown);
}

describe("MDX standard Markdown compatibility", () => {
  it("treats comparisons, hearts, and placeholder spans as text", () => {
    const source =
      "Discovery for <100k accounts\n\nThanks <3\n\nCommand <account-slug or example acme.example.com>";
    expect(parse(source).children).toHaveLength(3);
  });

  it("treats HTML and JSX-looking spans as standard Markdown text", () => {
    expect(parse("Press <kbd>Ctrl</kbd>.").children).toHaveLength(1);
  });

  it("handles angle text at block and list-item starts", () => {
    expect(() =>
      parse("<account-slug>\n\n- <3\n\ncontinued"),
    ).not.toThrow();
  });

  it("detects only unfinished angle tokens outside code", () => {
    expect(hasIncompleteStandardMarkdownAngle("Type <a")).toBe(true);
    expect(hasIncompleteStandardMarkdownAngle("Type <a>")).toBe(false);
    expect(hasIncompleteStandardMarkdownAngle("`Type <a`")).toBe(false);
  });

  it("preserves formatting and soft continuations on angle-leading lines", () => {
    const source = "<account-slug> **bold**\ncontinuation";
    expect(
      restoreStandardMarkdownAngles(
        toMarkdown(parse(source)).trimEnd(),
        source,
      ),
    ).toBe(source);
  });

  it("leaves indented angle text as code blocks", () => {
    expect(parse("    <account-slug>").children[0]?.type).toBe("code");
    const list = parse("- item\n\n      <account-slug>").children[0];
    expect(JSON.stringify(list)).toContain('"type":"code"');
  });

  it("restores serializer escapes without changing literal angle text", () => {
    expect(
      restoreStandardMarkdownAngles(
        "Discovery for \\<100k accounts\n\nCommand \\<account-slug>",
        "Discovery for <100k accounts\n\nCommand <account-slug>",
      ),
    ).toBe("Discovery for <100k accounts\n\nCommand <account-slug>");
    expect(
      restoreStandardMarkdownAngles("New value: \\<100k", "Before"),
    ).toBe("New value: <100k");
    expect(
      restoreStandardMarkdownAngles("New slash: \\\\<100k", "Before"),
    ).toBe("New slash: \\\\<100k");
    expect(
      restoreStandardMarkdownAngles(
        String.raw`Use \\\<account-slug>`,
        "Use <account-slug>",
      ),
    ).toBe(String.raw`Use \\<account-slug>`);
  });
});
