import { SuperDoc, DOCX } from "superdoc";
import { createSuperDocUI } from "superdoc/ui";
import "superdoc/style.css";

const params = new URLSearchParams(location.search);
const docPath = params.get("doc");
const mode = params.get("mode") ?? "editing";
const userName = params.get("user") ?? "Probe";
const collab = params.get("collab");
const commentsDisplay = params.get("commentsDisplay");
const licenseKey = params.get("licenseKey") ?? import.meta.env.VITE_SUPERDOC_LICENSE_KEY ?? undefined;

window.__errors = [];
window.addEventListener("error", (event) => {
  window.__errors.push({ type: "window.error", message: event.message });
});
window.addEventListener("unhandledrejection", (event) => {
  window.__errors.push({ type: "unhandledrejection", message: String(event.reason?.message ?? event.reason) });
});
const originalConsoleError = console.error.bind(console);
console.error = (...args) => {
  window.__errors.push({ type: "console.error", message: args.map(String).join(" ") });
  originalConsoleError(...args);
};

function parseCollabParam(raw) {
  const [serverUrl, documentId, roomMode] = raw.split(",");
  return { providerType: "hocuspocus", serverUrl, documentId, roomMode: roomMode ?? "join" };
}

async function buildDocumentConfig() {
  const collaboration = collab ? parseCollabParam(collab) : undefined;
  if (!docPath) return { id: "repro", type: DOCX, ...(collaboration ? { collaboration } : {}) };
  const response = await fetch("/" + docPath.replace(/^\//, ""));
  if (!response.ok) throw new Error(`failed to fetch doc "${docPath}": ${response.status}`);
  const file = new File([await response.blob()], docPath.split("/").pop(), {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
  return { id: "repro", type: DOCX, data: file, ...(collaboration ? { collaboration } : {}) };
}

const rawReady = new Promise((resolve) => {
  window.__resolveReady = resolve;
});

window.__sd = new SuperDoc({
  selector: "#editor",
  documentMode: mode,
  document: await buildDocumentConfig(),
  user: { name: userName, email: `${userName.toLowerCase().replace(/\s+/g, ".")}@example.com` },
  ...(commentsDisplay ? { ui: { comments: { layout: commentsDisplay } } } : {}),
  ...(licenseKey ? { licenseKey } : {}),
  onReady: (event) => window.__resolveReady(event),
  onException: (event) => {
    window.__errors.push({ type: "onException", code: event.code, message: event.error?.message });
  },
});

window.__ready = rawReady.then((event) => {
  window.__ui = createSuperDocUI({ superdoc: window.__sd });
  return event;
});

const hud = params.get("hud");
const label = params.get("label");
if (hud || label) {
  const panel = document.createElement("div");
  panel.id = "repro-hud";
  panel.style.cssText = "position:fixed;top:8px;right:8px;z-index:2147483647;font:13px/1.4 ui-monospace,Menlo,monospace;background:rgba(17,24,39,.88);color:#f9fafb;padding:8px 10px;border-radius:6px;min-width:220px;pointer-events:none;white-space:pre";
  document.body.appendChild(panel);
  const state = { label: label ?? "", frame: 0, worst: 0, worstAt: 0, stalls: 0, tracked: "–", comments: "–" };
  const render = () => {
    const lines = [];
    if (state.label) lines.push(state.label);
    if (hud?.includes("fps")) lines.push(`frame ${state.frame} ms  worst(2s) ${state.worst} ms`, `stalls >500ms: ${state.stalls}`);
    if (hud?.includes("tc")) lines.push(`tracked changes: ${state.tracked}`, `comments: ${state.comments}`);
    if (hud?.includes("err")) {
      const last = window.__errors.at(-1);
      lines.push(last ? `last error: ${last.code ?? last.type}` : "last error: none");
      if (last?.message) lines.push(`  ${String(last.message).slice(0, 60)}`);
    }
    panel.textContent = lines.join("\n");
  };
  if (hud?.includes("fps")) {
    let last = performance.now();
    const loop = (now) => {
      const delta = Math.round(now - last);
      last = now;
      state.frame = delta;
      if (delta > state.worst || now - state.worstAt > 2000) { state.worst = delta; state.worstAt = now; }
      if (delta > 500) state.stalls += 1;
      render();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
  if (hud?.includes("tc")) {
    window.__ready.then(() => {
      const poll = async () => {
        try {
          const doc = window.__sd.activeEditor?.doc;
          state.tracked = String((await doc.trackChanges.list()).total);
          const comments = await doc.comments.list();
          state.comments = String(comments.total ?? comments.items?.length ?? comments.length ?? "?");
        } catch (error) {
          state.tracked = "error";
        }
        render();
        setTimeout(poll, 1000);
      };
      poll();
    });
  }
  render();
  if (hud?.includes("err")) setInterval(render, 500);
}

if (params.get("actions")) {
  const bar = document.createElement("div");
  bar.id = "repro-actions";
  bar.style.cssText = "position:fixed;bottom:12px;right:12px;z-index:2147483647;display:flex;gap:8px;align-items:center;font:13px system-ui,sans-serif;background:#fff;border:1px solid #d1d5db;border-radius:8px;padding:8px 10px;box-shadow:0 2px 8px rgba(0,0,0,.12)";
  const status = document.createElement("span");
  status.id = "repro-actions-status";
  status.style.cssText = "font:12px ui-monospace,Menlo,monospace;color:#111827;max-width:420px";
  status.textContent = "integrator buttons → superdoc API";
  const addButton = (text, run) => {
    const button = document.createElement("button");
    button.textContent = text;
    button.style.cssText = "font:13px system-ui;padding:4px 10px;border:1px solid #9ca3af;border-radius:6px;background:#f9fafb;cursor:pointer";
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", async () => {
      status.textContent = `${text}…`;
      try {
        const result = await run();
        status.textContent = `${text}: ${JSON.stringify(result).slice(0, 160)}`;
      } catch (error) {
        status.textContent = `${text}: threw ${error?.code ?? ""} ${error?.message ?? error}`.slice(0, 200);
      }
    });
    bar.appendChild(button);
  };
  const decideAll = (decision) => window.__sd.activeEditor.doc.trackChanges.decide({ decision, target: { kind: "all" } });
  addButton("Accept all", () => decideAll("accept"));
  addButton("Reject all", () => decideAll("reject"));
  bar.appendChild(status);
  document.body.appendChild(bar);
}
