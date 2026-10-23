import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Server } from "@hocuspocus/server";

const sdkEntry = process.env.SDK_DIR ? `${process.env.SDK_DIR}/node_modules/@superdoc/sdk/dist/index.js` : "@superdoc/sdk";
const { createSuperDocClient } = await import(sdkEntry);
const sdkPackageJson = process.env.SDK_DIR
  ? `${process.env.SDK_DIR}/node_modules/@superdoc/sdk/package.json`
  : new URL("../node_modules/@superdoc/sdk/package.json", import.meta.url);
const sdkVersion = JSON.parse(readFileSync(sdkPackageJson, "utf8")).version;
const files = process.argv.slice(2);

const server = Server.configure({ port: 0, quiet: true, unloadImmediately: false });
await server.listen();
const url = `ws://127.0.0.1:${server.address.port}`;

function describe(error) {
  return `${error?.code ?? error?.name}: ${String(error?.message).slice(0, 160)}`;
}

async function run(file) {
  const documentId = randomUUID();
  const collaboration = { providerType: "hocuspocus", url, documentId, syncTimeoutMs: 20000 };
  const host = createSuperDocClient({ runtime: "v2" });
  await host.connect();
  const direct = await host.open({ doc: file }).then((doc) => doc.close({ discard: true }).then(() => "ok"), describe);
  const created = await host.open({ doc: file, collaboration: { ...collaboration, roomMode: "create" } }).then((doc) => ({ doc }), (error) => ({ error: describe(error) }));
  if (created.error) {
    console.log(`${file}\n  open without a room: ${direct}\n  create room: ${created.error}`);
    await host.dispose();
    return;
  }
  const joiner = createSuperDocClient({ runtime: "v2" });
  await joiner.connect();
  const joined = await joiner.open({ collaboration: { ...collaboration, roomMode: "join" } }).then(
    async (doc) => `ok (revision ${(await doc.info()).revision})`,
    describe,
  );
  console.log(`${file}\n  open without a room: ${direct}\n  create room: ok\n  second client joins: ${joined}`);
  await joiner.dispose();
  await host.dispose();
}

console.log(`@superdoc/sdk ${sdkVersion}`);
for (const file of files) await run(file);
await server.destroy();
