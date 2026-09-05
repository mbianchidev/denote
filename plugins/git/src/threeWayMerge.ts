/**
 * A deterministic, bounded, line-based three-way merge.
 *
 * Denote merges conflicted notes itself rather than reading Git's conflict
 * markers back out of the worktree: markers are content, and a note that
 * legitimately contains `<<<<<<<` would be indistinguishable from a marker.
 * The three sides Git recorded in the index are merged here instead, so what a
 * surface shows is exactly what Git holds.
 *
 * The algorithm is the classic three-way line merge: the lines every side
 * agrees on are stable, a region only one side changed is taken from that
 * side, an identical change on both sides is taken once, and a region both
 * sides changed differently is reported as a chunk that carries all three
 * sides. Nothing is ever invented, and no line of any side is dropped: every
 * line of base, ours, and theirs appears in exactly one chunk.
 */

/** Which side of a conflict one chunk is answered with. */
export type MergeSide = "base" | "ours" | "theirs";

export type MergeChunkKind = "stable" | "resolved" | "conflict";

/**
 * One region of the merge.
 *
 * A `stable` chunk is text every side holds. A `resolved` chunk is a change
 * exactly one side made, or the same change both sides made, and `automatic`
 * names the side its lines come from. A `conflict` chunk carries all three
 * sides and no answer: only the user can choose one.
 */
export interface MergeChunk {
  id: string;
  kind: MergeChunkKind;
  base: string[];
  ours: string[];
  theirs: string[];
  automatic: MergeSide | null;
}

export interface MergeResult {
  chunks: MergeChunk[];
  /** True while at least one chunk needs an answer. */
  conflicted: boolean;
  /** Whether the merged text ends with a line terminator. */
  finalNewline: boolean;
}

/** Answers a surface has collected, keyed by chunk ID. */
export type MergeChoices = Record<string, MergeSide>;

/** Bounds for one merge. Anything larger is refused, never truncated. */
export const MAX_MERGE_LINES = 20000;
export const MAX_MERGE_LINE_LENGTH = 8192;
/**
 * The largest comparison Denote will run after the common prefix and suffix
 * have been removed. Two files that share almost nothing and are both long
 * would otherwise cost time proportional to the product of their lengths.
 */
export const MAX_MERGE_MATRIX_CELLS = 4_000_000;

/**
 * Raised when content is larger than Denote will merge. It is reported rather
 * than cut short, because a truncated merge would offer a resolution that
 * silently loses the part that was never read.
 */
export class MergeTooLarge extends Error {
  constructor() {
    super(
      "This conflict is larger than Denote can merge. Choose a whole side, or resolve it with your own Git tooling.",
    );
  }
}

export interface MergeLines {
  lines: string[];
  finalNewline: boolean;
}

/**
 * Splits text into lines without losing anything.
 *
 * A carriage return stays on the line it terminates, so CRLF content survives
 * a merge byte for byte, and a missing final newline is reported rather than
 * added.
 */
export function splitMergeLines(text: string): MergeLines {
  if (text.length === 0) {
    return { lines: [], finalNewline: true };
  }
  const finalNewline = text.endsWith("\n");
  const body = finalNewline ? text.slice(0, -1) : text;
  return { lines: body.split("\n"), finalNewline };
}

/**
 * Merges three sides into a chunk model.
 *
 * A side Git does not hold is passed as null and merged as an empty side, so
 * an add/add conflict, which has no base, is described exactly as that rather
 * than as a change against invented content.
 */
export function threeWayMerge(
  baseText: string | null,
  oursText: string | null,
  theirsText: string | null,
): MergeResult {
  const base = splitMergeLines(baseText ?? "");
  const ours = splitMergeLines(oursText ?? "");
  const theirs = splitMergeLines(theirsText ?? "");
  for (const side of [base, ours, theirs]) {
    if (side.lines.length > MAX_MERGE_LINES) {
      throw new MergeTooLarge();
    }
    for (const line of side.lines) {
      if (line.length > MAX_MERGE_LINE_LENGTH) {
        throw new MergeTooLarge();
      }
    }
  }
  const matchedOurs = matches(base.lines, ours.lines);
  const matchedTheirs = matches(base.lines, theirs.lines);
  const chunks = buildChunks(
    base.lines,
    ours.lines,
    theirs.lines,
    matchedOurs,
    matchedTheirs,
  );
  return {
    chunks,
    conflicted: chunks.some((chunk) => chunk.kind === "conflict"),
    finalNewline: finalNewlineFor(baseText, base, ours, theirs),
  };
}

/**
 * Decides whether the merged text ends with a newline.
 *
 * Both sides agreeing settles it. When they disagree, exactly one of them
 * changed what the base had, so that side's answer is the change and is taken.
 * With no base to compare against, our own side is taken, because it is the
 * side the vault already holds.
 */
function finalNewlineFor(
  baseText: string | null,
  base: MergeLines,
  ours: MergeLines,
  theirs: MergeLines,
): boolean {
  if (ours.finalNewline === theirs.finalNewline) {
    return ours.finalNewline;
  }
  if (baseText === null) {
    return ours.finalNewline;
  }
  return ours.finalNewline === base.finalNewline
    ? theirs.finalNewline
    : ours.finalNewline;
}

/** The lines one chunk contributes when it is answered with one side. */
export function chunkResultLines(chunk: MergeChunk, side: MergeSide): string[] {
  return chunk[side];
}

/**
 * Renders the merged text.
 *
 * A chunk nobody has answered contributes nothing: a merge never guesses which
 * side the user meant, and the chunk stays on screen until it is answered.
 */
export function mergeResultText(
  merge: MergeResult,
  choices: MergeChoices = {},
): string {
  const lines: string[] = [];
  for (const chunk of merge.chunks) {
    if (chunk.kind === "conflict") {
      const choice = choices[chunk.id];
      if (choice) {
        lines.push(...chunkResultLines(chunk, choice));
      }
      continue;
    }
    lines.push(...chunkResultLines(chunk, chunk.automatic ?? "ours"));
  }
  if (lines.length === 0) {
    return "";
  }
  return merge.finalNewline ? `${lines.join("\n")}\n` : lines.join("\n");
}

/** Chunk IDs that still need an answer. */
export function unresolvedChunkIds(
  merge: MergeResult,
  choices: MergeChoices = {},
): string[] {
  return merge.chunks
    .filter((chunk) => chunk.kind === "conflict" && !choices[chunk.id])
    .map((chunk) => chunk.id);
}

/** One region of the base that exactly one side rewrote. */
interface EditBlock {
  side: "ours" | "theirs";
  baseStart: number;
  baseEnd: number;
  sideStart: number;
  sideEnd: number;
}

/**
 * Reads one side's matching as the maximal regions of the base it replaced.
 *
 * Between two blocks the side follows the base line for line, which is what
 * lets a chunk's range on one side be derived from the base range plus the
 * length each block added or removed.
 */
function editBlocks(
  side: "ours" | "theirs",
  matched: Array<number | null>,
  baseLength: number,
  sideLength: number,
): EditBlock[] {
  const blocks: EditBlock[] = [];
  let baseIndex = 0;
  let sideIndex = 0;
  for (;;) {
    if (baseIndex >= baseLength && sideIndex >= sideLength) {
      return blocks;
    }
    if (baseIndex < baseLength && matched[baseIndex] === sideIndex) {
      baseIndex += 1;
      sideIndex += 1;
      continue;
    }
    const baseStart = baseIndex;
    const sideStart = sideIndex;
    while (baseIndex < baseLength && matched[baseIndex] === null) {
      baseIndex += 1;
    }
    const aligned = baseIndex < baseLength ? matched[baseIndex] : null;
    sideIndex = aligned === null ? sideLength : aligned;
    blocks.push({ side, baseStart, baseEnd: baseIndex, sideStart, sideEnd: sideIndex });
  }
}

/**
 * Groups the two sides' edits and cuts all three into chunks.
 *
 * Edits that cover different parts of the base are independent, so each is
 * taken on its own and the merge combines them. Edits that cover the same
 * lines, and two insertions at the same point, become one chunk that carries
 * what all three sides hold there.
 */
function buildChunks(
  base: string[],
  ours: string[],
  theirs: string[],
  matchedOurs: Array<number | null>,
  matchedTheirs: Array<number | null>,
): MergeChunk[] {
  const blocks = [
    ...editBlocks("ours", matchedOurs, base.length, ours.length),
    ...editBlocks("theirs", matchedTheirs, base.length, theirs.length),
  ].sort((left, right) =>
    left.baseStart === right.baseStart
      ? left.baseEnd - right.baseEnd
      : left.baseStart - right.baseStart,
  );
  const chunks: MergeChunk[] = [];
  let baseCursor = 0;
  let oursCursor = 0;
  let theirsCursor = 0;
  let index = 0;
  while (index < blocks.length) {
    const group = [blocks[index]];
    let baseStart = blocks[index].baseStart;
    let baseEnd = blocks[index].baseEnd;
    index += 1;
    while (index < blocks.length && overlaps(baseStart, baseEnd, blocks[index])) {
      baseEnd = Math.max(baseEnd, blocks[index].baseEnd);
      group.push(blocks[index]);
      index += 1;
    }
    const gap = baseStart - baseCursor;
    if (gap > 0) {
      chunks.push({
        id: chunkId(chunks.length),
        kind: "stable",
        base: base.slice(baseCursor, baseCursor + gap),
        ours: ours.slice(oursCursor, oursCursor + gap),
        theirs: theirs.slice(theirsCursor, theirsCursor + gap),
        automatic: "ours",
      });
      baseCursor += gap;
      oursCursor += gap;
      theirsCursor += gap;
    }
    const span = baseEnd - baseStart;
    const oursEnd = oursCursor + span + growth(group, "ours");
    const theirsEnd = theirsCursor + span + growth(group, "theirs");
    chunks.push(
      unstableChunk(
        chunks.length,
        base.slice(baseCursor, baseEnd),
        ours.slice(oursCursor, oursEnd),
        theirs.slice(theirsCursor, theirsEnd),
      ),
    );
    baseCursor = baseEnd;
    oursCursor = oursEnd;
    theirsCursor = theirsEnd;
  }
  if (baseCursor < base.length) {
    chunks.push({
      id: chunkId(chunks.length),
      kind: "stable",
      base: base.slice(baseCursor),
      ours: ours.slice(oursCursor),
      theirs: theirs.slice(theirsCursor),
      automatic: "ours",
    });
  }
  return chunks;
}

/**
 * Whether one edit belongs to the group that already covers a base range.
 *
 * Ranges that genuinely intersect always do. Two insertions at the same point
 * do too: they hold different text for the same place, which is a choice only
 * the user can make.
 */
function overlaps(baseStart: number, baseEnd: number, block: EditBlock): boolean {
  if (block.baseStart < baseEnd) {
    return true;
  }
  return (
    block.baseStart === baseEnd &&
    block.baseStart === block.baseEnd &&
    baseStart === baseEnd
  );
}

/** How many lines one side's edits in a group add to, or remove from, the base. */
function growth(group: EditBlock[], side: "ours" | "theirs"): number {
  return group
    .filter((block) => block.side === side)
    .reduce(
      (total, block) =>
        total +
        (block.sideEnd - block.sideStart) -
        (block.baseEnd - block.baseStart),
      0,
    );
}

function unstableChunk(
  ordinal: number,
  base: string[],
  ours: string[],
  theirs: string[],
): MergeChunk {
  const id = chunkId(ordinal);
  if (sameLines(ours, base)) {
    return { id, kind: "resolved", base, ours, theirs, automatic: "theirs" };
  }
  if (sameLines(theirs, base)) {
    return { id, kind: "resolved", base, ours, theirs, automatic: "ours" };
  }
  if (sameLines(ours, theirs)) {
    return { id, kind: "resolved", base, ours, theirs, automatic: "ours" };
  }
  return { id, kind: "conflict", base, ours, theirs, automatic: null };
}

function chunkId(ordinal: number): string {
  return `chunk-${ordinal}`;
}

function sameLines(left: string[], right: string[]): boolean {
  return (
    left.length === right.length &&
    left.every((line, index) => line === right[index])
  );
}

/**
 * Matches the lines of two sides by their longest common subsequence.
 *
 * The shared prefix and suffix are matched directly, so the comparison itself
 * only ever runs over the part that actually differs. A remainder larger than
 * {@link MAX_MERGE_MATRIX_CELLS} is refused rather than merged slowly.
 */
function matches(left: string[], right: string[]): Array<number | null> {
  const matched: Array<number | null> = new Array(left.length).fill(null);
  let prefix = 0;
  while (
    prefix < left.length &&
    prefix < right.length &&
    left[prefix] === right[prefix]
  ) {
    matched[prefix] = prefix;
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < left.length - prefix &&
    suffix < right.length - prefix &&
    left[left.length - 1 - suffix] === right[right.length - 1 - suffix]
  ) {
    matched[left.length - 1 - suffix] = right.length - 1 - suffix;
    suffix += 1;
  }
  const leftMiddle = left.slice(prefix, left.length - suffix);
  const rightMiddle = right.slice(prefix, right.length - suffix);
  if (leftMiddle.length === 0 || rightMiddle.length === 0) {
    return matched;
  }
  if ((leftMiddle.length + 1) * (rightMiddle.length + 1) > MAX_MERGE_MATRIX_CELLS) {
    throw new MergeTooLarge();
  }
  const rows = leftMiddle.length + 1;
  const columns = rightMiddle.length + 1;
  const lengths = new Uint32Array(rows * columns);
  for (let row = leftMiddle.length - 1; row >= 0; row -= 1) {
    for (let column = rightMiddle.length - 1; column >= 0; column -= 1) {
      lengths[row * columns + column] =
        leftMiddle[row] === rightMiddle[column]
          ? lengths[(row + 1) * columns + column + 1] + 1
          : Math.max(
              lengths[(row + 1) * columns + column],
              lengths[row * columns + column + 1],
            );
    }
  }
  let row = 0;
  let column = 0;
  while (row < leftMiddle.length && column < rightMiddle.length) {
    if (leftMiddle[row] === rightMiddle[column]) {
      matched[prefix + row] = prefix + column;
      row += 1;
      column += 1;
      continue;
    }
    if (
      lengths[(row + 1) * columns + column] >=
      lengths[row * columns + column + 1]
    ) {
      row += 1;
    } else {
      column += 1;
    }
  }
  return matched;
}
