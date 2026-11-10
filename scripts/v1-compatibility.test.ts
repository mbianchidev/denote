import { expect, it } from "vitest";
import { assertValidPluginCatalogEntry, checkPluginCompatibility } from "@denote/plugin-sdk";
import catalogJson from "../plugins/catalog.json";

it("keeps every catalog plugin compatible with API 1 throughout Denote 1.x", () => {
  for (const value of catalogJson) {
    const entry: unknown = value;
    assertValidPluginCatalogEntry(entry);
    for (const host of ["1.0.0-rc.1", "1.0.0", "1.42.0"]) {
      expect(checkPluginCompatibility(entry.manifest, host, 1),
        `${entry.manifest.id} on Denote ${host}`).toEqual({ compatible: true, reason: null });
    }
    expect(checkPluginCompatibility(entry.manifest, "1.0.0", 2).compatible).toBe(false);
  }
});
