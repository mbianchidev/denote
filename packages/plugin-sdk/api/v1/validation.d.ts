import { type PluginBundle, type PluginCatalogEntry, type PluginCompatibilityResult, type PluginManifest, type PluginValidationResult } from "./contracts";
export declare function validatePluginBundles(value: unknown, catalogPluginIds?: ReadonlySet<string>): PluginValidationResult<PluginBundle[]>;
export declare function assertValidPluginBundles(value: unknown, catalogPluginIds?: ReadonlySet<string>): asserts value is PluginBundle[];
export declare function validatePluginManifest(value: unknown): PluginValidationResult<PluginManifest>;
export declare function assertValidPluginManifest(value: unknown): asserts value is PluginManifest;
export declare function parsePluginManifest(value: unknown): PluginManifest;
export declare function validatePluginCatalogEntry(value: unknown): PluginValidationResult<PluginCatalogEntry>;
export declare function assertValidPluginCatalogEntry(value: unknown): asserts value is PluginCatalogEntry;
export declare function checkPluginCompatibility(manifest: PluginManifest, denoteVersion: string, apiVersion: number): PluginCompatibilityResult;
