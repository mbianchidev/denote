import type { PluginStructuredViewModel } from "./contracts";
export declare const MAX_PLUGIN_STRUCTURED_VIEWER_EXTENSIONS = 16;
export declare const MAX_PLUGIN_STRUCTURED_VIEWER_NODES = 50000;
export declare const MAX_PLUGIN_STRUCTURED_VIEWER_MODEL_BYTES: number;
export declare const MAX_PLUGIN_STRUCTURED_VIEWER_SOURCE_BYTES: number;
export declare function isPluginStructuredViewerRegistration(value: unknown): value is {
    id: string;
    title: string;
    extensions: string[];
};
export declare function isPluginStructuredViewModel(value: unknown): value is PluginStructuredViewModel;
