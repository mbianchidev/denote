import { describe, expect, it } from "vitest";
import { checkPluginCompatibility } from "@denote/plugin-sdk";
import plugin from "../src";

describe("code intelligence host compatibility", () => {
  it("requires the first host release containing its native and SDK contracts", () => {
    expect(checkPluginCompatibility(plugin.manifest, "0.8.1", 1).compatible).toBe(false);
    expect(checkPluginCompatibility(plugin.manifest, "0.9.0", 1).compatible).toBe(true);
  });
});
