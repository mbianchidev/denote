import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { Compartment, EditorState } from "@codemirror/state";
import {
  EditorView,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightSpecialChars,
  keymap,
  placeholder,
} from "@codemirror/view";
import { useEffect, useRef } from "react";
import {
  createEditorDisplayExtensions,
  denoteCodeMirrorTheme,
} from "../lib/editorExtensions";
import type { EditorDisplaySettings } from "../lib/editorDisplay";
import { loadSourceLanguage } from "../lib/sourceLanguage";
import { findCaseInsensitiveMatches } from "../lib/textMatch";
import type { EditorSearchNavigation, FileLineEnding } from "../types";

interface PlainTextEditorProps {
  value: string;
  ariaLabel: string;
  readOnly: boolean;
  spellCheck: boolean;
  binary: boolean;
  filePath: string | null;
  lineEnding: FileLineEnding;
  displaySettings: EditorDisplaySettings;
  searchNavigation?: EditorSearchNavigation;
  onChange: (value: string) => void;
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
  searchNavigation,
  onChange,
  onError,
}: PlainTextEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const currentValueRef = useRef(value);
  const syncingValue = useRef(false);
  const displayCompartment = useRef(new Compartment()).current;
  const readOnlyCompartment = useRef(new Compartment()).current;
  const languageCompartment = useRef(new Compartment()).current;
  const languageRequest = useRef(0);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    const parent = containerRef.current;
    if (!parent) {
      return;
    }
    const editor = new EditorView({
      parent,
      state: EditorState.create({
        doc: value,
        extensions: [
          history(),
          denoteCodeMirrorTheme,
          drawSelection(),
          dropCursor(),
          highlightActiveLine(),
          highlightSpecialChars(),
          EditorView.lineWrapping,
          keymap.of([...defaultKeymap, ...historyKeymap]),
          placeholder("Start writing…"),
          EditorView.contentAttributes.of({
            "aria-label": ariaLabel,
            spellcheck: spellCheck ? "true" : "false",
          }),
          readOnlyCompartment.of([
            EditorState.readOnly.of(readOnly),
            EditorView.editable.of(!readOnly),
          ]),
          displayCompartment.of(
            createEditorDisplayExtensions(displaySettings, lineEnding),
          ),
          languageCompartment.of([]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged && !syncingValue.current) {
              const nextValue = update.state.doc.toString();
              currentValueRef.current = nextValue;
              onChangeRef.current(nextValue);
            }
          }),
        ],
      }),
    });
    editorRef.current = editor;
    return () => {
      editor.destroy();
      editorRef.current = null;
    };
  }, [
    ariaLabel,
    displayCompartment,
    languageCompartment,
    readOnlyCompartment,
    spellCheck,
  ]);

  useEffect(() => {
    const request = ++languageRequest.current;
    if (binary || !filePath) {
      editorRef.current?.dispatch({
        effects: languageCompartment.reconfigure([]),
      });
      return;
    }
    void loadSourceLanguage(filePath)
      .then((language) => {
        if (request === languageRequest.current && editorRef.current) {
          editorRef.current.dispatch({
            effects: languageCompartment.reconfigure(language ? [language] : []),
          });
        }
      })
      .catch((caught) => {
        if (request === languageRequest.current) {
          onError?.(caught);
        }
      });
  }, [binary, filePath, languageCompartment, onError]);

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

  return (
    <div
      ref={containerRef}
      className={`plain-code-editor${
        binary ? " plain-code-editor--binary" : ""
      }`}
    />
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
