import { createServer } from "node:http";
import { mkdirSync } from "node:fs";

const host = process.env.HOST || "0.0.0.0";
const port = Number.parseInt(process.env.PORT || "8080", 10);
const volumePath = process.env.RAILWAY_VOLUME_MOUNT_PATH || "";

if (volumePath) {
  try {
    mkdirSync(volumePath, { recursive: true });
  } catch {
    // The backend can still run without touching the volume.
  }
}

const startedAt = new Date().toISOString();

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

const server = createServer((request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);

  if (url.pathname === "/health") {
    return sendJson(response, 200, {
      ok: true,
      service: "backend",
      startedAt,
      hasDatabaseUrl: Boolean(process.env.DATABASE_URL),
      hasCoinbaseKey: Boolean(process.env.COINBASE_API_KEY),
      hasDiscordWebhook: Boolean(process.env.DISCORD_WEBHOOK_URL),
      volumePath: volumePath || null,
    });
  }

  if (url.pathname === "/") {
    return sendJson(response, 200, {
      service: "backend",
      status: "idle",
      message: "Dedicated backend service is online.",
    });
  }

  return sendJson(response, 404, {
    error: "not_found",
    path: url.pathname,
  });
});

server.listen(port, host, () => {
  console.log(`backend listening on http://${host}:${port}`);
});

function shutdown(signal) {
  console.log(`backend shutting down after ${signal}`);
  server.close(() => {
    process.exit(0);
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
