import SuperDocCollaboration from "@superdoc-dev/superdoc-yjs-collaboration";
console.log("default import value:", SuperDocCollaboration);
try {
  const service = new SuperDocCollaboration().withName("sdc-test");
  console.log("constructed fine:", service);
} catch (error) {
  console.log("THREW:", error.constructor.name, "-", error.message);
}
