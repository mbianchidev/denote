import type { Extension, Range } from "@codemirror/state";
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
import type { FileLineEnding } from "../types";
import type { EditorDisplaySettings } from "./editorDisplay";

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
