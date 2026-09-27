import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  PluginTaskListIndexRequest,
  PluginTaskListItem,
  PluginTaskListModel,
  PluginTaskListQuery,
} from "@denote/plugin-sdk";
import { calendarToday } from "../lib/calendar";
import { errorMessage } from "../lib/api";
import { TaskListCoordinator } from "../plugins/taskListCoordinator";
import type { TaskListSnapshot } from "../plugins/taskLists";
import type { PluginTaskListContribution } from "../plugins/workerRuntime";

interface TaskListPanelProps {
  provider: PluginTaskListContribution;
  snapshot: TaskListSnapshot | null;
  indexTaskList: (
    pluginId: string,
    providerId: string,
    request: PluginTaskListIndexRequest,
  ) => Promise<void>;
  queryTaskList: (
    pluginId: string,
    providerId: string,
    request: PluginTaskListQuery,
  ) => Promise<PluginTaskListModel>;
  onToggle: (task: PluginTaskListItem, checked: boolean) => Promise<void>;
  onOpenFile: (path: string) => Promise<void>;
  onError: (error: unknown) => void;
  coordinator?: TaskListCoordinator;
}

export function TaskListPanel({
  provider,
  snapshot,
  indexTaskList,
  queryTaskList,
  onToggle,
  onOpenFile,
  onError,
  coordinator,
}: TaskListPanelProps) {
  const headingId = useId();
  const [localCoordinator] = useState(() => new TaskListCoordinator());
  const taskCoordinator = coordinator ?? localCoordinator;
  const [statusFilter, setStatusFilter] =
    useState<PluginTaskListQuery["status"]>("open");
  const [tag, setTag] = useState<string | null>(null);
  const [path, setPath] = useState("");
  const [due, setDue] = useState<PluginTaskListQuery["due"]>("all");
  const [today, setToday] = useState(calendarToday);
  const [timeZone, setTimeZone] = useState(
    () => new Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
  const [model, setModel] = useState<PluginTaskListModel | null>(null);
  const [loading, setLoading] = useState(false);
  const [retry, setRetry] = useState(0);
  const [workingTaskId, setWorkingTaskId] = useState<string | null>(null);
  const [status, setStatus] = useState("Waiting for the local task index.");
  const generation = useRef(0);
  const taskInputs = useRef(new Map<string, HTMLInputElement>());
  const statusSelect = useRef<HTMLSelectElement>(null);
  const pendingFocus = useRef<string | "filters" | null>(null);
  const providerKey = `${provider.pluginId}:${provider.id}`;
  const query = useMemo<PluginTaskListQuery>(
    () => ({
      status: statusFilter,
      tag,
      path,
      due,
      today,
      timeZone,
    }),
    [due, path, statusFilter, tag, timeZone, today],
  );

  useEffect(() => {
    const updateDate = () => {
      setToday(calendarToday());
      setTimeZone(new Intl.DateTimeFormat().resolvedOptions().timeZone);
    };
    const interval = window.setInterval(updateDate, 60_000);
    window.addEventListener("focus", updateDate);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", updateDate);
    };
  }, []);

  useEffect(() => {
    if (!coordinator) {
      localCoordinator.invalidateWorkspace();
    }
  }, [coordinator, localCoordinator, snapshot?.workspaceKey]);

  useEffect(
    () => () => {
      if (!coordinator) {
        localCoordinator.clear();
      }
    },
    [coordinator, localCoordinator],
  );

  useEffect(() => {
    generation.current += 1;
    setModel(null);
    setStatus("Waiting for the local task index.");
  }, [providerKey, snapshot?.workspaceKey]);

  useEffect(() => {
    const requestGeneration = ++generation.current;
    if (!snapshot) {
      setModel(null);
      setLoading(false);
      setStatus("Waiting for the local task index.");
      return;
    }
    setLoading(true);
    setStatus("Updating tasks...");
    void taskCoordinator
      .run(provider, snapshot, query, indexTaskList, queryTaskList)
      .then((nextModel) => {
        if (generation.current !== requestGeneration) {
          return;
        }
        setModel(nextModel);
        setLoading(false);
        setStatus(taskStatus(nextModel));
      })
      .catch((error) => {
        if (generation.current !== requestGeneration) {
          return;
        }
        setLoading(false);
        setModel(null);
        setStatus("The task list could not be updated.");
        onError(error);
      });
    return () => {
      if (generation.current === requestGeneration) {
        generation.current += 1;
      }
    };
  }, [
    indexTaskList,
    onError,
    provider,
    query,
    queryTaskList,
    retry,
    snapshot,
    taskCoordinator,
  ]);

  useLayoutEffect(() => {
    const target = pendingFocus.current;
    if (!target) {
      return;
    }
    pendingFocus.current = null;
    if (target === "filters") {
      statusSelect.current?.focus();
    } else {
      taskInputs.current.get(target)?.focus();
    }
  }, [model]);

  const toggleTask = async (
    task: PluginTaskListItem,
    checked: boolean,
  ) => {
    if (workingTaskId) {
      return;
    }
    setWorkingTaskId(task.id);
    try {
      await onToggle(task, checked);
      setModel((current) => {
        if (!current) {
          return current;
        }
        const index = current.tasks.findIndex(
          (candidate) => candidate.id === task.id,
        );
        const leavesFilter =
          (statusFilter === "open" && checked) ||
          (statusFilter === "completed" && !checked);
        if (leavesFilter) {
          pendingFocus.current =
            current.tasks[index + 1]?.id ??
            current.tasks[index - 1]?.id ??
            "filters";
          const tasks = current.tasks.filter(
            (candidate) => candidate.id !== task.id,
          );
          return {
            ...current,
            tasks,
            matchingTasks: Math.max(0, current.matchingTasks - 1),
          };
        }
        return {
          ...current,
          tasks: current.tasks.map((candidate) =>
            candidate.id === task.id
              ? updatedTask(candidate, checked)
              : candidate,
          ),
        };
      });
      setStatus(`${checked ? "Completed" : "Reopened"} ${task.text}.`);
    } catch (error) {
      setStatus(errorMessage(error));
      onError(error);
    } finally {
      setWorkingTaskId(null);
    }
  };

  return (
    <section
      className="sidebar-view task-list-panel"
      aria-labelledby={headingId}
      aria-busy={loading}
    >
      <div className="sidebar-view__title">
        <h2 id={headingId}>{provider.title}</h2>
        {loading ? <span>Updating</span> : null}
      </div>
      <div className="task-list-panel__filters">
        <label>
          Status
          <select
            ref={statusSelect}
            value={statusFilter}
            onChange={(event) =>
              setStatusFilter(
                event.currentTarget.value as PluginTaskListQuery["status"],
              )
            }
          >
            <option value="open">Open</option>
            <option value="completed">Completed</option>
            <option value="all">All</option>
          </select>
        </label>
        <label>
          Due
          <select
            value={due}
            onChange={(event) =>
              setDue(
                event.currentTarget.value as PluginTaskListQuery["due"],
              )
            }
          >
            <option value="all">Any due date</option>
            <option value="overdue">Overdue</option>
            <option value="today">Due today</option>
            <option value="upcoming">Upcoming</option>
            <option value="undated">No due date</option>
          </select>
        </label>
        <label>
          Tag
          <select
            value={tag ?? "*"}
            onChange={(event) =>
              setTag(
                event.currentTarget.value === "*"
                  ? null
                  : event.currentTarget.value,
              )
            }
          >
            <option value="*">All tags</option>
            {model?.availableTags.map((value) => (
              <option value={value} key={value}>
                #{value}
              </option>
            ))}
          </select>
        </label>
        <label>
          Path
          <input
            type="search"
            value={path}
            placeholder="Folder or note"
            onChange={(event) => setPath(event.currentTarget.value)}
          />
        </label>
      </div>
      <p className="task-list-panel__status" role="status" aria-live="polite">
        {status}
      </p>
      {model?.notices.length ? (
        <ul className="task-list-panel__notices">
          {model.notices.map((notice) => (
            <li key={notice}>{notice}</li>
          ))}
        </ul>
      ) : null}
      {model && model.tasks.length > 0 ? (
        <ul className="task-list">
          {model.tasks.map((task) => {
            const working = workingTaskId === task.id;
            return (
              <li key={task.id} aria-busy={working}>
                <label className="task-list__toggle">
                  <input
                    ref={(element) => {
                      if (element) {
                        taskInputs.current.set(task.id, element);
                      } else {
                        taskInputs.current.delete(task.id);
                      }
                    }}
                    type="checkbox"
                    checked={task.checked}
                    aria-disabled={workingTaskId !== null}
                    aria-label={`${task.checked ? "Reopen" : "Complete"} ${task.text}`}
                    onChange={(event) =>
                      void toggleTask(task, event.currentTarget.checked)
                    }
                  />
                  <span>{task.text}</span>
                </label>
                <button
                  type="button"
                  className="task-list__source"
                  onClick={() => void onOpenFile(task.path)}
                >
                  <strong>{task.noteTitle}</strong>
                  <span>
                    {task.path}:{task.line}
                  </span>
                </button>
                {task.headingPath.length > 0 ? (
                  <small>{task.headingPath.join(" / ")}</small>
                ) : null}
                <div className="task-list__metadata">
                  {task.dueDate ? (
                    <time dateTime={task.dueDate}>
                      due {task.dueDate}
                    </time>
                  ) : null}
                  {task.tags.map((taskTag) => (
                    <span key={taskTag}>#{taskTag}</span>
                  ))}
                </div>
              </li>
            );
          })}
        </ul>
      ) : model ? (
        <div className="task-list-panel__empty">
          <p>No tasks match these filters.</p>
          <p>
            Add a Markdown checkbox such as{" "}
            <code>- [ ] Review notes due:2026-10-01</code>.
          </p>
        </div>
      ) : null}
      {!model && !loading ? (
        <button type="button" onClick={() => setRetry((value) => value + 1)}>
          Retry task list
        </button>
      ) : null}
    </section>
  );
}

function updatedTask(
  task: PluginTaskListItem,
  checked: boolean,
): PluginTaskListItem {
  return {
    ...task,
    checked,
    locator: {
      ...task.locator,
      checked,
      sourceLine: task.locator.sourceLine.replace(
        /^(\s*[-*+]\s+\[)[ xX](\]\s+)/u,
        `$1${checked ? "x" : " "}$2`,
      ),
    },
  };
}

function taskStatus(model: PluginTaskListModel): string {
  return model.matchingTasks === model.totalTasks
    ? `${model.totalTasks} indexed task${model.totalTasks === 1 ? "" : "s"}.`
    : `${model.matchingTasks} of ${model.totalTasks} indexed tasks match.`;
}
