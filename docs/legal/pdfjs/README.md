# PDF.js legal notice

Denote uses Mozilla PDF.js 6.3.289 from the `pdfjs-dist` package to render PDF
files locally. PDF.js is licensed under Apache License 2.0.

The desktop build includes the package license together with the runtime CMaps,
standard fonts, ICC profile, image-decoder WebAssembly modules, and their
upstream license files. `npm run prepare:pdf-assets` copies those verified files
from the installed package into ignored Vite public staging. The generated
staging directory is never committed.

Denote disables PDF scripting, forms, annotation rendering, automatic link
creation, external links, and embedded attachment extraction. The QuickJS
evaluation assets are not staged.
