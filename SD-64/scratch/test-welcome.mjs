import { SuperDocCollaboration } from "@superdoc-dev/superdoc-yjs-collaboration";

process.on("unhandledRejection", (reason) => {
  console.log("UNHANDLED REJECTION observed:", String(reason?.message ?? reason));
});

const service = new SuperDocCollaboration({ name: "test" });

// A bare node:http IncomingMessage-shaped request: no `.params` (that's an
// Express/Fastify route-param convenience, not present on raw http).
const fakeSocket = {
  readyState: 1,
  send() {},
  close() {},
  on() {},
};
const rawHttpRequest = {
  url: "/collaboration/abc123?foo=bar",
  headers: { cookie: "" },
  // no `.params` -- this is what a raw node:http server's request looks like
};

console.log("calling welcome() with a raw node:http-shaped request (no .params)...");
await service.welcome(fakeSocket, rawHttpRequest);
console.log("welcome() call returned (synchronously) without throwing -- check above for any unhandled rejection logged shortly after.");
await new Promise((resolve) => setTimeout(resolve, 500));
console.log("done waiting for async rejection.");
