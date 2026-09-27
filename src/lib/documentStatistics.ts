export const MAX_WORD_COUNT_CHARACTERS = 200_000;

export function wordCountLabel(content: string): string {
  if (content.length > MAX_WORD_COUNT_CHARACTERS) {
    return "word count paused";
  }
  let count = 0;
  if ("Segmenter" in Intl) {
    const segmenter = new Intl.Segmenter(undefined, { granularity: "word" });
    for (const segment of segmenter.segment(content)) {
      if (segment.isWordLike) count += 1;
    }
  } else {
    for (const _match of content.matchAll(/\S+/gu)) count += 1;
  }
  return `${count} words`;
}
