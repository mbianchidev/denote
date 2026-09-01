import type { LanguageSupport } from "@codemirror/language";
import { languages } from "@codemirror/language-data";

export const AUTOMATIC_LANGUAGE = "auto";
export const PLAIN_TEXT_LANGUAGE = "text";

interface CoreSyntaxLanguageDefinition {
  id: string;
  name: string;
  fence: string;
  aliases: readonly string[];
  extensions: readonly string[];
  filenames?: readonly RegExp[];
  catalogName?: string;
  load?: () => Promise<LanguageSupport>;
}

export interface CoreSyntaxLanguage {
  id: CoreSyntaxLanguageId;
  name: string;
  fence: string;
  aliases: readonly string[];
  extensions: readonly string[];
  filenames: readonly RegExp[];
}

export interface LanguageOption {
  value: LanguageChoice;
  label: string;
  searchTerms: readonly string[];
}

const LANGUAGE_DEFINITIONS = [
  {
    id: "javascript",
    name: "JavaScript",
    fence: "js",
    aliases: ["javascript", "js", "ecmascript", "node"],
    extensions: ["js", "mjs", "cjs"],
    catalogName: "JavaScript",
  },
  {
    id: "jsx",
    name: "JSX",
    fence: "jsx",
    aliases: ["jsx", "react"],
    extensions: ["jsx", "mdx"],
    catalogName: "JSX",
  },
  {
    id: "typescript",
    name: "TypeScript",
    fence: "ts",
    aliases: ["typescript", "ts"],
    extensions: ["ts", "mts", "cts"],
    catalogName: "TypeScript",
  },
  {
    id: "tsx",
    name: "TSX",
    fence: "tsx",
    aliases: ["tsx", "typescriptreact"],
    extensions: ["tsx"],
    catalogName: "TSX",
  },
  {
    id: "java",
    name: "Java",
    fence: "java",
    aliases: ["java"],
    extensions: ["java"],
    catalogName: "Java",
  },
  {
    id: "jsp",
    name: "JSP",
    fence: "jsp",
    aliases: ["jsp", "javaserverpages"],
    extensions: ["jsp"],
    catalogName: "HTML",
  },
  {
    id: "go",
    name: "Go",
    fence: "go",
    aliases: ["go", "golang"],
    extensions: ["go"],
    catalogName: "Go",
  },
  {
    id: "rust",
    name: "Rust",
    fence: "rust",
    aliases: ["rust", "rs"],
    extensions: ["rs"],
    catalogName: "Rust",
  },
  {
    id: "python",
    name: "Python",
    fence: "python",
    aliases: ["python", "py"],
    extensions: ["py", "pyw", "bzl"],
    filenames: [/^(?:BUCK|BUILD)$/],
    catalogName: "Python",
  },
  {
    id: "c",
    name: "C",
    fence: "c",
    aliases: ["c"],
    extensions: ["c", "h", "ino"],
    catalogName: "C",
  },
  {
    id: "cpp",
    name: "C++",
    fence: "cpp",
    aliases: ["cpp", "c++"],
    extensions: ["cc", "cpp", "cxx", "c++", "hpp", "hh", "hxx", "h++"],
    catalogName: "C++",
  },
  {
    id: "csharp",
    name: "C#",
    fence: "cs",
    aliases: ["csharp", "cs", "c#"],
    extensions: ["cs"],
    catalogName: "C#",
  },
  {
    id: "kotlin",
    name: "Kotlin",
    fence: "kotlin",
    aliases: ["kotlin", "kt", "kts"],
    extensions: ["kt", "kts"],
    catalogName: "Kotlin",
  },
  {
    id: "swift",
    name: "Swift",
    fence: "swift",
    aliases: ["swift"],
    extensions: ["swift"],
    catalogName: "Swift",
  },
  {
    id: "ruby",
    name: "Ruby",
    fence: "ruby",
    aliases: ["ruby", "rb", "jruby", "rake"],
    extensions: ["rb"],
    filenames: [/^(?:Gemfile|Rakefile)$/],
    catalogName: "Ruby",
  },
  {
    id: "php",
    name: "PHP",
    fence: "php",
    aliases: ["php"],
    extensions: ["php", "php3", "php4", "php5", "php7", "phtml"],
    catalogName: "PHP",
  },
  {
    id: "dart",
    name: "Dart",
    fence: "dart",
    aliases: ["dart"],
    extensions: ["dart"],
    catalogName: "Dart",
  },
  {
    id: "lua",
    name: "Lua",
    fence: "lua",
    aliases: ["lua"],
    extensions: ["lua"],
    catalogName: "Lua",
  },
  {
    id: "r",
    name: "R",
    fence: "r",
    aliases: ["r", "rscript"],
    extensions: ["r"],
    catalogName: "R",
  },
  {
    id: "scala",
    name: "Scala",
    fence: "scala",
    aliases: ["scala", "sc"],
    extensions: ["scala", "sc"],
    catalogName: "Scala",
  },
  {
    id: "elixir",
    name: "Elixir",
    fence: "elixir",
    aliases: ["elixir", "ex", "exs"],
    extensions: ["ex", "exs"],
    load: async () => {
      const { elixir } = await import("codemirror-lang-elixir");
      return elixir();
    },
  },
  {
    id: "json",
    name: "JSON",
    fence: "json",
    aliases: ["json", "json5"],
    extensions: ["json", "json5", "map"],
    catalogName: "JSON",
  },
  {
    id: "xml",
    name: "XML",
    fence: "xml",
    aliases: ["xml", "rss", "wsdl", "xsd"],
    extensions: ["xml", "xsl", "xsd", "svg"],
    catalogName: "XML",
  },
  {
    id: "html",
    name: "HTML",
    fence: "html",
    aliases: ["html", "htm", "xhtml"],
    extensions: ["html", "htm"],
    catalogName: "HTML",
  },
  {
    id: "css",
    name: "CSS",
    fence: "css",
    aliases: ["css"],
    extensions: ["css"],
    catalogName: "CSS",
  },
  {
    id: "scss",
    name: "SCSS",
    fence: "scss",
    aliases: ["scss"],
    extensions: ["scss"],
    catalogName: "SCSS",
  },
  {
    id: "less",
    name: "LESS",
    fence: "less",
    aliases: ["less"],
    extensions: ["less"],
    catalogName: "LESS",
  },
  {
    id: "markdown",
    name: "Markdown",
    fence: "markdown",
    aliases: ["markdown", "md"],
    extensions: ["md", "markdown", "mkd"],
    catalogName: "Markdown",
  },
  {
    id: "shell",
    name: "Shell",
    fence: "sh",
    aliases: ["shell", "bash", "sh", "zsh"],
    extensions: ["sh", "bash", "zsh", "ksh"],
    filenames: [/^PKGBUILD$/],
    catalogName: "Shell",
  },
  {
    id: "powershell",
    name: "PowerShell",
    fence: "powershell",
    aliases: ["powershell", "pwsh", "ps1"],
    extensions: ["ps1", "psd1", "psm1"],
    catalogName: "PowerShell",
  },
  {
    id: "yaml",
    name: "YAML",
    fence: "yaml",
    aliases: ["yaml", "yml"],
    extensions: ["yaml", "yml"],
    catalogName: "YAML",
  },
  {
    id: "toml",
    name: "TOML",
    fence: "toml",
    aliases: ["toml"],
    extensions: ["toml"],
    catalogName: "TOML",
  },
  {
    id: "sql",
    name: "SQL",
    fence: "sql",
    aliases: ["sql"],
    extensions: ["sql"],
    catalogName: "SQL",
  },
  {
    id: "dockerfile",
    name: "Dockerfile",
    fence: "dockerfile",
    aliases: ["dockerfile", "docker"],
    extensions: [],
    filenames: [/^Dockerfile$/i],
    catalogName: "Dockerfile",
  },
] as const satisfies readonly CoreSyntaxLanguageDefinition[];

export type CoreSyntaxLanguageId = (typeof LANGUAGE_DEFINITIONS)[number]["id"];
export type LanguageChoice =
  | typeof AUTOMATIC_LANGUAGE
  | typeof PLAIN_TEXT_LANGUAGE
  | CoreSyntaxLanguageId;
export type SourceLanguageOverride =
  | typeof PLAIN_TEXT_LANGUAGE
  | CoreSyntaxLanguageId
  | null;

export interface ResolvedSourceLanguage {
  language: CoreSyntaxLanguage | null;
  label: string;
  overridden: boolean;
}

export const CORE_SYNTAX_LANGUAGES: readonly CoreSyntaxLanguage[] =
  LANGUAGE_DEFINITIONS.map((language) => ({
    id: language.id,
    name: language.name,
    fence: language.fence,
    aliases: language.aliases,
    extensions: language.extensions,
    filenames: "filenames" in language ? language.filenames : [],
  }));

export const LANGUAGE_OPTIONS: readonly LanguageOption[] = [
  {
    value: AUTOMATIC_LANGUAGE,
    label: "Automatic",
    searchTerms: ["automatic", "detect", "filename", "extension"],
  },
  {
    value: PLAIN_TEXT_LANGUAGE,
    label: "Plain text",
    searchTerms: ["plain text", "text", "none", "unhighlighted"],
  },
  ...CORE_SYNTAX_LANGUAGES.map((language) => ({
    value: language.id,
    label: language.name,
    searchTerms: [
      language.name,
      language.fence,
      ...language.aliases,
      ...language.extensions,
    ],
  })),
];

const languageById = new Map(
  CORE_SYNTAX_LANGUAGES.map((language) => [language.id, language]),
);
const languageByFence = new Map<string, CoreSyntaxLanguage>();
const languageByExtension = new Map<string, CoreSyntaxLanguage>();
const definitionById = new Map<
  CoreSyntaxLanguageId,
  CoreSyntaxLanguageDefinition
>(
  LANGUAGE_DEFINITIONS.map((language) => [language.id, language]),
);
const loadCache = new Map<CoreSyntaxLanguageId, Promise<LanguageSupport>>();

for (const language of CORE_SYNTAX_LANGUAGES) {
  for (const value of [
    language.id,
    language.name,
    language.fence,
    ...language.aliases,
    ...language.extensions,
  ]) {
    languageByFence.set(normalizeLookup(value), language);
  }
  for (const extension of language.extensions) {
    if (!languageByExtension.has(extension.toLocaleLowerCase())) {
      languageByExtension.set(extension.toLocaleLowerCase(), language);
    }
  }
}

export function coreSyntaxLanguage(
  id: CoreSyntaxLanguageId,
): CoreSyntaxLanguage {
  const language = languageById.get(id);
  if (!language) {
    throw new Error(`Unknown core syntax language: ${id}`);
  }
  return language;
}

export function languageForFence(
  identifier: string,
): CoreSyntaxLanguage | null {
  return languageByFence.get(normalizeLookup(identifier)) ?? null;
}

export function detectSourceLanguage(path: string): CoreSyntaxLanguage | null {
  const pathParts = path.split(/[\\/]/);
  const fileName = pathParts[pathParts.length - 1] ?? path;
  for (const language of CORE_SYNTAX_LANGUAGES) {
    if (language.filenames.some((pattern) => pattern.test(fileName))) {
      return language;
    }
  }
  const dot = fileName.lastIndexOf(".");
  if (dot < 0 || dot === fileName.length - 1) {
    return null;
  }
  return (
    languageByExtension.get(fileName.slice(dot + 1).toLocaleLowerCase()) ?? null
  );
}

export function resolveSourceLanguage(
  path: string,
  override: SourceLanguageOverride,
): ResolvedSourceLanguage {
  if (override === PLAIN_TEXT_LANGUAGE) {
    return { language: null, label: "Plain text", overridden: true };
  }
  if (override) {
    return {
      language: coreSyntaxLanguage(override),
      label: coreSyntaxLanguage(override).name,
      overridden: true,
    };
  }
  const language = detectSourceLanguage(path);
  return {
    language,
    label: language?.name ?? "Plain text",
    overridden: false,
  };
}

export async function loadSyntaxLanguage(
  id: CoreSyntaxLanguageId,
): Promise<LanguageSupport> {
  const cached = loadCache.get(id);
  if (cached) {
    return cached;
  }
  const definition = definitionById.get(id);
  if (!definition) {
    throw new Error(`Unknown core syntax language: ${id}`);
  }
  const request = definition.load
    ? definition.load()
    : loadCatalogLanguage(definition.catalogName);
  loadCache.set(id, request);
  try {
    return await request;
  } catch (error) {
    if (loadCache.get(id) === request) {
      loadCache.delete(id);
    }
    throw error;
  }
}

export function languageChoiceLabel(
  value: LanguageChoice,
  unknownValue?: string,
): string {
  if (value === AUTOMATIC_LANGUAGE) {
    return "Automatic";
  }
  if (value === PLAIN_TEXT_LANGUAGE) {
    return "Plain text";
  }
  return languageById.get(value)?.name ?? unknownValue ?? value;
}

export function languageChoiceForFence(identifier: string): LanguageChoice {
  if (!identifier) {
    return AUTOMATIC_LANGUAGE;
  }
  if (normalizeLookup(identifier) === PLAIN_TEXT_LANGUAGE) {
    return PLAIN_TEXT_LANGUAGE;
  }
  return languageForFence(identifier)?.id ?? AUTOMATIC_LANGUAGE;
}

export function fenceIdentifierForChoice(choice: LanguageChoice): string {
  if (choice === AUTOMATIC_LANGUAGE) {
    return "";
  }
  if (choice === PLAIN_TEXT_LANGUAGE) {
    return PLAIN_TEXT_LANGUAGE;
  }
  return coreSyntaxLanguage(choice).fence;
}

function normalizeLookup(value: string): string {
  return value.trim().toLocaleLowerCase();
}

async function loadCatalogLanguage(
  catalogName: string | undefined,
): Promise<LanguageSupport> {
  const description = languages.find((language) => language.name === catalogName);
  if (!description) {
    throw new Error(`Bundled syntax grammar is unavailable: ${catalogName}`);
  }
  return description.load();
}
