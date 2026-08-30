import { languages } from "@codemirror/language-data";
import type { LanguageDescription } from "@codemirror/language";

export function sourceLanguageName(path: string): string | null {
  return sourceLanguage(path)?.name ?? null;
}

export async function loadSourceLanguage(path: string) {
  return sourceLanguage(path)?.load() ?? null;
}

function sourceLanguage(path: string): LanguageDescription | null {
  const pathParts = path.split("/");
  const fileName = pathParts[pathParts.length - 1] ?? path;
  const extension = fileName.includes(".")
    ? fileName.split(".").slice(-1)[0]?.toLowerCase()
    : undefined;
  const catalogExtension = extension === "mdx" ? "jsx" : extension;
  return (
    languages.find((language) => {
      if (
        catalogExtension &&
        language.extensions.includes(catalogExtension)
      ) {
        return true;
      }
      if (!language.filename) {
        return false;
      }
      language.filename.lastIndex = 0;
      return language.filename.test(fileName);
    }) ?? null
  );
}
