import { afterEach, describe, expect, it, vi } from "vitest";
import {
  dockPositionForPoint,
  paneDockTargetFromPoint,
  sameDockTarget,
} from "./paneDocking";

const bounds = { left: 100, top: 50, width: 400, height: 200 };

function stubElementFromPoint(element: Element | null) {
  Object.defineProperty(document, "elementFromPoint", {
    configurable: true,
    value: vi.fn(() => element),
  });
}

afterEach(() => {
  document.body.innerHTML = "";
  Reflect.deleteProperty(document, "elementFromPoint");
});

describe("pane docking targets", () => {
  it("maps edge bands to their docking position", () => {
    expect(dockPositionForPoint(bounds, 120, 150)).toBe("left");
    expect(dockPositionForPoint(bounds, 480, 150)).toBe("right");
    expect(dockPositionForPoint(bounds, 300, 60)).toBe("top");
    expect(dockPositionForPoint(bounds, 300, 240)).toBe("bottom");
  });

  it("falls back to the centre away from every edge", () => {
    expect(dockPositionForPoint(bounds, 300, 150)).toBe("center");
    expect(dockPositionForPoint(bounds, 250, 120)).toBe("center");
  });

  it("prefers the nearest edge in the corners", () => {
    expect(dockPositionForPoint(bounds, 104, 54)).toBe("left");
    expect(dockPositionForPoint(bounds, 496, 246)).toBe("right");
  });

  it("treats a collapsed pane as a centre drop", () => {
    expect(
      dockPositionForPoint({ left: 0, top: 0, width: 0, height: 0 }, 0, 0),
    ).toBe("center");
  });

  it("reads the pane under the pointer and its edge band", () => {
    document.body.innerHTML = `
      <section class="workspace-pane" data-pane-id="pane-2">
        <div class="workspace-pane__header"><div class="tab"><button></button></div></div>
        <div class="editor-pane"><p id="body">note body</p></div>
      </section>
    `;
    const editor = document.querySelector<HTMLElement>(".editor-pane")!;
    editor.getBoundingClientRect = () =>
      ({ left: 100, top: 50, width: 400, height: 200 }) as DOMRect;
    stubElementFromPoint(document.querySelector("#body"));

    expect(paneDockTargetFromPoint(480, 150)).toEqual({
      paneId: "pane-2",
      position: "right",
    });
    expect(paneDockTargetFromPoint(300, 150)).toEqual({
      paneId: "pane-2",
      position: "center",
    });
  });

  it("never targets the tab bar so reordering keeps working", () => {
    document.body.innerHTML = `
      <section class="workspace-pane" data-pane-id="pane-1">
        <div class="workspace-pane__header">
          <div class="tab"><button id="tab-button">one</button></div>
        </div>
        <div class="editor-pane"></div>
      </section>
    `;
    stubElementFromPoint(document.querySelector("#tab-button"));
    expect(paneDockTargetFromPoint(10, 10)).toBeNull();

    stubElementFromPoint(
      document.querySelector(".workspace-pane__header"),
    );
    expect(paneDockTargetFromPoint(10, 10)).toBeNull();
  });

  it("returns nothing outside the pane grid", () => {
    document.body.innerHTML = `<div id="outside">sidebar</div>`;
    stubElementFromPoint(document.querySelector("#outside"));
    expect(paneDockTargetFromPoint(5, 5)).toBeNull();

    stubElementFromPoint(null);
    expect(paneDockTargetFromPoint(5, 5)).toBeNull();
  });

  it("compares docking targets so hovering stays quiet", () => {
    const target = { paneId: "pane-1", position: "left" as const };
    expect(sameDockTarget(target, { ...target })).toBe(true);
    expect(sameDockTarget(null, null)).toBe(true);
    expect(sameDockTarget(target, null)).toBe(false);
    expect(
      sameDockTarget(target, { paneId: "pane-1", position: "right" }),
    ).toBe(false);
    expect(sameDockTarget(target, { paneId: "pane-2", position: "left" })).toBe(
      false,
    );
  });
});
