const token = decodeURIComponent(location.hash.slice(1));
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
      const moduleUrl = rendererModuleUrl(message.moduleSource);
      try {
        const module = await import(/* @vite-ignore */ moduleUrl);
        if (typeof module.renderDiagram !== "function") {
          throw new Error("Renderer export is unavailable.");
        }
        renderDiagram = module.renderDiagram;
      } finally {
        URL.revokeObjectURL(moduleUrl);
      }
      parent.postMessage({ token, type: "ready" }, "*");
      return;
    }
    if (message.type === "render") {
      if (!renderDiagram) {
        throw new Error("Renderer is not initialized.");
      }
      const result = await renderDiagram(message.request);
      parent.postMessage(
        { token, type: "result", requestId: message.requestId, result },
        "*",
      );
    }
  } catch (error) {
    parent.postMessage(
      {
        token,
        type: "failure",
        requestId: message.requestId,
        error: error instanceof Error ? error.message : String(error),
      },
      "*",
    );
  }
});

parent.postMessage({ token, type: "listening" }, "*");

function rendererModuleUrl(source) {
  if (typeof source !== "string") {
    throw new Error("Renderer source is invalid.");
  }
  return URL.createObjectURL(
    new Blob([source], { type: "text/javascript" }),
  );
}
