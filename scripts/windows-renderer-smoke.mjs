import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

const appPath = resolve(process.argv[2] ?? "");
const port = Number.parseInt(
  process.env.DENOTE_RENDERER_SMOKE_PORT ?? "9222",
  10,
);
const timeoutMs = Number.parseInt(
  process.env.DENOTE_RENDERER_SMOKE_TIMEOUT_MS ?? "45000",
  10,
);
const evidencePath = process.env.DENOTE_RENDERER_SMOKE_OUTPUT?.trim();

if (process.platform !== "win32") {
  throw new Error("The Windows renderer smoke test must run on Windows.");
}
if (!process.argv[2] || basename(appPath).toLowerCase() !== "denote.exe") {
  throw new Error("Pass the built Denote executable as the first argument.");
}
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  throw new Error("DENOTE_RENDERER_SMOKE_PORT must be a non-privileged TCP port.");
}
if (!Number.isInteger(timeoutMs) || timeoutMs < 5000 || timeoutMs > 120000) {
  throw new Error(
    "DENOTE_RENDERER_SMOKE_TIMEOUT_MS must be between 5000 and 120000.",
  );
}

const temporaryRoot = await mkdtemp(join(tmpdir(), "denote-renderer-smoke-"));
const appData = join(temporaryRoot, "Roaming");
const localAppData = join(temporaryRoot, "Local");
const webviewData = join(temporaryRoot, "WebView2");
await Promise.all([
  mkdir(appData, { recursive: true }),
  mkdir(localAppData, { recursive: true }),
  mkdir(webviewData, { recursive: true }),
]);

const diagnostics = {
  appPath,
  port,
  processExit: null,
  stdout: "",
  stderr: "",
  target: null,
  events: [],
  snapshots: [],
};

const child = spawn(appPath, [], {
  env: {
    ...process.env,
    APPDATA: appData,
    LOCALAPPDATA: localAppData,
    WEBVIEW2_USER_DATA_FOLDER: webviewData,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
  },
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: false,
});
let spawnError = null;
child.stdout.setEncoding("utf8");
child.stderr.setEncoding("utf8");
child.on("error", (error) => {
  spawnError = error;
});
child.stdout.on("data", (chunk) => {
  diagnostics.stdout = boundedAppend(diagnostics.stdout, chunk);
});
child.stderr.on("data", (chunk) => {
  diagnostics.stderr = boundedAppend(diagnostics.stderr, chunk);
});
child.on("exit", (code, signal) => {
  diagnostics.processExit = { code, signal };
});

let webSocket;
try {
  const target = await waitForTarget();
  diagnostics.target = {
    title: target.title,
    type: target.type,
    url: target.url,
  };
  webSocket = await connectWebSocket(target.webSocketDebuggerUrl);
  const cdp = createCdpClient(webSocket, diagnostics.events);
  await Promise.all([
    cdp.call("Runtime.enable"),
    cdp.call("Log.enable"),
    cdp.call("Network.enable"),
    cdp.call("Page.enable"),
  ]);

  const deadline = Date.now() + timeoutMs;
  let rendered = false;
  while (Date.now() < deadline) {
    if (spawnError) {
      throw new Error(`Unable to launch Denote: ${spawnError.message}`);
    }
    if (child.exitCode !== null) {
      throw new Error(`Denote exited before rendering with code ${child.exitCode}.`);
    }
    const response = await cdp.call("Runtime.evaluate", {
      expression: `(() => {
        const root = document.getElementById("root");
        return {
          href: location.href,
          title: document.title,
          readyState: document.readyState,
          visibility: document.visibilityState,
          rootChildren: root?.childElementCount ?? -1,
          bodyText: document.body?.innerText?.slice(0, 4000) ?? "",
          rootHtml: root?.innerHTML?.slice(0, 4000) ?? "",
          renderedSurface: Boolean(document.querySelector(".app-shell, .welcome")),
          fatalError: document.querySelector(".fatal-error")?.textContent ?? null,
          scripts: [...document.scripts].map((script) => script.src || "inline"),
          resources: performance.getEntriesByType("resource")
            .slice(-40)
            .map((entry) => ({ name: entry.name, duration: entry.duration })),
        };
      })()`,
      returnByValue: true,
    });
    if (response.result?.exceptionDetails) {
      throw new Error(
        `Renderer evaluation failed: ${response.result.exceptionDetails.text}`,
      );
    }
    const snapshot = response.result?.result?.value;
    diagnostics.snapshots.push(snapshot);
    if (snapshot?.fatalError) {
      throw new Error(`Denote rendered its fatal error boundary: ${snapshot.fatalError}`);
    }
    if (
      snapshot?.readyState === "complete" &&
      snapshot.renderedSurface === true &&
      snapshot.rootChildren > 0 &&
      snapshot.bodyText.trim().length > 0
    ) {
      rendered = true;
      break;
    }
    await delay(250);
  }

  if (!rendered) {
    throw new Error("Denote did not populate the renderer root before the timeout.");
  }
  const exceptions = diagnostics.events.filter(
    (event) =>
      event.method === "Runtime.exceptionThrown" ||
      event.method === "Inspector.targetCrashed",
  );
  if (exceptions.length > 0) {
    throw new Error(`The renderer reported ${exceptions.length} uncaught exception(s).`);
  }
  console.log("Windows renderer smoke test passed.");
} catch (error) {
  diagnostics.error = error instanceof Error ? error.stack : String(error);
  throw error;
} finally {
  webSocket?.close();
  if (child.exitCode === null) {
    child.kill();
    await Promise.race([onceExit(child), delay(5000)]);
  }
  if (evidencePath) {
    await writeFile(evidencePath, `${JSON.stringify(diagnostics, null, 2)}\n`);
  }
  await rm(temporaryRoot, { recursive: true, force: true, maxRetries: 5 });
}

async function waitForTarget() {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (spawnError) {
      throw new Error(`Unable to launch Denote: ${spawnError.message}`);
    }
    if (child.exitCode !== null) {
      throw new Error(`Denote exited before WebView2 started with code ${child.exitCode}.`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (response.ok) {
        const targets = await response.json();
        const target = targets.find(
          (candidate) =>
            candidate.type === "page" &&
            typeof candidate.webSocketDebuggerUrl === "string" &&
            /(?:tauri:\/\/localhost|https?:\/\/tauri\.localhost)(?:\/|$)/.test(
              candidate.url,
            ),
        );
        if (target) {
          return target;
        }
      }
    } catch {
      // WebView2 has not opened the debugging endpoint yet.
    }
    await delay(250);
  }
  throw new Error("WebView2 did not expose a Denote page before the timeout.");
}

function createCdpClient(socket, events) {
  const pending = new Map();
  let sequence = 0;
  socket.addEventListener("message", (message) => {
    const payload = JSON.parse(String(message.data));
    if (payload.id) {
      const request = pending.get(payload.id);
      if (request) {
        clearTimeout(request.timeout);
        pending.delete(payload.id);
        request.resolve(payload);
      }
      return;
    }
    events.push(payload);
  });
  return {
    call(method, params = {}) {
      return new Promise((resolveCall, rejectCall) => {
        const id = ++sequence;
        const timeout = setTimeout(() => {
          pending.delete(id);
          rejectCall(new Error(`Timed out waiting for CDP method ${method}.`));
        }, 10000);
        pending.set(id, {
          resolve: (payload) => {
            if (payload.error) {
              rejectCall(
                new Error(`${method} failed: ${JSON.stringify(payload.error)}`),
              );
            } else {
              resolveCall(payload);
            }
          },
          timeout,
        });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
  };
}

function connectWebSocket(url) {
  return new Promise((resolveSocket, rejectSocket) => {
    const socket = new WebSocket(url);
    const timeout = setTimeout(() => {
      socket.close();
      rejectSocket(new Error("Timed out connecting to the WebView2 debugger."));
    }, 10000);
    socket.addEventListener(
      "open",
      () => {
        clearTimeout(timeout);
        resolveSocket(socket);
      },
      { once: true },
    );
    socket.addEventListener(
      "error",
      () => {
        clearTimeout(timeout);
        rejectSocket(new Error("Unable to connect to the WebView2 debugger."));
      },
      { once: true },
    );
  });
}

function onceExit(processHandle) {
  return new Promise((resolveExit) => {
    if (processHandle.exitCode !== null) {
      resolveExit();
      return;
    }
    processHandle.once("exit", resolveExit);
  });
}

function boundedAppend(current, next) {
  return `${current}${next}`.slice(-16000);
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}
