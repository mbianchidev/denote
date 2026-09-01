import {
  type CodeBlockEditorProps,
  useCodeBlockEditorContext,
} from "@mdxeditor/editor";
import { Compartment, EditorState, Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { $setSelection } from "lexical";
import { Trash2 } from "lucide-react";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import {
  createCodeMirrorBehaviorExtensions,
  denoteCodeMirrorTheme,
} from "../lib/editorExtensions";
import {
  AUTOMATIC_LANGUAGE,
  PLAIN_TEXT_LANGUAGE,
  fenceIdentifierForChoice,
  languageForFence,
  loadSyntaxLanguage,
  type LanguageChoice,
} from "../lib/syntaxLanguages";
import { LanguageCombobox } from "./LanguageCombobox";
import type { Extension } from "@codemirror/state";

interface DenoteCodeBlockEditorSettings {
  readOnly: boolean;
  tabExtensions: readonly Extension[];
  onError: (error: unknown) => void;
}

const DenoteCodeBlockEditorSettingsContext =
  createContext<DenoteCodeBlockEditorSettings | null>(null);

export function DenoteCodeBlockEditorSettingsProvider({
  readOnly,
  tabExtensions,
  onError,
  children,
}: DenoteCodeBlockEditorSettings & { children: ReactNode }) {
  return (
    <DenoteCodeBlockEditorSettingsContext.Provider
      value={{ readOnly, tabExtensions, onError }}
    >
      {children}
    </DenoteCodeBlockEditorSettingsContext.Provider>
  );
}

export function DenoteCodeBlockEditor({
  language,
  code,
  focusEmitter,
}: CodeBlockEditorProps) {
  const settings = useContext(DenoteCodeBlockEditorSettingsContext);
  if (!settings) {
    throw new Error("Code block editor settings are unavailable.");
  }
  const { parentEditor, lexicalNode, setCode, setLanguage } =
    useCodeBlockEditorContext();
  const editorHostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<EditorView | null>(null);
  const currentCodeRef = useRef(code);
  const syncingCodeRef = useRef(false);
  const setCodeRef = useRef(setCode);
  const onErrorRef = useRef(settings.onError);
  const languageRequestRef = useRef(0);
  const languageCompartment = useRef(new Compartment()).current;
  const readOnlyCompartment = useRef(new Compartment()).current;
  const tabCompartment = useRef(new Compartment()).current;

  setCodeRef.current = setCode;
  onErrorRef.current = settings.onError;

  useEffect(() => {
    const parent = editorHostRef.current;
    if (!parent) {
      return;
    }
    const editor = new EditorView({
      parent,
      state: EditorState.create({
        doc: code,
        extensions: [
          ...createCodeMirrorBehaviorExtensions(),
          denoteCodeMirrorTheme,
          EditorView.contentAttributes.of({
            "aria-label": settings.readOnly
              ? "Read code block"
              : "Edit code block",
            spellcheck: "false",
          }),
          EditorView.domEventHandlers({
            focus: () => {
              parentEditor.update(() => {
                $setSelection(null);
              });
              return false;
            },
            keydown: (event) => {
              event.stopPropagation();
              return false;
            },
          }),
          readOnlyCompartment.of(readOnlyExtensions(settings.readOnly)),
          tabCompartment.of(settings.tabExtensions),
          languageCompartment.of([]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged && !syncingCodeRef.current) {
              const nextCode = update.state.doc.toString();
              currentCodeRef.current = nextCode;
              setCodeRef.current(nextCode);
            }
          }),
        ],
      }),
    });
    editorRef.current = editor;
    focusEmitter.subscribe(() => editorRef.current?.focus());
    return () => {
      editor.destroy();
      editorRef.current = null;
    };
  }, [
    focusEmitter,
    languageCompartment,
    parentEditor,
    readOnlyCompartment,
    tabCompartment,
  ]);

  useEffect(() => {
    editorRef.current?.dispatch({
      effects: readOnlyCompartment.reconfigure(
        readOnlyExtensions(settings.readOnly),
      ),
    });
  }, [readOnlyCompartment, settings.readOnly]);

  useEffect(() => {
    editorRef.current?.dispatch({
      effects: tabCompartment.reconfigure(settings.tabExtensions),
    });
  }, [settings.tabExtensions, tabCompartment]);

  useEffect(() => {
    const editor = editorRef.current;
    const request = ++languageRequestRef.current;
    editor?.dispatch({
      effects: languageCompartment.reconfigure([]),
    });
    const syntaxLanguage = languageForFence(language);
    if (!editor || !syntaxLanguage || language === PLAIN_TEXT_LANGUAGE) {
      return;
    }
    void loadSyntaxLanguage(syntaxLanguage.id)
      .then((support) => {
        if (request === languageRequestRef.current && editorRef.current) {
          editorRef.current.dispatch({
            effects: languageCompartment.reconfigure(support),
          });
        }
      })
      .catch((error) => {
        if (request === languageRequestRef.current) {
          onErrorRef.current(error);
        }
      });
  }, [language, languageCompartment]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || currentCodeRef.current === code) {
      return;
    }
    currentCodeRef.current = code;
    syncingCodeRef.current = true;
    try {
      editor.dispatch({
        changes: { from: 0, to: editor.state.doc.length, insert: code },
        annotations: Transaction.addToHistory.of(false),
      });
    } finally {
      syncingCodeRef.current = false;
    }
  }, [code]);

  const syntaxLanguage = languageForFence(language);
  const choice: LanguageChoice | null = !language
    ? AUTOMATIC_LANGUAGE
    : language.toLocaleLowerCase() === PLAIN_TEXT_LANGUAGE
      ? PLAIN_TEXT_LANGUAGE
      : (syntaxLanguage?.id ?? null);
  const currentLabel = !language
    ? "Automatic"
    : language.toLocaleLowerCase() === PLAIN_TEXT_LANGUAGE
      ? "Plain text"
      : (syntaxLanguage?.name ?? `Unknown: ${language}`);

  return (
    <div
      className="denote-code-block-editor"
      data-denote-code-block-editor=""
    >
      <div className="denote-code-block-editor__toolbar">
        <LanguageCombobox
          label="Code block language"
          value={choice}
          currentLabel={currentLabel}
          disabled={settings.readOnly}
          onSelect={(nextChoice) => {
            setLanguage(fenceIdentifierForChoice(nextChoice));
            window.setTimeout(() => editorRef.current?.focus(), 0);
          }}
        />
        <button
          type="button"
          className="denote-code-block-editor__delete"
          aria-label="Delete code block"
          title="Delete code block"
          disabled={settings.readOnly}
          onClick={() => {
            parentEditor.update(() => {
              lexicalNode.remove();
            });
          }}
        >
          <Trash2 aria-hidden="true" size={14} />
        </button>
      </div>
      <div ref={editorHostRef} className="denote-code-block-editor__surface" />
    </div>
  );
}

function readOnlyExtensions(readOnly: boolean): Extension[] {
  return [
    EditorState.readOnly.of(readOnly),
    EditorView.editable.of(!readOnly),
  ];
}
