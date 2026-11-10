import type { PluginAuthoringCapability } from "./authoring";
import type { PluginSensitiveToolsCapability } from "./sensitiveTools";
export declare const PLUGIN_MANIFEST_SCHEMA_VERSION: 1;
export declare const PLUGIN_API_VERSION: 1;
export declare const PLUGIN_CATEGORIES: readonly ["code", "productivity", "knowledge-management", "editor-writing", "diagrams-visualization", "collaboration", "accessibility", "security-privacy", "other"];
export type PluginCategory = (typeof PLUGIN_CATEGORIES)[number];
export declare const PLUGIN_CAPABILITIES: readonly ["commands", "sidebar", "status", "editor-decoration", "emoji-picker", "structured-viewer", "kanban-board", "task-list", "text-styling", "note-comments", "presentation", "speech", "credential-store", "note-graph", "calendar", "reminders", "time-tracking", "clocks", "diagram-renderer", "note-events", "project-context", "code-intelligence", "tooling", "terminal", "source-control", "automatic-local-commit", "automatic-git-push", "git", "workspace-read", "workspace-write", "network", "clipboard-read", "clipboard-write", "notifications", "process", "secure-storage"];
export type PluginCapability = (typeof PLUGIN_CAPABILITIES)[number];
export type PluginPermissionRequest = {
    capability: Exclude<PluginCapability, "network" | "process">;
} | {
    capability: "network";
    hosts: string[];
} | {
    capability: "process";
    executables: {
        macos?: string[];
        linux?: string[];
        windows?: string[];
    };
};
export interface PluginPublisher {
    name: string;
    url?: string;
}
export interface PluginCompatibility {
    apiVersion: number;
    minimumDenoteVersion: string;
    maximumDenoteVersion?: string;
}
interface PluginSettingBase {
    title: string;
    description?: string;
}
export interface PluginBooleanSetting extends PluginSettingBase {
    type: "boolean";
    default: boolean;
}
export interface PluginStringSetting extends PluginSettingBase {
    type: "string";
    default: string;
    sensitive?: boolean;
}
export interface PluginNumberSetting extends PluginSettingBase {
    type: "number";
    default: number;
    minimum?: number;
    maximum?: number;
}
export interface PluginSelectSetting extends PluginSettingBase {
    type: "select";
    default: string;
    options: Array<{
        value: string;
        label: string;
    }>;
}
export type PluginSettingDefinition = PluginBooleanSetting | PluginStringSetting | PluginNumberSetting | PluginSelectSetting;
export interface PluginSettingsMigration {
    from: number;
    to: number;
    rename?: Record<string, string>;
    remove?: string[];
    defaults?: Record<string, unknown>;
}
export interface PluginSettingsSchema {
    version: number;
    properties: Record<string, PluginSettingDefinition>;
    migrations?: PluginSettingsMigration[];
}
export interface PluginManifest {
    schemaVersion: typeof PLUGIN_MANIFEST_SCHEMA_VERSION;
    id: string;
    name: string;
    version: string;
    description: string;
    publisher: PluginPublisher;
    license: string;
    repository: string;
    homepage?: string;
    icon: string;
    category: PluginCategory;
    compatibility: PluginCompatibility;
    permissions: PluginPermissionRequest[];
    entrypoint: string;
    diagramRenderer?: {
        entrypoint: string;
    };
    legal?: string[];
    documentation: string;
    settings?: PluginSettingsSchema;
}
export interface PluginArtifact {
    url: string;
    sha256: string;
    sizeBytes: number;
}
export interface PluginProvenance {
    publisherId: string;
    sourceCommit: string;
    trusted: boolean;
}
export interface PluginRevocation {
    reason: string;
    revokedAt: string;
}
export interface PluginBundleRole {
    id: string;
    name: string;
    candidatePluginIds: string[];
}
export interface PluginBundle {
    id: string;
    name: string;
    categories: PluginCategory[];
    roles: PluginBundleRole[];
}
export interface PluginCatalogEntry {
    manifest: PluginManifest;
    artifact: PluginArtifact;
    provenance: PluginProvenance;
    revoked?: PluginRevocation;
    guide: string;
}
export type PluginInstallState = "downloading" | "verifying" | "installing";
export type PluginLifecycleState = "not-installed" | PluginInstallState | "enabled" | "disabling" | "disabled" | "update-available" | "incompatible" | "failed";
export declare const PLUGIN_GUIDE_SECTIONS: readonly ["purpose", "enablement and permissions", "usage", "settings", "disable behavior", "troubleshooting"];
export interface PluginDisposable {
    dispose: () => void | Promise<void>;
}
export interface PluginSubscriptions {
    add: (disposable: PluginDisposable) => void;
}
export interface PluginLogger {
    debug: (message: string, details?: Record<string, unknown>) => void;
    info: (message: string, details?: Record<string, unknown>) => void;
    warn: (message: string, details?: Record<string, unknown>) => void;
    error: (message: string, details?: Record<string, unknown>) => void;
}
export interface PluginStorage {
    get: <T>(key: string) => Promise<T | null>;
    set: <T>(key: string, value: T) => Promise<void>;
    delete: (key: string) => Promise<void>;
    clear: () => Promise<void>;
}
export interface PluginSettings {
    getAll: () => Promise<Record<string, unknown>>;
}
export interface PluginEmojiVariant {
    name: string;
    unicode: string;
    tone?: number;
}
export interface PluginEmojiEntry {
    id: string;
    name: string;
    unicode: string;
    category: string;
    keywords: string[];
    shortcodes: string[];
    variants: PluginEmojiVariant[];
}
export interface PluginEmojiPreferences {
    recents: string[];
    favorites: string[];
    tone: number;
}
export interface PluginEmojiPicker {
    id: string;
    title: string;
    entries: PluginEmojiEntry[];
    shortcodes: boolean;
    settingsKeys: {
        recents: string;
        favorites: string;
        tone: string;
    };
}
export interface PluginEmojiPickerCapability {
    register: (picker: PluginEmojiPicker) => PluginDisposable;
}
export type PluginStructuredViewerFormat = "json" | "yaml";
export type PluginStructuredNodeType = "object" | "array" | "mapping" | "sequence" | "stream" | "string" | "number" | "boolean" | "null" | "scalar" | "alias";
export interface PluginStructuredNode {
    id: string;
    parentId: string | null;
    label: string;
    type: PluginStructuredNodeType;
    value?: string;
    anchor?: string;
    depth: number;
    childCount: number;
}
export interface PluginStructuredParseError {
    message: string;
    line?: number;
    column?: number;
    code?: string;
}
export interface PluginStructuredViewModel {
    rootId: string | null;
    nodes: PluginStructuredNode[];
    error: PluginStructuredParseError | null;
    notices: string[];
    truncated: boolean;
}
export interface PluginStructuredViewerParseRequest {
    path: string;
    format: PluginStructuredViewerFormat;
    source: string;
}
export interface PluginStructuredViewer {
    id: string;
    title: string;
    extensions: string[];
    parse: (request: PluginStructuredViewerParseRequest) => PluginStructuredViewModel | Promise<PluginStructuredViewModel>;
}
export interface PluginStructuredViewerCapability {
    register: (viewer: PluginStructuredViewer) => PluginDisposable;
}
export interface PluginKanbanLink {
    label: string;
    href: string;
}
export interface PluginKanbanCard {
    id: string;
    title: string;
    body: string;
    tags: string[];
    links: PluginKanbanLink[];
    completed?: boolean;
}
export interface PluginKanbanColumn {
    id: string;
    title: string;
    cards: PluginKanbanCard[];
}
export interface PluginKanbanError {
    message: string;
    line?: number;
    column?: number;
    code?: string;
}
export type PluginKanbanSourceFormat = "denote-kanban-v1" | "obsidian-kanban";
export interface PluginKanbanBoardModel {
    title: string;
    columns: PluginKanbanColumn[];
    error: PluginKanbanError | null;
    notices: string[];
    canInitialize: boolean;
    sourceFormat?: PluginKanbanSourceFormat;
}
export interface PluginKanbanBoardRequest {
    path: string;
    source: string;
}
export type PluginKanbanEdit = {
    type: "migrate";
    title: string;
} | {
    type: "initialize";
    title: string;
    initialColumnTitle: string;
} | {
    type: "rename-board";
    title: string;
} | {
    type: "add-column";
    title: string;
    beforeColumnId: string | null;
} | {
    type: "rename-column";
    columnId: string;
    title: string;
} | {
    type: "delete-column";
    columnId: string;
} | {
    type: "move-column";
    columnId: string;
    beforeColumnId: string | null;
} | {
    type: "add-card";
    columnId: string;
    title: string;
    body: string;
    beforeCardId: string | null;
} | {
    type: "edit-card";
    cardId: string;
    title: string;
    body: string;
} | {
    type: "set-card-completed";
    cardId: string;
    completed: boolean;
} | {
    type: "delete-card";
    cardId: string;
} | {
    type: "move-card";
    cardId: string;
    targetColumnId: string;
    beforeCardId: string | null;
};
export interface PluginKanbanEditRequest extends PluginKanbanBoardRequest {
    edit: PluginKanbanEdit;
}
export interface PluginKanbanEditResult {
    source: string;
    model: PluginKanbanBoardModel;
}
export interface PluginKanbanBoardProvider {
    id: string;
    title: string;
    fileSuffixes: string[];
    defaultFileName: string;
    sourceFormats?: PluginKanbanSourceFormat[];
    parse: (request: PluginKanbanBoardRequest) => PluginKanbanBoardModel | Promise<PluginKanbanBoardModel>;
    edit: (request: PluginKanbanEditRequest) => PluginKanbanEditResult | Promise<PluginKanbanEditResult>;
}
export interface PluginKanbanBoardCapability {
    register: (provider: PluginKanbanBoardProvider) => PluginDisposable;
}
export interface PluginTaskListDocument {
    path: string;
    title: string;
    source: string;
}
export interface PluginTaskListIndexRequest {
    mode: "replace" | "update";
    documents: PluginTaskListDocument[];
    removedPaths: string[];
    skippedCount: number;
    truncated: boolean;
}
export type PluginTaskListStatusFilter = "all" | "open" | "completed";
export type PluginTaskListDueFilter = "all" | "overdue" | "today" | "upcoming" | "undated";
export interface PluginTaskListQuery {
    status: PluginTaskListStatusFilter;
    tag: string | null;
    path: string;
    due: PluginTaskListDueFilter;
    today: string;
    timeZone: string;
}
export interface PluginTaskListLocator {
    path: string;
    sourceLine: string;
    headingPath: string[];
    occurrence: number;
    matchCount: number;
    checked: boolean;
}
export interface PluginTaskListItem {
    id: string;
    path: string;
    noteTitle: string;
    line: number;
    text: string;
    checked: boolean;
    headingPath: string[];
    tags: string[];
    dueDate: string | null;
    locator: PluginTaskListLocator;
}
export interface PluginTaskListModel {
    tasks: PluginTaskListItem[];
    totalTasks: number;
    matchingTasks: number;
    availableTags: string[];
    truncated: boolean;
    notices: string[];
}
export interface PluginTaskListToggleRequest {
    path: string;
    source: string;
    locator: PluginTaskListLocator;
    checked: boolean;
}
export type PluginTaskListToggleResult = {
    status: "applied";
    source: string;
} | {
    status: "conflict";
    reason: "missing" | "ambiguous" | "changed";
};
export interface PluginTaskListProvider {
    id: string;
    title: string;
    index: (request: PluginTaskListIndexRequest) => void | Promise<void>;
    query: (request: PluginTaskListQuery) => PluginTaskListModel | Promise<PluginTaskListModel>;
    toggle: (request: PluginTaskListToggleRequest) => PluginTaskListToggleResult | Promise<PluginTaskListToggleResult>;
}
export interface PluginTaskListCapability {
    register: (provider: PluginTaskListProvider) => PluginDisposable;
}
export interface PluginNoteGraphDocument {
    path: string;
    title: string;
    source: string;
    tags: string[];
}
export interface PluginNoteGraphIndexRequest {
    mode: "replace" | "update";
    documents: PluginNoteGraphDocument[];
    removedPaths: string[];
    skippedCount: number;
    truncated: boolean;
}
export type PluginNoteGraphScope = "global" | "local";
export type PluginNoteGraphOrphanFilter = "all" | "only" | "connected";
export type PluginNoteGraphDepth = 1 | 2 | 3;
export interface PluginNoteGraphQuery {
    scope: PluginNoteGraphScope;
    activePath: string | null;
    folder: string | null;
    tag: string | null;
    orphanFilter: PluginNoteGraphOrphanFilter;
    depth: PluginNoteGraphDepth;
}
export interface PluginNoteGraphNode {
    id: string;
    path: string;
    title: string;
    tags: string[];
    incoming: number;
    outgoing: number;
    orphan: boolean;
    distance: number | null;
}
export interface PluginNoteGraphEdge {
    sourceId: string;
    targetId: string;
}
export interface PluginNoteGraphModel {
    nodes: PluginNoteGraphNode[];
    edges: PluginNoteGraphEdge[];
    totalNotes: number;
    matchingNotes: number;
    totalEdges: number;
    activeNodeId: string | null;
    truncated: boolean;
    notices: string[];
}
export interface PluginNoteGraphProvider {
    id: string;
    title: string;
    index: (request: PluginNoteGraphIndexRequest) => void | Promise<void>;
    query: (request: PluginNoteGraphQuery) => PluginNoteGraphModel | Promise<PluginNoteGraphModel>;
}
export interface PluginNoteGraphCapability {
    register: (provider: PluginNoteGraphProvider) => PluginDisposable;
}
export interface PluginCalendarDocument {
    path: string;
    title: string;
    frontmatter: string;
    metadataAvailable?: boolean;
    createdAt?: number | null;
    modifiedAt?: number | null;
}
export type PluginCalendarView = "dated" | "created" | "updated";
export interface PluginCalendarRequest {
    view?: PluginCalendarView;
    timeZone?: string;
    startDate: string;
    endDate: string;
    documents: PluginCalendarDocument[];
    skippedCount: number;
    truncated: boolean;
}
export interface PluginCalendarDay {
    date: string;
    dailyNotePath: string;
    notes: Array<{
        path: string;
        title: string;
    }>;
}
export interface PluginCalendarModel {
    view?: PluginCalendarView;
    days: PluginCalendarDay[];
    notices: string[];
    truncated: boolean;
}
export interface PluginCalendarProvider {
    id: string;
    title: string;
    views?: PluginCalendarView[];
    query: (request: PluginCalendarRequest) => PluginCalendarModel | Promise<PluginCalendarModel>;
}
export interface PluginCalendarCapability {
    register: (provider: PluginCalendarProvider) => PluginDisposable;
}
export type PluginReminderTargetKind = "standalone" | "note" | "heading" | "task";
export interface PluginReminderDocument {
    path: string;
    title: string;
    source: string;
}
export interface PluginReminderTarget {
    id: string;
    kind: PluginReminderTargetKind;
    path: string | null;
    noteTitle: string | null;
    line: number | null;
    label: string;
}
export interface PluginReminderLink {
    kind: PluginReminderTargetKind;
    path: string | null;
    noteTitle: string | null;
    line: number | null;
}
export interface PluginReminderTargetsRequest {
    document: PluginReminderDocument | null;
}
export interface PluginReminderTargetsModel {
    targets: PluginReminderTarget[];
    truncated: boolean;
    notices: string[];
}
export type PluginReminderSchedule = {
    kind: "wall-clock";
    localDateTime: string;
    timeZone: string;
} | {
    kind: "instant";
    dueAt: number;
    timeZone: string;
};
export type PluginReminderStatus = "scheduled" | "delivering" | "notified" | "failed" | "completed" | "dismissed";
export type PluginReminderRecurrenceUnit = "minute" | "hour" | "day" | "week" | "month" | "year";
export interface PluginReminderRecurrence {
    interval: number;
    unit: PluginReminderRecurrenceUnit;
}
export interface PluginReminderRecord {
    id: string;
    title: string;
    target: PluginReminderLink;
    schedule: PluginReminderSchedule;
    recurrence: PluginReminderRecurrence | null;
    dueAt: number;
    snoozedUntil: number | null;
    snoozeTimeZone: string | null;
    status: PluginReminderStatus;
    createdAt: number;
    updatedAt: number;
    attemptCount: number;
    deliveringAt: number | null;
    notifiedAt: number | null;
    completedAt: number | null;
    dismissedAt: number | null;
    lastError: string | null;
}
export interface PluginReminderQuery {
    workspaceId: string;
    now: number;
}
export type PluginReminderMutation = {
    type: "create";
    id: string;
    title: string;
    target: PluginReminderTarget;
    schedule: PluginReminderSchedule;
    recurrence: PluginReminderRecurrence | null;
    createdAt: number;
} | {
    type: "update";
    id: string;
    title: string;
    target: PluginReminderTarget;
    schedule: PluginReminderSchedule;
    recurrence: PluginReminderRecurrence | null;
    updatedAt: number;
} | {
    type: "snooze";
    id: string;
    dueAt: number;
    timeZone: string;
    updatedAt: number;
} | {
    type: "dismiss";
    id: string;
    dismissedAt: number;
} | {
    type: "complete";
    id: string;
    historyId: string;
    completedAt: number;
} | {
    type: "restore";
    id: string;
    restoredAt: number;
} | {
    type: "advance";
    id: string;
    advancedAt: number;
} | {
    type: "remove";
    id: string;
    updatedAt: number;
} | {
    type: "delivery-started";
    id: string;
    startedAt: number;
} | {
    type: "delivery-succeeded";
    id: string;
    completedAt: number;
} | {
    type: "delivery-failed";
    id: string;
    failedAt: number;
    error: string;
};
export interface PluginReminderMutationRequest {
    workspaceId: string;
    now: number;
    mutation: PluginReminderMutation;
}
export interface PluginReminderModel {
    reminders: PluginReminderRecord[];
    truncated: boolean;
    notices: string[];
}
export interface PluginReminderProvider {
    id: string;
    title: string;
    defaultSnoozeMinutes: number;
    targets: (request: PluginReminderTargetsRequest) => PluginReminderTargetsModel | Promise<PluginReminderTargetsModel>;
    query: (request: PluginReminderQuery) => PluginReminderModel | Promise<PluginReminderModel>;
    mutate: (request: PluginReminderMutationRequest) => PluginReminderModel | Promise<PluginReminderModel>;
}
export interface PluginReminderCapability {
    register: (provider: PluginReminderProvider) => PluginDisposable;
}
export type PluginDiagramTheme = "light" | "dark" | "high-contrast";
export interface PluginDiagramRenderer {
    id: string;
    title: string;
    languages: string[];
}
export interface PluginDiagramRendererCapability {
    register: (renderer: PluginDiagramRenderer) => PluginDisposable;
}
export interface PluginDiagramRenderRequest {
    source: string;
    theme: PluginDiagramTheme;
}
export interface PluginDiagramRenderError {
    code: "SOURCE_LIMIT" | "UNSAFE_SOURCE" | "UNSUPPORTED_DIAGRAM" | "PARSE_ERROR" | "RENDER_ERROR";
    message: string;
    line?: number;
    column?: number;
}
export type PluginDiagramRenderResult = {
    status: "success";
    svg: string;
    diagramType: string;
    accessibleName: string;
} | {
    status: "error";
    error: PluginDiagramRenderError;
};
export interface PluginDiagramRendererModule {
    renderDiagram: (request: PluginDiagramRenderRequest) => PluginDiagramRenderResult | Promise<PluginDiagramRenderResult>;
}
export interface PluginSecureStorage {
    get: (key: string) => Promise<string | null>;
    set: (key: string, value: string) => Promise<void>;
    delete: (key: string) => Promise<void>;
}
export interface PluginCommand {
    id: string;
    title: string;
    run: (context: PluginUserActionContext) => void | Promise<void>;
}
export interface PluginCommandCapability {
    register: (command: PluginCommand) => PluginDisposable;
}
export interface PluginSidebarView {
    id: string;
    title: string;
    content: string;
}
export interface PluginSidebarCapability {
    register: (view: PluginSidebarView) => PluginDisposable;
}
export interface PluginStatusItem {
    id: string;
    text: string;
}
export interface PluginStatusCapability {
    register: (item: PluginStatusItem) => PluginDisposable;
}
export interface PluginEditorDecoration {
    id: string;
    pattern: string;
    style: "highlight" | "warning" | "muted";
    caseSensitive?: boolean;
}
export interface PluginEditorDecorationCapability {
    register: (decoration: PluginEditorDecoration) => PluginDisposable;
}
export interface PluginNoteEvent {
    path: string;
    kind: "opened" | "changed" | "saved" | "closed";
}
export interface PluginNoteEventsCapability {
    subscribe: (listener: (event: PluginNoteEvent) => void | Promise<void>) => PluginDisposable;
}
export interface PluginProjectContext {
    projectId: string;
    rootPath: string;
}
export interface PluginProjectContextChangeEvent {
    previous: PluginProjectContext | null;
    current: PluginProjectContext | null;
    repositories?: PluginProjectRepositoryContext[];
    workspaceChanged: boolean;
}
export interface PluginProjectRepositoryContext {
    repositoryId: string;
    projectId: string | null;
    label: string;
}
export interface PluginProjectContextCapability {
    getCurrent: () => PluginProjectContext | null;
    getRepositories: () => PluginProjectRepositoryContext[];
    subscribe: (listener: (event: PluginProjectContextChangeEvent) => void | Promise<void>) => PluginDisposable;
}
export interface PluginSourceControlCommitSummary {
    id: string;
    shortId: string;
    summary: string;
    authorName: string;
    authoredAt: string;
}
export interface PluginSourceControlRepositorySummary {
    repositoryId: string;
    label: string;
    initialized: boolean;
    branch: string | null;
    upstream: string | null;
    ahead: number;
    behind: number;
    latestCommit: PluginSourceControlCommitSummary | null;
    busy: boolean;
    busyMessage?: string;
    activeOperationId?: string;
}
export interface PluginSourceControlWorkspaceRepository {
    repositoryId: string;
    label: string;
    selected: boolean;
    initialized: boolean;
    branch: string | null;
    changes: number;
}
export type PluginSourceControlResourceGroupKind = "staged" | "unstaged" | "untracked" | "conflicted" | "ignored";
export type PluginSourceControlResourceStatus = "added" | "modified" | "deleted" | "renamed" | "copied" | "type-changed" | "unmerged" | "unknown";
export interface PluginSourceControlResource {
    path: string;
    status: PluginSourceControlResourceStatus;
    additions: number;
    deletions: number;
    binary: boolean;
    lineCountsKnown?: boolean;
}
export declare const PLUGIN_SOURCE_CONTROL_MAX_FILE_STATS = 5000;
export interface PluginSourceControlFileStat {
    path: string;
    previousPath: string | null;
    additions: number;
    deletions: number;
    binary: boolean;
}
export interface PluginSourceControlResourceGroup {
    kind: PluginSourceControlResourceGroupKind;
    label: string;
    resources: PluginSourceControlResource[];
}
export interface PluginSourceControlBranchChoice {
    name: string;
    current: boolean;
    remote: boolean;
    upstream: string | null;
    ahead: number;
    behind: number;
}
export interface PluginSourceControlRemote {
    name: string;
    fetchUrl: string | null;
    pushUrl: string | null;
}
export interface PluginSourceControlHistoryEntry extends PluginSourceControlCommitSummary {
    parentIds: string[];
    refs: string[];
}
export interface PluginSourceControlHistoryPage {
    pageIndex: number;
    pageSize: number;
    hasPrevious: boolean;
    hasNext: boolean;
    loading: boolean;
    error: string | null;
}
export interface PluginSourceControlCommitDetail {
    commit: PluginSourceControlHistoryEntry;
    files: PluginSourceControlDiffFile[];
    limitation: string | null;
}
export type PluginSourceControlDiffSource = {
    kind: "worktree";
} | {
    kind: "index";
} | {
    kind: "commit";
    commitId: string;
};
export type PluginSourceControlDiffLineKind = "context" | "addition" | "deletion";
export interface PluginSourceControlDiffLine {
    kind: PluginSourceControlDiffLineKind;
    oldLineNumber: number | null;
    newLineNumber: number | null;
    content: string;
    noNewlineAtEndOfFile?: boolean;
}
export interface PluginSourceControlDiffHunk {
    header: string;
    oldStart: number;
    oldLines: number;
    newStart: number;
    newLines: number;
    lines: PluginSourceControlDiffLine[];
}
export interface PluginSourceControlDiffFile {
    path: string;
    previousPath: string | null;
    status: PluginSourceControlResourceStatus;
    additions: number;
    deletions: number;
    binary: boolean;
    hunks: PluginSourceControlDiffHunk[];
}
export interface PluginSourceControlConflictEntry {
    path: string;
    status: PluginSourceControlResourceStatus;
    oursLabel: string;
    theirsLabel: string;
    baseLabel: string | null;
}
export type PluginSourceControlAdvancedOperation = "merge" | "rebase" | "cherry-pick" | "revert";
export type PluginSourceControlOperationRisk = "creates-commit" | "may-conflict" | "rewrites-history";
export interface PluginSourceControlOperationPlan {
    operation: PluginSourceControlAdvancedOperation;
    source: string;
    sourceDetail: string | null;
    currentBranch: string | null;
    risk: PluginSourceControlOperationRisk;
    summary: string;
    affectedPaths: string[];
    affectedPathsLimitation: string | null;
    startActionId: string;
    cancelActionId: string;
}
export interface PluginSourceControlOperationProgress {
    operation: PluginSourceControlAdvancedOperation;
    summary: string;
    conflictedPaths: string[];
    continueAvailable: boolean;
    continueUnavailableReason: string | null;
    skipAvailable: boolean;
    abortAvailable: boolean;
}
export type PluginSourceControlConflictSideKind = "base" | "ours" | "theirs";
export interface PluginSourceControlConflictSide {
    side: PluginSourceControlConflictSideKind;
    label: string;
    present: boolean;
    text: string | null;
    byteLength: number;
}
export type PluginSourceControlConflictChunkKind = "stable" | "resolved" | "conflict";
export interface PluginSourceControlConflictChunk {
    id: string;
    kind: PluginSourceControlConflictChunkKind;
    base: string[];
    ours: string[];
    theirs: string[];
    choice: PluginSourceControlConflictSideKind | null;
    automatic: boolean;
}
export interface PluginSourceControlConflictDetail {
    path: string;
    operation: PluginSourceControlAdvancedOperation | null;
    binary: boolean;
    encrypted: boolean;
    base: PluginSourceControlConflictSide;
    ours: PluginSourceControlConflictSide;
    theirs: PluginSourceControlConflictSide;
    chunks: PluginSourceControlConflictChunk[];
    result: string | null;
    unsavedResult: boolean;
    unresolvedChunks: number;
    wholeSideOnly: boolean;
    limitation: string | null;
    status: string | null;
    error: string | null;
    loading: boolean;
}
export type PluginSourceControlAuthMode = "system" | "public" | "ssh-agent" | "github-https";
export interface PluginSourceControlRepositoryChoice {
    nameWithOwner: string;
    httpsUrl: string;
    sshUrl: string;
    defaultBranch: string | null;
    private: boolean;
}
export interface PluginSourceControlCloneCleanup {
    token: string;
    label: string;
}
export interface PluginSourceControlOperationReview {
    operation: string;
    outcome: "succeeded" | "failed" | "cancelled";
    summary: string;
    detail: string | null;
    files?: PluginSourceControlFileStat[];
    retryActionId?: string;
}
export interface PluginSourceControlRemoteAccess {
    pullStrategy?: PluginGitPullStrategy;
    authMode: PluginSourceControlAuthMode;
    cloneAvailable: boolean;
    githubAvailable: boolean;
    repositories: PluginSourceControlRepositoryChoice[];
    cleanup: PluginSourceControlCloneCleanup | null;
    review: PluginSourceControlOperationReview | null;
}
export type PluginSourceControlPendingOperation = "checkout" | PluginSourceControlAdvancedOperation;
export interface PluginSourceControlPendingBranchSwitch {
    operation: PluginSourceControlPendingOperation;
    target: string;
    localBranch: string | null;
    fromBranch: string | null;
    stagedPaths: string[];
    unstagedPaths: string[];
    untrackedPaths: string[];
    commitAvailable: boolean;
    stashAvailable: boolean;
    stashUnavailableReason: string | null;
    commitActionId: string;
    stashActionId: string;
    cancelActionId: string;
}
export interface PluginSourceControlRemoteSyncRecovery {
    reason: "remote-ahead" | "diverged";
    remote: string;
    branch: string;
    localBranch: string;
    pullStrategy: PluginGitPullStrategy;
}
export type PluginSourceControlRecoveryState = {
    state: "idle";
} | {
    state: "running";
    operationId: string;
    message: string;
} | {
    state: "failed";
    operationId: string;
    message: string;
    retryActionId?: string;
    dismissActionId?: string;
    remoteSync?: PluginSourceControlRemoteSyncRecovery;
};
interface PluginSourceControlViewModelBase {
    repository: PluginSourceControlRepositorySummary;
    workspaceRepositories?: PluginSourceControlWorkspaceRepository[];
    resourceGroups: PluginSourceControlResourceGroup[];
    branches: PluginSourceControlBranchChoice[];
    remotes: PluginSourceControlRemote[];
    history: PluginSourceControlHistoryEntry[];
    historyPage: PluginSourceControlHistoryPage;
    commitDetail: PluginSourceControlCommitDetail | null;
    diffFiles: PluginSourceControlDiffFile[];
    diffSource: PluginSourceControlDiffSource | null;
    conflicts: PluginSourceControlConflictEntry[];
    conflictDetail: PluginSourceControlConflictDetail | null;
    operationProgress: PluginSourceControlOperationProgress | null;
    operationPlan: PluginSourceControlOperationPlan | null;
    recovery: PluginSourceControlRecoveryState;
    remoteAccess: PluginSourceControlRemoteAccess;
    pendingBranchSwitch: PluginSourceControlPendingBranchSwitch | null;
}
export type PluginSourceControlViewModel = (PluginSourceControlViewModelBase & {
    selectedTab: "changes";
    selectedView: {
        kind: "repository";
    } | {
        kind: "diff";
        path: string;
    } | {
        kind: "conflict";
        path: string;
    };
}) | (PluginSourceControlViewModelBase & {
    selectedTab: "history";
    selectedView: {
        kind: "history";
    } | {
        kind: "commit";
        commitId: string;
    } | {
        kind: "diff";
        path: string;
        commitId: string;
    };
}) | (PluginSourceControlViewModelBase & {
    selectedTab: "branches";
    selectedView: {
        kind: "branches";
    } | {
        kind: "remotes";
    };
});
export interface PluginSourceControlAction {
    id: string;
    values?: Record<string, string | boolean | number>;
}
export interface PluginSourceControlProvider {
    id: string;
    title: string;
    initialModel: PluginSourceControlViewModel;
    runAction: (action: PluginSourceControlAction, context: PluginUserActionContext) => void | Promise<void>;
}
export interface PluginSourceControlRegistration extends PluginDisposable {
    update: (model: PluginSourceControlViewModel) => void;
}
export interface PluginSourceControlCapability {
    register: (provider: PluginSourceControlProvider) => PluginSourceControlRegistration;
}
export interface PluginAutomaticLocalCommitSchedule {
    id: string;
    intervalMinutes: number;
    message: string;
    includePatterns?: string[];
    excludePatterns?: string[];
    authorName?: string;
    authorEmail?: string;
    pushAfterCommit?: boolean;
}
export type PluginAutomaticLocalCommitUpdate = Omit<PluginAutomaticLocalCommitSchedule, "id">;
export interface PluginAutomaticLocalCommitRegistration extends PluginDisposable {
    update: (schedule: PluginAutomaticLocalCommitUpdate) => void;
}
export interface PluginAutomaticLocalCommitCapability {
    register: (schedule: PluginAutomaticLocalCommitSchedule) => PluginAutomaticLocalCommitRegistration;
}
export interface PluginTextDocument {
    content: string;
    version: string;
}
export type PluginGitScope = "vault" | "project";
export type PluginGitSequencer = "merge" | "rebase" | "cherry-pick" | "revert";
export type PluginGitConflictStage = "base" | "ours" | "theirs";
export type PluginGitStashAction = "push" | "pop" | "apply" | "drop" | "list";
export type PluginGitPullStrategy = "merge" | "rebase" | "fast-forward-only";
export type PluginGitPushMode = "normal" | "force-with-lease";
export type PluginGitAuthMode = "system" | "public" | "ssh-agent" | "github-https";
export interface PluginGitRepositoryTarget {
    projectId: string | null;
}
export type PluginGitDiffTarget = {
    kind: "worktree";
} | {
    kind: "index";
} | {
    kind: "commit";
    commit: string;
} | {
    kind: "range";
    fromCommit: string;
    toCommit: string;
};
export type PluginGitDiffFormat = "patch" | "numstat";
export type PluginGitConflictResolution = {
    kind: "stage";
    stage: PluginGitConflictStage;
} | {
    kind: "content";
    contentBase64: string;
};
export type PluginGitHunkLineKind = "context" | "addition" | "deletion";
export interface PluginGitHunkLine {
    kind: PluginGitHunkLineKind;
    content: string;
    noNewlineAtEndOfFile?: boolean;
}
export interface PluginGitHunk {
    oldStart: number;
    oldLines: number;
    newStart: number;
    newLines: number;
    lines: PluginGitHunkLine[];
}
export type PluginGitRunRequest = {
    operation: "discover";
    scope: PluginGitScope;
} | {
    operation: "status";
    scope: PluginGitScope;
} | {
    operation: "list-conflicts";
    scope: PluginGitScope;
} | {
    operation: "operation-state";
    scope: PluginGitScope;
} | {
    operation: "initialize";
    scope: PluginGitScope;
    defaultBranch: string;
} | {
    operation: "stage";
    scope: PluginGitScope;
    paths: string[];
} | {
    operation: "unstage";
    scope: PluginGitScope;
    paths: string[];
} | {
    operation: "restore-from-upstream";
    scope: PluginGitScope;
    paths: string[];
} | {
    operation: "stage-hunk";
    scope: PluginGitScope;
    path: string;
    hunk: PluginGitHunk;
} | {
    operation: "unstage-hunk";
    scope: PluginGitScope;
    path: string;
    hunk: PluginGitHunk;
} | {
    operation: "commit";
    scope: PluginGitScope;
    message: string;
    amend?: boolean;
    allowEmpty?: boolean;
    authorName?: string;
    authorEmail?: string;
} | {
    operation: "list-branches";
    scope: PluginGitScope;
} | {
    operation: "list-remotes";
    scope: PluginGitScope;
} | {
    operation: "list-history";
    scope: PluginGitScope;
    maxCount: number;
    skip?: number;
    ref?: string;
    path?: string;
} | {
    operation: "diff";
    scope: PluginGitScope;
    target: PluginGitDiffTarget;
    paths?: string[];
    format?: PluginGitDiffFormat;
} | {
    operation: "fetch";
    scope: PluginGitScope;
    remote: string;
    prune?: boolean;
    authMode?: PluginGitAuthMode;
} | {
    operation: "pull";
    scope: PluginGitScope;
    remote: string;
    branch: string;
    strategy: PluginGitPullStrategy;
    authMode?: PluginGitAuthMode;
} | {
    operation: "push";
    scope: PluginGitScope;
    remote: string;
    branch: string;
    setUpstream?: boolean;
    mode?: PluginGitPushMode;
    authMode?: PluginGitAuthMode;
} | {
    operation: "add-remote";
    scope: PluginGitScope;
    name: string;
    url: string;
} | {
    operation: "set-remote-url";
    scope: PluginGitScope;
    name: string;
    url: string;
} | {
    operation: "remove-remote";
    scope: PluginGitScope;
    name: string;
} | {
    operation: "create-branch";
    scope: PluginGitScope;
    name: string;
    startPoint?: string;
    checkout?: boolean;
} | {
    operation: "checkout-branch";
    scope: PluginGitScope;
    name: string;
} | {
    operation: "rename-branch";
    scope: PluginGitScope;
    name: string;
    newName: string;
} | {
    operation: "delete-branch";
    scope: PluginGitScope;
    name: string;
    force?: boolean;
} | {
    operation: "rename-remote-branch";
    scope: PluginGitScope;
    remote: string;
    name: string;
    newName: string;
    authMode?: PluginGitAuthMode;
} | {
    operation: "delete-remote-branch";
    scope: PluginGitScope;
    remote: string;
    name: string;
    authMode?: PluginGitAuthMode;
} | {
    operation: "stash";
    scope: PluginGitScope;
    action: PluginGitStashAction;
    message?: string;
    includeUntracked?: boolean;
    entry?: number;
} | {
    operation: "merge";
    scope: PluginGitScope;
    ref: string;
    fastForwardOnly?: boolean;
    noCommit?: boolean;
} | {
    operation: "rebase";
    scope: PluginGitScope;
    upstream: string;
} | {
    operation: "cherry-pick";
    scope: PluginGitScope;
    commit: string;
} | {
    operation: "revert";
    scope: PluginGitScope;
    commit: string;
} | {
    operation: "continue";
    scope: PluginGitScope;
    sequencer: PluginGitSequencer;
} | {
    operation: "skip";
    scope: PluginGitScope;
    sequencer: PluginGitSequencer;
} | {
    operation: "abort";
    scope: PluginGitScope;
    sequencer: PluginGitSequencer;
} | {
    operation: "read-conflict-stage";
    scope: PluginGitScope;
    path: string;
    stage: PluginGitConflictStage;
} | {
    operation: "resolve-conflict";
    scope: PluginGitScope;
    path: string;
    resolution: PluginGitConflictResolution;
} | {
    operation: "clone";
    scope: PluginGitScope;
    url: string;
    directory: string;
    branch?: string;
    authMode?: PluginGitAuthMode;
};
export type PluginGitCancelRequest = {
    operation: "cancel";
    operationId: string;
};
export type PluginGitRequest = PluginGitRunRequest | PluginGitCancelRequest;
export interface PluginGitResult {
    operationId: string;
    exitCode: number;
    stdout: string;
    stderr: string;
    cancelled: boolean;
}
export interface PluginGitOperation {
    operationId: string;
    result: Promise<PluginGitResult>;
}
export interface PluginGitHubRepository {
    nameWithOwner: string;
    httpsUrl: string;
    sshUrl: string;
    defaultBranch: string | null;
    private: boolean;
}
export interface PluginGitHubListRequest {
    limit: number;
}
export interface PluginGitCloneVaultRequest {
    url: string;
    authMode: PluginGitAuthMode;
    branch?: string;
}
export type PluginGitCloneVaultResult = {
    status: "cancelled";
} | {
    status: "cloned";
    label: string;
    remoteUrl: string;
    branch: string | null;
    defaultBranch: string | null;
    upstream: string | null;
} | {
    status: "failed";
    message: string;
    cleanupToken: string | null;
};
export interface PluginGitCloneCleanupResult {
    cleaned: boolean;
    message: string;
}
export interface PluginGitCloneVaultOperation {
    operationId: string;
    result: Promise<PluginGitCloneVaultResult>;
}
export interface PluginGitHubListOperation {
    operationId: string;
    result: Promise<PluginGitHubRepository[]>;
}
export interface PluginGitCapability {
    run: (request: PluginGitRunRequest, target?: PluginGitRepositoryTarget) => PluginGitOperation;
    cancel: (operationId: string) => Promise<PluginGitResult>;
    listGitHubRepositories: (request: PluginGitHubListRequest) => PluginGitHubListOperation;
    cloneVault: (request: PluginGitCloneVaultRequest) => PluginGitCloneVaultOperation;
    cleanFailedClone: (cleanupToken: string) => Promise<PluginGitCloneCleanupResult>;
}
export interface PluginWorkspaceReadCapability {
    readText: (path: string) => Promise<PluginTextDocument>;
}
export interface PluginWorkspaceWriteCapability extends PluginWorkspaceReadCapability {
    writeText: (path: string, content: string, version: string) => Promise<void>;
}
export interface PluginNetworkRequest {
    url: string;
    method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    headers?: Record<string, string>;
    body?: string;
}
export interface PluginNetworkResponse {
    status: number;
    headers: Record<string, string>;
    body: string;
}
export interface PluginNetworkCapability {
    request: (request: PluginNetworkRequest) => Promise<PluginNetworkResponse>;
}
export interface PluginClipboardReadCapability {
    readText: () => Promise<string>;
}
export interface PluginClipboardWriteCapability {
    writeText: (text: string) => Promise<void>;
}
export interface PluginNotificationCapability {
    show: (title: string, body?: string) => Promise<void>;
}
export interface PluginProcessRequest {
    executable: string;
    arguments: string[];
}
export interface PluginProcessResult {
    exitCode: number;
    stdout: string;
    stderr: string;
}
export interface PluginProcessCapability {
    run: (request: PluginProcessRequest) => Promise<PluginProcessResult>;
}
export interface PluginCapabilities {
    sensitiveTools?: PluginSensitiveToolsCapability;
    authoring?: PluginAuthoringCapability;
    commands?: PluginCommandCapability;
    sidebar?: PluginSidebarCapability;
    status?: PluginStatusCapability;
    editorDecoration?: PluginEditorDecorationCapability;
    emojiPicker?: PluginEmojiPickerCapability;
    structuredViewer?: PluginStructuredViewerCapability;
    kanbanBoard?: PluginKanbanBoardCapability;
    taskList?: PluginTaskListCapability;
    noteGraph?: PluginNoteGraphCapability;
    calendar?: PluginCalendarCapability;
    reminders?: PluginReminderCapability;
    timeTracking?: import("./timeTracking").PluginTimeTrackingCapability;
    clocks?: import("./clocks").PluginClockCapability;
    diagramRenderer?: PluginDiagramRendererCapability;
    noteEvents?: PluginNoteEventsCapability;
    projectContext?: PluginProjectContextCapability;
    codeIntelligence?: import("./codeIntelligence").PluginCodeIntelligenceCapability;
    tooling?: import("./tooling").PluginToolingCapability;
    terminal?: import("./tooling").PluginTerminalCapability;
    sourceControl?: PluginSourceControlCapability;
    automaticLocalCommit?: PluginAutomaticLocalCommitCapability;
    secureStorage?: PluginSecureStorage;
}
export interface PluginUserActionContext {
    capabilities: {
        workspaceRead?: PluginWorkspaceReadCapability;
        workspaceWrite?: PluginWorkspaceWriteCapability;
        network?: PluginNetworkCapability;
        clipboardRead?: PluginClipboardReadCapability;
        clipboardWrite?: PluginClipboardWriteCapability;
        notifications?: PluginNotificationCapability;
        process?: PluginProcessCapability;
        git?: PluginGitCapability;
    };
}
export interface PluginActivationContext {
    pluginId: string;
    logger: PluginLogger;
    storage: PluginStorage;
    settings: PluginSettings;
    capabilities: PluginCapabilities;
    subscriptions: PluginSubscriptions;
}
export interface DenotePlugin {
    manifest: PluginManifest;
    activate: (context: PluginActivationContext) => void | Promise<void>;
    deactivate?: () => void | Promise<void>;
}
export interface PluginValidationResult<T> {
    valid: boolean;
    value: T | null;
    errors: string[];
}
export interface PluginCompatibilityResult {
    compatible: boolean;
    reason: string | null;
}
export {};
