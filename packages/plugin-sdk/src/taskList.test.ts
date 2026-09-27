import { describe, expect, it } from "vitest";
import {
  MAX_PLUGIN_TASK_LIST_SOURCE_BYTES,
  isPluginTaskListIndexRequest,
  isPluginTaskListModel,
  isPluginTaskListQuery,
  isPluginTaskListRegistration,
  isPluginTaskListToggleRequest,
  isPluginTaskListToggleResult,
} from "./taskList";

const locator = {
  path: "notes/Plan.md",
  sourceLine: "- [ ] Ship release #work due:2026-10-01",
  headingPath: ["Release"],
  occurrence: 1,
  matchCount: 1,
  checked: false,
};

describe("task list contract", () => {
  it("accepts bounded registration, index, query, and toggle values", () => {
    expect(
      isPluginTaskListRegistration({
        id: "denote.task-lists.tasks",
        title: "Advanced task lists",
      }),
    ).toBe(true);
    expect(
      isPluginTaskListIndexRequest({
        mode: "update",
        documents: [
          {
            path: "notes/Plan.md",
            title: "Plan",
            source: "# Release\n\n- [ ] Ship release",
          },
        ],
        removedPaths: ["notes/Old.md"],
        skippedCount: 0,
        truncated: false,
      }),
    ).toBe(true);
    expect(
      isPluginTaskListQuery({
        status: "open",
        tag: "work",
        path: "notes",
        due: "upcoming",
        today: "2026-09-27",
        timeZone: "Europe/Rome",
      }),
    ).toBe(true);
    expect(
      isPluginTaskListToggleRequest({
        path: locator.path,
        source: locator.sourceLine,
        locator,
        checked: true,
      }),
    ).toBe(true);
    expect(
      isPluginTaskListToggleResult({
        status: "conflict",
        reason: "ambiguous",
      }),
    ).toBe(true);
  });

  it("rejects traversal, oversized source, and inconsistent locators", () => {
    expect(
      isPluginTaskListIndexRequest({
        mode: "replace",
        documents: [
          {
            path: "../Plan.md",
            title: "Plan",
            source: "",
          },
        ],
        removedPaths: [],
        skippedCount: 0,
        truncated: false,
      }),
    ).toBe(false);
    expect(
      isPluginTaskListIndexRequest({
        mode: "replace",
        documents: [
          {
            path: "Plan.md",
            title: "Plan",
            source: "x".repeat(MAX_PLUGIN_TASK_LIST_SOURCE_BYTES + 1),
          },
        ],
        removedPaths: [],
        skippedCount: 0,
        truncated: false,
      }),
    ).toBe(false);
    expect(
      isPluginTaskListToggleRequest({
        path: "Other.md",
        source: locator.sourceLine,
        locator,
        checked: true,
      }),
    ).toBe(false);
  });

  it("requires internally consistent task models", () => {
    const model = {
      tasks: [
        {
          id: "notes/Plan.md:3",
          path: locator.path,
          noteTitle: "Plan",
          line: 3,
          text: "Ship release #work due:2026-10-01",
          checked: false,
          headingPath: ["Release"],
          tags: ["work"],
          dueDate: "2026-10-01",
          locator,
        },
      ],
      totalTasks: 1,
      matchingTasks: 1,
      availableTags: ["work"],
      truncated: false,
      notices: [],
    };
    expect(isPluginTaskListModel(model)).toBe(true);
    expect(
      isPluginTaskListModel({
        ...model,
        tasks: [{ ...model.tasks[0], checked: true }],
      }),
    ).toBe(false);
    expect(
      isPluginTaskListModel({
        ...model,
        matchingTasks: 0,
      }),
    ).toBe(false);
  });
});
