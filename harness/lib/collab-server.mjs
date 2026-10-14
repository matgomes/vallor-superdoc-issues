import { createServer } from "node:net";
import { Server } from "@hocuspocus/server";
import { createSuperDocClient } from "@superdoc/sdk";

function closeAndResolvePort(probe, resolve) {
  const { port } = probe.address();
  probe.close(() => resolve(port));
}

export function getFreePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.unref();
    probe.on("error", reject);
    probe.listen(0, () => closeAndResolvePort(probe, resolve));
  });
}

export async function startCollabServer(options = {}) {
  const port = options.port ?? (await getFreePort());
  const server = Server.configure({ port, quiet: options.quiet ?? true, unloadImmediately: false });
  await server.listen();
  return { port, url: `ws://127.0.0.1:${port}`, stop: () => server.destroy() };
}

function hocuspocusCollaborationConfig(serverUrl, documentId, syncTimeoutMs) {
  return { providerType: "hocuspocus", url: serverUrl, documentId, roomMode: "create", syncTimeoutMs };
}

async function releaseSeedConnection(client, document) {
  await document.close({ discard: true });
  await client.dispose();
}

export async function seedRoomFromDocx(serverUrl, documentId, docPath, options = {}) {
  const client = createSuperDocClient({ runtime: "v2" });
  await client.connect();
  const document = await client.open({
    doc: docPath,
    userName: options.userName ?? "Seeder",
    userEmail: options.userEmail ?? "seeder@example.com",
    collaboration: hocuspocusCollaborationConfig(serverUrl, documentId, options.syncTimeoutMs ?? 20000),
  });
  return { document, release: () => releaseSeedConnection(client, document) };
}
