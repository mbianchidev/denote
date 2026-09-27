import { describe, expect, it } from "vitest";
import { TaskListIndex, parseTaskDocument } from "../src/taskList";

const document = {
  path: "notes/Plan.md",
  title: "Plan",
  source: `---
example: "- [ ] not a task"
---

# Release

- [ ] Ship release #work due:2026-10-01
- [x] Write notes #docs due:2026-09-27
- [ ] Follow up
- [ ] Follow up

\`\`\`markdown
- [ ] fenced example
\`\`\`

~~~
- [ ] tilde example
~~~

    - [ ] indented code
`,
};

describe("TaskListIndex", () => {
  it("indexes portable tasks with heading, tags, and due dates", () => {
    const parsed = parseTaskDocument(document);

    expect(parsed.parseError).toBe(false);
    expect(parsed.tasks).toHaveLength(4);
    expect(parsed.tasks[0]).toMatchObject({
      path: "notes/Plan.md",
      line: 7,
      text: "Ship release #work due:2026-10-01",
      checked: false,
      headingPath: ["Release"],
      tags: ["work"],
      dueDate: "2026-10-01",
    });
    expect(parsed.tasks[2].locator).toMatchObject({
      occurrence: 1,
      matchCount: 2,
    });
    expect(parsed.tasks[3].locator).toMatchObject({
      occurrence: 2,
      matchCount: 2,
    });
  });

  it("filters by status, tag, path, and due date", () => {
    const index = new TaskListIndex();
    index.index({
      mode: "replace",
      documents: [document],
      removedPaths: [],
      skippedCount: 0,
      truncated: false,
    });

    expect(
      index.query({
        status: "open",
        tag: "work",
        path: "plan",
        due: "upcoming",
        today: "2026-09-27",
        timeZone: "Europe/Rome",
      }).tasks.map((task) => task.text),
    ).toEqual(["Ship release #work due:2026-10-01"]);
    expect(
      index.query({
        status: "completed",
        tag: null,
        path: "",
        due: "today",
        today: "2026-09-27",
        timeZone: "Europe/Rome",
      }).tasks.map((task) => task.text),
    ).toEqual(["Write notes #docs due:2026-09-27"]);
  });

  it("toggles the selected duplicate and preserves every other byte", () => {
    const parsed = parseTaskDocument(document);
    const target = parsed.tasks[3];
    const index = new TaskListIndex();

    const result = index.toggle({
      path: document.path,
      source: document.source,
      locator: target.locator,
      checked: true,
    });

    expect(result.status).toBe("applied");
    if (result.status !== "applied") {
      return;
    }
    expect(result.source.match(/- \[x\] Follow up/gu)).toHaveLength(1);
    expect(result.source.match(/- \[ \] Follow up/gu)).toHaveLength(1);
    expect(result.source.length).toBe(document.source.length);
  });

  it("returns typed conflicts when the indexed task changed", () => {
    const target = parseTaskDocument(document).tasks[0];
    const changed = document.source.replace("Ship release", "Ship safely");
    const index = new TaskListIndex();

    expect(
      index.toggle({
        path: document.path,
        source: changed,
        locator: target.locator,
        checked: true,
      }),
    ).toEqual({ status: "conflict", reason: "missing" });
  });
});
