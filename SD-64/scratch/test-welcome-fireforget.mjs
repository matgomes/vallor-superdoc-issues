import { SuperDocCollaboration } from "@superdoc-dev/superdoc-yjs-collaboration";

process.on("unhandledRejection", (reason) => {
  console.log("UNHANDLED REJECTION caught by a process-level handler:", String(reason?.message ?? reason));
});

const service = new SuperDocCollaboration({ name: "test" });
const fakeSocket = { readyState: 1, send() {}, close() {}, on() {} };
const rawHttpRequest = { url: "/collaboration/abc123?foo=bar", headers: { cookie: "" } };

// Fire-and-forget, exactly as the README's own example does:
// `app.get('/collaboration/:documentId', { websocket: true }, (socket, request) => service.welcome(socket, request));`
console.log("calling welcome() fire-and-forget (no await), as the README example does...");
service.welcome(fakeSocket, rawHttpRequest);
console.log("synchronous call returned with no exception (good) -- waiting to see if a rejection surfaces asynchronously...");
await new Promise((resolve) => setTimeout(resolve, 800));
console.log("done waiting.");
