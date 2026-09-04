import { Compartment, EditorState } from "@codemirror/state";
import {
  EditorView,
  placeholder,
} from "@codemirror/view";
import { useEffect, useRef } from "react";
import {
  createCodeMirrorBehaviorExtensions,
  createEditorDiagnosticExtensions,
  createEditorDisplayExtensions,
  createPluginDecorationExtensions,
  denoteCodeMirrorTheme,
  markdownLinkKeymap,
  setEditorDiagnostic,
} from "../lib/editorExtensions";
import type { PluginEditorDecoration } from "@denote/plugin-sdk";
import type { EditorDisplaySettings } from "../lib/editorDisplay";
import type { MarkdownErrorLocation } from "../lib/markdownErrors";
import {
  loadSyntaxLanguage,
  resolveSourceLanguage,
  type SourceLanguageOverride,
} from "../lib/syntaxLanguages";
import type {
  SourceEditorNavigation,
  SourceViewport,
} from "../lib/sourceOutline";
import { findCaseInsensitiveMatches } from "../lib/textMatch";
import type { EditorSearchNavigation, FileLineEnding } from "../types";
import type { EmojiEditorBinding } from "../lib/emojiHost";
import { createEmojiSourceExtension } from "../lib/emojiSource";

interface PlainTextEditorProps {
  value: string;
  ariaLabel: string;
  readOnly: boolean;
  spellCheck: boolean;
  binary: boolean;
  filePath: string | null;
  lineEnding: FileLineEnding;
  displaySettings: EditorDisplaySettings;
  languageOverride?: SourceLanguageOverride;
  projectMode?: boolean;
  markdownSource?: boolean;
  errorLocation?: MarkdownErrorLocation;
  errorNavigationRequest?: number;
  searchNavigation?: EditorSearchNavigation;
  sourceNavigation?: SourceEditorNavigation;
  pluginDecorations?: PluginEditorDecoration[];
  emoji?: EmojiEditorBinding;
  onChange: (value: string) => void;
  onViewportChange?: (viewport: SourceViewport) => void;
  onError?: (error: unknown) => void;
}

export function PlainTextEditor({
  value,
  ariaLabel,
  readOnly,
  spellCheck,
  binary,
  filePath,
  lineEnding,
  displaySettings,
  languageOverride = null,
  projectMode = false,
  markdownSource = false,
  errorLocation,
  errorNavigationRequest = 0,
  searchNavigation,
  sourceNavigation,
  pluginDecorations = [],
  emoji,
  onChange,
  onViewportChange,
  onError,
}: PlainTextEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onViewportChangeRef = useRef(onViewportChange);
  const viewportReportingActive = useRef(Boolean(onViewportChange));
  const currentValueRef = useRef(value);
  const syncingValue = useRef(false);
  const attributesCompartment = useRef(new Compartment()).current;
  const displayCompartment = useRef(new Compartment()).current;
  const readOnlyCompartment = useRef(new Compartment()).current;
  const languageCompartment = useRef(new Compartment()).current;
  const pluginDecorationCompartment = useRef(new Compartment()).current;
  const emojiCompartment = useRef(new Compartment()).current;
  const languageRequest = useRef(0);
  const handledErrorNavigationRequest = useRef(0);
  const handledSourceNavigationRequest = useRef(0);
  const emojiRef = useRef(emoji);
  emojiRef.current = !binary && /\.(md|markdown)$/i.test(filePath ?? "") ? emoji : undefined;

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    const becameActive =
      Boolean(onViewportChange) && !viewportReportingActive.current;
    onViewportChangeRef.current = onViewportChange;
    const editor = editorRef.current;
    if (editor && onViewportChange && becameActive) {
      onViewportChange(editorViewport(editor));
    }
    viewportReportingActive.current = Boolean(onViewportChange);
  }, [onViewportChange]);

  useEffect(() => {
    const parent = containerRef.current;
    if (!parent) {
      return;
    }
    let viewportFrame = 0;
    const reportViewport = (view: EditorView) => {
      window.cancelAnimationFrame(viewportFrame);
      viewportFrame = window.requestAnimationFrame(() => {
        onViewportChangeRef.current?.(editorViewport(view));
      });
    };
    const editor = new EditorView({
      parent,
      state: EditorState.create({
        doc: value,
        extensions: [
          ...createCodeMirrorBehaviorExtensions(),
          ...(value.includes("\r") ? [EditorState.lineSeparator.of(value.includes("\r\n") ? "\r\n" : "\r")] : []),
          emojiCompartment.of(emojiRef.current ? createEmojiSourceExtension(() => emojiRef.current) : []),
          denoteCodeMirrorTheme,
          ...(markdownSource
            ? [markdownLinkKeymap, ...createEditorDiagnosticExtensions()]
            : []),
          placeholder("Start writing…"),
          attributesCompartment.of(
            EditorView.contentAttributes.of({
              "aria-label": ariaLabel,
              spellcheck: spellCheck ? "true" : "false",
            }),
          ),
          readOnlyCompartment.of([
            EditorState.readOnly.of(readOnly),
            EditorView.editable.of(!readOnly),
          ]),
          displayCompartment.of(
            createEditorDisplayExtensions(displaySettings, lineEnding),
          ),
          languageCompartment.of([]),
          pluginDecorationCompartment.of(
            createPluginDecorationExtensions(pluginDecorations),
          ),
          EditorView.updateListener.of((update) => {
            if (update.docChanged && !syncingValue.current) {
              const nextValue = update.state.sliceDoc();
              currentValueRef.current = nextValue;
              onChangeRef.current(nextValue);
            }
            if (
              update.docChanged ||
              update.geometryChanged ||
              update.viewportChanged
            ) {
              reportViewport(update.view);
            }
          }),
        ],
      }),
    });
    editorRef.current = editor;
    const handleScroll = () => reportViewport(editor);
    editor.scrollDOM.addEventListener("scroll", handleScroll, {
      passive: true,
    });
    reportViewport(editor);
    return () => {
      window.cancelAnimationFrame(viewportFrame);
      editor.scrollDOM.removeEventListener("scroll", handleScroll);
      editor.destroy();
      editorRef.current = null;
    };
  }, [
    attributesCompartment,
    displayCompartment,
    emojiCompartment,
    languageCompartment,
    markdownSource,
    pluginDecorationCompartment,
    readOnlyCompartment,
  ]);

  useEffect(() => {
    editorRef.current?.dispatch({
      effects: emojiCompartment.reconfigure(emojiRef.current ? createEmojiSourceExtension(() => emojiRef.current) : []),
    });
  }, [emoji?.host, emoji?.scope, emojiCompartment, binary, filePath]);

  useEffect(() => {
    editorRef.current?.dispatch({
      effects: attributesCompartment.reconfigure(
        EditorView.contentAttributes.of({
          "aria-label": ariaLabel,
          spellcheck: spellCheck ? "true" : "false",
        }),
      ),
    });
  }, [ariaLabel, attributesCompartment, spellCheck]);

  useEffect(() => {
    editorRef.current?.dispatch({
      effects: pluginDecorationCompartment.reconfigure(
        createPluginDecorationExtensions(pluginDecorations),
      ),
    });
  }, [pluginDecorationCompartment, pluginDecorations]);

  useEffect(() => {
    const request = ++languageRequest.current;
    editorRef.current?.dispatch({
      effects: languageCompartment.reconfigure([]),
    });
    if (binary || !filePath) {
      return;
    }
    const language = resolveSourceLanguage(filePath, languageOverride).language;
    if (!language) {
      return;
    }
    void loadSyntaxLanguage(language.id)
      .then((support) => {
        if (request === languageRequest.current && editorRef.current) {
          editorRef.current.dispatch({
            effects: languageCompartment.reconfigure(support),
          });
        }
      })
      .catch((caught) => {
        if (request === languageRequest.current) {
          onError?.(caught);
        }
      });
  }, [
    binary,
    filePath,
    languageCompartment,
    languageOverride,
    onError,
  ]);

  useEffect(() => {
    editorRef.current?.dispatch({
      effects: displayCompartment.reconfigure(
        createEditorDisplayExtensions(displaySettings, lineEnding),
      ),
    });
  }, [displayCompartment, displaySettings, lineEnding]);

  useEffect(() => {
    editorRef.current?.dispatch({
      effects: readOnlyCompartment.reconfigure([
        EditorState.readOnly.of(readOnly),
        EditorView.editable.of(!readOnly),
      ]),
    });
  }, [readOnly, readOnlyCompartment]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || currentValueRef.current === value) {
      return;
    }
    currentValueRef.current = value;
    syncingValue.current = true;
    try {
      editor.dispatch({
        changes: { from: 0, to: editor.state.doc.length, insert: value },
      });
    } finally {
      syncingValue.current = false;
    }
  }, [value]);

  useEffect(() => {
    if (!markdownSource) {
      return;
    }
    editorRef.current?.dispatch({
      effects: setEditorDiagnostic.of(errorLocation ?? null),
    });
  }, [errorLocation?.column, errorLocation?.line, markdownSource]);

  useEffect(() => {
    const editor = editorRef.current;
    if (
      !markdownSource ||
      !editor ||
      !errorLocation ||
      errorNavigationRequest <= 0 ||
      handledErrorNavigationRequest.current === errorNavigationRequest
    ) {
      return;
    }
    handledErrorNavigationRequest.current = errorNavigationRequest;
    const anchor = resolveSourcePosition(editor, errorLocation);
    editor.dispatch({
      selection: { anchor },
      effects: EditorView.scrollIntoView(anchor, { y: "center" }),
    });
    editor.focus();
  }, [
    errorLocation?.column,
    errorLocation?.line,
    errorNavigationRequest,
    markdownSource,
  ]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !searchNavigation || searchNavigation.request <= 0) {
      return;
    }
    const range = resolveSearchRange(
      editor.state.doc.toString(),
      searchNavigation,
    );
    if (!range) {
      return;
    }
    editor.dispatch({
      selection: { anchor: range.from, head: range.to },
      effects: EditorView.scrollIntoView(range.from, { y: "center" }),
    });
    editor.focus();
  }, [searchNavigation]);

  useEffect(() => {
    const editor = editorRef.current;
    if (
      !editor ||
      !sourceNavigation ||
      sourceNavigation.request <= 0 ||
      handledSourceNavigationRequest.current === sourceNavigation.request
    ) {
      return;
    }
    handledSourceNavigationRequest.current = sourceNavigation.request;
    if (sourceNavigation.line !== undefined) {
      const line = editor.state.doc.line(
        Math.max(1, Math.min(sourceNavigation.line, editor.state.doc.lines)),
      );
      editor.dispatch({
        selection: { anchor: line.from },
        effects: EditorView.scrollIntoView(line.from, { y: "center" }),
      });
      editor.focus();
      return;
    }
    if (sourceNavigation.progress !== undefined) {
      const maximum = Math.max(
        0,
        editor.scrollDOM.scrollHeight - editor.scrollDOM.clientHeight,
      );
      editor.scrollDOM.scrollTop =
        maximum * Math.min(1, Math.max(0, sourceNavigation.progress));
    }
  }, [sourceNavigation]);

  return (
    <div
      ref={containerRef}
      className={`plain-code-editor${
        binary ? " plain-code-editor--binary" : ""
      }${projectMode ? " plain-code-editor--project" : ""}`}
    />
  );
}

function editorViewport(editor: EditorView): SourceViewport {
  const maximum = Math.max(
    0,
    editor.scrollDOM.scrollHeight - editor.scrollDOM.clientHeight,
  );
  return {
    firstLine: editor.state.doc.lineAt(editor.viewport.from).number,
    lastLine: editor.state.doc.lineAt(editor.viewport.to).number,
    totalLines: editor.state.doc.lines,
    progress:
      maximum > 0
        ? Math.min(1, Math.max(0, editor.scrollDOM.scrollTop / maximum))
        : 0,
  };
}

function resolveSourcePosition(
  editor: EditorView,
  location: MarkdownErrorLocation,
): number {
  const line = editor.state.doc.line(
    Math.max(1, Math.min(location.line, editor.state.doc.lines)),
  );
  return Math.min(
    line.to,
    line.from + Math.max(0, location.column - 1),
  );
}

function resolveSearchRange(
  source: string,
  navigation: EditorSearchNavigation,
): { from: number; to: number } | null {
  const from = Math.max(0, Math.min(navigation.from, source.length));
  const to = Math.max(from, Math.min(navigation.to, source.length));
  if (
    source.slice(from, to).toLocaleLowerCase() ===
    navigation.text.toLocaleLowerCase()
  ) {
    return { from, to };
  }
  return findCaseInsensitiveMatches(source, navigation.text)[0] ?? null;
}
