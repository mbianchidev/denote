import type { PluginDisposable } from "./contracts";
export declare const AUTHORING_FEATURES: readonly ["text-styling", "note-comments", "presentation"];
export type PluginAuthoringFeature = (typeof AUTHORING_FEATURES)[number];
export declare const AUTHORING_COLORS: readonly ["yellow", "red", "green", "blue", "purple"];
export type PluginAuthoringColor = (typeof AUTHORING_COLORS)[number];
export declare const MAX_AUTHORING_SOURCE_BYTES: number;
export declare const MAX_NOTE_COMMENTS = 500;
export declare const MAX_PRESENTATION_SLIDES = 256;
export interface PluginSourceEdit {
    from: number;
    to: number;
    text: string;
}
export interface PluginTextStyle {
    from: number;
    to: number;
    text: string;
    style: "highlight" | "color";
    color: PluginAuthoringColor;
}
export interface PluginCommentAnchor {
    from: number;
    to: number;
    quote: string;
    prefix: string;
    suffix: string;
    matchCount: number;
}
export interface PluginLocatedComment {
    id: string;
    status: "attached" | "missing" | "ambiguous";
    from: number | null;
    to: number | null;
}
export interface PluginPresentationOptions {
    title: string;
    author: string;
    theme: "system" | "dark" | "light";
    aspectRatio: "16:9" | "4:3" | "16:10";
    alignment: "left" | "center" | "right";
    slideNumbers: boolean;
    autoplay: boolean;
    advanceSeconds: number;
    loop: boolean;
    transition: "none" | "fade";
}
export interface PluginPresentationSlide {
    from: number;
    to: number;
    line: number;
    title: string;
}
export interface PluginPresentationModel {
    bodyStart: number;
    slides: PluginPresentationSlide[];
    separators: Array<{
        from: number;
        to: number;
    }>;
    options: PluginPresentationOptions;
    notices: string[];
}
export type PluginAuthoringRequest = {
    feature: "text-styling";
    action: "parse";
    source: string;
} | {
    feature: "text-styling";
    action: "format";
    source: string;
    from: number;
    to: number;
    style: "highlight" | "color" | "clear";
    color: PluginAuthoringColor;
} | {
    feature: "note-comments";
    action: "anchor";
    source: string;
    from: number;
    to: number;
} | {
    feature: "note-comments";
    action: "locate";
    source: string;
    anchors: Array<{
        id: string;
        anchor: PluginCommentAnchor | null;
    }>;
} | {
    feature: "presentation";
    action: "parse";
    source: string;
} | {
    feature: "presentation";
    action: "reorder";
    source: string;
    order: number[];
};
export type PluginAuthoringResult = {
    feature: "text-styling";
    action: "parse";
    spans: PluginTextStyle[];
    notices: string[];
} | {
    feature: "text-styling";
    action: "format";
    edit: PluginSourceEdit;
} | {
    feature: "note-comments";
    action: "anchor";
    anchor: PluginCommentAnchor | null;
} | {
    feature: "note-comments";
    action: "locate";
    anchors: PluginLocatedComment[];
} | {
    feature: "presentation";
    action: "parse";
    model: PluginPresentationModel;
} | {
    feature: "presentation";
    action: "reorder";
    model: PluginPresentationModel;
    edit: PluginSourceEdit;
};
export interface PluginAuthoringRegistration {
    id: string;
    title: string;
    feature: PluginAuthoringFeature;
}
export interface PluginAuthoringProvider extends PluginAuthoringRegistration {
    request: (request: PluginAuthoringRequest) => PluginAuthoringResult | Promise<PluginAuthoringResult>;
}
export interface PluginAuthoringCapability {
    register: (provider: PluginAuthoringProvider) => PluginDisposable;
}
export declare function isPluginAuthoringRegistration(value: unknown): value is PluginAuthoringRegistration;
export declare function isPluginCommentAnchor(value: unknown): value is PluginCommentAnchor;
export declare function isPluginAuthoringRequest(value: unknown): value is PluginAuthoringRequest;
export declare function isPluginAuthoringResult(value: unknown): value is PluginAuthoringResult;
export declare function isPluginAuthoringResultFor(request: PluginAuthoringRequest, value: unknown): value is PluginAuthoringResult;
export declare function verifiedAuthoringEdit(request: PluginAuthoringRequest, result: unknown): string;
export declare function textStyleDelimiter(style: "highlight" | "color", color: PluginAuthoringColor): string;
export declare function commentAnchorMatches(source: string, anchor: PluginCommentAnchor): number[];
export declare function reorderedPresentationBody(source: string, model: PluginPresentationModel, order: number[]): string;
