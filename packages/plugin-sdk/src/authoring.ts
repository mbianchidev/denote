import type { PluginDisposable } from "./contracts";

export const AUTHORING_FEATURES = ["text-styling", "note-comments", "presentation"] as const;
export type PluginAuthoringFeature = (typeof AUTHORING_FEATURES)[number];
export const AUTHORING_COLORS = ["yellow", "red", "green", "blue", "purple"] as const;
export type PluginAuthoringColor = (typeof AUTHORING_COLORS)[number];
export const MAX_AUTHORING_SOURCE_BYTES = 4 * 1024 * 1024;
export const MAX_NOTE_COMMENTS = 500;
export const MAX_PRESENTATION_SLIDES = 256;

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
  separators: Array<{ from: number; to: number }>;
  options: PluginPresentationOptions;
  notices: string[];
}

export type PluginAuthoringRequest =
  | { feature: "text-styling"; action: "parse"; source: string }
  | {
      feature: "text-styling"; action: "format"; source: string;
      from: number; to: number; style: "highlight" | "color" | "clear";
      color: PluginAuthoringColor;
    }
  | { feature: "note-comments"; action: "anchor"; source: string; from: number; to: number }
  | {
      feature: "note-comments"; action: "locate"; source: string;
      anchors: Array<{ id: string; anchor: PluginCommentAnchor | null }>;
    }
  | { feature: "presentation"; action: "parse"; source: string }
  | { feature: "presentation"; action: "reorder"; source: string; order: number[] };

export type PluginAuthoringResult =
  | { feature: "text-styling"; action: "parse"; spans: PluginTextStyle[]; notices: string[] }
  | { feature: "text-styling"; action: "format"; edit: PluginSourceEdit }
  | { feature: "note-comments"; action: "anchor"; anchor: PluginCommentAnchor | null }
  | { feature: "note-comments"; action: "locate"; anchors: PluginLocatedComment[] }
  | { feature: "presentation"; action: "parse"; model: PluginPresentationModel }
  | { feature: "presentation"; action: "reorder"; model: PluginPresentationModel; edit: PluginSourceEdit };

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

const encoder = new TextEncoder();
const COLORS: readonly string[] = AUTHORING_COLORS;
const FEATURES: readonly string[] = AUTHORING_FEATURES;

export function isPluginAuthoringRegistration(value: unknown): value is PluginAuthoringRegistration {
  return record(value) && singleLine(value.id, 160) && singleLine(value.title, 160) &&
    typeof value.feature === "string" && FEATURES.includes(value.feature);
}

export function isPluginCommentAnchor(value: unknown): value is PluginCommentAnchor {
  return record(value) && position(value.from) && position(value.to) && value.to > value.from &&
    text(value.quote, 4096) && value.quote.length > 0 && value.to - value.from === value.quote.length &&
    text(value.prefix, 96) && text(value.suffix, 96) &&
    position(value.matchCount) && value.matchCount > 0;
}

export function isPluginAuthoringRequest(value: unknown): value is PluginAuthoringRequest {
  if (!record(value) || !text(value.source, MAX_AUTHORING_SOURCE_BYTES)) return false;
  const fields = value.feature === "text-styling" && value.action === "format" ? ["from", "to", "style", "color"] :
    value.feature === "note-comments" && value.action === "anchor" ? ["from", "to"] :
      value.feature === "note-comments" && value.action === "locate" ? ["anchors"] :
        value.feature === "presentation" && value.action === "reorder" ? ["order"] : [];
  const allowed = new Set(["feature", "action", "source", ...fields]);
  if (Object.keys(value).some((key) => !allowed.has(key))) return false;
  if (value.feature === "text-styling") {
    return value.action === "parse" || value.action === "format" &&
      range(value, value.source.length) && value.from !== value.to &&
      ["highlight", "color", "clear"].includes(String(value.style)) && COLORS.includes(String(value.color));
  }
  if (value.feature === "note-comments") {
    if (value.action === "anchor") return range(value, value.source.length) && text(value.source.slice(value.from, value.to), 4096);
    return value.action === "locate" && Array.isArray(value.anchors) &&
      value.anchors.length <= MAX_NOTE_COMMENTS && uniqueIds(value.anchors) &&
      value.anchors.every((item) => record(item) && singleLine(item.id, 80) &&
        (item.anchor === null || isPluginCommentAnchor(item.anchor)));
  }
  if (value.feature === "presentation") {
    const order = value.order;
    return value.action === "parse" || value.action === "reorder" && Array.isArray(value.order) &&
      Array.isArray(order) && order.length > 0 && order.length <= MAX_PRESENTATION_SLIDES &&
      order.every(position) && new Set(order).size === order.length &&
      order.every((index) => index < order.length);
  }
  return false;
}

export function isPluginAuthoringResult(value: unknown): value is PluginAuthoringResult {
  if (!record(value)) return false;
  if (value.feature === "text-styling") {
    if (value.action === "format") return sourceEdit(value.edit);
    return value.action === "parse" && Array.isArray(value.spans) && value.spans.length <= 2000 &&
      notices(value.notices) && value.spans.every((span) => record(span) &&
        position(span.from) && position(span.to) && span.to > span.from &&
        text(span.text, 4096) && span.text.length > 0 &&
        ["highlight", "color"].includes(String(span.style)) && COLORS.includes(String(span.color)));
  }
  if (value.feature === "note-comments") {
    if (value.action === "anchor") return value.anchor === null || isPluginCommentAnchor(value.anchor);
    return value.action === "locate" && Array.isArray(value.anchors) &&
      value.anchors.length <= MAX_NOTE_COMMENTS && uniqueIds(value.anchors) &&
      value.anchors.every((item) => record(item) && singleLine(item.id, 80) &&
        (item.status === "attached" && position(item.from) && position(item.to) && item.to >= item.from ||
          ["missing", "ambiguous"].includes(String(item.status)) && item.from === null && item.to === null));
  }
  return value.feature === "presentation" && presentationModel(value.model) &&
    (value.action === "parse" || value.action === "reorder" && sourceEdit(value.edit));
}

export function isPluginAuthoringResultFor(
  request: PluginAuthoringRequest, value: unknown,
): value is PluginAuthoringResult {
  if (!isPluginAuthoringRequest(request) || !isPluginAuthoringResult(value) ||
      value.feature !== request.feature || value.action !== request.action) return false;
  if (request.feature === "text-styling" && request.action === "format" &&
      value.feature === "text-styling" && value.action === "format") {
    const selected = request.source.slice(request.from, request.to);
    const delimiter = textStyleDelimiter(request.style === "color" ? "color" : "highlight", request.color);
    const cleared = /^(=(?:yellow|red|green|blue|purple)(?::text)?=)([\s\S]+)\1$/.exec(selected);
    const expected = request.style === "clear" ? cleared?.[2] : delimiter + selected + delimiter;
    return expected !== undefined && value.edit.from === request.from && value.edit.to === request.to &&
      value.edit.text === expected;
  }
  if (request.feature === "text-styling" && request.action === "parse" &&
      value.feature === "text-styling" && value.action === "parse") {
    let end = 0;
    return value.spans.every((span) => {
      const delimiter = textStyleDelimiter(span.style, span.color);
      const valid = span.from >= end && span.to <= request.source.length &&
        request.source.slice(span.from, span.to) === delimiter + span.text + delimiter;
      end = span.to;
      return valid;
    });
  }
  if (request.feature === "note-comments" && request.action === "anchor" &&
      value.feature === "note-comments" && value.action === "anchor") {
    return request.from === request.to ? value.anchor === null :
      value.anchor !== null && value.anchor.from === request.from && value.anchor.to === request.to &&
      anchorMatchesSource(request.source, value.anchor);
  }
  if (request.feature === "note-comments" && request.action === "locate" &&
      value.feature === "note-comments" && value.action === "locate") {
    return value.anchors.length === request.anchors.length && value.anchors.every((located, index) => {
      const original = request.anchors[index];
      if (located.id !== original.id) return false;
      if (located.status !== "attached") return original.anchor !== null;
      if (original.anchor === null) return located.from === 0 && located.to === 0;
      const matches = commentAnchorMatches(request.source, original.anchor);
      return matches.length === 1 && located.from === matches[0] &&
        located.to === matches[0] + original.anchor.quote.length;
    });
  }
  if (request.feature === "presentation" && value.feature === "presentation") {
    if (!presentationModelMatchesSource(request.source, value.model)) return false;
    if (request.action === "reorder" && value.action === "reorder") {
      return request.order.length === value.model.slides.length && value.edit.from === value.model.bodyStart &&
        value.edit.to === request.source.length && value.edit.text === reorderedPresentationBody(request.source, value.model, request.order);
    }
    return request.action === "parse" && value.action === "parse";
  }
  return false;
}

export function verifiedAuthoringEdit(request: PluginAuthoringRequest, result: unknown): string {
  if (!isPluginAuthoringResultFor(request, result) || !("edit" in result)) {
    throw new Error("The plugin returned an unsafe or stale source edit. Nothing was changed.");
  }
  return request.source.slice(0, result.edit.from) + result.edit.text + request.source.slice(result.edit.to);
}

export function textStyleDelimiter(style: "highlight" | "color", color: PluginAuthoringColor): string {
  return `=${color}${style === "color" ? ":text" : ""}=`;
}

/** Both trust boundaries use the same fail-closed, exact-quote identity rule. */
export function commentAnchorMatches(source: string, anchor: PluginCommentAnchor): number[] {
  const matches: number[] = [];
  let offset = source.indexOf(anchor.quote);
  while (offset >= 0) {
    matches.push(offset);
    if (matches.length > anchor.matchCount) return [];
    offset = source.indexOf(anchor.quote, offset + 1);
  }
  if (matches.length !== anchor.matchCount) return [];
  if (matches.length === 1) return matches;
  return matches.filter((from) =>
    source.slice(Math.max(0, from - anchor.prefix.length), from) === anchor.prefix &&
    source.slice(from + anchor.quote.length, from + anchor.quote.length + anchor.suffix.length) === anchor.suffix);
}

export function reorderedPresentationBody(source: string, model: PluginPresentationModel, order: number[]): string {
  const newline = source.includes("\r\n") ? "\r\n" : source.includes("\r") ? "\r" : "\n";
  return order.map((index, position) => {
    const slide = model.slides[index];
    const separator = model.separators[position];
    let body = source.slice(slide.from, slide.to);
    if (separator) {
      if (body && !/[\r\n]$/.test(body)) body += newline;
      const delimiter = source.slice(separator.from, separator.to);
      body += delimiter + (/[\r\n]$/.test(delimiter) ? "" : newline);
    }
    return body;
  }).join("");
}

function anchorMatchesSource(source: string, anchor: PluginCommentAnchor): boolean {
  if (source.slice(anchor.from, anchor.to) !== anchor.quote ||
      source.slice(Math.max(0, anchor.from - anchor.prefix.length), anchor.from) !== anchor.prefix ||
      source.slice(anchor.to, anchor.to + anchor.suffix.length) !== anchor.suffix) return false;
  let count = 0;
  for (let at = source.indexOf(anchor.quote); at >= 0; at = source.indexOf(anchor.quote, at + 1)) count++;
  return count === anchor.matchCount;
}

function presentationModelMatchesSource(source: string, model: PluginPresentationModel): boolean {
  let cursor = model.bodyStart;
  if (cursor > source.length || model.separators.length !== model.slides.length - 1) return false;
  return model.slides.every((slide, index) => {
    if (slide.from !== cursor || slide.to > source.length || slide.to < slide.from) return false;
    cursor = slide.to;
    const separator = model.separators[index];
    if (!separator) return cursor === source.length;
    if (separator.from !== cursor || separator.to > source.length ||
        !/^===(?:\r\n|\n|\r)?$/.test(source.slice(separator.from, separator.to)) ||
        separator.from > 0 && !/[\r\n]/.test(source[separator.from - 1])) return false;
    cursor = separator.to;
    return true;
  });
}

function presentationModel(value: unknown): value is PluginPresentationModel {
  if (!record(value) || !position(value.bodyStart) || !Array.isArray(value.slides) ||
      !value.slides.length || value.slides.length > MAX_PRESENTATION_SLIDES ||
      !value.slides.every((slide) => record(slide) && position(slide.from) && position(slide.to) &&
        position(slide.line) && slide.line > 0 && singleLine(slide.title, 200)) ||
      !Array.isArray(value.separators) || !value.separators.every((item) => record(item) &&
        position(item.from) && position(item.to)) || !notices(value.notices) || !record(value.options)) return false;
  const options = value.options;
  return text(options.title, 200) && text(options.author, 200) &&
    ["system", "light", "dark"].includes(String(options.theme)) &&
    ["16:9", "4:3", "16:10"].includes(String(options.aspectRatio)) &&
    ["left", "center", "right"].includes(String(options.alignment)) &&
    typeof options.slideNumbers === "boolean" && typeof options.autoplay === "boolean" &&
    typeof options.loop === "boolean" && ["none", "fade"].includes(String(options.transition)) &&
    typeof options.advanceSeconds === "number" && Number.isFinite(options.advanceSeconds) &&
    options.advanceSeconds >= 1 && options.advanceSeconds <= 3600;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function text(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length <= max && encoder.encode(value).length <= max &&
    !/[\u0000\u202a-\u202e\u2066-\u2069]/u.test(value);
}
function singleLine(value: unknown, max: number): value is string {
  return text(value, max) && value.trim().length > 0 && !/[\r\n\u0000-\u001f\u007f]/.test(value);
}
function position(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
function range(value: Record<string, unknown>, length: number): value is Record<string, unknown> & { from: number; to: number } {
  return position(value.from) && position(value.to) && value.to >= value.from && value.to <= length;
}
function sourceEdit(value: unknown): value is PluginSourceEdit {
  return record(value) && position(value.from) && position(value.to) && value.to >= value.from &&
    text(value.text, MAX_AUTHORING_SOURCE_BYTES);
}
function notices(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= 32 && value.every((item) => singleLine(item, 512));
}
function uniqueIds(value: unknown[]): boolean {
  return new Set(value.map((item) => record(item) ? item.id : undefined)).size === value.length;
}
