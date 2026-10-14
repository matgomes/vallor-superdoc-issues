import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const pkgVersion = require("@superdoc-dev/superdoc-yjs-collaboration/package.json").version;
console.log("resolved version:", pkgVersion);
