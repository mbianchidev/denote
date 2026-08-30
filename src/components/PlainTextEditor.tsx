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
import type { FileLineEnding } from "../types";

interface PlainTextEditorProps {
  value: string;
  ariaLabel: string;
  readOnly: boolean;
  spellCheck: boolean;
  binary: boolean;
  filePath: string | null;
  lineEnding: FileLineEnding;
  displaySettings: EditorDisplaySettings;
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

  return (
    <div
      ref={containerRef}
      className={`plain-code-editor${
        binary ? " plain-code-editor--binary" : ""
      }`}
    />
  );
}
