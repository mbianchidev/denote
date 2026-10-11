const net = require("node:net");

function serve(inputStream, outputStream, dap) {
  let input = Buffer.alloc(0);
  inputStream.on("data", (chunk) => {
    input = Buffer.concat([input, chunk]);
    for (;;) {
      const boundary = input.indexOf("\r\n\r\n");
      if (boundary < 0) return;
      const length = Number(/Content-Length: (\d+)/i.exec(input.subarray(0, boundary).toString())[1]);
      if (input.length < boundary + 4 + length) return;
      const request = JSON.parse(input.subarray(boundary + 4, boundary + 4 + length));
      input = input.subarray(boundary + 4 + length);
      const method = dap ? request.command : request.method;
      if (dap ? request.type !== "request" : request.id === undefined || !method) continue;
      if (method === "synthetic/hang") continue;
      const result = method === "initialize"
        ? dap ? { supportsConfigurationDoneRequest: true } : { capabilities: { hoverProvider: true, textDocumentSync: 1 } }
        : dap ? request.arguments : request.params;
      const response = dap
        ? { seq: request.seq + 1000, type: "response", request_seq: request.seq, command: method, success: true, body: result }
        : { jsonrpc: "2.0", id: request.id, result };
      const body = Buffer.from(JSON.stringify(response));
      outputStream.write(`Content-Length: ${body.length}\r\n\r\n`);
      outputStream.write(body);
      process.stderr.write("Synthetic server handled a request.\n");
    }
  });
}

const tcpIndex = process.argv.indexOf("--tcp");
if (tcpIndex >= 0) {
  net.createServer((socket) => serve(socket, socket, true))
    .listen(Number(process.argv[tcpIndex + 1]), "127.0.0.1", () => {
      process.stdout.write("Synthetic loopback adapter ready.\n");
    });
} else {
  serve(process.stdin, process.stdout, false);
}
