import * as hostYjs from "../../node_modules/yjs/dist/yjs.mjs";
import { SuperDocCollaboration } from "./node_modules/@superdoc-dev/superdoc-yjs-collaboration/dist/index.js";

console.log("host yjs Doc:", typeof hostYjs.Doc);

const service = new SuperDocCollaboration({ name: "test" });
const doc = service.documentManager.get("nonexistent-doc-id");
console.log("documentManager.get on missing doc ->", doc);

// Create a document via getDocument to force the package's own yjs Doc class to instantiate,
// then check if a host-created Y.Doc is `instanceof` the package's bundled Doc class.
const created = await service.documentManager.getDocument("probe-doc", { documentId: "probe-doc" });
console.log("created doc instanceof host yjs.Doc:", created instanceof hostYjs.Doc);

const hostDoc = new hostYjs.Doc();
console.log("host-created Y.Doc constructor name:", hostDoc.constructor.name);
console.log("package-created doc constructor name:", created.constructor.name);
