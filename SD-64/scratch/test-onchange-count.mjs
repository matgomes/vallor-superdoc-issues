import { SuperDocCollaboration } from "@superdoc-dev/superdoc-yjs-collaboration";
import * as Y from "yjs";

let changeCount = 0;
const service = new SuperDocCollaboration({
  name: "test",
  hooks: {
    change: () => { changeCount += 1; },
  },
});

const doc = await service.documentManager.getDocument("probe-onchange", { documentId: "probe-onchange" });
console.log("doc created, making one text edit...");

const fragment = doc.getXmlFragment("default");
doc.transact(() => {
  const textNode = new Y.XmlText();
  textNode.insert(0, "hello world");
  fragment.insert(0, [textNode]);
});

await new Promise((resolve) => setTimeout(resolve, 300));
console.log(`onChange hook fired ${changeCount} time(s) for ONE transact() call.`);
process.exit(0);
