import { Plug, Search, ShieldCheck, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  PLUGIN_CATEGORIES,
  type PluginCategory,
  type PluginPermissionRequest,
  type PluginSettingDefinition,
} from "@denote/plugin-sdk";
import type {
  PluginBundleMetadata,
  PluginView,
  ProjectRoot,
} from "../types";

const CATEGORY_LABELS: Record<PluginCategory, string> = {
  code: "Code",
  productivity: "Productivity",
  "knowledge-management": "Knowledge management",
  "editor-writing": "Editor and writing",
  "diagrams-visualization": "Diagrams and visualization",
  collaboration: "Collaboration",
  accessibility: "Accessibility",
  "security-privacy": "Security and privacy",
  other: "Other",
};

const PERMISSION_LABELS: Record<string, string> = {
  commands: "Register commands",
  sidebar: "Add sidebar views",
  status: "Add status bar items",
  "editor-decoration": "Decorate editor content",
  "note-events": "Observe note lifecycle events",
  "project-context": "Observe the focused project root",
  "source-control": "Provide source control status and actions",
  "automatic-local-commit": "Allow automatic local commits",
  git: "Run reviewed Git operations in this vault or project",
  "workspace-read": "Read vault content",
  "workspace-write": "Change vault content after an explicit action",
  network: "Connect to declared network hosts",
  "clipboard-read": "Read the clipboard",
  "clipboard-write": "Write to the clipboard after an explicit action",
  notifications: "Show system notifications",
  process: "Run external processes after an explicit action",
  "secure-storage": "Use an isolated operating-system keychain namespace",
};

interface PluginSettingsPanelProps {
  plugins: PluginView[];
  bundles: PluginBundleMetadata[];
  activeProject: ProjectRoot | null;
  loading: boolean;
  busyPluginIds: ReadonlySet<string>;
  onEnable: (
    pluginId: string,
    permissions: PluginPermissionRequest[],
  ) => Promise<void>;
  onDisable: (pluginId: string) => Promise<void>;
  onDisableAll: () => Promise<void>;
  onClearData: (pluginId: string) => Promise<void>;
  onClearCredentials: (pluginId: string) => Promise<void>;
  onUpdateSettings: (
    pluginId: string,
    settings: Record<string, unknown>,
  ) => Promise<void>;
  onImportSettings: (
    pluginId: string,
    sourceVersion: number,
    settings: Record<string, unknown>,
  ) => Promise<void>;
  onError: (error: unknown) => void;
}

export function PluginSettingsPanel({
  plugins,
  bundles,
  activeProject,
  loading,
  busyPluginIds,
  onEnable,
  onDisable,
  onDisableAll,
  onClearData,
  onClearCredentials,
  onUpdateSettings,
  onImportSettings,
  onError,
}: PluginSettingsPanelProps) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<PluginCategory | "all">("all");
  const [stateFilter, setStateFilter] = useState<
    "all" | "enabled" | "disabled"
  >("all");
  const [pendingEnable, setPendingEnable] = useState<string | null>(null);
  const [pendingCleanup, setPendingCleanup] = useState<{
    pluginId: string;
    kind: "data" | "credentials";
  } | null>(null);
  const [drafts, setDrafts] = useState<
    Record<string, Record<string, unknown>>
  >({});
  const [dirtyPluginIds, setDirtyPluginIds] = useState<Set<string>>(
    new Set(),
  );
  const [settingsJson, setSettingsJson] = useState<Record<string, string>>({});

  useEffect(() => {
    setDrafts((current) => {
      const next = { ...current };
      for (const plugin of plugins) {
        if (!dirtyPluginIds.has(plugin.catalog.manifest.id)) {
          next[plugin.catalog.manifest.id] = { ...plugin.settings };
        }
      }
      return next;
    });
    setSettingsJson((current) => {
      const next = { ...current };
      for (const plugin of plugins) {
        if (!dirtyPluginIds.has(plugin.catalog.manifest.id)) {
          next[plugin.catalog.manifest.id] = JSON.stringify(
            {
              schemaVersion: plugin.catalog.manifest.settings?.version ?? 0,
              settings: plugin.settings,
            },
            null,
            2,
          );
        }
      }
      return next;
    });
  }, [dirtyPluginIds, plugins]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return plugins.filter((plugin) => {
      const manifest = plugin.catalog.manifest;
      const pluginCategory = normalizedCategory(manifest.category);
      if (category !== "all" && pluginCategory !== category) {
        return false;
      }
      if (stateFilter === "enabled" && !plugin.enabled) {
        return false;
      }
      if (stateFilter === "disabled" && plugin.enabled) {
        return false;
      }
      return (
        !normalized ||
        [
          manifest.name,
          manifest.description,
          manifest.id,
          manifest.publisher.name,
          plugin.catalog.guide,
        ]
          .join(" ")
          .toLocaleLowerCase()
          .includes(normalized)
      );
    });
  }, [category, plugins, query, stateFilter]);

  const grouped = useMemo(() => {
    const groups = new Map<PluginCategory, PluginView[]>();
    for (const plugin of filtered) {
      const pluginCategory = normalizedCategory(
        plugin.catalog.manifest.category,
      );
      const entries = groups.get(pluginCategory) ?? [];
      entries.push(plugin);
      groups.set(pluginCategory, entries);
    }
    return PLUGIN_CATEGORIES.flatMap((pluginCategory) => {
      const entries = groups.get(pluginCategory);
      return entries ? [[pluginCategory, entries] as const] : [];
    });
  }, [filtered]);

  return (
    <section
      className="plugin-settings"
      aria-labelledby="plugin-settings-title"
      aria-busy={loading}
    >
      <header className="plugin-settings__header">
        <div>
          <h3 id="plugin-settings-title">
            <Plug aria-hidden="true" size={15} />
            Plugins
          </h3>
          <p>
            Plugin code is downloaded and executed only after you approve and
            enable it. Disabling stops the plugin and deletes its package.
          </p>
        </div>
        {plugins.some((plugin) => plugin.enabled) ? (
          <button
            type="button"
            className="secondary-button"
            onClick={() => void onDisableAll().catch(onError)}
          >
            Disable all plugins
          </button>
        ) : null}
      </header>

      {activeProject && !loading ? (
        <CodeToolingRecommendations bundles={bundles} plugins={plugins} />
      ) : null}

      <div className="plugin-settings__filters">
        <label className="plugin-settings__search">
          <Search aria-hidden="true" size={14} />
          <span className="sr-only">Search plugins</span>
          <input
            type="search"
            value={query}
            placeholder="Search plugins"
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
        </label>
        <label>
          <span>Category</span>
          <select
            value={category}
            onChange={(event) =>
              setCategory(event.currentTarget.value as PluginCategory | "all")
            }
          >
            <option value="all">All categories</option>
            {PLUGIN_CATEGORIES.map((pluginCategory) => (
              <option key={pluginCategory} value={pluginCategory}>
                {CATEGORY_LABELS[pluginCategory]}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Status</span>
          <select
            value={stateFilter}
            onChange={(event) =>
              setStateFilter(
                event.currentTarget.value as "all" | "enabled" | "disabled",
              )
            }
          >
            <option value="all">All plugins</option>
            <option value="enabled">Enabled</option>
            <option value="disabled">Disabled</option>
          </select>
        </label>
      </div>

      <p className="sr-only" role="status" aria-live="polite">
        {loading
          ? "Loading plugins"
          : `${filtered.length} plugin${filtered.length === 1 ? "" : "s"} shown`}
      </p>

      {loading ? (
        <p className="plugin-settings__empty">Loading plugin catalog…</p>
      ) : grouped.length === 0 ? (
        <p className="plugin-settings__empty">No plugins match these filters.</p>
      ) : (
        <div className="plugin-settings__groups">
          {grouped.map(([pluginCategory, entries]) => (
            <section
              key={pluginCategory}
              aria-labelledby={`plugin-category-${pluginCategory}`}
            >
              <h4 id={`plugin-category-${pluginCategory}`}>
                {CATEGORY_LABELS[pluginCategory]}
              </h4>
              <div className="plugin-settings__list">
                {entries.map((plugin) => {
                  const manifest = plugin.catalog.manifest;
                  const pluginId = manifest.id;
                  const busy = busyPluginIds.has(pluginId);
                  const permissions = manifest.permissions.map(
                    (permission) => permission.capability,
                  );
                  const settingDefinitions =
                    manifest.settings?.properties ?? {};
                  const draft = drafts[pluginId] ?? plugin.settings;
                  const confirmEnable = pendingEnable === pluginId;
                  return (
                    <article className="plugin-card" key={pluginId}>
                      <header className="plugin-card__header">
                        <div>
                          <h5>{manifest.name}</h5>
                          <p>{manifest.description}</p>
                        </div>
                        <span
                          className={`plugin-status plugin-status--${plugin.status}`}
                        >
                          {statusLabel(plugin)}
                        </span>
                      </header>
                      <dl className="plugin-card__metadata">
                        <div>
                          <dt>Version</dt>
                          <dd>{manifest.version}</dd>
                        </div>
                        <div>
                          <dt>Publisher</dt>
                          <dd>{manifest.publisher.name}</dd>
                        </div>
                        <div>
                          <dt>Package</dt>
                          <dd>{plugin.enabled ? "Downloaded" : "Not stored locally"}</dd>
                        </div>
                        <div>
                          <dt>Trust</dt>
                          <dd>
                            {plugin.catalog.provenance.trusted
                              ? `Verified ${plugin.catalog.provenance.publisherId}`
                              : "Untrusted"}
                          </dd>
                        </div>
                      </dl>
                      {plugin.error ? (
                        <p className="plugin-card__error" role="alert">
                          {plugin.error}
                        </p>
                      ) : null}

                      <details
                        className="plugin-card__details"
                        open={Boolean(plugin.error) ? true : undefined}
                      >
                        <summary>Permissions and guide</summary>
                        <div className="plugin-card__details-body">
                          <section>
                            <h6>Permissions</h6>
                            {permissions.length > 0 ? (
                              <ul>
                                {manifest.permissions.map((permission) => (
                                  <li key={permission.capability}>
                                    {permissionLabel(permission.capability)}
                                    {permissionScope(permission) ? (
                                      <small>{permissionScope(permission)}</small>
                                    ) : null}
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              <p>No additional permissions.</p>
                            )}
                          </section>
                          <Guide guide={plugin.catalog.guide} />
                        </div>
                      </details>

                      {Object.keys(settingDefinitions).length > 0 ? (
                        <fieldset className="plugin-card__settings" disabled={busy}>
                          <legend>Settings</legend>
                          {Object.entries(settingDefinitions).map(
                            ([key, definition]) => (
                              <PluginSetting
                                key={key}
                                id={`${pluginId}-${key}`}
                                definition={definition}
                                value={draft[key]}
                                onChange={(value) => {
                                  setDirtyPluginIds((current) =>
                                    new Set(current).add(pluginId),
                                  );
                                  setDrafts((current) => ({
                                    ...current,
                                    [pluginId]: {
                                      ...(current[pluginId] ?? plugin.settings),
                                      [key]: value,
                                    },
                                  }));
                                }}
                              />
                            ),
                          )}
                          <div className="plugin-card__settings-actions">
                            <button
                              type="button"
                              className="secondary-button"
                              onClick={() =>
                                void onUpdateSettings(pluginId, draft)
                                  .then(() =>
                                    setDirtyPluginIds((current) => {
                                      const next = new Set(current);
                                      next.delete(pluginId);
                                      return next;
                                    }),
                                  )
                                  .catch(onError)
                              }
                            >
                              Save settings
                            </button>
                            <button
                              type="button"
                              className="secondary-button"
                              onClick={() => {
                                const defaults = settingDefaults(settingDefinitions);
                                void onUpdateSettings(pluginId, defaults)
                                  .then(() => {
                                    setDrafts((current) => ({
                                      ...current,
                                      [pluginId]: defaults,
                                    }));
                                    setDirtyPluginIds((current) => {
                                      const next = new Set(current);
                                      next.delete(pluginId);
                                      return next;
                                    });
                                  })
                                  .catch(onError);
                              }}
                            >
                              Reset settings
                            </button>
                          </div>
                          <details className="plugin-settings-json">
                            <summary>Import or export settings JSON</summary>
                            <textarea
                              aria-label={`${manifest.name} settings JSON`}
                              value={
                                settingsJson[pluginId] ??
                                JSON.stringify(
                                  {
                                    schemaVersion:
                                      manifest.settings?.version ?? 0,
                                    settings: draft,
                                  },
                                  null,
                                  2,
                                )
                              }
                              onChange={(event) => {
                                const value = event.currentTarget.value;
                                setSettingsJson((current) => ({
                                  ...current,
                                  [pluginId]: value,
                                }));
                              }}
                            />
                            <button
                              type="button"
                              className="secondary-button"
                              onClick={() => {
                                try {
                                  const imported: unknown = JSON.parse(
                                    settingsJson[pluginId] ?? "{}",
                                  );
                                  if (
                                    !isRecord(imported) ||
                                    typeof imported.schemaVersion !== "number" ||
                                    !isRecord(imported.settings)
                                  ) {
                                    throw new Error(
                                      "Imported plugin settings must contain schemaVersion and settings.",
                                    );
                                  }
                                  const sourceVersion = imported.schemaVersion;
                                  const importedSettings = imported.settings;
                                  void onImportSettings(
                                    pluginId,
                                    sourceVersion,
                                    importedSettings,
                                  )
                                    .then(() => {
                                      setDrafts((current) => ({
                                        ...current,
                                        [pluginId]: importedSettings,
                                      }));
                                      setDirtyPluginIds((current) => {
                                        const next = new Set(current);
                                        next.delete(pluginId);
                                        return next;
                                      });
                                    })
                                    .catch(onError);
                                } catch (error) {
                                  onError(error);
                                }
                              }}
                            >
                              Import JSON
                            </button>
                          </details>
                        </fieldset>
                      ) : null}

                      {confirmEnable ? (
                        <section
                          className="plugin-card__permission-confirm"
                          aria-labelledby={`${pluginId}-permission-title`}
                        >
                          <h6 id={`${pluginId}-permission-title`}>
                            <ShieldCheck aria-hidden="true" size={14} />
                            Approve permissions?
                          </h6>
                          <p>
                            Denote will download and verify the package, then run
                            it in an isolated worker.
                          </p>
                          <div>
                            <button
                              type="button"
                              className="secondary-button"
                              disabled={busy}
                              onClick={() => setPendingEnable(null)}
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              className="primary-button"
                              disabled={busy}
                              onClick={() =>
                                void onEnable(pluginId, manifest.permissions)
                                  .then(() => setPendingEnable(null))
                                  .catch(onError)
                              }
                            >
                              {busy ? "Enabling…" : "Approve and enable"}
                            </button>
                          </div>
                        </section>
                      ) : (
                        <div className="plugin-card__actions">
                          {plugin.enabled ? (
                            <button
                              type="button"
                              className="secondary-button"
                              disabled={busy}
                              onClick={() =>
                                void onDisable(pluginId).catch(onError)
                              }
                            >
                              {busy ? "Disabling…" : "Disable and remove code"}
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="primary-button"
                              disabled={busy || plugin.status === "incompatible"}
                              onClick={() => setPendingEnable(pluginId)}
                            >
                              {plugin.status === "update-available"
                                ? "Review and update"
                                : "Enable"}
                            </button>
                          )}
                          {!plugin.enabled ? (
                            <>
                              <button
                                type="button"
                                className="secondary-button"
                                disabled={busy}
                                onClick={() =>
                                  setPendingCleanup({
                                    pluginId,
                                    kind: "data",
                                  })
                                }
                              >
                                <Trash2 aria-hidden="true" size={13} />
                                Delete saved data
                              </button>
                              {plugin.hasCredentials ? (
                                <button
                                  type="button"
                                  className="secondary-button"
                                  disabled={busy}
                                  onClick={() =>
                                    setPendingCleanup({
                                      pluginId,
                                      kind: "credentials",
                                    })
                                  }
                                >
                                  <Trash2 aria-hidden="true" size={13} />
                                  Delete credentials
                                </button>
                              ) : null}
                            </>
                          ) : null}
                        </div>
                      )}
                      {pendingCleanup?.pluginId === pluginId ? (
                        <section
                          className="plugin-card__permission-confirm"
                          aria-labelledby={`${pluginId}-cleanup-title`}
                        >
                          <h6 id={`${pluginId}-cleanup-title`}>
                            Delete plugin {pendingCleanup.kind}?
                          </h6>
                          <p>
                            This does not delete notes or other user-authored
                            vault content.
                          </p>
                          <div>
                            <button
                              type="button"
                              className="secondary-button"
                              disabled={busy}
                              onClick={() => setPendingCleanup(null)}
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              className="danger-button"
                              disabled={busy}
                              onClick={() => {
                                const cleanup =
                                  pendingCleanup.kind === "data"
                                    ? onClearData(pluginId)
                                    : onClearCredentials(pluginId);
                                void cleanup
                                  .then(() => {
                                    if (pendingCleanup.kind === "data") {
                                      setDrafts((current) => ({
                                        ...current,
                                        [pluginId]: {},
                                      }));
                                      setDirtyPluginIds((current) => {
                                        const next = new Set(current);
                                        next.delete(pluginId);
                                        return next;
                                      });
                                    }
                                    setPendingCleanup(null);
                                  })
                                  .catch(onError);
                              }}
                            >
                              Delete {pendingCleanup.kind}
                            </button>
                          </div>
                        </section>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </section>
  );
}

function CodeToolingRecommendations({
  bundles,
  plugins,
}: {
  bundles: PluginBundleMetadata[];
  plugins: PluginView[];
}) {
  const bundle = bundles.find((candidate) => candidate.id === "code-tooling");
  if (!bundle) {
    return null;
  }
  const pluginsById = new Map(
    plugins.map((plugin) => [plugin.catalog.manifest.id, plugin]),
  );
  return (
    <section
      className="plugin-bundle"
      aria-labelledby={`plugin-bundle-${bundle.id}`}
    >
      <div className="plugin-bundle__header">
        <h4 id={`plugin-bundle-${bundle.id}`}>{bundle.name}</h4>
        <p>
          Optional recommendations for the focused project. Review and enable
          plugins individually below.
        </p>
      </div>
      <ul className="plugin-bundle__roles">
        {bundle.roles.map((role) => {
          const candidates = role.candidatePluginIds.flatMap((pluginId) => {
            const plugin = pluginsById.get(pluginId);
            return plugin ? [plugin] : [];
          });
          const state =
            candidates.length === 0
              ? "Unavailable"
              : candidates.some((candidate) => candidate.enabled)
                ? "Enabled"
                : "Disabled";
          return (
            <li key={role.id} className="plugin-bundle__role">
              <div className="plugin-bundle__role-header">
                <h5>{role.name}</h5>
                <span
                  className={`plugin-status plugin-status--${state.toLowerCase()}`}
                >
                  {state}
                </span>
              </div>
              {candidates.length === 0 ? (
                <p>No catalog plugin is currently available for this role.</p>
              ) : (
                <ul className="plugin-bundle__candidates">
                  {candidates.map((candidate) => (
                    <li key={candidate.catalog.manifest.id}>
                      <strong>{candidate.catalog.manifest.name}</strong>
                      <span>
                        {candidateStatusLabel(candidate)}
                        {candidate.error ? ` — ${candidate.error}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function PluginSetting({
  id,
  definition,
  value,
  onChange,
}: {
  id: string;
  definition: PluginSettingDefinition;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  if (definition.type === "boolean") {
    return (
      <label className="plugin-setting plugin-setting--checkbox" htmlFor={id}>
        <input
          id={id}
          type="checkbox"
          checked={value === true}
          onChange={(event) => onChange(event.currentTarget.checked)}
        />
        <span>
          <strong>{definition.title}</strong>
          {definition.description ? <small>{definition.description}</small> : null}
        </span>
      </label>
    );
  }
  return (
    <label className="plugin-setting" htmlFor={id}>
      <span>
        <strong>{definition.title}</strong>
        {definition.description ? <small>{definition.description}</small> : null}
      </span>
      {definition.type === "select" ? (
        <select
          id={id}
          value={typeof value === "string" ? value : definition.default}
          onChange={(event) => onChange(event.currentTarget.value)}
        >
          {definition.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          id={id}
          type={definition.type === "number" ? "number" : "text"}
          value={
            typeof value === definition.type
              ? String(value)
              : String(definition.default)
          }
          min={definition.type === "number" ? definition.minimum : undefined}
          max={definition.type === "number" ? definition.maximum : undefined}
          onChange={(event) =>
            onChange(
              definition.type === "number"
                ? Number(event.currentTarget.value)
                : event.currentTarget.value,
            )
          }
        />
      )}
    </label>
  );
}

function Guide({ guide }: { guide: string }) {
  const sections = guide
    .split(/^## /m)
    .slice(1)
    .map((section) => {
      const [title, ...body] = section.trim().split("\n");
      return { title, body: body.join("\n").trim() };
    });
  return (
    <section className="plugin-guide">
      <h6>How to use</h6>
      {sections.map((section) => (
        <div key={section.title}>
          <strong>{section.title}</strong>
          <p>{section.body}</p>
        </div>
      ))}
    </section>
  );
}

function normalizedCategory(category: string): PluginCategory {
  return PLUGIN_CATEGORIES.includes(category as PluginCategory)
    ? (category as PluginCategory)
    : "other";
}

function permissionLabel(permission: string): string {
  return PERMISSION_LABELS[permission] ?? permission;
}

function permissionScope(permission: PluginPermissionRequest): string | null {
  if (permission.capability === "network") {
    return `Hosts: ${permission.hosts.join(", ")}`;
  }
  if (permission.capability === "process") {
    const scopes = Object.entries(permission.executables)
      .flatMap(([platform, executables]) =>
        (executables ?? []).map(
          (executable) => `${platform}: ${executable}`,
        ),
      );
    return scopes.length > 0 ? `Executables: ${scopes.join("; ")}` : null;
  }
  return null;
}

function statusLabel(plugin: PluginView): string {
  if (plugin.enabled) {
    return "Enabled";
  }
  switch (plugin.status) {
    case "downloading":
      return "Downloading";
    case "verifying":
      return "Verifying";
    case "installing":
      return "Installing";
    case "disabling":
      return "Disabling";
    case "update-available":
      return "Update available";
    case "incompatible":
      return "Incompatible";
    case "failed":
      return "Failed";
    case "not-installed":
    case "disabled":
    case "enabled":
      return "Disabled";
  }
}

function candidateStatusLabel(plugin: PluginView): string {
  if (
    plugin.status === "failed" ||
    plugin.status === "incompatible" ||
    plugin.status === "update-available"
  ) {
    return statusLabel({ ...plugin, enabled: false });
  }
  return statusLabel(plugin);
}

function settingDefaults(
  definitions: Record<string, PluginSettingDefinition>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(definitions).map(([key, definition]) => [
      key,
      definition.default,
    ]),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
