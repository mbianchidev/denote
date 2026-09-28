import { parse } from "acorn";
import type { Plugin } from "vite";

const MAX_JAVASCRIPT_BYTES = 500_000;

export function frontendBundle(): Plugin {
  return {
    name: "denote-frontend-bundle",
    apply: "build",
    transform(source, id) {
      const match = id.replaceAll("\\", "/").match(
        /\/node_modules\/@shikijs\/langs\/dist\/([^/]+)\.mjs$/,
      );
      if (!match || Buffer.byteLength(source) < MAX_JAVASCRIPT_BYTES) {
        return;
      }
      const program = parse(source, { ecmaVersion: "latest", sourceType: "module" });
      const declaration = program.body.find(
        (statement) => statement.type === "VariableDeclaration",
      );
      const frozen = declaration?.declarations[0]?.init;
      const json = frozen?.type === "CallExpression" ? frozen.arguments[0] : null;
      const literal = json?.type === "CallExpression" ? json.arguments[0] : null;
      if (
        frozen?.type !== "CallExpression" ||
        frozen.optional ||
        frozen.arguments.length !== 1 ||
        frozen.callee.type !== "MemberExpression" ||
        frozen.callee.computed ||
        frozen.callee.object.type !== "Identifier" ||
        frozen.callee.object.name !== "Object" ||
        frozen.callee.property.type !== "Identifier" ||
        frozen.callee.property.name !== "freeze" ||
        json?.type !== "CallExpression" ||
        json.optional ||
        json.arguments.length !== 1 ||
        json.callee.type !== "MemberExpression" ||
        json.callee.computed ||
        json.callee.object.type !== "Identifier" ||
        json.callee.object.name !== "JSON" ||
        json.callee.property.type !== "Identifier" ||
        json.callee.property.name !== "parse" ||
        literal?.type !== "Literal" ||
        typeof literal.value !== "string"
      ) {
        throw new Error(`Unsupported large syntax grammar format: ${id}`);
      }
      JSON.parse(literal.value);
      const reference = this.emitFile({
        type: "asset",
        name: `${match[1]}.json`,
        source: literal.value,
      });
      const replacement = `await (async () => {
        const response = await fetch(import.meta.ROLLUP_FILE_URL_${reference});
        if (!response.ok) {
          throw new Error(${JSON.stringify(`Unable to load bundled ${match[1]} syntax grammar`)} + ": " + response.status);
        }
        return response.json();
      })()`;
      return {
        code: source.slice(0, json.start) + replacement + source.slice(json.end),
        map: null,
      };
    },
    generateBundle(_options, bundle) {
      for (const output of Object.values(bundle)) {
        if (
          output.type === "chunk" &&
          Buffer.byteLength(output.code) > MAX_JAVASCRIPT_BYTES
        ) {
          this.error(
            `${output.fileName} exceeds the ${MAX_JAVASCRIPT_BYTES}-byte JavaScript budget. Split the module or its static data.`,
          );
        }
      }
    },
  };
}
