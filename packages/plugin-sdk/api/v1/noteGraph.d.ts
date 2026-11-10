import type { PluginNoteGraphIndexRequest, PluginNoteGraphModel, PluginNoteGraphQuery } from "./contracts";
export declare const MAX_PLUGIN_NOTE_GRAPH_DOCUMENTS = 5000;
export declare const MAX_PLUGIN_NOTE_GRAPH_SOURCE_BYTES: number;
export declare const MAX_PLUGIN_NOTE_GRAPH_INDEX_BYTES: number;
export declare const MAX_PLUGIN_NOTE_GRAPH_INDEX_DOCUMENTS = 256;
export declare const MAX_PLUGIN_NOTE_GRAPH_INDEX_REMOVALS = 512;
export declare const MAX_PLUGIN_NOTE_GRAPH_TOTAL_SOURCE_BYTES: number;
export declare const MAX_PLUGIN_NOTE_GRAPH_TAGS_PER_DOCUMENT = 32;
export declare const MAX_PLUGIN_NOTE_GRAPH_NODES = 500;
export declare const MAX_PLUGIN_NOTE_GRAPH_EDGES = 2000;
export declare function isPluginNoteGraphRegistration(value: unknown): value is {
    id: string;
    title: string;
};
export declare function isPluginNoteGraphIndexRequest(value: unknown): value is PluginNoteGraphIndexRequest;
export declare function isPluginNoteGraphQuery(value: unknown): value is PluginNoteGraphQuery;
export declare function isPluginNoteGraphModel(value: unknown): value is PluginNoteGraphModel;
