import { isPluginCommentAnchor, type PluginCommentAnchor } from "@denote/plugin-sdk";

export interface NoteComment {
  id: string;
  body: string;
  anchor: PluginCommentAnchor | null;
  resolved: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface NoteCommentsDocument {
  schemaVersion: 1;
  owner: "denote.note-comments";
  notes: Record<string, NoteComment[]>;
}

export interface NoteCommentsSnapshot {
  contentHash: string;
  document: NoteCommentsDocument;
}

export function isNoteCommentsSnapshot(value: unknown): value is NoteCommentsSnapshot {
  if (!record(value) || typeof value.contentHash !== "string" || !/^[a-f0-9]{64}$/.test(value.contentHash) ||
      !record(value.document) || value.document.schemaVersion !== 1 ||
      value.document.owner !== "denote.note-comments" || !record(value.document.notes)) return false;
  const ids = new Set<string>();
  let count = 0;
  return Object.entries(value.document.notes).every(([path, comments]) =>
    /(?:^|\/)[^/]+\.m(?:d|arkdown)$/i.test(path) && !path.split("/").some((part) =>
      !part || part === "." || part === ".." || part.toLowerCase() === ".denote") &&
    !path.startsWith("/") && !path.includes("\\") && Array.isArray(comments) && comments.length > 0 &&
    comments.every((comment) => {
      if (!record(comment) || typeof comment.id !== "string" || ids.has(comment.id) ||
          typeof comment.body !== "string" || !comment.body.trim() ||
          new TextEncoder().encode(comment.body).length > 4096 || typeof comment.resolved !== "boolean" ||
          !Number.isSafeInteger(comment.createdAt) || !Number.isSafeInteger(comment.updatedAt) ||
          typeof comment.createdAt !== "number" || typeof comment.updatedAt !== "number" ||
          comment.createdAt <= 0 || comment.updatedAt < comment.createdAt ||
          comment.anchor !== null && !isPluginCommentAnchor(comment.anchor) || ++count > 500) return false;
      ids.add(comment.id);
      return true;
    }));
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
