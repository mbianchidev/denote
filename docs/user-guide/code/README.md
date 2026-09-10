# Syntax highlighting samples

Each file in this folder is a tiny invented example for one distinct core
syntax-highlighting mode. Extensions and aliases that resolve to the same mode
share one sample.

Filename-only detection is represented by `Dockerfile`, `CMakeLists.txt`,
`Makefile`, `Jenkinsfile`, `.editorconfig`, `.env.example`, `Procfile`,
`BUILD.bazel`, `go.mod`, `_helpers.tpl`, `Pipfile.lock`, `Cargo.lock`, and
`meson.build`.

The `.pp` extension is intentionally ambiguous between Pascal and Puppet.
`hello.pas` demonstrates automatic Pascal detection; open `hello.pp` and choose
**Puppet** manually from the language control.
