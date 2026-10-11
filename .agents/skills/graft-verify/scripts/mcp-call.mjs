#!/usr/bin/env node
// Drive `graft mcp` over stdio the way an MCP client does, and print each
// response. Usage, from a Graft project directory:
//
//   node mcp-call.mjs tools/list
//   node mcp-call.mjs get_content '{"collection":"pages","slug":"home"}'
//
// A bare method name (contains "/") is sent as-is. Anything else is a tool
// name, sent as tools/call with the JSON arguments that follow it. Exits 1
// if any call returns a JSON-RPC error or a tool result with isError.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = process.env.GRAFT_REPO ?? path.resolve(here, "../../../..");
const cli = path.join(repo, "packages/cli/dist/index.js");

const args = process.argv.slice(2);
if (!args.length) {
  console.error("usage: mcp-call.mjs <method|tool> [jsonArgs] [<method|tool> [jsonArgs]]...");
  process.exit(2);
}
const calls = [];
for (let i = 0; i < args.length; i++) {
  const name = args[i];
  let params = {};
  if (args[i + 1]?.startsWith("{")) params = JSON.parse(args[++i]);
  calls.push(name.includes("/") ? { method: name, params } : { method: "tools/call", params: { name, arguments: params } });
}

const child = spawn(process.execPath, [cli, "mcp", ...(process.env.GRAFT_MCP_FLAGS?.split(" ").filter(Boolean) ?? [])], {
  stdio: ["pipe", "pipe", "inherit"],
});
const send = (msg) => child.stdin.write(JSON.stringify({ jsonrpc: "2.0", ...msg }) + "\n");
const pending = new Map();
let buf = "";
let failed = false;

child.stdout.on("data", (chunk) => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    const msg = JSON.parse(line);
    const waiting = pending.get(msg.id);
    if (waiting) {
      pending.delete(msg.id);
      waiting.resolve(msg);
    }
  }
});

const request = (id, method, params) =>
  new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    send({ id, method, params });
  });

// A server that dies before answering (a bad config, a startup error) fails
// every waiting call now, not at the 30s timeout.
child.on("exit", (code, signal) => {
  for (const { reject } of pending.values()) {
    reject(new Error(`graft mcp exited (${signal ?? `code ${code}`}) before replying`));
  }
  pending.clear();
});

const timer = setTimeout(() => {
  console.error("mcp-call: timed out after 30s");
  child.kill();
  process.exit(1);
}, 30_000);

try {
  await request(0, "initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "graft-verify", version: "0" },
  });
} catch (error) {
  console.error(`mcp-call: ${error.message}`);
  process.exit(1);
}
send({ method: "notifications/initialized" });

for (const [i, call] of calls.entries()) {
  let res;
  try {
    res = await request(i + 1, call.method, call.params);
  } catch (error) {
    console.error(`mcp-call: ${error.message}`);
    failed = true;
    break;
  }
  if (res.error || res.result?.isError) failed = true;
  const label = call.method === "tools/call" ? call.params.name : call.method;
  console.log(`--- ${label}`);
  if (call.method === "tools/list" && res.result) {
    console.log(res.result.tools.map((t) => t.name).join("\n"));
  } else if (res.result?.content) {
    for (const part of res.result.content) console.log(part.type === "text" ? part.text : JSON.stringify(part));
  } else {
    console.log(JSON.stringify(res.error ?? res.result, null, 2));
  }
}

clearTimeout(timer);
child.stdin.end();
child.kill();
// exitCode rather than exit(), so a large result piped to another program is
// written in full before the process ends.
process.exitCode = failed ? 1 : 0;
