import { SuperDocCollaboration } from "@superdoc-dev/superdoc-yjs-collaboration";

let changeCount = 0;
const service = new SuperDocCollaboration({
  name: "test",
  hooks: {
    change: () => { changeCount += 1; },
  },
});

const listeners = {};
const fakeSocket = {
  readyState: 1,
  send() {},
  close() {},
  on(event, cb) { listeners[event] = cb; },
};
// Supply `.params.documentId` the way Express/Fastify would, so welcome()
// doesn't throw -- we want to see onChange wiring, not re-prove claim #2.
const requestWithParams = {
  url: "/collaboration/probe-onchange3",
  params: { documentId: "probe-onchange3" },
  headers: { cookie: "" },
};

await service.welcome(fakeSocket, requestWithParams);
console.log("welcome() completed, connection established. Making one text edit...");

const doc = service.documentManager.get("probe-onchange3");
const text = doc.getText("default");
doc.transact(() => {
  text.insert(0, "hello world");
});

await new Promise((resolve) => setTimeout(resolve, 300));
console.log(`onChange hook fired ${changeCount} time(s) for ONE transact() call after a real welcome()-established connection.`);
process.exit(0);
