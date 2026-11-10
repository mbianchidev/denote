import type { PluginCalendarDocument, PluginCalendarModel, PluginCalendarRequest, PluginCalendarView } from "./contracts";
export declare const MAX_PLUGIN_CALENDAR_DAYS = 42;
export declare const MAX_PLUGIN_CALENDAR_DOCUMENTS = 5000;
export declare const MAX_PLUGIN_CALENDAR_FRONTMATTER_BYTES: number;
export declare const MAX_PLUGIN_CALENDAR_INPUT_BYTES: number;
export declare const MAX_PLUGIN_CALENDAR_NOTES = 1000;
export declare const MAX_PLUGIN_CALENDAR_NOTES_PER_DAY = 100;
export declare function isCalendarDate(value: unknown): value is string;
export declare function calendarDates(startDate: string, endDate: string): string[];
export declare function isCalendarFolder(value: unknown): value is string;
export declare function isCalendarNotePath(value: unknown): value is string;
export declare function isPluginCalendarRegistration(value: unknown): value is {
    id: string;
    title: string;
    views?: PluginCalendarView[];
};
export declare function calendarDocumentBytes(document: PluginCalendarDocument): number;
export declare function isPluginCalendarRequest(value: unknown): value is PluginCalendarRequest;
export declare function isPluginCalendarModel(value: unknown, request?: PluginCalendarRequest): value is PluginCalendarModel;
