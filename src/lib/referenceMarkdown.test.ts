import { describe, expect, it } from "vitest";
import { fromMarkdown } from "mdast-util-from-markdown";
import type { LinkReference, Root } from "mdast";
import {
  captureReferenceMarkdown,
  maskReferenceDefinitions,
  rawReferenceSource,
  referenceDefinitionFor,
  referenceTypeAfterTextEdit,
} from "./referenceMarkdown";

describe("reference Markdown compatibility", () => {
  it("captures all reference forms and resolves later definitions", () => {
    const source =
      '[Guide text][guide-home]\n\n[Guide text][]\n\n[guide-home]\n\n[guide-home]: https://docs.example.test/guide "Optional title"\n[guide text]: /guide/start';
    const snapshot = captureReferenceMarkdown(source);
    const references = collectReferences(fromMarkdown(source));

    expect(references.map((reference) => reference.referenceType)).toEqual([
      "full",
      "collapsed",
      "shortcut",
    ]);
    expect(
      references.map(
        (reference) => referenceDefinitionFor(snapshot, reference)?.resolvedUrl,
      ),
    ).toEqual([
      "https://docs.example.test/guide",
      "/guide/start",
      "https://docs.example.test/guide",
    ]);
  });

  it("uses the first duplicate definition and preserves every raw definition", () => {
    const source =
      "  [topic]:  <https://first.example.test/a>  'First title'\n[TOPIC]: https://second.example.test/b\n\n[Read][topic]";
    const snapshot = captureReferenceMarkdown(source);
    const reference = collectReferences(fromMarkdown(source))[0];

    expect(referenceDefinitionFor(snapshot, reference)?.resolvedUrl).toBe(
      "https://first.example.test/a",
    );
    expect(snapshot.definitions.map((definition) => definition.raw)).toEqual([
      "  [topic]:  <https://first.example.test/a>  'First title'",
      "[TOPIC]: https://second.example.test/b",
    ]);
  });

  it("keeps NBSP identifiers distinct from ASCII-space identifiers", () => {
    const source =
      "[Normal][a b]\n\n[NBSP][a\u00a0b]\n\n[a b]: /normal-space\n[a\u00a0b]: /nbsp";
    const snapshot = captureReferenceMarkdown(source);
    const references = collectReferences(fromMarkdown(source));

    expect(
      references.map(
        (reference) => referenceDefinitionFor(snapshot, reference)?.resolvedUrl,
      ),
    ).toEqual(["/normal-space", "/nbsp"]);
  });

  it("validates generated repository destinations without normalizing their source", () => {
    const raw =
      '[repo-card]: <copilot-ref kind="repo" target-id="https://example.test/acme/widget" label="acme/widget" />';
    const snapshot = captureReferenceMarkdown(`${raw}\n\n[Open][repo-card]`);

    expect(snapshot.definitions[0]).toMatchObject({
      raw,
      generated: true,
      resolvedUrl: "https://example.test/acme/widget",
    });
  });

  it("rejects malformed, duplicate, unknown, and unsafe generated attributes", () => {
    const invalid = [
      '[a]: <copilot-ref kind="repo" target-id="javascript:alert(1)" label="a/b" />',
      '[b]: <copilot-ref kind="repo" target-id="https://example.test/a" target-id="https://example.test/b" label="a/b" />',
      '[c]: <copilot-ref kind="repo" target-id="https://example.test/a" onclick="go()" label="a/b" />',
      '[d]: <copilot-ref kind="repo" target-id={"https://example.test/a"} label="a/b" />',
      '[e]: <copilot-ref kind="issue" target-id="https://example.test/a" label="a/b" />',
    ].join("\n");

    expect(
      captureReferenceMarkdown(invalid).definitions.map(
        (definition) => definition.resolvedUrl,
      ),
    ).toEqual([null, null, null, null, null]);
  });

  it("keeps unresolved and malformed references as their exact literal source", () => {
    const source = "[Missing][unknown]\n\n[broken][\n\n[x]: /valid";
    const root = fromMarkdown(source);
    expect(collectReferences(root)).toHaveLength(0);
    expect(root.children[0]).toMatchObject({
      type: "paragraph",
      children: [{ type: "text", value: "[Missing][unknown]" }],
    });

    const resolvedSource = "[Shown][x]\n\n[x]: /valid";
    const reference = collectReferences(fromMarkdown(resolvedSource))[0];
    expect(rawReferenceSource(captureReferenceMarkdown(resolvedSource), reference)).toBe(
      "[Shown][x]",
    );
  });

  it("masks definition and generated angle syntax from HTML detection", () => {
    const source =
      'Before\n\n[repo]: <copilot-ref kind="repo" target-id="https://example.test/o/r" label="o/r" />\n[plain]: <https://example.test/guide>\n\nAfter';
    const masked = maskReferenceDefinitions(source);

    expect(masked).not.toContain("copilot-ref");
    expect(masked).not.toContain("<https://");
    expect(masked).toContain("Before");
    expect(masked).toContain("After");
    expect(masked.split("\n")).toHaveLength(source.split("\n").length);
  });

  it("retains reference types while their labels remain valid", () => {
    expect(
      referenceTypeAfterTextEdit(
        "collapsed",
        "Guide text",
        "guide text",
        " Guide   text ",
      ),
    ).toBe("collapsed");
    expect(
      referenceTypeAfterTextEdit(
        "shortcut",
        "guide-home",
        "guide-home",
        "Updated guide",
      ),
    ).toBe("full");
    expect(
      referenceTypeAfterTextEdit(
        "full",
        "guide-home",
        "guide-home",
        "Updated guide",
      ),
    ).toBe("full");
  });
});

function collectReferences(root: Root): LinkReference[] {
  const references: LinkReference[] = [];
  visit(root, (node) => {
    if (node.type === "linkReference") {
      references.push(node);
    }
  });
  return references;
}

function visit(
  node: Root | Root["children"][number],
  callback: (node: Root | Root["children"][number]) => void,
) {
  callback(node);
  if ("children" in node) {
    for (const child of node.children) {
      visit(child as Root["children"][number], callback);
    }
  }
}
