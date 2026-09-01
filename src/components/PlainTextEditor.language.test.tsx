import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { syntaxTree, type LanguageSupport } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_EDITOR_DISPLAY_SETTINGS } from "../lib/editorDisplay";

const languageMocks = vi.hoisted(() => ({
  load: vi.fn(),
}));

vi.mock("../lib/syntaxLanguages", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../lib/syntaxLanguages")>();
  return {
    ...actual,
    loadSyntaxLanguage: languageMocks.load,
  };
});

import { PlainTextEditor } from "./PlainTextEditor";

describe("PlainTextEditor language loading", () => {
  beforeEach(() => {
    languageMocks.load.mockReset();
  });

  it("ignores stale asynchronous language loads", async () => {
    const first = deferred<LanguageSupport>();
    const second = deferred<LanguageSupport>();
    languageMocks.load.mockImplementation((id: string) =>
      id === "typescript" ? first.promise : second.promise,
    );
    const onChange = vi.fn();
    const props = {
      value: "const value = 1;",
      ariaLabel: "Edit asynchronous source",
      readOnly: false,
      spellCheck: false,
      binary: false,
      lineEnding: "lf" as const,
      displaySettings: DEFAULT_EDITOR_DISPLAY_SETTINGS,
      onChange,
    };
    const { container, rerender } = render(
      <PlainTextEditor {...props} filePath="synthetic.ts" />,
    );
    const view = EditorView.findFromDOM(
      container.querySelector<HTMLElement>(".cm-editor")!,
    )!;

    rerender(<PlainTextEditor {...props} filePath="synthetic.py" />);
    first.resolve(javascript());
    await Promise.resolve();
    expect(syntaxTree(view.state).type.name).toBe("");

    second.resolve(python());
    await vi.waitFor(() =>
      expect(syntaxTree(view.state).type.name).not.toBe(""),
    );
    expect(onChange).not.toHaveBeenCalled();
  });

  it("keeps plain text after failure and retries on the next request", async () => {
    const onError = vi.fn();
    languageMocks.load
      .mockRejectedValueOnce(new Error("Synthetic grammar failure"))
      .mockResolvedValueOnce(python());
    const props = {
      value: "value = 1",
      ariaLabel: "Edit retry source",
      readOnly: false,
      spellCheck: false,
      binary: false,
      lineEnding: "lf" as const,
      displaySettings: DEFAULT_EDITOR_DISPLAY_SETTINGS,
      onChange: vi.fn(),
      onError,
    };
    const { container, rerender } = render(
      <PlainTextEditor {...props} filePath="broken.py" />,
    );
    const view = EditorView.findFromDOM(
      container.querySelector<HTMLElement>(".cm-editor")!,
    )!;

    await vi.waitFor(() =>
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({ message: "Synthetic grammar failure" }),
      ),
    );
    expect(syntaxTree(view.state).type.name).toBe("");

    rerender(<PlainTextEditor {...props} filePath="retry.py" />);
    await vi.waitFor(() =>
      expect(syntaxTree(view.state).type.name).not.toBe(""),
    );
    expect(languageMocks.load).toHaveBeenCalledTimes(2);
    expect(props.onChange).not.toHaveBeenCalled();
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}
