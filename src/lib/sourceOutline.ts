import type { CoreSyntaxLanguageId } from "./syntaxLanguages";

export type SourceSymbolKind =
  | "function"
  | "class"
  | "type"
  | "module"
  | "resource"
  | "section";

export interface SourceSymbol {
  name: string;
  kind: SourceSymbolKind;
  line: number;
  depth: number;
}

export interface SourceViewport {
  firstLine: number;
  lastLine: number;
  totalLines: number;
  progress: number;
}

export interface SourceMinimapLine {
  line: number;
  top: number;
  left: number;
  width: number;
  kind: "code" | "comment" | "symbol";
}

export interface SourceEditorNavigation {
  request: number;
  line?: number;
  progress?: number;
}

const MAX_SYMBOLS = 1_000;
const MAX_LINE_LENGTH = 20_000;
const MAX_MINIMAP_LINES = 500;
const CONTROL_NAMES = new Set([
  "catch",
  "do",
  "else",
  "for",
  "if",
  "switch",
  "try",
  "while",
  "with",
]);

export function extractSourceSymbols(
  source: string,
  languageId: CoreSyntaxLanguageId | null,
): SourceSymbol[] {
  if (!languageId) {
    return [];
  }
  const symbols: SourceSymbol[] = [];
  let lineNumber = 1;
  let lineStart = 0;
  for (let index = 0; index <= source.length; index += 1) {
    if (index < source.length && source.charCodeAt(index) !== 10) {
      continue;
    }
    const lineEnd =
      index > lineStart && source.charCodeAt(index - 1) === 13
        ? index - 1
        : index;
    if (lineEnd - lineStart <= MAX_LINE_LENGTH) {
      const line = source.slice(lineStart, lineEnd);
      const symbol = sourceSymbolForLine(line, lineNumber, languageId);
      if (
        symbol &&
        !symbols.some(
          (candidate) =>
            candidate.line === symbol.line && candidate.name === symbol.name,
        )
      ) {
        symbols.push(symbol);
        if (symbols.length >= MAX_SYMBOLS) {
          break;
        }
      }
    }
    lineNumber += 1;
    lineStart = index + 1;
  }
  return symbols;
}

export function buildSourceMinimap(
  source: string,
  symbols: readonly SourceSymbol[],
): SourceMinimapLine[] {
  const totalLines = countSourceLines(source);
  const bucketSize = Math.max(1, Math.ceil(totalLines / MAX_MINIMAP_LINES));
  const symbolLines = new Set(symbols.map((symbol) => symbol.line));
  const minimap: SourceMinimapLine[] = [];
  let bucket: MinimapCandidate | null = null;
  let lineNumber = 1;
  let lineStart = 0;
  for (let index = 0; index <= source.length; index += 1) {
    if (index < source.length && source.charCodeAt(index) !== 10) {
      continue;
    }
    const lineEnd =
      index > lineStart && source.charCodeAt(index - 1) === 13
        ? index - 1
        : index;
    if (lineEnd - lineStart <= MAX_LINE_LENGTH) {
      const line = source.slice(lineStart, lineEnd);
      const candidate = minimapCandidate(line, lineNumber, symbolLines);
      if (
        candidate &&
        (!bucket ||
          candidate.kind === "symbol" ||
          (bucket.kind !== "symbol" && candidate.length > bucket.length))
      ) {
        bucket = candidate;
      }
    }
    if (lineNumber % bucketSize === 0 || index === source.length) {
      if (bucket) {
        minimap.push({
          line: bucket.line,
          top:
            totalLines <= 1
              ? 0
              : Math.min(1, (bucket.line - 1) / (totalLines - 1)),
          left: Math.min(0.4, bucket.indent / 120),
          width: Math.min(
            0.92,
            Math.max(0.04, bucket.length / 140),
          ),
          kind: bucket.kind,
        });
      }
      bucket = null;
    }
    lineNumber += 1;
    lineStart = index + 1;
  }
  return minimap;
}

interface MinimapCandidate {
  line: number;
  indent: number;
  length: number;
  kind: SourceMinimapLine["kind"];
}

function minimapCandidate(
  line: string,
  lineNumber: number,
  symbolLines: ReadonlySet<number>,
): MinimapCandidate | null {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }
  return {
    line: lineNumber,
    indent: indentationWidth(line),
    length: Math.min(140, trimmed.length),
    kind: symbolLines.has(lineNumber)
      ? "symbol"
      : /^(?:\/\/|#|;|--|\*|\/\*)/.test(trimmed)
        ? "comment"
        : "code",
  };
}

function countSourceLines(source: string): number {
  let lines = 1;
  for (let index = 0; index < source.length; index += 1) {
    if (source.charCodeAt(index) === 10) {
      lines += 1;
    }
  }
  return lines;
}

function sourceSymbolForLine(
  line: string,
  lineNumber: number,
  languageId: CoreSyntaxLanguageId,
): SourceSymbol | null {
  const trimmed = line.trim();
  if (!trimmed || /^(?:\/\/|#|;|--|\*)/.test(trimmed)) {
    return null;
  }
  const depth = Math.min(6, Math.floor(indentationWidth(line) / 2));
  const match = matchSourceSymbol(trimmed, languageId);
  return match ? { ...match, line: lineNumber, depth } : null;
}

function matchSourceSymbol(
  line: string,
  languageId: CoreSyntaxLanguageId,
): Pick<SourceSymbol, "name" | "kind"> | null {
  if (["javascript", "jsx", "typescript", "tsx", "vue"].includes(languageId)) {
    return (
      namedMatch(
        line,
        /^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\*?\s+([A-Za-z_$][\w$]*)/,
        "function",
      ) ??
      namedMatch(
        line,
        /^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)[^=]*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/,
        "function",
      ) ??
      namedMatch(
        line,
        /^(?:export\s+)?(?:default\s+)?class\s+([A-Za-z_$][\w$]*)/,
        "class",
      ) ??
      cLikeMethod(line)
    );
  }
  switch (languageId) {
    case "python":
      return (
        namedMatch(line, /^(?:async\s+)?def\s+([A-Za-z_]\w*)/, "function") ??
        namedMatch(line, /^class\s+([A-Za-z_]\w*)/, "class")
      );
    case "go":
      return (
        namedMatch(
          line,
          /^func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/,
          "function",
        ) ?? namedMatch(line, /^type\s+([A-Za-z_]\w*)/, "type")
      );
    case "rust":
      return (
        namedMatch(
          line,
          /^(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+([A-Za-z_]\w*)/,
          "function",
        ) ??
        namedMatch(
          line,
          /^(?:pub(?:\([^)]*\))?\s+)?(?:struct|enum|trait|type)\s+([A-Za-z_]\w*)/,
          "type",
        )
      );
    case "swift":
      return (
        namedMatch(line, /^(?:\w+\s+)*func\s+([A-Za-z_]\w*)/, "function") ??
        namedMatch(
          line,
          /^(?:\w+\s+)*(?:class|struct|enum|protocol)\s+([A-Za-z_]\w*)/,
          "type",
        )
      );
    case "ruby":
      return (
        namedMatch(line, /^def\s+(?:self\.)?([A-Za-z_]\w*[!?=]?)/, "function") ??
        namedMatch(line, /^(?:class|module)\s+([A-Za-z_:]\w*)/, "class")
      );
    case "php":
      return (
        namedMatch(
          line,
          /^(?:\w+\s+)*function\s+&?\s*([A-Za-z_]\w*)/,
          "function",
        ) ?? namedMatch(line, /^(?:\w+\s+)*class\s+([A-Za-z_]\w*)/, "class")
      );
    case "lua":
      return namedMatch(
        line,
        /^(?:local\s+)?function\s+([A-Za-z_][\w.:]*)/,
        "function",
      );
    case "r":
      return namedMatch(
        line,
        /^([A-Za-z_.]\w*)\s*(?:<-|=)\s*function\s*\(/,
        "function",
      );
    case "elixir":
      return (
        namedMatch(line, /^defmodule\s+([A-Za-z_][\w.]*)/, "module") ??
        namedMatch(line, /^defp?\s+([A-Za-z_]\w*[!?]?)/, "function")
      );
    case "haskell":
      return namedMatch(
        line,
        /^([a-z_]\w*)\s*(?:::|[^=]*=)/,
        "function",
      );
    case "clojure":
    case "clojurescript":
      return namedMatch(
        line,
        /^\((?:defn-?|defmacro)\s+([^\s()[\]{}]+)/,
        "function",
      );
    case "commonlisp":
      return namedMatch(
        line,
        /^\((?:defun|defmacro|defgeneric|defmethod)\s+([^\s()[\]{}]+)/i,
        "function",
      );
    case "erlang":
      return namedMatch(line, /^([a-z]\w*)\s*\([^)]*\)\s*->/, "function");
    case "ocaml":
      return (
        namedMatch(
          line,
          /^let\s+(?:rec\s+)?([a-z_]\w*)/,
          "function",
        ) ?? namedMatch(line, /^(?:module|type)\s+([A-Za-z_]\w*)/, "type")
      );
    case "fsharp":
      return (
        namedMatch(
          line,
          /^(?:let|and)\s+(?:rec\s+)?(?:inline\s+)?([A-Za-z_]\w*)/,
          "function",
        ) ?? namedMatch(line, /^(?:type|module)\s+([A-Za-z_][\w.]*)/, "type")
      );
    case "fortran":
      return namedMatch(
        line,
        /^(?:\w+\s+)*(?:subroutine|function|module)\s+([A-Za-z_]\w*)/i,
        "function",
      );
    case "julia":
      return (
        namedMatch(line, /^function\s+([A-Za-z_]\w*[!.]?)/, "function") ??
        namedMatch(
          line,
          /^([A-Za-z_]\w*[!.]?)\s*\([^)]*\)\s*=/,
          "function",
        ) ??
        namedMatch(
          line,
          /^(?:mutable\s+)?struct\s+([A-Za-z_]\w*)/,
          "type",
        )
      );
    case "perl":
      return namedMatch(line, /^sub\s+([A-Za-z_]\w*)/, "function");
    case "pascal":
      return namedMatch(
        line,
        /^(?:class\s+)?(?:procedure|function|constructor|destructor)\s+([A-Za-z_]\w*)/i,
        "function",
      );
    case "vbnet":
      return (
        namedMatch(
          line,
          /^(?:\w+\s+)*(?:Sub|Function)\s+([A-Za-z_]\w*)/i,
          "function",
        ) ??
        namedMatch(
          line,
          /^(?:\w+\s+)*(?:Class|Module|Structure|Interface)\s+([A-Za-z_]\w*)/i,
          "type",
        )
      );
    case "cobol":
      return namedMatch(
        line,
        /^([A-Z0-9][A-Z0-9-]*)\.\s*(?:$|\*>)/i,
        "section",
      );
    case "puppet":
      return namedMatch(
        line,
        /^(?:class|define|function)\s+([A-Za-z_][\w:]*)/,
        "function",
      );
    case "terraform":
      return terraformBlockMatch(line);
    case "helm":
      return namedMatch(
        line,
        /^\{\{-?\s*(?:define|block)\s+"([^"]+)"/,
        "section",
      );
    case "sql":
    case "postgresql":
    case "mysql":
    case "mariadb":
    case "mssql":
    case "plsql":
    case "sqlite":
    case "cql":
      return namedMatch(
        line,
        /^create\s+(?:or\s+replace\s+)?(?:function|procedure|view|table|trigger)\s+(?:if\s+not\s+exists\s+)?([`"[\]\w.]+)/i,
        "function",
      );
    case "latex":
      return (
        namedMatch(
          line,
          /^\\(?:part|chapter|section|subsection|subsubsection)\*?\{([^}]+)\}/,
          "section",
        ) ??
        namedMatch(
          line,
          /^\\(?:newcommand|renewcommand)\s*\{?\\([A-Za-z@]+)\}?/,
          "function",
        )
      );
    case "jinja":
      return namedMatch(
        line,
        /^\{%-?\s*(?:macro|block)\s+([A-Za-z_]\w*)/,
        "section",
      );
    case "c":
    case "cpp":
    case "csharp":
    case "java":
    case "kotlin":
    case "dart":
    case "scala":
      return cLikeMethod(line);
    default:
      return null;
  }
}

function cLikeMethod(
  line: string,
): Pick<SourceSymbol, "name" | "kind"> | null {
  const classMatch =
    /^(?:\w+\s+)*(?:class|struct|interface|enum|record)\s+([A-Za-z_]\w*)/.exec(
      line,
    );
  if (classMatch) {
    return { name: classMatch[1], kind: "type" };
  }
  const match =
    /^(?:[\w<>{}[\],.?*&:@$]+\s+)+([A-Za-z_$~][\w$~]*)\s*\([^;]*\)\s*(?:const\s*)?(?:\{|=>)/.exec(
      line,
    );
  if (!match || CONTROL_NAMES.has(match[1])) {
    return null;
  }
  return { name: match[1], kind: "function" };
}

function namedMatch(
  line: string,
  pattern: RegExp,
  kind: SourceSymbolKind,
): Pick<SourceSymbol, "name" | "kind"> | null {
  const match = pattern.exec(line);
  return match?.[1] ? { name: match[1], kind } : null;
}

function terraformBlockMatch(
  line: string,
): Pick<SourceSymbol, "name" | "kind"> | null {
  const doubleLabel = /^(resource|data)\s+"([^"]+)"\s+"([^"]+)"/.exec(
    line,
  );
  if (doubleLabel) {
    return {
      name: `${doubleLabel[1]} ${doubleLabel[2]}.${doubleLabel[3]}`,
      kind: "resource",
    };
  }
  const singleLabel =
    /^(module|variable|output|provider)\s+"([^"]+)"/.exec(line);
  if (singleLabel) {
    return {
      name: `${singleLabel[1]} ${singleLabel[2]}`,
      kind: "resource",
    };
  }
  const singleton = /^(locals|terraform)\s*\{/.exec(line);
  return singleton
    ? { name: singleton[1], kind: "section" }
    : null;
}

function indentationWidth(line: string): number {
  let width = 0;
  for (const character of line) {
    if (character === " ") {
      width += 1;
    } else if (character === "\t") {
      width += 2;
    } else {
      break;
    }
  }
  return width;
}
