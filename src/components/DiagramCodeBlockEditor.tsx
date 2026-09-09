import type { CodeBlockEditorProps } from "@mdxeditor/editor";
import { Code2, Copy, Download } from "lucide-react";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { api, errorMessage } from "../lib/api";
import type {
  PluginDiagramRenderResult,
  PluginDiagramTheme,
} from "@denote/plugin-sdk";
import {
  currentDiagramTheme,
  type DiagramEditorBinding,
} from "../plugins/diagramRenderers";
import { DenoteCodeBlockEditor } from "./DenoteCodeBlockEditor";

const DiagramBindingContext =
  createContext<DiagramEditorBinding | undefined>(undefined);

export function DiagramCodeBlockSettingsProvider({
  binding,
  children,
}: {
  binding?: DiagramEditorBinding;
  children: ReactNode;
}) {
  useEffect(
    () => () => {
      if (binding) {
        binding.releaseScope(binding.scopeId);
      }
    },
    [binding?.releaseScope, binding?.scopeId],
  );
  return (
    <DiagramBindingContext.Provider value={binding}>
      {children}
    </DiagramBindingContext.Provider>
  );
}

export function DiagramCodeBlockEditor(props: CodeBlockEditorProps) {
  const binding = useContext(DiagramBindingContext);
  const renderer = binding?.renderers.find((candidate) =>
    candidate.languages.includes(props.language.trim().toLocaleLowerCase()),
  );
  const theme = useDiagramTheme();
  const [result, setResult] = useState<PluginDiagramRenderResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [showSource, setShowSource] = useState(false);
  const [focusLine, setFocusLine] = useState<number | undefined>();
  const [focusRequest, setFocusRequest] = useState(0);
  const [status, setStatus] = useState("");

  useEffect(() => {
    if (!binding || !renderer) {
      setResult(null);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    let active = true;
    setLoading(true);
    setStatus("");
    void binding
      .renderDiagram(
        renderer,
        { source: props.code, theme },
        binding.scopeId,
        controller.signal,
      )
      .then((next) => {
        if (!active) {
          return;
        }
        setResult(next);
        if (next.status === "error") {
          setShowSource(true);
          setFocusLine(next.error.line);
        }
      })
      .catch((caught) => {
        if (!active || (caught instanceof Error && caught.name === "AbortError")) {
          return;
        }
        setResult({
          status: "error",
          error: {
            code: "RENDER_ERROR",
            message: errorMessage(caught),
          },
        });
        setShowSource(true);
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [
    binding,
    binding?.scopeId,
    props.code,
    props.language,
    renderer,
    theme,
  ]);

  const success = result?.status === "success" ? result : null;
  const failure = result?.status === "error" ? result.error : null;
  const sourceLabel = showSource
    ? "Hide diagram source"
    : "Show diagram source";

  const focusSource = (line?: number) => {
    setShowSource(true);
    setFocusLine(line);
    setFocusRequest((current) => current + 1);
  };

  const copySvg = async () => {
    if (!success) {
      return;
    }
    try {
      await api.copyFileContent(success.svg);
      setStatus("Diagram SVG copied.");
    } catch (caught) {
      setStatus(`Unable to copy diagram SVG: ${errorMessage(caught)}`);
    }
  };

  const exportSvg = async () => {
    if (!success || !binding) {
      return;
    }
    try {
      const exported = await binding.exportSvg("mermaid-diagram.svg", success.svg);
      setStatus(exported ? "Diagram SVG exported." : "Diagram export cancelled.");
    } catch (caught) {
      setStatus(`Unable to export diagram SVG: ${errorMessage(caught)}`);
    }
  };

  return (
    <section className="diagram-code-block" aria-label="Mermaid diagram block">
      <div className="diagram-code-block__toolbar" role="toolbar" aria-label="Diagram actions">
        <button
          type="button"
          aria-label={sourceLabel}
          title={sourceLabel}
          onClick={() => {
            if (showSource) {
              setShowSource(false);
            } else {
              focusSource(failure?.line);
            }
          }}
        >
          <Code2 aria-hidden="true" size={14} />
        </button>
        <button
          type="button"
          aria-label="Copy diagram SVG"
          title="Copy diagram SVG"
          disabled={!success}
          onClick={() => void copySvg()}
        >
          <Copy aria-hidden="true" size={14} />
        </button>
        <button
          type="button"
          aria-label="Export diagram SVG"
          title="Export diagram SVG"
          disabled={!success}
          onClick={() => void exportSvg()}
        >
          <Download aria-hidden="true" size={14} />
        </button>
      </div>
      {loading ? (
        <p className="diagram-code-block__status" role="status" aria-live="polite">
          Rendering Mermaid diagram…
        </p>
      ) : null}
      {success ? (
        <figure
          className="diagram-code-block__figure"
          aria-label={success.accessibleName}
        >
          <iframe
            className="diagram-code-block__frame"
            title="Rendered Mermaid diagram"
            aria-hidden="true"
            sandbox=""
            srcDoc={diagramDisplayDocument(success.svg)}
          />
          <figcaption>{success.accessibleName}</figcaption>
        </figure>
      ) : null}
      {failure ? (
        <div className="diagram-code-block__error" role="status" aria-live="polite">
          <strong>Mermaid diagram error</strong>
          <span>{failure.message}</span>
          {failure.line ? (
            <button
              type="button"
              onClick={() => focusSource(failure.line)}
            >
              {locationLabel(failure.line, failure.column)}
            </button>
          ) : (
            <span>Check the diagram source below.</span>
          )}
        </div>
      ) : null}
      {showSource || failure ? (
        <DenoteCodeBlockEditor
          {...props}
          focusLine={focusLine}
          focusRequest={focusRequest}
        />
      ) : null}
      {status ? (
        <p className="sr-only" role="status" aria-live="polite">
          {status}
        </p>
      ) : null}
    </section>
  );
}

function useDiagramTheme(): PluginDiagramTheme {
  const [theme, setTheme] = useState(currentDiagramTheme);
  useEffect(() => {
    const update = () => setTheme(currentDiagramTheme());
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    const media = [
      window.matchMedia?.("(forced-colors: active)"),
      window.matchMedia?.("(prefers-contrast: more)"),
    ].filter((query): query is MediaQueryList => query !== undefined);
    for (const query of media) {
      query.addEventListener("change", update);
    }
    return () => {
      observer.disconnect();
      for (const query of media) {
        query.removeEventListener("change", update);
      }
    };
  }, []);
  return theme;
}

function locationLabel(line: number, column?: number): string {
  return column ? `Line ${line}, column ${column}` : `Line ${line}`;
}

function diagramDisplayDocument(svg: string): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; font-src 'none'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">
<style>
html, body { margin: 0; min-height: 100%; background: transparent; }
body { display: grid; place-items: center; padding: 8px; box-sizing: border-box; }
svg { display: block; max-width: 100%; height: auto; }
@media (forced-colors: active) { svg { forced-color-adjust: auto; } }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; transition: none !important; } }
</style>
</head>
<body>${svg}</body>
</html>`;
}
