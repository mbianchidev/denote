import { fromMarkdown } from "mdast-util-from-markdown";
import type { Definition, LinkReference, Root } from "mdast";

const GENERATED_REFERENCE_ATTRIBUTES = new Set([
  "kind",
  "target-id",
  "label",
]);

export interface ReferenceDefinitionSnapshot {
  identifier: string;
  label: string | null;
  url: string;
  title: string | null;
  raw: string;
  start: number;
  end: number;
  resolvedUrl: string | null;
  generated: boolean;
}

export interface ReferenceDefinitionGroupSnapshot {
  raw: string;
  start: number;
  end: number;
}

export interface ReferenceMarkdownSnapshot {
  source: string;
  definitions: ReferenceDefinitionSnapshot[];
  definitionGroups: ReferenceDefinitionGroupSnapshot[];
  firstDefinitions: Map<string, ReferenceDefinitionSnapshot>;
}

export function captureReferenceMarkdown(
  markdown: string,
): ReferenceMarkdownSnapshot {
  let root: Root;
  try {
    root = fromMarkdown(markdown);
  } catch {
    return {
      source: markdown,
      definitions: [],
      definitionGroups: [],
      firstDefinitions: new Map(),
    };
  }

  const definitions: ReferenceDefinitionSnapshot[] = [];
  visit(root, (node) => {
    if (node.type !== "definition") {
      return;
    }
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start === undefined || end === undefined) {
      return;
    }
    const sourceStart = definitionSourceStart(markdown, start);
    const raw = markdown.slice(sourceStart, end);
    const generatedDestination = generatedReferenceDestination(raw);
    definitions.push({
      identifier: node.identifier,
      label: node.label ?? null,
      url: node.url,
      title: node.title ?? null,
      raw,
      start: sourceStart,
      end,
      resolvedUrl:
        generatedDestination === undefined ? node.url : generatedDestination,
      generated: generatedDestination !== undefined,
    });
  });

  const firstDefinitions = new Map<string, ReferenceDefinitionSnapshot>();
  for (const definition of definitions) {
    if (!firstDefinitions.has(definition.identifier)) {
      firstDefinitions.set(definition.identifier, definition);
    }
  }
  return {
    source: markdown,
    definitions,
    definitionGroups: groupReferenceDefinitions(markdown, definitions),
    firstDefinitions,
  };
}

export function referenceDefinitionFor(
  snapshot: ReferenceMarkdownSnapshot,
  reference: Pick<LinkReference, "identifier">,
): ReferenceDefinitionSnapshot | null {
  return snapshot.firstDefinitions.get(reference.identifier) ?? null;
}

export function rawReferenceSource(
  snapshot: ReferenceMarkdownSnapshot,
  reference: LinkReference,
): string {
  const start = reference.position?.start.offset;
  const end = reference.position?.end.offset;
  if (start === undefined || end === undefined) {
    return reference.label ? `[${reference.label}]` : reference.identifier;
  }
  return snapshot.source.slice(start, end);
}

export function rawDefinitionGroupSource(
  snapshot: ReferenceMarkdownSnapshot,
  definition: Definition,
): string | null {
  const start = definition.position?.start.offset;
  if (start !== undefined) {
    const sourceStart = definitionSourceStart(snapshot.source, start);
    const containingGroup = snapshot.definitionGroups.find(
      (item) => item.start <= sourceStart && sourceStart <= item.end,
    );
    if (containingGroup) {
      return containingGroup.start === sourceStart ? containingGroup.raw : null;
    }
  }
  return (
    snapshot.definitions.find(
      (item) => item.identifier === definition.identifier,
    )?.raw ?? `[${definition.label ?? definition.identifier}]: ${definition.url}`
  );
}

export function maskReferenceDefinitions(markdown: string): string {
  const snapshot = captureReferenceMarkdown(markdown);
  if (snapshot.definitions.length === 0) {
    return markdown;
  }
  let output = "";
  let cursor = 0;
  for (const definition of snapshot.definitions) {
    output += markdown.slice(cursor, definition.start);
    output += definition.raw.replace(/[^\r\n]/g, " ");
    cursor = definition.end;
  }
  return output + markdown.slice(cursor);
}

export function normalizeReferenceIdentifier(identifier: string): string {
  return identifier
    .replace(/^[\t\r\n ]+|[\t\r\n ]+$/g, "")
    .replace(/[\t\r\n ]+/g, " ")
    .toLowerCase();
}

export function referenceTypeAfterTextEdit(
  referenceType: LinkReference["referenceType"],
  label: string | null,
  identifier: string,
  currentText: string,
): LinkReference["referenceType"] {
  return referenceType !== "full" &&
    normalizeReferenceIdentifier(currentText) !==
      normalizeReferenceIdentifier(label ?? identifier)
    ? "full"
    : referenceType;
}

function generatedReferenceDestination(rawDefinition: string):
  | string
  | null
  | undefined {
  const colon = findDefinitionColon(rawDefinition);
  if (colon < 0) {
    return undefined;
  }
  const afterColon = rawDefinition.slice(colon + 1).trim();
  if (!afterColon.startsWith("<copilot-ref")) {
    return undefined;
  }
  return parseGeneratedReferenceToken(afterColon);
}

function groupReferenceDefinitions(
  markdown: string,
  definitions: ReferenceDefinitionSnapshot[],
): ReferenceDefinitionGroupSnapshot[] {
  const groups: ReferenceDefinitionGroupSnapshot[] = [];
  for (const definition of definitions) {
    const previous = groups[groups.length - 1];
    if (
      previous &&
      /^[\t\n\f\r ]*$/.test(markdown.slice(previous.end, definition.start))
    ) {
      previous.end = definition.end;
      previous.raw = markdown.slice(previous.start, previous.end);
      continue;
    }
    groups.push({
      raw: definition.raw,
      start: definition.start,
      end: definition.end,
    });
  }
  return groups;
}

function parseGeneratedReferenceToken(source: string): string | null {
  const match = /^<copilot-ref((?:\s+[a-z][a-z0-9-]*\s*=\s*(?:"[^"<>{}\r\n]*"|'[^'<>{}\r\n]*'))+)\s*\/>$/.exec(
    source,
  );
  if (!match) {
    return null;
  }
  const attributes = new Map<string, string>();
  const attributePattern =
    /\s+([a-z][a-z0-9-]*)\s*=\s*(?:"([^"<>{}\r\n]*)"|'([^'<>{}\r\n]*)')/g;
  let consumed = "";
  for (const attribute of match[1].matchAll(attributePattern)) {
    consumed += attribute[0];
    const name = attribute[1];
    if (
      !GENERATED_REFERENCE_ATTRIBUTES.has(name) ||
      name.startsWith("on") ||
      attributes.has(name)
    ) {
      return null;
    }
    attributes.set(name, attribute[2] ?? attribute[3] ?? "");
  }
  if (consumed !== match[1] || attributes.get("kind") !== "repo") {
    return null;
  }
  const target = attributes.get("target-id");
  if (
    !target ||
    target !== target.trim() ||
    !attributes.has("label") ||
    /[\u0000-\u0020\u007f]/.test(target)
  ) {
    return null;
  }

  try {
    const parsed = new URL(target);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? target
      : null;
  } catch {
    return null;
  }
}

function definitionSourceStart(markdown: string, start: number): number {
  const lineStart = markdown.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
  return /^ {0,3}$/.test(markdown.slice(lineStart, start)) ? lineStart : start;
}

function findDefinitionColon(raw: string): number {
  let escaped = false;
  for (let index = 0; index < raw.length - 1; index += 1) {
    const character = raw[index];
    if (escaped) {
      escaped = false;
    } else if (character === "\\") {
      escaped = true;
    } else if (character === "]" && raw[index + 1] === ":") {
      return index + 1;
    }
  }
  return -1;
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
