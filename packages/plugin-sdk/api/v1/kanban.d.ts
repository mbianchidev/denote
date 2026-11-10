import type { PluginKanbanBoardModel, PluginKanbanEdit, PluginKanbanEditRequest, PluginKanbanEditResult, PluginKanbanSourceFormat } from "./contracts";
export declare const MAX_PLUGIN_KANBAN_FILE_SUFFIXES = 4;
export declare const MAX_PLUGIN_KANBAN_SOURCE_BYTES: number;
export declare const MAX_PLUGIN_KANBAN_MODEL_BYTES: number;
export declare const MAX_PLUGIN_KANBAN_COLUMNS = 128;
export declare const MAX_PLUGIN_KANBAN_CARDS = 5000;
export declare const MAX_PLUGIN_KANBAN_CARD_BODY_BYTES: number;
export declare const MAX_PLUGIN_KANBAN_TAGS_PER_CARD = 32;
export declare const MAX_PLUGIN_KANBAN_LINKS_PER_CARD = 32;
export declare function detectPluginKanbanSourceFormat(source: string): PluginKanbanSourceFormat | null;
export declare function isPluginKanbanRegistration(value: unknown): value is {
    id: string;
    title: string;
    fileSuffixes: string[];
    defaultFileName: string;
    sourceFormats?: PluginKanbanSourceFormat[];
};
export declare function isPluginKanbanBoardModel(value: unknown): value is PluginKanbanBoardModel;
export declare function isPluginKanbanEditRequest(value: unknown): value is PluginKanbanEditRequest;
export declare function isPluginKanbanEditResult(value: unknown): value is PluginKanbanEditResult;
export declare function isPluginKanbanEdit(value: unknown): value is PluginKanbanEdit;
export declare function isPluginKanbanBoardRequest(value: unknown): value is {
    path: string;
    source: string;
};
