const SuperDocCollaboration = require("@superdoc-dev/superdoc-yjs-collaboration");
console.log("require() result type:", typeof SuperDocCollaboration, Object.keys(SuperDocCollaboration));
console.log("require().default:", SuperDocCollaboration.default);

try {
  const service = new SuperDocCollaboration().withName("sdc-test");
  console.log("constructed fine:", service);
} catch (error) {
  console.log("THREW:", error.constructor.name, "-", error.message);
}
