import {
  LanguageSupport,
  StreamLanguage,
  type StringStream,
} from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { tags } from "@lezer/highlight";

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
    aliases: ["jsx", "react", "reactjs", "react-jsx"],
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
    aliases: ["tsx", "typescriptreact", "reacttsx", "react-tsx"],
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
    id: "gomod",
    name: "Go module",
    fence: "gomod",
    aliases: ["gomod", "go.mod", "go.sum", "go.work"],
    extensions: [],
    filenames: [/^go\.(?:mod|sum|work|work\.sum)$/i],
    load: async () => goModuleSupport,
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
    filenames: [/^(?:BUCK|BUILD(?:\.bazel)?|WORKSPACE|MODULE\.bazel)$/],
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
    id: "terraform",
    name: "Terraform / HCL",
    fence: "terraform",
    aliases: ["terraform", "hcl", "tf"],
    extensions: ["tf", "hcl", "tfvars"],
    load: async () => {
      const { hcl } = await import("codemirror-lang-hcl");
      return hcl();
    },
  },
  {
    id: "helm",
    name: "Helm template",
    fence: "helm",
    aliases: ["helm", "gotemplate", "go-template"],
    extensions: ["tpl"],
    filenames: [/^_helpers\.tpl$/i],
    load: async () => helmTemplateSupport,
  },
  {
    id: "json",
    name: "JSON",
    fence: "json",
    aliases: ["json", "json5"],
    extensions: ["json", "json5", "map"],
    filenames: [/^(?:Pipfile|composer)\.lock$/i],
    catalogName: "JSON",
  },
  {
    id: "xml",
    name: "XML",
    fence: "xml",
    aliases: ["xml", "rss", "wsdl", "xsd"],
    extensions: [
      "xml",
      "xsl",
      "xsd",
      "svg",
      "csproj",
      "fsproj",
      "vbproj",
      "vcxproj",
      "props",
      "targets",
      "nuspec",
      "slnx",
    ],
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
    filenames: [/^PKGBUILD$/, /^Procfile$/i, /^\.env(?:\..+)?$/i],
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
    filenames: [/^(?:Cargo|poetry|uv)\.lock$/i],
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
    id: "postgresql",
    name: "PostgreSQL",
    fence: "postgresql",
    aliases: ["postgresql", "postgres", "pgsql", "psql"],
    extensions: ["pgsql", "psql"],
    catalogName: "PostgreSQL",
  },
  {
    id: "mysql",
    name: "MySQL",
    fence: "mysql",
    aliases: ["mysql"],
    extensions: ["mysql"],
    catalogName: "MySQL",
  },
  {
    id: "mariadb",
    name: "MariaDB SQL",
    fence: "mariadb",
    aliases: ["mariadb", "mariadb-sql"],
    extensions: ["mariadb.sql"],
    catalogName: "MariaDB SQL",
  },
  {
    id: "mssql",
    name: "MS SQL",
    fence: "mssql",
    aliases: ["mssql", "ms-sql", "tsql"],
    extensions: ["mssql.sql", "tsql"],
    catalogName: "MS SQL",
  },
  {
    id: "plsql",
    name: "PL/SQL",
    fence: "plsql",
    aliases: ["plsql", "oracle-sql"],
    extensions: ["pls", "plsql", "pkb", "pks"],
    catalogName: "PLSQL",
  },
  {
    id: "sqlite",
    name: "SQLite SQL",
    fence: "sqlite",
    aliases: ["sqlite", "sqlite-sql"],
    extensions: ["sqlite.sql"],
    catalogName: "SQLite",
  },
  {
    id: "cql",
    name: "CQL",
    fence: "cql",
    aliases: ["cql", "cassandra"],
    extensions: ["cql"],
    catalogName: "CQL",
  },
  {
    id: "latex",
    name: "LaTeX",
    fence: "latex",
    aliases: ["latex", "tex"],
    extensions: ["tex", "ltx"],
    catalogName: "LaTeX",
  },
  {
    id: "jinja",
    name: "Jinja",
    fence: "jinja",
    aliases: ["jinja", "jinja2", "j2"],
    extensions: ["j2", "jinja", "jinja2"],
    catalogName: "Jinja",
  },
  {
    id: "vue",
    name: "Vue",
    fence: "vue",
    aliases: ["vue", "vuejs"],
    extensions: ["vue"],
    catalogName: "Vue",
  },
  {
    id: "angular",
    name: "Angular template",
    fence: "angular",
    aliases: ["angular", "angular-template"],
    extensions: ["component.html", "component.htm"],
    catalogName: "Angular Template",
  },
  {
    id: "haskell",
    name: "Haskell",
    fence: "haskell",
    aliases: ["haskell", "hs"],
    extensions: ["hs", "lhs"],
    catalogName: "Haskell",
  },
  {
    id: "clojure",
    name: "Clojure",
    fence: "clojure",
    aliases: ["clojure", "clj"],
    extensions: ["clj", "cljc", "cljx"],
    catalogName: "Clojure",
  },
  {
    id: "commonlisp",
    name: "Common Lisp",
    fence: "lisp",
    aliases: ["common-lisp", "commonlisp", "lisp"],
    extensions: ["cl", "lisp", "lsp"],
    catalogName: "Common Lisp",
  },
  {
    id: "clojurescript",
    name: "ClojureScript",
    fence: "clojurescript",
    aliases: ["clojurescript", "cljs"],
    extensions: ["cljs"],
    catalogName: "ClojureScript",
  },
  {
    id: "erlang",
    name: "Erlang",
    fence: "erlang",
    aliases: ["erlang", "erl"],
    extensions: ["erl", "hrl"],
    catalogName: "Erlang",
  },
  {
    id: "ocaml",
    name: "OCaml",
    fence: "ocaml",
    aliases: ["ocaml"],
    extensions: ["ml", "mli", "mll", "mly"],
    catalogName: "OCaml",
  },
  {
    id: "fsharp",
    name: "F#",
    fence: "fsharp",
    aliases: ["fsharp", "f#"],
    extensions: ["fs", "fsx", "fsi"],
    catalogName: "F#",
  },
  {
    id: "fortran",
    name: "Fortran",
    fence: "fortran",
    aliases: ["fortran"],
    extensions: ["f", "for", "f77", "f90", "f95", "f03", "f08"],
    catalogName: "Fortran",
  },
  {
    id: "julia",
    name: "Julia",
    fence: "julia",
    aliases: ["julia", "jl"],
    extensions: ["jl"],
    catalogName: "Julia",
  },
  {
    id: "perl",
    name: "Perl",
    fence: "perl",
    aliases: ["perl"],
    extensions: ["pl", "pm", "t"],
    catalogName: "Perl",
  },
  {
    id: "pascal",
    name: "Pascal",
    fence: "pascal",
    aliases: ["pascal"],
    extensions: ["p", "pas", "pp"],
    catalogName: "Pascal",
  },
  {
    id: "vbnet",
    name: "VB.NET",
    fence: "vbnet",
    aliases: ["vbnet", "vb.net", "visual-basic"],
    extensions: ["vb"],
    catalogName: "VB.NET",
  },
  {
    id: "cobol",
    name: "Cobol",
    fence: "cobol",
    aliases: ["cobol"],
    extensions: ["cob", "cpy", "cbl"],
    catalogName: "Cobol",
  },
  {
    id: "puppet",
    name: "Puppet",
    fence: "puppet",
    aliases: ["puppet"],
    extensions: ["pp"],
    catalogName: "Puppet",
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
  {
    id: "cmake",
    name: "CMake",
    fence: "cmake",
    aliases: ["cmake"],
    extensions: ["cmake", "cmake.in"],
    filenames: [/^CMakeLists\.txt$/i],
    catalogName: "CMake",
  },
  {
    id: "makefile",
    name: "Makefile",
    fence: "makefile",
    aliases: ["makefile", "make", "gnumake"],
    extensions: ["mk", "mak"],
    filenames: [/^(?:GNUmakefile|Makefile)(?:\..+)?$/i],
    load: async () => makefileSupport,
  },
  {
    id: "groovy",
    name: "Groovy",
    fence: "groovy",
    aliases: ["groovy", "gradle"],
    extensions: ["groovy", "gradle"],
    filenames: [/^Jenkinsfile$/i],
    catalogName: "Groovy",
  },
  {
    id: "properties",
    name: "Properties",
    fence: "properties",
    aliases: ["properties", "ini", "editorconfig"],
    extensions: ["properties", "ini", "cfg", "editorconfig"],
    filenames: [/^\.editorconfig$/i],
    catalogName: "Properties files",
  },
  {
    id: "protobuf",
    name: "Protocol Buffers",
    fence: "proto",
    aliases: ["protobuf", "proto"],
    extensions: ["proto"],
    catalogName: "ProtoBuf",
  },
  {
    id: "solution",
    name: "Visual Studio solution",
    fence: "sln",
    aliases: ["solution", "sln"],
    extensions: ["sln"],
    catalogName: "Properties files",
  },
  {
    id: "meson",
    name: "Meson",
    fence: "meson",
    aliases: ["meson"],
    extensions: [],
    filenames: [/^(?:meson\.build|meson_options\.txt)$/i],
    catalogName: "Python",
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
const languageByFence = new Map<string, CoreSyntaxLanguage | null>();
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
    registerUnambiguousLanguage(
      languageByFence,
      normalizeLookup(value),
      language,
    );
  }
}

const languageByExtension = new Map<string, CoreSyntaxLanguage | null>();
for (const language of CORE_SYNTAX_LANGUAGES) {
  for (const extension of language.extensions) {
    registerUnambiguousLanguage(
      languageByExtension,
      extension.toLocaleLowerCase(),
      language,
    );
  }
}
const sourceExtensionMatchers = [...languageByExtension.entries()]
  .map(([extension, language]) => ({ extension, language }))
  .sort((left, right) => right.extension.length - left.extension.length);

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
    if (
      language.filenames.some((pattern) => {
        pattern.lastIndex = 0;
        return pattern.test(fileName);
      })
    ) {
      return language;
    }
  }
  const normalizedFileName = fileName.toLocaleLowerCase();
  const matched = sourceExtensionMatchers.find(({ extension }) =>
    normalizedFileName.endsWith(`.${extension}`),
  );
  return matched?.language ?? null;
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

function registerUnambiguousLanguage(
  registry: Map<string, CoreSyntaxLanguage | null>,
  key: string,
  language: CoreSyntaxLanguage,
): void {
  if (!registry.has(key)) {
    registry.set(key, language);
    return;
  }
  if (registry.get(key)?.id !== language.id) {
    registry.set(key, null);
  }
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

const goModuleSupport = new LanguageSupport(
  StreamLanguage.define<Record<never, never>>({
    name: "go-module",
    startState: () => ({}),
    token(stream) {
      if (stream.eatSpace()) {
        return null;
      }
      if (stream.match("//")) {
        stream.skipToEnd();
        return "comment";
      }
      if (
        stream.match(
          /^(?:module|go|toolchain|require|exclude|replace|retract|use|godebug|tool)\b/,
        )
      ) {
        return "keyword";
      }
      if (stream.match(/^(?:=>|\(|\))/)) {
        return "operator";
      }
      if (stream.match(/^"(?:[^"\\]|\\.)*"/)) {
        return "string";
      }
      if (
        stream.match(
          /^(?:v\d+\.\d+\.\d+(?:-[0-9A-Za-z.+-]+)?|go\d+\.\d+(?:\.\d+)?|h1:[A-Za-z0-9+/=]+)/,
        )
      ) {
        return "number";
      }
      consumeAuxiliaryToken(stream);
      return "string";
    },
  }),
);

const makefileSupport = new LanguageSupport(
  StreamLanguage.define<Record<never, never>>({
    name: "makefile",
    startState: () => ({}),
    token(stream) {
      if (stream.eatSpace()) {
        return null;
      }
      if (stream.match("#")) {
        stream.skipToEnd();
        return "comment";
      }
      if (
        stream.match(
          /^(?:include|-include|sinclude|define|endef|ifeq|ifneq|ifdef|ifndef|else|endif|override|export|unexport|private|vpath)\b/,
        )
      ) {
        return "keyword";
      }
      if (stream.match(/^\$\([^)]+\)|^\$\{[^}]+\}/)) {
        return "variableName";
      }
      if (
        stream.sol() &&
        stream.match(/^[^\s:=][^:=]*:(?![=])/)
      ) {
        return "labelName";
      }
      if (stream.match(/^(?::=|\?=|\+=|!=|=|::|:)/)) {
        return "operator";
      }
      if (stream.match(/^"(?:[^"\\]|\\.)*"|^'(?:[^'\\]|\\.)*'/)) {
        return "string";
      }
      consumeAuxiliaryToken(stream);
      return null;
    },
  }),
);

interface HelmTemplateState {
  inAction: boolean;
  inComment: boolean;
  quote: '"' | "'" | null;
}

const helmTemplateSupport = new LanguageSupport(
  StreamLanguage.define<HelmTemplateState>({
    name: "helm-template",
    startState: () => ({ inAction: false, inComment: false, quote: null }),
    copyState: (state) => ({ ...state }),
    tokenTable: {
      "helm-function": tags.function(tags.variableName),
    },
    token(stream, state) {
      if (state.inComment) {
        if (stream.skipTo("*/")) {
          stream.match("*/");
          state.inComment = false;
        } else {
          stream.skipToEnd();
        }
        return "comment";
      }
      if (state.inAction) {
        if (stream.eatSpace()) {
          return null;
        }
        if (stream.match(/^\/\*/)) {
          state.inComment = true;
          return "comment";
        }
        if (stream.match(/^-?\}\}/)) {
          state.inAction = false;
          return "operator";
        }
        if (
          stream.match(
            /^(?:if|else|end|range|with|define|block|template)\b/,
          )
        ) {
          return "keyword";
        }
        if (
          stream.match(
            /^(?:include|required|tpl|lookup|default|quote|squote|toYaml|fromYaml|indent|nindent|fail|printf|print|println)\b/,
          )
        ) {
          return "helm-function";
        }
        if (
          stream.match(
            /^(?:\$(?:[A-Za-z_][\w]*)?|\.(?:Values|Release|Chart|Capabilities|Files|Template)(?:\.[\w-]+)*)/,
          )
        ) {
          return "variableName";
        }
        if (stream.match(/^"(?:[^"\\]|\\.)*"|^`[^`]*`/)) {
          return "string";
        }
        if (stream.match(/^(?:true|false|nil)\b/)) {
          return "atom";
        }
        if (stream.match(/^-?\d+(?:\.\d+)?\b/)) {
          return "number";
        }
        if (stream.match(/^(?::=|=|\||,|\(|\))/)) {
          return "operator";
        }
        if (stream.match(/^[A-Za-z_][\w-]*/)) {
          return "variableName";
        }
        stream.next();
        return null;
      }
      if (stream.sol() && state.quote) {
        state.quote = null;
      }
      if (state.quote) {
        if (stream.match(/^\{\{-?/)) {
          state.inAction = true;
          return "operator";
        }
        if (state.quote === "'" && stream.match("''")) {
          return "string";
        }
        if (state.quote === '"' && stream.peek() === "\\") {
          stream.next();
          if (!stream.eol()) {
            stream.next();
          }
          return "string";
        }
        if (stream.eatSpace()) {
          return null;
        }
        if (stream.peek() === state.quote) {
          stream.next();
          state.quote = null;
          return "string";
        }
        while (
          !stream.eol() &&
          stream.peek() !== state.quote &&
          !stream.string.startsWith("{{", stream.pos)
        ) {
          stream.next();
        }
        return "string";
      }
      if (stream.match(/^\{\{-?/)) {
        state.inAction = true;
        return "operator";
      }
      if (stream.match("#")) {
        stream.skipToEnd();
        return "comment";
      }
      if (stream.match(/^(?:---|\.\.\.)$/)) {
        return "meta";
      }
      if (stream.match(/^[\w.-]+(?=\s*:)/)) {
        return "propertyName";
      }
      const quote = stream.peek();
      if (quote === '"' || quote === "'") {
        stream.next();
        state.quote = quote;
        return "string";
      }
      if (stream.match(/^(?:true|false|null|~)\b/i)) {
        return "atom";
      }
      if (stream.match(/^-?\d+(?:\.\d+)?\b/)) {
        return "number";
      }
      if (stream.match(/^[&*][\w.-]+/)) {
        return "variableName";
      }
      if (stream.match(/^(?:-|\[|\]|\{|\}|,|:)/)) {
        return "operator";
      }
      consumeAuxiliaryToken(stream);
      return "string";
    },
  }),
);

function consumeAuxiliaryToken(stream: StringStream): void {
  if (!stream.eatWhile(/[^\s(){}:=]/)) {
    stream.next();
  }
}
