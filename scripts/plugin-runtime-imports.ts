import { parse } from "acorn";

export function containsPluginRuntimeImport(
  source: string,
  fileName = "plugin.js",
): boolean {
  let sourceFile: unknown;
  try {
    sourceFile = parse(source, {
      allowHashBang: true,
      ecmaVersion: "latest",
      sourceFile: fileName,
      sourceType: "module",
    });
  } catch {
    return true;
  }
  let found = false;
  const visit = (value: unknown) => {
    if (found || value === null || typeof value !== "object") {
      return;
    }
    if (Array.isArray(value)) {
      for (const entry of value) {
        visit(entry);
      }
      return;
    }
    const node = value as Record<string, unknown>;
    if (
      node.type === "ImportExpression" ||
      node.type === "ImportDeclaration" ||
      node.type === "ExportAllDeclaration" ||
      (node.type === "ExportNamedDeclaration" &&
        node.source !== null &&
        node.source !== undefined)
    ) {
      found = true;
      return;
    }
    if (node.type === "CallExpression" && importScriptsCall(node.callee)) {
      found = true;
      return;
    }
    for (const child of Object.values(node)) {
      if (child !== node) {
        visit(child);
        if (found) {
          return;
        }
      }
    }
  };
  visit(sourceFile);
  return found;
}

function importScriptsCall(expression: unknown): boolean {
  if (!expression || typeof expression !== "object") {
    return false;
  }
  const node = expression as Record<string, unknown>;
  if (node.type === "ChainExpression") {
    return importScriptsCall(node.expression);
  }
  if (node.type === "Identifier") {
    return node.name === "importScripts";
  }
  if (node.type !== "MemberExpression") {
    return false;
  }
  const property = node.property;
  if (!property || typeof property !== "object") {
    return false;
  }
  const propertyNode = property as Record<string, unknown>;
  if (node.computed === true) {
    return (
      propertyNode.type === "Literal" &&
      propertyNode.value === "importScripts"
    );
  }
  return (
    propertyNode.type === "Identifier" &&
    propertyNode.name === "importScripts"
  );
}
