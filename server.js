import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { randomBytes } from "node:crypto";
import { LikeStore, RateLimiter, newVoterId } from "./likes.js";

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = join(import.meta.dirname, "public");
const CREATIONS_FILE = join(import.meta.dirname, "data", "creations.json");
const DATA_DIR = process.env.DATA_DIR || join(import.meta.dirname, "var");
const TRUST_PROXY = process.env.TRUST_PROXY === "1";
const SECURE_COOKIE = process.env.NODE_ENV === "production";

const VOTER_COOKIE = "kc_voter";
const VOTER_COOKIE_MAX_AGE = 60 * 60 * 24 * 400;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

const creations = JSON.parse(await readFile(CREATIONS_FILE, "utf8"));
const creationIds = new Set(creations.map((creation) => creation.id));

const likes = new LikeStore(join(DATA_DIR, "likes.json"), await loadSecret());
await likes.load();

// 30 likes ou unlikes par minute et par IP, largement assez pour un humain.
const likeLimiter = new RateLimiter(30, 60 * 1000);

async function loadSecret() {
  if (process.env.LIKES_SECRET) return process.env.LIKES_SECRET;
  const secretFile = join(DATA_DIR, "secret");
  try {
    return (await readFile(secretFile, "utf8")).trim();
  } catch {
    const secret = randomBytes(32).toString("base64url");
    await mkdir(DATA_DIR, { recursive: true });
    await writeFile(secretFile, secret, { mode: 0o600 });
    return secret;
  }
}

function clientIp(req) {
  if (TRUST_PROXY && req.headers["x-real-ip"]) return String(req.headers["x-real-ip"]);
  return req.socket.remoteAddress || "unknown";
}

function readCookie(req, name) {
  for (const part of (req.headers.cookie || "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

function voterCookie(voterId) {
  const attributes = [
    `${VOTER_COOKIE}=${voterId}`,
    "Path=/",
    `Max-Age=${VOTER_COOKIE_MAX_AGE}`,
    "HttpOnly",
    "SameSite=Strict",
  ];
  if (SECURE_COOKIE) attributes.push("Secure");
  return attributes.join("; ");
}

function sendJson(res, status, body, headers = {}) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(JSON.stringify(body));
}

// Refuse les requetes d'ecriture venant d'un autre site (anti-CSRF).
function isSameOrigin(req) {
  const fetchSite = req.headers["sec-fetch-site"];
  if (fetchSite) return fetchSite === "same-origin";
  const origin = req.headers.origin;
  if (!origin) return false;
  return new URL(origin).host === req.headers.host;
}

function listCreations(req, res) {
  const voterId = readCookie(req, VOTER_COOKIE);
  const body = creations.map((creation) => ({
    ...creation,
    likes: likes.count(creation.id),
    liked: likes.hasLiked(creation.id, voterId),
  }));
  sendJson(res, 200, body);
}

function handleLike(req, res, creationId) {
  if (!creationIds.has(creationId)) {
    sendJson(res, 404, { error: "Création introuvable" });
    return;
  }
  if (!isSameOrigin(req)) {
    sendJson(res, 403, { error: "Origine refusée" });
    return;
  }

  const ip = clientIp(req);
  if (!likeLimiter.allow(ip)) {
    sendJson(res, 429, { error: "Trop de likes d'un coup, réessaie dans une minute" });
    return;
  }

  let voterId = readCookie(req, VOTER_COOKIE);
  const headers = {};
  if (!voterId || !/^[\w-]{22}$/.test(voterId)) {
    voterId = newVoterId();
    headers["Set-Cookie"] = voterCookie(voterId);
  }

  if (req.method === "DELETE") {
    likes.unlike(creationId, voterId, ip);
  } else {
    const result = likes.like(creationId, voterId, ip);
    if (!result.ok) {
      sendJson(res, 429, { error: "Limite de likes atteinte pour ce réseau" }, headers);
      return;
    }
  }

  sendJson(
    res,
    200,
    { id: creationId, likes: likes.count(creationId), liked: likes.hasLiked(creationId, voterId) },
    headers,
  );
}

async function serveStatic(req, res, pathname) {
  const filePath = normalize(join(PUBLIC_DIR, pathname === "/" ? "/index.html" : pathname));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end("Forbidden");
    return;
  }

  try {
    const content = await readFile(filePath);
    res.writeHead(200, { "Content-Type": MIME_TYPES[extname(filePath)] || "application/octet-stream" });
    res.end(content);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Page introuvable");
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const likeMatch = url.pathname.match(/^\/api\/creations\/([\w-]+)\/like$/);

  if (url.pathname === "/health") {
    sendJson(res, 200, { status: "ok" });
  } else if (url.pathname === "/api/creations" && req.method === "GET") {
    listCreations(req, res);
  } else if (likeMatch && (req.method === "POST" || req.method === "DELETE")) {
    handleLike(req, res, likeMatch[1]);
  } else if (url.pathname.startsWith("/api/")) {
    sendJson(res, 404, { error: "Route inconnue" });
  } else if (req.method === "GET" || req.method === "HEAD") {
    await serveStatic(req, res, url.pathname);
  } else {
    res.writeHead(405).end("Method Not Allowed");
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`karmineshop en ecoute sur le port ${PORT}`);
});

async function shutdown() {
  await likes.flush();
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
