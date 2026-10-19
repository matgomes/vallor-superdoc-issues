import { randomUUID } from "node:crypto";
import { Server } from "@hocuspocus/server";
import { createSuperDocClient } from "@superdoc/sdk";

const file = process.argv[2];
const useRoom = !process.argv.includes("--no-room");
const server = Server.configure({ port: 0, quiet: true });
await server.listen();
const client = createSuperDocClient({ runtime: "v2" });
await client.connect();

async function openDocument() {
  if (!useRoom) return { doc: await client.open({ doc: file }), close: [] };
  const collaboration = { providerType: "hocuspocus", url: `ws://127.0.0.1:${server.address.port}`, documentId: randomUUID() };
  const host = await client.open({ doc: file, collaboration: { ...collaboration, roomMode: "create" } });
  const doc = await client.open({ collaboration: { ...collaboration, roomMode: "join" } });
  return { doc, close: [host] };
}

const first = await openDocument();
const { items } = await first.doc.trackChanges.list({});
const text = await first.doc.getText({});
for (const item of items) {
  const change = await first.doc.trackChanges.get({ id: item.id });
  const { start, end } = change.target.segments[0].range;
  console.log(`change ${JSON.stringify(item.excerpt)} reported range ${start}-${end} -> text there: ${JSON.stringify(text.slice(start, end))}`);
}
await first.doc.close({ discard: true });
await Promise.all(first.close.map((doc) => doc.close({ discard: true })));

for (const item of items) {
  for (const decision of ["accept", "reject"]) {
    const { doc, close } = await openDocument();
    const outcome = await doc.trackChanges
      .decide({ decision, target: { kind: "id", id: item.id } })
      .then((receipt) => `success=${receipt.success}`, (error) => `${error.details?.failure?.code ?? error.name}: ${error.details?.failure?.message ?? error.message}`);
    console.log(`${useRoom ? "room" : "no room"} | ${decision} ${JSON.stringify(item.excerpt)} -> ${outcome}`);
    await doc.close({ discard: true });
    await Promise.all(close.map((other) => other.close({ discard: true })));
  }
}
await client.dispose();
await server.destroy();
