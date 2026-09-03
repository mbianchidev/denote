# Bundled tools notice

Official Denote installers include Git and GitHub CLI for the release target.
They remain separate programs invoked by Denote and keep their upstream
licenses.

## Git

- Version: 2.55.0
- Source: https://github.com/git/git/tree/e9019fcafe0040228b8631c30f97ae1adb61bcdc
- Corresponding source archive:
  https://www.kernel.org/pub/software/scm/git/git-2.55.0.tar.gz
- License: GNU General Public License version 2, included as `COPYING` in the
  source archive and installed beside the bundled executable.
- Release signing key: the minimal OpenPGP export in `git-maintainer.asc`,
  pinned by fingerprint and SHA-256 in `bundled-tools.lock.json`.

The Windows x64 package uses MinGit 2.55.0.5 from Git for Windows:
https://github.com/git-for-windows/git/tree/32c4f7689275d233577576630e1ac5b7eb354eb0.
MinGit includes additional third-party license notices in its distribution.

## GitHub CLI

- Version: 2.99.0
- Source: https://github.com/cli/cli/tree/d528f20f2ee02f6703773e9f56c90e3c3f5d46b0
- License: MIT, included as `LICENSE` in every official archive and installed
  beside the bundled executable.

The exact source identities, release archives, checksums, signatures,
attestations, executable paths, and SBOM digests are pinned in
`bundled-tools.lock.json`.
