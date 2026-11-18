import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";

const root = process.cwd();
const port = Number(process.env.PORT) || 5173;
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

createServer(async (req, res) => {
  try {
    const decoded = decodeURIComponent(new URL(req.url || "/", "http://localhost").pathname);
    const path = decoded === "/" ? "/index.html" : decoded;
    if (!/^\/(?:index\.html|sw\.js|manifest\.webmanifest|(?:assets|css|js)\/[a-z0-9_./-]+)$/i.test(path)
      || path.split("/").some((segment) => segment.startsWith("."))) {
      res.writeHead(404).end("Not found");
      return;
    }
    const filePath = resolve(root, "." + path);
    if (!filePath.startsWith(root + sep)) {
      res.writeHead(404).end("Not found");
      return;
    }
    const data = await readFile(filePath);
    res.writeHead(200, {
      "Content-Type": types[extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    res.end(data);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found");
  }
}).listen(port, "127.0.0.1", () => console.log(`CharMsg dev server: http://127.0.0.1:${port}`));
