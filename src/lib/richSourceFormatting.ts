import { diffChars } from "diff";

interface SourceEdit {
  from: number;
  to: number;
  text: string;
}

function edits(before: string, after: string, offset = 0): SourceEdit[] {
  const result: SourceEdit[] = [];
  let position = offset;
  let pending: SourceEdit | null = null;
  for (const part of diffChars(before, after)) {
    if (!part.added && !part.removed) {
      if (pending) result.push(pending);
      pending = null;
      position += part.value.length;
    } else {
      pending ??= { from: position, to: position, text: "" };
      if (part.removed) position += part.value.length;
      else pending.text += part.value;
      pending.to = position;
    }
  }
  if (pending) result.push(pending);
  return result;
}

function normalizationEdits(before: string, source: string): SourceEdit[] {
  const beforeLines = before.split(/(?<=\n)/);
  const sourceLines = source.split(/(?<=\n)/);
  if (beforeLines.length !== sourceLines.length) return edits(before, source);
  const result: SourceEdit[] = [];
  let offset = 0;
  for (let index = 0; index < beforeLines.length; index++) {
    if (beforeLines[index] !== sourceLines[index]) {
      result.push(...edits(beforeLines[index], sourceLines[index], offset));
    }
    offset += beforeLines[index].length;
  }
  return result;
}

export function preserveRichSourceFormatting(
  markdown: string,
  snapshot: Readonly<{ serialized: string; source: string }> | null,
): string {
  if (!snapshot) return markdown;
  const before = snapshot.serialized.trim();
  const source = snapshot.source.trim();
  if (before === source) return markdown;
  const changes = edits(before, markdown);
  const replacements: SourceEdit[] = [];
  for (const original of normalizationEdits(before, source)) {
    const removed = before.slice(original.from, original.to);
    // Structural Markdown is owned by its extension, not by whitespace reconciliation.
    if (!/^[\\\s]*$/.test(removed + original.text)) continue;
    const trivia = original.from === original.to && /^\s+$/.test(original.text);
    if (changes.some((change) => trivia
      ? change.from < original.from && original.from < change.to
      : change.from <= original.to && original.from <= change.to)) continue;
    const offset = (position: number) => changes.reduce((mapped, change) =>
      change.to <= position ? mapped + change.text.length - (change.to - change.from) : mapped, position);
    replacements.push({ from: offset(original.from), to: offset(original.to), text: original.text });
  }
  let output = markdown;
  for (const replacement of replacements.sort((left, right) => right.from - left.from)) {
    output = output.slice(0, replacement.from) + replacement.text + output.slice(replacement.to);
  }
  return output;
}
