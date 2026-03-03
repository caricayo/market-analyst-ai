import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
};

const __filename = fileURLToPath(import.meta.url);
const projectRoot = normalize(join(__filename, "..", ".."));
const distRoot = normalize(join(projectRoot, "dist"));
const port = Number(process.env.PORT || 4173);

if (!existsSync(distRoot)) {
  console.error(`dist directory not found: ${distRoot}`);
  process.exit(1);
}

const sendFile = (res, filePath) => {
  const ext = extname(filePath).toLowerCase();
  res.statusCode = 200;
  res.setHeader("Content-Type", MIME_TYPES[ext] || "application/octet-stream");
  createReadStream(filePath).pipe(res);
};

createServer((req, res) => {
  const requestPath = decodeURIComponent((req.url || "/").split("?")[0]);
  const normalizedPath =
    requestPath === "/" ? "index.html" : requestPath.replace(/^\/+/, "");
  const filePath = normalize(join(distRoot, normalizedPath));

  if (!filePath.startsWith(distRoot)) {
    res.statusCode = 403;
    res.end("Forbidden");
    return;
  }

  if (existsSync(filePath) && statSync(filePath).isFile()) {
    sendFile(res, filePath);
    return;
  }

  const fallbackPath = join(distRoot, "index.html");
  if (!existsSync(fallbackPath)) {
    res.statusCode = 404;
    res.end("Not Found");
    return;
  }

  sendFile(res, fallbackPath);
})
  .listen(port, "0.0.0.0", () => {
    console.log(`Serving dist on 0.0.0.0:${port}`);
  })
  .on("error", (error) => {
    console.error(error);
    process.exit(1);
  });
