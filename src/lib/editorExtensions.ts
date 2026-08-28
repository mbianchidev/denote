import {
  HighlightStyle,
  syntaxHighlighting,
} from "@codemirror/language";
import { Prec, type Extension, type Range } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
  WidgetType,
  highlightTrailingWhitespace,
  highlightWhitespace,
  lineNumbers,
} from "@codemirror/view";
import { tags } from "@lezer/highlight";
import type { FileLineEnding } from "../types";
import type { EditorDisplaySettings } from "./editorDisplay";

export const denoteCodeMirrorTheme: Extension = [
  Prec.highest(
    EditorView.theme({
      "&": {
        color: "var(--text-primary)",
        backgroundColor: "var(--code-bg)",
      },
      ".cm-content": {
        caretColor: "var(--accent-strong)",
      },
      ".cm-cursor, .cm-dropCursor": {
        borderLeftColor: "var(--accent-strong)",
      },
      "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection":
        {
          backgroundColor: "var(--code-selection) !important",
        },
      ".cm-gutters": {
        color: "var(--text-tertiary)",
        backgroundColor: "var(--code-gutter-bg)",
        borderRightColor: "var(--code-border)",
      },
      ".cm-activeLine, .cm-activeLineGutter": {
        backgroundColor: "var(--code-active-line)",
      },
      ".cm-matchingBracket": {
        color: "var(--text-primary)",
        backgroundColor: "var(--accent-muted)",
        outline: "1px solid var(--accent)",
      },
      ".cm-tooltip": {
        color: "var(--text-primary)",
        backgroundColor: "var(--editor-raised)",
        borderColor: "var(--border-strong)",
      },
    }),
  ),
  Prec.highest(
    syntaxHighlighting(
      HighlightStyle.define([
        {
          tag: [tags.keyword, tags.modifier, tags.operatorKeyword],
          color: "var(--syntax-keyword)",
          fontWeight: "650",
        },
        {
          tag: [tags.string, tags.special(tags.string), tags.regexp],
          color: "var(--syntax-string)",
        },
        {
          tag: [tags.comment, tags.meta, tags.docComment],
          color: "var(--syntax-comment)",
          fontStyle: "italic",
        },
        {
          tag: [tags.number, tags.bool, tags.null, tags.atom],
          color: "var(--syntax-number)",
        },
        {
          tag: [tags.typeName, tags.className, tags.namespace],
          color: "var(--syntax-type)",
        },
        {
          tag: [
            tags.function(tags.variableName),
            tags.definition(tags.variableName),
            tags.labelName,
          ],
          color: "var(--syntax-function)",
        },
        {
          tag: [tags.variableName, tags.propertyName, tags.attributeName],
          color: "var(--syntax-variable)",
        },
        {
          tag: [tags.heading, tags.link, tags.url],
          color: "var(--accent-strong)",
          textDecoration: "none",
        },
        {
          tag: tags.invalid,
          color: "var(--danger)",
          textDecoration: "underline wavy",
        },
      ]),
    ),
  ),
];

export function createEditorDisplayExtensions(
  settings: EditorDisplaySettings,
  lineEnding: FileLineEnding,
  includeLineNumbers = true,
): Extension[] {
  const extensions: Extension[] = [];
  if (settings.showLineNumbers && includeLineNumbers) {
    extensions.push(lineNumbers());
  }
  if (settings.showWhitespace) {
    extensions.push(highlightWhitespace());
  }
  if (settings.highlightTrailingWhitespace) {
    extensions.push(highlightTrailingWhitespace());
  }
  if (settings.showLineEndings) {
    extensions.push(lineEndingMarkers(lineEnding.toUpperCase()));
  }
  return extensions;
}

class LineEndingWidget extends WidgetType {
  constructor(private readonly label: string) {
    super();
  }

  eq(other: LineEndingWidget): boolean {
    return other.label === this.label;
  }

  toDOM(): HTMLElement {
    const marker = document.createElement("span");
    marker.className = "cm-line-ending";
    marker.textContent = `↵ ${this.label}`;
    marker.title = `${this.label} line ending`;
    marker.setAttribute("aria-hidden", "true");
    return marker;
  }
}

function lineEndingMarkers(label: string): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations = Decoration.none;

      constructor(view: EditorView) {
        this.decorations = buildLineEndingMarkers(view, label);
      }

      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged) {
          this.decorations = buildLineEndingMarkers(update.view, label);
        }
      }
    },
    {
      decorations: (plugin) => plugin.decorations,
    },
  );
}

function buildLineEndingMarkers(
  view: EditorView,
  label: string,
): DecorationSet {
  const markers: Range<Decoration>[] = [];
  const seenLines = new Set<number>();
  for (const range of view.visibleRanges) {
    let line = view.state.doc.lineAt(range.from);
    while (line.from <= range.to) {
      if (line.number < view.state.doc.lines && !seenLines.has(line.number)) {
        seenLines.add(line.number);
        markers.push(
          Decoration.widget({
            widget: new LineEndingWidget(label),
            side: 1,
          }).range(line.to),
        );
      }
      if (line.number >= view.state.doc.lines) {
        break;
      }
      line = view.state.doc.line(line.number + 1);
    }
  }
  return Decoration.set(markers, true);
}
