import { compare, valid } from "semver";
import {
  PLUGIN_CAPABILITIES,
  PLUGIN_CATEGORIES,
  PLUGIN_GUIDE_SECTIONS,
  PLUGIN_MANIFEST_SCHEMA_VERSION,
  type PluginCapability,
  type PluginBundle,
  type PluginCatalogEntry,
  type PluginCategory,
  type PluginCompatibilityResult,
  type PluginManifest,
  type PluginValidationResult,
} from "./contracts";

export function validatePluginBundles(
  value: unknown,
  catalogPluginIds?: ReadonlySet<string>,
): PluginValidationResult<PluginBundle[]> {
  if (!Array.isArray(value)) {
    return invalid("Plugin bundles must be an array.");
  }

  const errors: string[] = [];
  const bundleIds = new Set<string>();
  const bundleNames = new Set<string>();
  for (const [bundleIndex, bundle] of value.entries()) {
    const field = `bundles[${bundleIndex}]`;
    if (!isRecord(bundle)) {
      errors.push(`${field} must be an object.`);
      continue;
    }
    validateStableId(bundle.id, `${field}.id`, errors);
    requireString(bundle.name, `${field}.name`, errors);
    trackUniqueString(bundle.id, `${field}.id`, bundleIds, errors);
    trackUniqueName(bundle.name, `${field}.name`, bundleNames, errors);

    if (!Array.isArray(bundle.categories)) {
      errors.push(`${field}.categories must be an array.`);
    } else {
      const categories = new Set<string>();
      for (const [categoryIndex, category] of bundle.categories.entries()) {
        if (
          typeof category !== "string" ||
          !PLUGIN_CATEGORIES.includes(category as PluginCategory)
        ) {
          errors.push(
            `${field}.categories[${categoryIndex}] must be one of: ${PLUGIN_CATEGORIES.join(", ")}.`,
          );
        } else if (categories.has(category)) {
          errors.push(`${field}.categories contains duplicate ${category}.`);
        } else {
          categories.add(category);
        }
      }
    }

    if (!Array.isArray(bundle.roles) || bundle.roles.length === 0) {
      errors.push(`${field}.roles must be a non-empty array.`);
      continue;
    }
    const roleIds = new Set<string>();
    const roleNames = new Set<string>();
    for (const [roleIndex, role] of bundle.roles.entries()) {
      const roleField = `${field}.roles[${roleIndex}]`;
      if (!isRecord(role)) {
        errors.push(`${roleField} must be an object.`);
        continue;
      }
      validateStableId(role.id, `${roleField}.id`, errors);
      requireString(role.name, `${roleField}.name`, errors);
      trackUniqueString(role.id, `${roleField}.id`, roleIds, errors);
      trackUniqueName(role.name, `${roleField}.name`, roleNames, errors);
      if (!Array.isArray(role.candidatePluginIds)) {
        errors.push(`${roleField}.candidatePluginIds must be an array.`);
        continue;
      }
      const candidates = new Set<string>();
      for (const [candidateIndex, candidate] of role.candidatePluginIds.entries()) {
        const candidateField = `${roleField}.candidatePluginIds[${candidateIndex}]`;
        if (typeof candidate !== "string") {
          errors.push(`${candidateField} must be a string.`);
          continue;
        }
        if (candidates.has(candidate)) {
          errors.push(`${roleField}.candidatePluginIds contains duplicate ${candidate}.`);
        } else {
          candidates.add(candidate);
        }
        if (catalogPluginIds && !catalogPluginIds.has(candidate)) {
          errors.push(`${candidateField} references unknown catalog plugin ${candidate}.`);
        }
      }
    }
  }

  return errors.length === 0
    ? { valid: true, value: value as PluginBundle[], errors }
    : { valid: false, value: null, errors };
}

export function assertValidPluginBundles(
  value: unknown,
  catalogPluginIds?: ReadonlySet<string>,
): asserts value is PluginBundle[] {
  const result = validatePluginBundles(value, catalogPluginIds);
  if (!result.valid) {
    throw new Error(`Invalid plugin bundles:\n- ${result.errors.join("\n- ")}`);
  }
}

export function validatePluginManifest(
  value: unknown,
): PluginValidationResult<PluginManifest> {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return invalid("Manifest must be an object.");
  }

  requireEqual(
    value.schemaVersion,
    PLUGIN_MANIFEST_SCHEMA_VERSION,
    "schemaVersion",
    errors,
  );
  requireString(value.id, "id", errors);
  if (
    typeof value.id === "string" &&
    !/^(?=.*\.)[a-z0-9]+(?:[.-][a-z0-9]+)+$/.test(value.id)
  ) {
    errors.push(
      "id must be a namespaced lowercase identifier such as denote.example.",
    );
  }
  requireString(value.name, "name", errors);
  requireSemver(value.version, "version", errors);
  requireString(value.description, "description", errors);
  validatePublisher(value.publisher, errors);
  requireString(value.license, "license", errors);
  requireHttpsUrl(value.repository, "repository", errors);
  if (value.homepage !== undefined) {
    requireHttpsUrl(value.homepage, "homepage", errors);
  }
  requireSafeRelativePath(value.icon, "icon", errors);
  if (
    typeof value.category !== "string" ||
    !PLUGIN_CATEGORIES.includes(value.category as PluginCategory)
  ) {
    errors.push(`category must be one of: ${PLUGIN_CATEGORIES.join(", ")}.`);
  }
  validateCompatibility(value.compatibility, errors);
  validatePermissions(value.permissions, errors);
  requireSafeRelativePath(value.entrypoint, "entrypoint", errors);
  if (
    typeof value.entrypoint === "string" &&
    !value.entrypoint.startsWith("dist/")
  ) {
    errors.push("entrypoint must point inside the package dist/ directory.");
  }
  requireSafeRelativePath(value.documentation, "documentation", errors);
  if (value.settings !== undefined) {
    validateSettings(value.settings, errors);
  }

  return errors.length === 0
    ? { valid: true, value: value as unknown as PluginManifest, errors }
    : { valid: false, value: null, errors };
}

export function assertValidPluginManifest(
  value: unknown,
): asserts value is PluginManifest {
  const result = validatePluginManifest(value);
  if (!result.valid) {
    throw new Error(`Invalid plugin manifest:\n- ${result.errors.join("\n- ")}`);
  }
}

export function parsePluginManifest(value: unknown): PluginManifest {
  assertValidPluginManifest(value);
  return value;
}

export function validatePluginCatalogEntry(
  value: unknown,
): PluginValidationResult<PluginCatalogEntry> {
  if (!isRecord(value)) {
    return invalid("Catalog entry must be an object.");
  }
  const errors = validatePluginManifest(value.manifest).errors;
  if (!isRecord(value.artifact)) {
    errors.push("artifact must be an object.");
  } else {
    requireHttpsUrl(value.artifact.url, "artifact.url", errors);
    if (
      typeof value.artifact.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/i.test(value.artifact.sha256)
    ) {
      errors.push("artifact.sha256 must be a 64-character SHA-256 hex digest.");
    }
    if (!isRecord(value.provenance)) {
      errors.push("provenance must be an object.");
    } else {
      requireString(
        value.provenance.publisherId,
        "provenance.publisherId",
        errors,
      );
      if (
        typeof value.provenance.sourceCommit !== "string" ||
        !/^[a-f0-9]{40}$/i.test(value.provenance.sourceCommit)
      ) {
        errors.push(
          "provenance.sourceCommit must be a full 40-character Git commit SHA.",
        );
      }
      if (value.provenance.trusted !== true) {
        errors.push("provenance.trusted must be true for catalog plugins.");
      }
    }
    if (value.revoked !== undefined) {
      if (!isRecord(value.revoked)) {
        errors.push("revoked must be an object.");
      } else {
        requireString(value.revoked.reason, "revoked.reason", errors);
        requireString(value.revoked.revokedAt, "revoked.revokedAt", errors);
      }
    }
    if (
      typeof value.artifact.sizeBytes !== "number" ||
      !Number.isSafeInteger(value.artifact.sizeBytes) ||
      value.artifact.sizeBytes <= 0
    ) {
      errors.push("artifact.sizeBytes must be a positive integer.");
    }
  }
  requireString(value.guide, "guide", errors);
  if (typeof value.guide === "string") {
    const guide = value.guide.toLowerCase();
    for (const section of PLUGIN_GUIDE_SECTIONS) {
      if (!guide.includes(`## ${section}`)) {
        errors.push(`guide is missing the "${section}" section.`);
      }
    }
  }

  return errors.length === 0
    ? { valid: true, value: value as unknown as PluginCatalogEntry, errors }
    : { valid: false, value: null, errors };
}

export function assertValidPluginCatalogEntry(
  value: unknown,
): asserts value is PluginCatalogEntry {
  const result = validatePluginCatalogEntry(value);
  if (!result.valid) {
    throw new Error(
      `Invalid plugin catalog entry:\n- ${result.errors.join("\n- ")}`,
    );
  }
}

export function checkPluginCompatibility(
  manifest: PluginManifest,
  denoteVersion: string,
  apiVersion: number,
): PluginCompatibilityResult {
  const hostVersion = strictSemver(denoteVersion);
  if (!hostVersion) {
    return {
      compatible: false,
      reason: `Denote host version ${denoteVersion} is not valid semantic versioning.`,
    };
  }
  if (manifest.compatibility.apiVersion !== apiVersion) {
    return {
      compatible: false,
      reason: `Plugin API version ${manifest.compatibility.apiVersion} is incompatible with host API version ${apiVersion}.`,
    };
  }

  const minimum = strictSemver(
    manifest.compatibility.minimumDenoteVersion,
  );
  const maximum = manifest.compatibility.maximumDenoteVersion
    ? strictSemver(manifest.compatibility.maximumDenoteVersion)
    : null;
  if (!minimum || compare(hostVersion, minimum) < 0) {
    return {
      compatible: false,
      reason: `Plugin requires Denote ${manifest.compatibility.minimumDenoteVersion} or newer.`,
    };
  }
  if (maximum && compare(hostVersion, maximum) >= 0) {
    return {
      compatible: false,
      reason: `Plugin requires a Denote version below ${manifest.compatibility.maximumDenoteVersion}.`,
    };
  }
  return { compatible: true, reason: null };
}

function validatePublisher(value: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push("publisher must be an object.");
    return;
  }
  requireString(value.name, "publisher.name", errors);
  if (value.url !== undefined) {
    requireHttpsUrl(value.url, "publisher.url", errors);
  }
}

function validateCompatibility(value: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push("compatibility must be an object.");
    return;
  }
  if (
    typeof value.apiVersion !== "number" ||
    !Number.isSafeInteger(value.apiVersion) ||
    value.apiVersion <= 0
  ) {
    errors.push("compatibility.apiVersion must be a positive integer.");
  }
  requireSemver(
    value.minimumDenoteVersion,
    "compatibility.minimumDenoteVersion",
    errors,
  );
  if (value.maximumDenoteVersion !== undefined) {
    requireSemver(
      value.maximumDenoteVersion,
      "compatibility.maximumDenoteVersion",
      errors,
    );
  }
  const minimum =
    typeof value.minimumDenoteVersion === "string"
      ? strictSemver(value.minimumDenoteVersion)
      : null;
  const maximum =
    typeof value.maximumDenoteVersion === "string"
      ? strictSemver(value.maximumDenoteVersion)
      : null;
  if (minimum && maximum && compare(minimum, maximum) >= 0) {
    errors.push(
      "compatibility.maximumDenoteVersion must be greater than minimumDenoteVersion.",
    );
  }
}

function validatePermissions(value: unknown, errors: string[]): void {
  if (!Array.isArray(value)) {
    errors.push("permissions must be an array.");
    return;
  }
  const seen = new Set<string>();
  value.forEach((permission, index) => {
    if (!isRecord(permission)) {
      errors.push(`permissions[${index}] must be an object.`);
      return;
    }
    if (
      typeof permission.capability !== "string" ||
      !PLUGIN_CAPABILITIES.includes(
        permission.capability as PluginCapability,
      )
    ) {
      errors.push(
        `permissions[${index}].capability must be one of: ${PLUGIN_CAPABILITIES.join(", ")}.`,
      );
      return;
    }
    if (seen.has(permission.capability)) {
      errors.push(`permissions contains duplicate ${permission.capability}.`);
    }
    seen.add(permission.capability);

    if (permission.capability === "network") {
      if (!Array.isArray(permission.hosts) || permission.hosts.length === 0) {
        errors.push(`permissions[${index}].hosts must be a non-empty array.`);
      } else {
        permission.hosts.forEach((host, hostIndex) => {
          if (
            typeof host !== "string" ||
            !validHostPattern(host)
          ) {
            errors.push(
              `permissions[${index}].hosts[${hostIndex}] is not a valid host pattern.`,
            );
          }
        });
      }
    } else if ("hosts" in permission) {
      errors.push(
        `permissions[${index}].hosts is only valid for network permission.`,
      );
    }
    if (permission.capability === "process") {
      const executableMap = permission.executables;
      if (
        !isRecord(executableMap) ||
        !["macos", "linux", "windows"].some(
          (platform) =>
            Array.isArray(executableMap[platform]) &&
            executableMap[platform].length > 0,
        )
      ) {
        errors.push(
          `permissions[${index}].executables must define at least one platform.`,
        );
      } else {
        for (const platform of Object.keys(executableMap)) {
          if (!["macos", "linux", "windows"].includes(platform)) {
            errors.push(
              `permissions[${index}].executables contains unknown platform ${platform}.`,
            );
          }
        }
        for (const platform of ["macos", "linux", "windows"] as const) {
          const executables = executableMap[platform];
          if (executables === undefined) {
            continue;
          }
          if (!Array.isArray(executables)) {
            errors.push(
              `permissions[${index}].executables.${platform} must be an array.`,
            );
            continue;
          }
          executables.forEach((executable, executableIndex) => {
            const absolute =
              typeof executable === "string" &&
              (platform === "windows"
                ? /^[A-Za-z]:[\\/]/.test(executable) ||
                  executable.startsWith("\\\\")
                : executable.startsWith("/"));
            if (
              typeof executable !== "string" ||
              !absolute ||
              executable.includes("\0")
            ) {
              errors.push(
                `permissions[${index}].executables.${platform}[${executableIndex}] must be an absolute executable path.`,
              );
            }
          });
        }
      }
    } else if ("executables" in permission) {
      errors.push(
        `permissions[${index}].executables is only valid for process permission.`,
      );
    }
  });
}

function validateSettings(value: unknown, errors: string[]): void {
  if (!isRecord(value) || !isRecord(value.properties)) {
    errors.push("settings.properties must be an object.");
    return;
  }
  if (
    typeof value.version !== "number" ||
    !Number.isSafeInteger(value.version) ||
    value.version <= 0
  ) {
    errors.push("settings.version must be a positive integer.");
  }
  for (const [key, definition] of Object.entries(value.properties)) {
    if (!/^[a-z][a-zA-Z0-9]*$/.test(key)) {
      errors.push(`settings property ${key} must use lower camel case.`);
    }
    if (!isRecord(definition)) {
      errors.push(`settings.properties.${key} must be an object.`);
      continue;
    }
    requireString(definition.title, `settings.properties.${key}.title`, errors);
    if (definition.description !== undefined) {
      requireString(
        definition.description,
        `settings.properties.${key}.description`,
        errors,
      );
    }
    switch (definition.type) {
      case "boolean":
        if (typeof definition.default !== "boolean") {
          errors.push(`settings.properties.${key}.default must be boolean.`);
        }
        break;
      case "string":
        if (typeof definition.default !== "string") {
          errors.push(`settings.properties.${key}.default must be a string.`);
        }
        break;
      case "number":
        if (
          typeof definition.default !== "number" ||
          !Number.isFinite(definition.default)
        ) {
          errors.push(`settings.properties.${key}.default must be a number.`);
        }
        if (
          definition.minimum !== undefined &&
          (typeof definition.minimum !== "number" ||
            !Number.isFinite(definition.minimum))
        ) {
          errors.push(`settings.properties.${key}.minimum must be a number.`);
        }
        if (
          definition.maximum !== undefined &&
          (typeof definition.maximum !== "number" ||
            !Number.isFinite(definition.maximum))
        ) {
          errors.push(`settings.properties.${key}.maximum must be a number.`);
        }
        if (
          typeof definition.minimum === "number" &&
          typeof definition.maximum === "number" &&
          definition.minimum > definition.maximum
        ) {
          errors.push(
            `settings.properties.${key}.minimum cannot exceed maximum.`,
          );
        }
        if (
          typeof definition.default === "number" &&
          ((typeof definition.minimum === "number" &&
            definition.default < definition.minimum) ||
            (typeof definition.maximum === "number" &&
              definition.default > definition.maximum))
        ) {
          errors.push(
            `settings.properties.${key}.default must be inside the allowed range.`,
          );
        }
        break;
      case "select":
        if (typeof definition.default !== "string") {
          errors.push(`settings.properties.${key}.default must be a string.`);
        }
        if (!Array.isArray(definition.options) || definition.options.length === 0) {
          errors.push(
            `settings.properties.${key}.options must be a non-empty array.`,
          );
        } else {
          const values = new Set<string>();
          for (const [optionIndex, option] of definition.options.entries()) {
            if (
              !isRecord(option) ||
              typeof option.value !== "string" ||
              typeof option.label !== "string"
            ) {
              errors.push(
                `settings.properties.${key}.options[${optionIndex}] must contain string value and label.`,
              );
              continue;
            }
            values.add(option.value);
          }
          if (
            typeof definition.default === "string" &&
            !values.has(definition.default)
          ) {
            errors.push(
              `settings.properties.${key}.default must match an option value.`,
            );
          }
        }
        break;
      default:
        errors.push(
          `settings.properties.${key}.type must be boolean, string, number, or select.`,
        );
    }
  }
  if (value.migrations !== undefined) {
    if (!Array.isArray(value.migrations)) {
      errors.push("settings.migrations must be an array.");
      return;
    }
    const seen = new Set<number>();
    for (const [index, migration] of value.migrations.entries()) {
      if (!isRecord(migration)) {
        errors.push(`settings.migrations[${index}] must be an object.`);
        continue;
      }
      if (
        typeof migration.from !== "number" ||
        !Number.isSafeInteger(migration.from) ||
        typeof migration.to !== "number" ||
        !Number.isSafeInteger(migration.to) ||
        migration.to !== migration.from + 1
      ) {
        errors.push(
          `settings.migrations[${index}] must advance exactly one integer version.`,
        );
      } else if (seen.has(migration.from)) {
        errors.push(
          `settings.migrations contains duplicate version ${migration.from}.`,
        );
      } else {
        seen.add(migration.from);
      }
      if (migration.rename !== undefined && !isStringRecord(migration.rename)) {
        errors.push(`settings.migrations[${index}].rename must map strings.`);
      }
      if (
        migration.remove !== undefined &&
        (!Array.isArray(migration.remove) ||
          migration.remove.some((key) => typeof key !== "string"))
      ) {
        errors.push(
          `settings.migrations[${index}].remove must contain strings.`,
        );
      }
      if (migration.defaults !== undefined && !isRecord(migration.defaults)) {
        errors.push(
          `settings.migrations[${index}].defaults must be an object.`,
        );
      }
    }
    if (
      typeof value.version === "number" &&
      Number.isSafeInteger(value.version)
    ) {
      for (let version = 1; version < value.version; version += 1) {
        if (!seen.has(version)) {
          errors.push(
            `settings.migrations is missing version ${version} to ${version + 1}.`,
          );
        }
      }
    }
  }
}

function requireEqual(
  value: unknown,
  expected: unknown,
  field: string,
  errors: string[],
): void {
  if (value !== expected) {
    errors.push(`${field} must be ${String(expected)}.`);
  }
}

function requireString(
  value: unknown,
  field: string,
  errors: string[],
): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    errors.push(`${field} must be a non-empty string.`);
  }
}

function validateStableId(
  value: unknown,
  field: string,
  errors: string[],
): void {
  if (
    typeof value !== "string" ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)
  ) {
    errors.push(`${field} must be a stable kebab-case ID.`);
  }
}

function trackUniqueString(
  value: unknown,
  field: string,
  seen: Set<string>,
  errors: string[],
): void {
  if (typeof value === "string" && seen.has(value)) {
    errors.push(`${field} duplicates ${value}.`);
  } else if (typeof value === "string") {
    seen.add(value);
  }
}

function trackUniqueName(
  value: unknown,
  field: string,
  seen: Set<string>,
  errors: string[],
): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    return;
  }
  const normalized = value.trim().toLocaleLowerCase();
  if (seen.has(normalized)) {
    errors.push(`${field} duplicates the name ${value}.`);
  } else {
    seen.add(normalized);
  }
}

function requireHttpsUrl(
  value: unknown,
  field: string,
  errors: string[],
): void {
  if (typeof value !== "string") {
    errors.push(`${field} must be an HTTPS URL.`);
    return;
  }
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") {
      errors.push(`${field} must be an HTTPS URL.`);
    }
  } catch {
    errors.push(`${field} must be an HTTPS URL.`);
  }
}

function requireSafeRelativePath(
  value: unknown,
  field: string,
  errors: string[],
): void {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.startsWith("/") ||
    value.includes("\\") ||
    value.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    errors.push(`${field} must be a safe package-relative path.`);
  }
}

function requireSemver(
  value: unknown,
  field: string,
  errors: string[],
): void {
  if (
    typeof value !== "string" ||
    strictSemver(value) === null
  ) {
    errors.push(`${field} must be a semantic version.`);
  }
}

function strictSemver(value: string): string | null {
  const exactSemver =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
  if (!exactSemver.test(value)) {
    return null;
  }
  return valid(value);
}

function invalid<T>(message: string): PluginValidationResult<T> {
  return { valid: false, value: null, errors: [message] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    isRecord(value) &&
    Object.values(value).every((entry) => typeof entry === "string")
  );
}

function validHostPattern(value: string): boolean {
  const host = value.startsWith("*.") ? value.slice(2) : value;
  return (
    host.length > 0 &&
    host.length <= 253 &&
    /^[a-z0-9.-]+$/i.test(host) &&
    !host.startsWith(".") &&
    !host.startsWith("-") &&
    !host.endsWith(".") &&
    !host.endsWith("-") &&
    !host.includes("..")
  );
}
