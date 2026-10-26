import {
  isPluginAuthoringRequest,
  MAX_PRESENTATION_SLIDES,
  reorderedPresentationBody,
  type PluginAuthoringRequest,
  type PluginAuthoringResult,
  type PluginPresentationModel,
  type PluginPresentationOptions,
} from "@denote/plugin-sdk";
import { isAlias, isMap, isNode, isSeq, parseDocument } from "yaml";

const DEFAULTS: PluginPresentationOptions = {
  title: "", author: "", theme: "system", aspectRatio: "16:9", alignment: "left",
  slideNumbers: true, autoplay: false, advanceSeconds: 10, loop: false, transition: "none",
};

export function presentationRequest(request: PluginAuthoringRequest): PluginAuthoringResult {
  if (!isPluginAuthoringRequest(request) || request.feature !== "presentation") {
    throw new Error("Presentations require a valid Markdown deck of at most 4 MiB.");
  }
  const model = parseDeck(request.source);
  if (request.action === "parse") return { feature: "presentation", action: "parse", model };
  if (request.order.length !== model.slides.length) throw new Error("The slide order changed. Refresh the overview and try again.");
  return {
    feature: "presentation", action: "reorder", model,
    edit: { from: model.bodyStart, to: request.source.length, text: reorderedPresentationBody(request.source, model, request.order) },
  };
}

function parseDeck(source: string): PluginPresentationModel {
  const { bodyStart, options, notices } = metadata(source);
  const slides: PluginPresentationModel["slides"] = [];
  const separators: PluginPresentationModel["separators"] = [];
  let start = bodyStart;
  let offset = bodyStart;
  let line = source.slice(0, bodyStart).split(/\r\n|\n|\r/).length;
  let slideLine = line;
  let fence: { character: string; length: number } | null = null;
  const addSlide = (end: number) => {
    if (slides.length >= MAX_PRESENTATION_SLIDES) throw new Error("Presentation limit is 256 slides. Split this deck into smaller Markdown files.");
    const body = source.slice(start, end);
    const title = boundedText(/^#{1,6}[ \t]+([^\r\n]+)/m.exec(body)?.[1]?.trim() ?? "", 200) || `Slide ${slides.length + 1}`;
    slides.push({ from: start, to: end, line: slideLine, title });
    if (!body.trim() && notices.length < 32) notices.push(`Slide ${slides.length} is empty. Add content or remove its separator.`);
  };
  for (const match of source.slice(bodyStart).matchAll(/[^\r\n]*(?:\r\n|\n|\r|$)/g)) {
    if (!match[0]) continue;
    const raw = match[0].replace(/(?:\r\n|\n|\r)$/, "");
    const opening = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(raw);
    if (fence) {
      const closing = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(raw);
      if (closing && closing[1][0] === fence.character && closing[1].length >= fence.length) fence = null;
    } else if (opening && (opening[1][0] !== "`" || !opening[2].includes("`"))) {
      fence = { character: opening[1][0], length: opening[1].length };
    } else if (raw === "===") {
      addSlide(offset);
      separators.push({ from: offset, to: offset + match[0].length });
      start = offset + match[0].length;
      slideLine = line + 1;
    }
    offset += match[0].length;
    line++;
  }
  addSlide(source.length);
  if (fence && notices.length < 32) notices.push("A code fence is not closed. Add its matching closing fence in Source.");
  return { bodyStart, slides, separators, options, notices };
}

function metadata(source: string): Pick<PluginPresentationModel, "bodyStart" | "options" | "notices"> {
  const options = { ...DEFAULTS };
  const notices: string[] = [];
  if (!/^---(?:\r\n|\n|\r)/.test(source)) return { bodyStart: 0, options, notices };
  const match = /^---(?:\r\n|\n|\r)([\s\S]*?)^---(?:\r\n|\n|\r|$)/m.exec(source);
  if (!match) return { bodyStart: 0, options, notices: ["Frontmatter is not closed. Add a closing --- line; presentation defaults are in use."] };
  const bodyStart = match[0].length;
  try {
    if (new TextEncoder().encode(match[1]).length > 64 * 1024) throw new Error("Frontmatter exceeds 64 KiB.");
    const document = parseDocument(match[1], {
      version: "1.2", schema: "core", customTags: [], merge: false, resolveKnownTags: false,
      strict: true, stringKeys: true, uniqueKeys: true, logLevel: "silent",
    });
    if (document.errors.length || document.warnings.length) throw new Error(document.errors[0]?.message ?? document.warnings[0].message);
    let nodes = 0;
    const check = (node: unknown, depth: number) => {
      if (!node) return;
      if (!isNode(node)) throw new Error("Unsupported frontmatter node.");
      if (++nodes > 5000 || depth > 64) throw new Error("Frontmatter exceeds the 5,000-node or 64-level limit.");
      if (isAlias(node)) throw new Error("Aliases are not supported in presentation frontmatter.");
      if (isMap(node)) for (const pair of node.items) {
        check(pair.key, depth + 1);
        check(pair.value, depth + 1);
      }
      if (isSeq(node)) for (const child of node.items) check(child, depth + 1);
    };
    check(document.contents, 0);
    const value: unknown = document.toJS({ maxAliasCount: 0 });
    if (value !== null && !record(value)) throw new Error("Frontmatter must be a YAML mapping.");
    if (!record(value)) return { bodyStart, options, notices };
    for (const key of ["title", "author"] as const) {
      if (value[key] === undefined) continue;
      if (typeof value[key] === "string" && new TextEncoder().encode(value[key]).length <= 200 && !/[\r\n\u0000-\u001f]/.test(value[key])) options[key] = value[key];
      else notices.push(`Frontmatter ${key} must be one line of at most 200 characters. Its default is in use.`);
    }
    const config = value.presentation;
    if (config === undefined) return { bodyStart, options, notices };
    if (!record(config)) throw new Error("presentation must be a YAML mapping.");
    const choice = <K extends "theme" | "aspectRatio" | "alignment" | "transition">(
      field: string, key: K, choices: readonly PluginPresentationOptions[K][],
    ) => {
      if (config[field] === undefined) return;
      const selected = choices.find((value) => value === config[field]);
      if (selected !== undefined) options[key] = selected;
      else notices.push(`presentation.${field} must be ${choices.join(", ")}. Using ${DEFAULTS[key]}.`);
    };
    choice("theme", "theme", ["system", "dark", "light"]);
    choice("aspect-ratio", "aspectRatio", ["16:9", "4:3", "16:10"]);
    choice("alignment", "alignment", ["left", "center", "right"]);
    choice("transition", "transition", ["none", "fade"]);
    for (const [field, key] of [["slide-numbers", "slideNumbers"], ["autoplay", "autoplay"], ["loop", "loop"]] as const) {
      if (config[field] === undefined) continue;
      if (typeof config[field] === "boolean") options[key] = config[field];
      else notices.push(`presentation.${field} must be true or false. Using ${DEFAULTS[key]}.`);
    }
    if (config["advance-seconds"] !== undefined) {
      const seconds = config["advance-seconds"];
      if (typeof seconds === "number" && Number.isFinite(seconds) && seconds >= 1 && seconds <= 3600) options.advanceSeconds = seconds;
      else notices.push("presentation.advance-seconds must be a number from 1 to 3600. Using 10 seconds.");
    }
  } catch (error) {
    notices.push(`Invalid frontmatter: ${error instanceof Error ? error.message : String(error)} Edit Source to correct it; safe defaults are in use.`);
    return { bodyStart, options: { ...DEFAULTS }, notices: notices.map((notice) => boundedText(notice.replace(/\s+/g, " "), 512)) };
  }
  return { bodyStart, options, notices };
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedText(value: string, maximum: number): string {
  let result = "";
  let bytes = 0;
  for (const character of value) {
    bytes += new TextEncoder().encode(character).length;
    if (bytes > maximum) break;
    result += character;
  }
  return result;
}
