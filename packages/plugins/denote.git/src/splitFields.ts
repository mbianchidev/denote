/**
 * Bounded splitting used by every Git output parser.
 *
 * Git separates records with fixed characters but never escapes the final
 * field, so a commit subject, a remote URL, or a path that contains the
 * separator must stay inside the last field instead of shifting every value
 * after it.
 */
export function splitFields(
  value: string,
  separator: string,
  limit: number,
): string[] {
  if (limit < 1) {
    return [];
  }
  const fields: string[] = [];
  let start = 0;
  while (fields.length < limit - 1) {
    const index = value.indexOf(separator, start);
    if (index === -1) {
      break;
    }
    fields.push(value.slice(start, index));
    start = index + separator.length;
  }
  fields.push(value.slice(start));
  return fields;
}
