import { createSuperDocClient } from "@superdoc/sdk";
import JSZip from "jszip";

function hocuspocusCollaborationConfig(collaboration) {
  return { providerType: "hocuspocus", roomMode: "join", syncTimeoutMs: 20000, ...collaboration };
}

export async function openDocx(docPath, options = {}) {
  const client = createSuperDocClient({ runtime: "v2" });
  await client.connect();
  const document = await client.open({
    doc: docPath,
    userName: options.userName ?? "Probe",
    userEmail: options.userEmail ?? "probe@example.com",
    ...(options.collaboration ? { collaboration: hocuspocusCollaborationConfig(options.collaboration) } : {}),
  });
  return { client, document };
}

export async function closeDocx({ client, document }, options = { discard: true }) {
  await document.close(options);
  await client.dispose();
}

export async function exportDocx(document, mode = "final") {
  const result = await document.export.toDocx({ mode });
  return { buffer: Buffer.from(result.contentBase64, "base64"), warnings: result.report?.warnings ?? [] };
}

function countTag(xml, tag) {
  return (xml.match(new RegExp(`<${tag}[ />]`, "g")) ?? []).length;
}

export async function countTags(docxBuffer, tags) {
  const zip = await JSZip.loadAsync(docxBuffer);
  const xml = await zip.file("word/document.xml").async("string");
  return Object.fromEntries(tags.map((tag) => [tag, countTag(xml, tag)]));
}
