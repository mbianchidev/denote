import { describe, expect, it } from "vitest";
import { isPluginSensitiveToolRegistration, parsePluginManifest } from "./index";
import speech from "../../../plugins/speech/plugin.json";
import credentials from "../../../plugins/credential-store/plugin.json";

describe("sensitive tool boundaries", () => {
  it("accepts only closed declarative registrations without sensitive payloads or functions", () => {
    const tool = { id: "denote.speech.local", title: "Speech", feature: "speech" };
    expect(isPluginSensitiveToolRegistration(tool)).toBe(true);
    for (const extra of [{ source: "invented text" }, { secret: "invented secret" }, { run: () => {} }, { type: "log" }]) {
      expect(isPluginSensitiveToolRegistration({ ...tool, ...extra })).toBe(false);
    }
    expect(isPluginSensitiveToolRegistration({ ...tool, title: "Untrusted\nlabel" })).toBe(false);
    expect(isPluginSensitiveToolRegistration({ ...tool, feature: "microphone" })).toBe(false);
  });

  it.each([speech, credentials])("keeps $id isolated from unrelated data and network capabilities", (manifest) => {
    expect(parsePluginManifest(manifest).permissions).toHaveLength(1);
    for (const capability of ["network", "process", "workspace-read", "workspace-write", "clocks", "secure-storage"]) {
      const permission = capability === "network" ? { capability, hosts: ["synthetic.invalid"] } :
        capability === "process" ? { capability, executables: { linux: ["synthetic"] } } : { capability };
      expect(() => parsePluginManifest({ ...manifest, permissions: [...manifest.permissions, permission] })).toThrow(/sensitive/i);
    }
  });
});
