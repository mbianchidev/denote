import { externalLinkTarget } from "./links";

const STORAGE_KEY = "denote-external-domains";

export interface ExternalDomainPolicy {
  allowAll: boolean;
  domains: string[];
}

export const DEFAULT_EXTERNAL_DOMAIN_POLICY: ExternalDomainPolicy = {
  allowAll: false,
  domains: [],
};

export function getExternalDomainPolicy(): ExternalDomainPolicy {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(STORAGE_KEY) ?? "null",
    ) as Partial<ExternalDomainPolicy> | null;
    return normalizeExternalDomainPolicy(parsed);
  } catch {
    return { ...DEFAULT_EXTERNAL_DOMAIN_POLICY };
  }
}

export function saveExternalDomainPolicy(
  policy: ExternalDomainPolicy,
): ExternalDomainPolicy {
  const normalized = normalizeExternalDomainPolicy(policy);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  return normalized;
}

export function externalDomain(href: string): string | null {
  try {
    const url = new URL(externalLinkTarget(href));
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.hostname.toLowerCase()
      : null;
  } catch {
    return null;
  }
}

export function isExternalDomainAllowed(
  policy: ExternalDomainPolicy,
  domain: string,
): boolean {
  const normalized = domain.trim().toLowerCase();
  return (
    policy.allowAll ||
    policy.domains.some((candidate) => candidate === normalized)
  );
}

export function allowExternalDomain(
  policy: ExternalDomainPolicy,
  domain: string,
): ExternalDomainPolicy {
  const normalized = domain.trim().toLowerCase();
  return normalizeExternalDomainPolicy({
    ...policy,
    domains: normalized ? [...policy.domains, normalized] : policy.domains,
  });
}

function normalizeExternalDomainPolicy(
  policy: Partial<ExternalDomainPolicy> | null,
): ExternalDomainPolicy {
  const domains = [
    ...new Set(
      (Array.isArray(policy?.domains) ? policy.domains : [])
        .filter((domain): domain is string => typeof domain === "string")
        .map((domain) => domain.trim().toLowerCase())
        .filter(Boolean),
    ),
  ].sort((left, right) => left.localeCompare(right));
  return {
    allowAll: policy?.allowAll === true,
    domains,
  };
}
