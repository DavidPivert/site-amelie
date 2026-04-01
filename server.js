const http = require("http");
const path = require("path");
const fs = require("fs");
const fsp = require("fs/promises");
const { randomUUID } = require("crypto");
const { spawn } = require("child_process");
const QRCode = require("qrcode");

const ROOT_DIR = __dirname;
const STORAGE_DIR = path.join(ROOT_DIR, "qrcodes");
const STORAGE_FILE = path.join(STORAGE_DIR, "index.json");
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || "127.0.0.1";

const ROUTES = {
  "/": "index.html",
  "/qr-generator": "qr-generator.html",
  "/qr-generator.html": "qr-generator.html",
};

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8",
  ".webp": "image/webp",
};

async function ensureStorage() {
  await fsp.mkdir(STORAGE_DIR, { recursive: true });

  try {
    await fsp.access(STORAGE_FILE);
  } catch {
    await fsp.writeFile(STORAGE_FILE, "[]\n", "utf8");
  }
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function sendText(res, statusCode, message) {
  res.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(message);
}

function slugify(value) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function extractVideoId(urlString) {
  try {
    const url = new URL(urlString);
    const hostname = url.hostname.replace(/^www\./, "");

    if (hostname === "youtu.be") {
      return url.pathname.replace(/^\/+/, "").split("/")[0] || null;
    }

    if (hostname.endsWith("youtube.com")) {
      if (url.searchParams.get("v")) {
        return url.searchParams.get("v");
      }

      const parts = url.pathname.split("/").filter(Boolean);
      if (parts[0] === "shorts" || parts[0] === "embed") {
        return parts[1] || null;
      }
    }
  } catch {
    return null;
  }

  return null;
}

function isYoutubeUrl(urlString) {
  try {
    const url = new URL(urlString);
    const hostname = url.hostname.replace(/^www\./, "");
    return (
      hostname === "youtu.be" ||
      hostname === "youtube.com" ||
      hostname === "m.youtube.com" ||
      hostname === "music.youtube.com" ||
      hostname.endsWith(".youtube.com")
    );
  } catch {
    return false;
  }
}

function timestampToken() {
  return new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
}

function buildSlug(name, url) {
  const videoId = extractVideoId(url);
  const base = slugify(name || `youtube-${videoId || "video"}`) || "youtube-video";
  return `${base}-${timestampToken()}-${randomUUID().slice(0, 8)}`;
}

async function readEntries() {
  await ensureStorage();
  const raw = await fsp.readFile(STORAGE_FILE, "utf8");

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeEntries(entries) {
  await fsp.writeFile(STORAGE_FILE, `${JSON.stringify(entries, null, 2)}\n`, "utf8");
}

async function parseRequestBody(req) {
  const chunks = [];
  let size = 0;

  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1_000_000) {
      throw new Error("Le corps de la requête est trop volumineux.");
    }
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  return JSON.parse(raw);
}

async function createQrFiles(url, slug) {
  const pngFileName = `${slug}.png`;
  const svgFileName = `${slug}.svg`;
  const pngPath = path.join(STORAGE_DIR, pngFileName);
  const svgPath = path.join(STORAGE_DIR, svgFileName);

  await QRCode.toFile(pngPath, url, {
    type: "png",
    width: 1080,
    margin: 2,
    color: {
      dark: "#1C3D5A",
      light: "#FFFFFFFF",
    },
  });

  const svgString = await QRCode.toString(url, {
    type: "svg",
    margin: 1,
    color: {
      dark: "#1C3D5A",
      light: "#FFFFFFFF",
    },
  });

  await fsp.writeFile(svgPath, svgString, "utf8");

  return {
    png: `/qrcodes/${pngFileName}`,
    svg: `/qrcodes/${svgFileName}`,
  };
}

async function handleCreateQr(req, res) {
  let payload;

  try {
    payload = await parseRequestBody(req);
  } catch {
    sendJson(res, 400, { error: "Le format JSON envoyé est invalide." });
    return;
  }

  const url = typeof payload.url === "string" ? payload.url.trim() : "";
  const name = typeof payload.name === "string" ? payload.name.trim() : "";

  if (!url) {
    sendJson(res, 400, { error: "Merci de coller une URL YouTube." });
    return;
  }

  if (!isYoutubeUrl(url)) {
    sendJson(res, 400, { error: "L'URL doit pointer vers une vidéo YouTube valide." });
    return;
  }

  const slug = buildSlug(name, url);

  try {
    const files = await createQrFiles(url, slug);
    const createdAt = new Date().toISOString();
    const entry = {
      id: randomUUID(),
      url,
      name,
      createdAt,
      slug,
      files,
    };

    const entries = await readEntries();
    entries.unshift(entry);
    await writeEntries(entries);

    sendJson(res, 201, { entry });
  } catch (error) {
    console.error("QR generation failed:", error);
    sendJson(res, 500, { error: "La génération du QR code a échoué en local." });
  }
}

async function handleListQrs(res) {
  try {
    const entries = await readEntries();
    sendJson(res, 200, { entries });
  } catch (error) {
    console.error("Reading QR entries failed:", error);
    sendJson(res, 500, { error: "Impossible de lire les QR déjà générés." });
  }
}

async function handleZipExport(res) {
  await ensureStorage();

  const archiveName = `qrcodes-${timestampToken()}.zip`;
  const zipProcess = spawn("zip", ["-r", "-", "qrcodes", "-x", "qrcodes/*.zip"], {
    cwd: ROOT_DIR,
  });

  let stderr = "";

  zipProcess.stderr.on("data", (chunk) => {
    stderr += chunk.toString("utf8");
  });

  zipProcess.on("error", (error) => {
    console.error("Zip export failed:", error);
    if (!res.headersSent) {
      sendJson(res, 500, { error: "La création du ZIP a échoué." });
    } else {
      res.destroy(error);
    }
  });

  zipProcess.on("close", (code) => {
    if (code !== 0 && !res.writableEnded) {
      console.error("Zip exited with code", code, stderr);
      res.destroy(new Error(stderr || `zip exited with code ${code}`));
    }
  });

  res.writeHead(200, {
    "Content-Type": "application/zip",
    "Content-Disposition": `attachment; filename="${archiveName}"`,
    "Cache-Control": "no-store",
  });

  zipProcess.stdout.pipe(res);
}

function resolveFilePath(requestPath) {
  const routePath = ROUTES[requestPath] ? `/${ROUTES[requestPath]}` : requestPath;
  const safePath = path.normalize(routePath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(ROOT_DIR, safePath);

  if (!filePath.startsWith(ROOT_DIR)) {
    return null;
  }

  return filePath;
}

function serveFile(requestPath, res) {
  const filePath = resolveFilePath(requestPath);

  if (!filePath) {
    sendText(res, 403, "Accès interdit.");
    return;
  }

  fs.stat(filePath, (error, stats) => {
    if (error || !stats.isFile()) {
      sendText(res, 404, "Fichier introuvable.");
      return;
    }

    const extension = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[extension] || "application/octet-stream";

    res.writeHead(200, { "Content-Type": contentType });
    fs.createReadStream(filePath).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = decodeURIComponent(requestUrl.pathname);

  if (req.method === "GET" && pathname === "/api/qrcodes") {
    await handleListQrs(res);
    return;
  }

  if (req.method === "POST" && pathname === "/api/qrcodes") {
    await handleCreateQr(req, res);
    return;
  }

  if (req.method === "GET" && pathname === "/api/export") {
    await handleZipExport(res);
    return;
  }

  if (req.method === "GET" && pathname === "/api/health") {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method !== "GET") {
    sendText(res, 405, "Méthode non autorisée.");
    return;
  }

  serveFile(pathname, res);
});

ensureStorage()
  .then(() => {
    server.listen(PORT, HOST, () => {
      console.log(`Amelie QR Studio disponible sur http://${HOST}:${PORT}`);
    });
  })
  .catch((error) => {
    console.error("Server startup failed:", error);
    process.exit(1);
  });
