import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyPluginDownloads, verifyRemoteArtifact } from "./plugin-downloads.mjs";

const bytes = Buffer.from("synthetic plugin archive");
const sha256 = createHash("sha256").update(bytes).digest("hex");
const sourceCommit = "a".repeat(40);
const releaseUrl =
  "https://github.com/mbianchidev/denote/releases/download/v1.2.3/denote.synthetic-1.0.0.tgz";

function entry(id = "denote.synthetic") {
  return {
    manifest: { id, version: "1.0.0" },
    artifact: {
      url: releaseUrl.replace("denote.synthetic", id),
      sha256,
      sizeBytes: bytes.length,
    },
    provenance: { sourceCommit },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("published plugin downloads", () => {
  it("rejects an unpublished release and reports every missing plugin URL", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 404 }));
    vi.stubGlobal("fetch", fetch);

    await expect(verifyPluginDownloads([entry(), entry("denote.other")]))
      .rejects.toThrow(/denote.synthetic.*HTTP 404.*\n.*denote.other.*HTTP 404/s);
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      releaseUrl,
      releaseUrl.replace("denote.synthetic", "denote.other"),
    ]);
  });

  it("checks the exact source pin before a release exists without changing the catalog", async () => {
    const catalog = [entry()];
    const before = JSON.stringify(catalog);
    const fetch = vi.fn().mockResolvedValue(new Response(bytes));
    vi.stubGlobal("fetch", fetch);

    await verifyPluginDownloads(catalog, { source: true });

    expect(fetch).toHaveBeenCalledWith(
      `https://raw.githubusercontent.com/mbianchidev/denote/${sourceCommit}/plugin-artifacts/denote.synthetic-1.0.0.tgz`,
      expect.objectContaining({ redirect: "manual" }),
    );
    expect(JSON.stringify(catalog)).toBe(before);
  });

  it("verifies release asset redirects and exact bytes", async () => {
    const assetUrl = "https://release-assets.githubusercontent.com/synthetic.tgz";
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: assetUrl } }))
      .mockResolvedValueOnce(new Response(bytes));
    vi.stubGlobal("fetch", fetch);

    await verifyRemoteArtifact(releaseUrl, "denote.synthetic", bytes.length, sha256);

    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each([
    "http://github.com/synthetic.tgz",
    "https://example.invalid/synthetic.tgz",
    "https://user@github.com/synthetic.tgz",
    "https://github.com:444/synthetic.tgz",
  ])("rejects unapproved redirect %s before requesting it", async (location) => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(null, { status: 302, headers: { location } }),
    );
    vi.stubGlobal("fetch", fetch);

    await expect(verifyRemoteArtifact(releaseUrl, "denote.synthetic", bytes.length, sha256))
      .rejects.toThrow("host is not allowed");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each(["short", "oversized synthetic plugin archive", "different plugin bytes!"])(
    "rejects incorrect download bytes: %s",
    async (content) => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(content)));

      await expect(verifyRemoteArtifact(releaseUrl, "denote.synthetic", bytes.length, sha256))
        .rejects.toThrow(/catalog metadata/);
    },
  );

  it("rejects a same-size checksum mismatch", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(Buffer.alloc(bytes.length))));

    await expect(verifyRemoteArtifact(releaseUrl, "denote.synthetic", bytes.length, sha256))
      .rejects.toThrow("bytes do not match catalog metadata");
  });

  it("bounds redirect chains without falling back to another artifact", async () => {
    const fetch = vi.fn().mockImplementation(async () =>
      new Response(null, { status: 302, headers: { location: releaseUrl } }),
    );
    vi.stubGlobal("fetch", fetch);

    await expect(verifyRemoteArtifact(releaseUrl, "denote.synthetic", bytes.length, sha256))
      .rejects.toThrow("redirect limit exceeded");
    expect(fetch).toHaveBeenCalledTimes(5);
  });

  it("rejects an unpinned source ref before making a request", async () => {
    const catalog = [entry()];
    catalog[0].provenance.sourceCommit = "main";
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    await expect(verifyPluginDownloads(catalog, { source: true }))
      .rejects.toThrow("40-character source commit");
    expect(fetch).not.toHaveBeenCalled();
  });
});
