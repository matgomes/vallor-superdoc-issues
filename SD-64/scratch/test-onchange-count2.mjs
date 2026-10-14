import { SuperDocCollaboration } from "@superdoc-dev/superdoc-yjs-collaboration";

let changeCount = 0;
const service = new SuperDocCollaboration({
  name: "test",
  hooks: {
    change: () => { changeCount += 1; },
  },
});

const doc = await service.documentManager.getDocument("probe-onchange2", { documentId: "probe-onchange2" });
console.log("doc created, making one plain-text edit via the doc's OWN bundled Yjs types...");

const text = doc.getText("default");
doc.transact(() => {
  text.insert(0, "hello world");
});

await new Promise((resolve) => setTimeout(resolve, 300));
console.log(`onChange hook fired ${changeCount} time(s) for ONE transact() call.`);
process.exit(0);
