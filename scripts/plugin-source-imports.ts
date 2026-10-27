import { parse } from "acorn";
import { transformWithOxc } from "vite";

export async function runtimeSourceImports(source: string, filename: string): Promise<string[]> {
  const compiled = await transformWithOxc(source, filename);
  const tree = parse(compiled.code, { ecmaVersion: "latest", sourceType: "module" });
  const imports: string[] = [];
  const literal = (value: unknown) => {
    if (record(value) && typeof value.value === "string") imports.push(value.value);
  };
  const visit = (value: unknown) => {
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (!record(value)) return;
    if (["ImportDeclaration", "ExportNamedDeclaration", "ExportAllDeclaration", "ImportExpression"].includes(String(value.type))) {
      literal(value.source);
    } else if (value.type === "CallExpression" && record(value.callee) &&
        value.callee.type === "Identifier" && value.callee.name === "require" && Array.isArray(value.arguments)) {
      literal(value.arguments[0]);
    }
    Object.values(value).forEach(visit);
  };
  visit(tree);
  return imports;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
