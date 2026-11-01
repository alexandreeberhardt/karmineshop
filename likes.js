import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

// Stockage des likes dans un fichier JSON.
// Pour chaque creation on garde l'ensemble des votants (identifiants hashes)
// et, pour limiter les abus, le nombre de likes par adresse IP (hashee aussi).
// Aucune donnee personnelle en clair n'est ecrite sur le disque.

const MAX_LIKES_PER_IP_PER_CREATION = 5;
const SAVE_DELAY_MS = 1000;

export class LikeStore {
  constructor(filePath, secret) {
    this.filePath = filePath;
    this.secret = secret;
    this.data = { creations: {} };
    this.saveTimer = null;
  }

  async load() {
    try {
      this.data = JSON.parse(await readFile(this.filePath, "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await mkdir(dirname(this.filePath), { recursive: true });
  }

  hash(value) {
    return createHash("sha256").update(this.secret).update(value).digest("base64url").slice(0, 22);
  }

  entry(creationId) {
    if (!this.data.creations[creationId]) {
      this.data.creations[creationId] = { voters: [], ips: {} };
    }
    return this.data.creations[creationId];
  }

  count(creationId) {
    return this.data.creations[creationId]?.voters.length || 0;
  }

  hasLiked(creationId, voterId) {
    const voters = this.data.creations[creationId]?.voters;
    return Boolean(voters && voterId && voters.includes(this.hash(voterId)));
  }

  like(creationId, voterId, ip) {
    const entry = this.entry(creationId);
    const voterHash = this.hash(voterId);
    if (entry.voters.includes(voterHash)) return { ok: true };

    const ipHash = this.hash(`ip:${ip}`);
    if ((entry.ips[ipHash] || 0) >= MAX_LIKES_PER_IP_PER_CREATION) {
      return { ok: false, reason: "ip-limit" };
    }

    entry.voters.push(voterHash);
    entry.ips[ipHash] = (entry.ips[ipHash] || 0) + 1;
    this.scheduleSave();
    return { ok: true };
  }

  unlike(creationId, voterId, ip) {
    const entry = this.data.creations[creationId];
    if (!entry) return;
    const index = entry.voters.indexOf(this.hash(voterId));
    if (index === -1) return;

    entry.voters.splice(index, 1);
    const ipHash = this.hash(`ip:${ip}`);
    if (entry.ips[ipHash] > 0) entry.ips[ipHash] -= 1;
    this.scheduleSave();
  }

  scheduleSave() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.save().catch((error) => console.error("Sauvegarde des likes impossible:", error));
    }, SAVE_DELAY_MS);
  }

  async save() {
    const tmpPath = `${this.filePath}.tmp`;
    await writeFile(tmpPath, JSON.stringify(this.data));
    await rename(tmpPath, this.filePath);
  }

  async flush() {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    await this.save();
  }
}

export function newVoterId() {
  return randomBytes(16).toString("base64url");
}

// Limiteur simple en memoire : N actions par fenetre glissante, par cle.
export class RateLimiter {
  constructor(limit, windowMs) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.hits = new Map();
  }

  allow(key) {
    const now = Date.now();
    const recent = (this.hits.get(key) || []).filter((time) => now - time < this.windowMs);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > 10000) this.prune(now);
    return true;
  }

  prune(now) {
    for (const [key, times] of this.hits) {
      if (times.every((time) => now - time >= this.windowMs)) this.hits.delete(key);
    }
  }
}
