const token = decodeURIComponent(new URL(import.meta.url).hash.slice(1));
let renderDiagram = null;

for (const name of [
  "fetch",
  "XMLHttpRequest",
  "WebSocket",
  "EventSource",
  "Worker",
  "SharedWorker",
  "BroadcastChannel",
  "RTCPeerConnection",
  "webkitRTCPeerConnection",
  "RTCDataChannel",
  "RTCIceCandidate",
  "RTCSessionDescription",
]) {
  try {
    Object.defineProperty(globalThis, name, {
      value: undefined,
      configurable: false,
      writable: false,
    });
  } catch {
    // The sandbox CSP still denies the corresponding resource types.
  }
}

addEventListener("message", async (event) => {
  const message = event.data;
  if (!token || !message || message.token !== token) {
    return;
  }
  try {
    if (message.type === "initialize") {
      const module = await import(moduleDataUrl(message.moduleSource));
      if (typeof module.renderDiagram !== "function") {
        throw new Error("Renderer export is unavailable.");
      }
      renderDiagram = module.renderDiagram;
      parent.postMessage({ token, type: "ready" }, "*");
      return;
    }
    if (message.type === "render") {
      if (!renderDiagram) {
        throw new Error("Renderer is not initialized.");
      }
      const result = await renderDiagram(message.request);
      parent.postMessage({ token, type: "result", result }, "*");
    }
  } catch (error) {
    parent.postMessage(
      {
        token,
        type: "failure",
        error: error instanceof Error ? error.message : String(error),
      },
      "*",
    );
  }
});

parent.postMessage({ token, type: "listening" }, "*");

function moduleDataUrl(source) {
  if (typeof source !== "string") {
    throw new Error("Renderer source is invalid.");
  }
  const bytes = new TextEncoder().encode(source);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return `data:text/javascript;base64,${btoa(binary)}`;
}
