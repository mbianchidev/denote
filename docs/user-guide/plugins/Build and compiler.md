# Build and compiler exercise

Opening this invented exercise never runs a compiler or downloads tooling.

1. Read [Build and compiler](<../docs/Optional plugins.md#build-and-compiler>).
2. Create a separate synthetic practice project. The Welcome source samples
   demonstrate editing, not a complete build configuration.
3. Enable Build and compiler, choose the project or vault scope, and explicitly
   approve an installed build executable and its JSON arguments.
4. For Cargo, use `["check", "--message-format=json"]` and **Cargo JSON**.
   For a different compiler, choose the matching parser and column units.
5. Edit a source file without saving. Compare **Save all and build** with
   **Run on saved files**. A failed save must not start a build.
6. Inspect streamed standard output and standard error. A nonzero exit remains
   a failed run. Navigate a current diagnostic, then change its source and
   confirm the stale marker disappears.
7. Cancel a build and disable the plugin. No child process should remain.

Approving a build also trusts its project scripts. Denote never installs
compilers or exposes decrypted vault content or encryption keys to them.

[Plugin examples](README.md) | [Optional plugins](<../docs/Optional plugins.md>)
