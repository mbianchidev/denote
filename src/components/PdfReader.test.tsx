import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type {
  PdfRuntime,
  PdfRuntimeCallbacks,
  PdfRuntimeFactory,
} from "../lib/pdf";
import { defaultPdfViewState } from "../lib/pdf";
import {
  createCorruptPdfFixture,
  createImageOnlyPdfFixture,
  createLargePdfFixture,
  createPdfFixture,
} from "../test/pdfFixtures";
import { PdfReader } from "./PdfReader";

describe("PdfReader", () => {
  it("provides accessible page, zoom, fit, rotation, and search controls", async () => {
    const harness = runtimeHarness();
    const onViewStateChange = vi.fn();
    render(
      <PdfReader
        title="Synthetic guide.pdf"
        data={createPdfFixture([
          { text: "First synthetic page" },
          { text: "Second synthetic page", rotation: 90 },
          { text: "Third synthetic page" },
        ])}
        viewState={defaultPdfViewState()}
        searchFocusRequest={0}
        onViewStateChange={onViewStateChange}
        createRuntime={harness.factory}
      />,
    );

    await act(async () => {
      harness.callbacks.onLoaded({ pageCount: 3 });
      harness.callbacks.onPageChanged(1);
      harness.callbacks.onScaleChanged({
        scale: 1,
        scaleMode: "page-width",
      });
    });

    expect(
      screen.getByRole("region", { name: "PDF reader for Synthetic guide.pdf" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("toolbar", { name: "PDF controls" })).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Next PDF page" }));
    expect(harness.runtime.setPage).toHaveBeenCalledWith(2);

    fireEvent.click(screen.getByRole("button", { name: "Zoom PDF in" }));
    expect(harness.runtime.setScale).toHaveBeenCalledWith(1.1);
    fireEvent.click(screen.getByRole("button", { name: "Fit PDF to width" }));
    expect(harness.runtime.setScaleMode).toHaveBeenCalledWith("page-width");
    fireEvent.click(screen.getByRole("button", { name: "Fit PDF to page" }));
    expect(harness.runtime.setScaleMode).toHaveBeenCalledWith("page-fit");
    fireEvent.click(screen.getByRole("button", { name: "Rotate PDF clockwise" }));
    expect(harness.runtime.setRotation).toHaveBeenCalledWith(90);

    const search = screen.getByRole("searchbox", { name: "Search this PDF" });
    await userEvent.type(search, "synthetic{Enter}");
    expect(harness.runtime.search).toHaveBeenCalledWith("synthetic", false);
    await act(async () => {
      harness.callbacks.onSearchChanged({
        state: "found",
        current: 1,
        total: 3,
        message: "Result 1 of 3",
      });
    });
    expect(screen.getByRole("status")).toHaveTextContent("Result 1 of 3");
  });

  it("focuses in-document search and keeps large documents lazily readable", async () => {
    const harness = runtimeHarness();
    const data = createLargePdfFixture();
    const { rerender } = render(
      <PdfReader
        title="Large synthetic.pdf"
        data={data}
        viewState={defaultPdfViewState()}
        searchFocusRequest={0}
        onViewStateChange={vi.fn()}
        createRuntime={harness.factory}
      />,
    );
    await act(async () => {
      harness.callbacks.onLoaded({ pageCount: 600 });
    });
    rerender(
      <PdfReader
        title="Large synthetic.pdf"
        data={data}
        viewState={defaultPdfViewState()}
        searchFocusRequest={1}
        onViewStateChange={vi.fn()}
        createRuntime={harness.factory}
      />,
    );
    expect(screen.getByRole("searchbox", { name: "Search this PDF" })).toHaveFocus();
    expect(screen.getByText(/search is limited to PDFs with 500 pages or fewer/i)).toBeVisible();
    expect(harness.runtime.search).not.toHaveBeenCalled();
  });

  it("prompts locally for a password and clears it immediately after retry", async () => {
    const harness = runtimeHarness();
    const submit = vi.fn();
    render(
      <PdfReader
        title="Protected synthetic.pdf"
        data={createPdfFixture()}
        viewState={defaultPdfViewState()}
        searchFocusRequest={0}
        onViewStateChange={vi.fn()}
        createRuntime={harness.factory}
      />,
    );
    await act(async () => {
      harness.callbacks.onPasswordRequired({
        incorrect: false,
        submit,
        cancel: vi.fn(),
      });
    });

    const dialog = screen.getByRole("dialog", { name: "Unlock PDF" });
    const input = screen.getByLabelText("PDF password");
    expect(input).toHaveFocus();
    await userEvent.type(input, "synthetic-password");
    fireEvent.submit(dialog.querySelector("form")!);

    expect(submit).toHaveBeenCalledWith("synthetic-password");
    expect(screen.queryByDisplayValue("synthetic-password")).not.toBeInTheDocument();
  });

  it("shows explicit empty, unsupported, corrupted, rendering, and text-layer states", async () => {
    const empty = render(
      <PdfReader
        title="Empty.pdf"
        data={new Uint8Array()}
        viewState={defaultPdfViewState()}
        searchFocusRequest={0}
        onViewStateChange={vi.fn()}
      />,
    );
    expect(screen.getAllByText("This PDF is empty.")[0]).toBeVisible();
    empty.unmount();

    const unsupported = render(
      <PdfReader
        title="Future.pdf"
        data={createPdfFixture(undefined, "9.9")}
        viewState={defaultPdfViewState()}
        searchFocusRequest={0}
        onViewStateChange={vi.fn()}
      />,
    );
    expect(
      screen.getAllByText(/PDF version 9.9 is not supported/i)[0],
    ).toBeVisible();
    unsupported.unmount();

    const harness = runtimeHarness();
    render(
      <PdfReader
        title="Corrupt.pdf"
        data={createCorruptPdfFixture()}
        viewState={defaultPdfViewState()}
        searchFocusRequest={0}
        onViewStateChange={vi.fn()}
        createRuntime={harness.factory}
      />,
    );
    await act(async () => {
      harness.callbacks.onFatalError(
        Object.assign(new Error("Invalid PDF structure"), {
          name: "InvalidPDFException",
        }),
      );
    });
    expect(
      screen.getAllByText(/PDF is corrupted or incomplete/i)[0],
    ).toBeVisible();

    await act(async () => {
      harness.callbacks.onLoaded({ pageCount: 1 });
      harness.callbacks.onPageTextChanged({
        pageNumber: 1,
        available: false,
      });
      harness.callbacks.onRenderError("Page 1 could not be rendered.");
    });
    expect(screen.getByText("This page has no selectable text.")).toBeVisible();
    expect(
      screen.getAllByText("Page 1 could not be rendered.")[0],
    ).toBeVisible();
  });

  it("cancels stale work and releases runtime bytes on teardown", async () => {
    const first = runtimeHarness();
    const second = runtimeHarness();
    const factories = [first.factory, second.factory];
    const { rerender, unmount } = render(
      <PdfReader
        title="First.pdf"
        data={createPdfFixture([{ text: "First" }])}
        viewState={defaultPdfViewState()}
        searchFocusRequest={0}
        onViewStateChange={vi.fn()}
        createRuntime={factories[0]}
      />,
    );
    rerender(
      <PdfReader
        title="Second.pdf"
        data={createImageOnlyPdfFixture()}
        viewState={defaultPdfViewState()}
        searchFocusRequest={0}
        onViewStateChange={vi.fn()}
        createRuntime={factories[1]}
      />,
    );
    expect(first.runtime.destroy).toHaveBeenCalled();

    await act(async () => {
      first.callbacks.onLoaded({ pageCount: 99 });
      second.callbacks.onLoaded({ pageCount: 1 });
    });
    expect(screen.getByText("Page 1 of 1")).toBeVisible();

    const runtimeBytes = second.runtime.load.mock.calls[0][0] as Uint8Array;
    unmount();
    await waitFor(() => expect(second.runtime.destroy).toHaveBeenCalled());
    expect(runtimeBytes.every((value) => value === 0)).toBe(true);
  });
});

function runtimeHarness(): {
  runtime: {
    [Key in keyof PdfRuntime]: ReturnType<typeof vi.fn>;
  };
  callbacks: PdfRuntimeCallbacks;
  factory: PdfRuntimeFactory;
} {
  let callbacks: PdfRuntimeCallbacks | null = null;
  const runtime = {
    load: vi.fn().mockResolvedValue(undefined),
    setPage: vi.fn(),
    setScale: vi.fn(),
    setScaleMode: vi.fn(),
    setRotation: vi.fn(),
    search: vi.fn(),
    clearSearch: vi.fn(),
    destroy: vi.fn().mockResolvedValue(undefined),
  };
  const factory: PdfRuntimeFactory = (options) => {
    callbacks = options.callbacks;
    return runtime;
  };
  return {
    runtime,
    get callbacks() {
      if (!callbacks) {
        throw new Error("PDF runtime was not created.");
      }
      return callbacks;
    },
    factory,
  };
}
