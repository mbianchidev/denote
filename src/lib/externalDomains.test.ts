import { beforeEach, describe, expect, it } from "vitest";
import {
  allowExternalDomain,
  externalDomain,
  getExternalDomainPolicy,
  isExternalDomainAllowed,
  saveExternalDomainPolicy,
} from "./externalDomains";

describe("external domain policy", () => {
  beforeEach(() => localStorage.clear());

  it("normalizes domains and persists exact trust", () => {
    const policy = allowExternalDomain(getExternalDomainPolicy(), "Google.COM");
    saveExternalDomainPolicy(policy);

    expect(getExternalDomainPolicy()).toEqual({
      allowAll: false,
      domains: ["google.com"],
    });
    expect(isExternalDomainAllowed(policy, "google.com")).toBe(true);
    expect(isExternalDomainAllowed(policy, "www.google.com")).toBe(false);
  });

  it("extracts normalized HTTP domains only", () => {
    expect(externalDomain("Https://Google.com/path")).toBe("google.com");
    expect(externalDomain("mailto:user@example.com")).toBeNull();
  });

  it("supports wildcard trust", () => {
    const policy = saveExternalDomainPolicy({
      allowAll: true,
      domains: ["example.com"],
    });
    expect(isExternalDomainAllowed(policy, "unknown.test")).toBe(true);
  });
});
