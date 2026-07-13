const path = require("path");
const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const express = require("express");
const multer = require("multer");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, "data");

// ---- File uploads (images / videos) ----
const UPLOAD_DIR = process.env.UPLOAD_DIR ? path.resolve(process.env.UPLOAD_DIR) : path.join(__dirname, "public", "uploads");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const raw = (file.originalname.split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "");
    const ext = raw.slice(0, 8);
    const id = crypto.randomBytes(12).toString("hex");
    cb(null, id + (ext ? "." + ext : ""));
  },
});
const DOC_EXT = /\.(pdf|docx?|xlsx?|pptx?|txt|md|csv|zip|rar|7z|json|log)$/i;
const upload = multer({
  storage,
  limits: { fileSize: 120 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/^(image|video)\//.test(file.mimetype)) return cb(null, true);
    if (DOC_EXT.test(file.originalname)) return cb(null, true);
    cb(new Error("Unsupported file type."));
  },
});
app.use("/uploads", express.static(UPLOAD_DIR));

// ---- Config ----
let fileConfig = {};
try { fileConfig = JSON.parse(fs.readFileSync(path.join(__dirname, "config.json"), "utf8")); } catch {}
const KLIPY_KEY = process.env.KLIPY_API_KEY || fileConfig.klipyKey || "";

// ---- Stores ----
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const USERS_FILE = path.join(DATA_DIR, "users.json");
const SERVERS_FILE = path.join(DATA_DIR, "servers.json");
const HISTORY_FILE = path.join(DATA_DIR, "history.json");

let users = {};
try { users = JSON.parse(fs.readFileSync(USERS_FILE, "utf8")); } catch {}
let servers = {};
try { servers = JSON.parse(fs.readFileSync(SERVERS_FILE, "utf8")); } catch {}
let history = new Map();
try { const h = JSON.parse(fs.readFileSync(HISTORY_FILE, "utf8")); if (h && typeof h === "object") history = new Map(Object.entries(h)); } catch {}

// Migrate user records to new shape
for (const k in users) {
  const u = users[k];
  if (!Array.isArray(u.friends)) u.friends = [];
  if (!Array.isArray(u.incoming)) u.incoming = [];
  if (!Array.isArray(u.outgoing)) u.outgoing = [];
  if (!Array.isArray(u.servers)) u.servers = [];
  if (!Array.isArray(u.blocked)) u.blocked = [];
  if (!u.presence) u.presence = "online";
  if (typeof u.status !== "string") u.status = "";
  if (u.activity !== null && typeof u.activity !== "object") u.activity = null;
  if (typeof u.lastSeen !== "number") u.lastSeen = 0;
  if (u.pronouns === undefined) u.pronouns = "";
  if (u.banner === undefined) u.banner = "";
  if (!u.createdAt) u.createdAt = Date.now();
  if (typeof u.mute !== "boolean") u.mute = false;
  if (typeof u.deafen !== "boolean") u.deafen = false;
  if (typeof u.voice !== "object" || !u.voice) u.voice = {};
  if (typeof u.notif !== "object" || !u.notif) u.notif = {};
  if (!Array.isArray(u.favorites)) u.favorites = [];
  if (typeof u.notes !== "object" || !u.notes) u.notes = {};
  if (typeof u.friendNick !== "object" || !u.friendNick) u.friendNick = {};
  if (!Array.isArray(u.bookmarks)) u.bookmarks = [];
  if (!Array.isArray(u.badges)) u.badges = [];
  if (typeof u.flags !== "number") u.flags = 0;
  if (typeof u.dmMuted !== "object" || !u.dmMuted) u.dmMuted = {};
  if (typeof u.statusEmoji !== "string") u.statusEmoji = "";
}
for (const id in servers) {
  const s = servers[id];
  if (typeof s.nicknames !== "object" || !s.nicknames) s.nicknames = {};
  if (!Array.isArray(s.roles)) s.roles = [];
  if (!Array.isArray(s.emojis)) s.emojis = [];
  if (!Array.isArray(s.bans)) s.bans = [];
  if (!Array.isArray(s.audit)) s.audit = [];
  s.channels.forEach((c) => { if (typeof c.slow !== "number") c.slow = 0; if (typeof c.topic !== "string") c.topic = ""; });
  if (!Array.isArray(s.stickers)) s.stickers = [];
}
function saveUsers() { fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2)); }
function saveServers() { fs.writeFileSync(SERVERS_FILE, JSON.stringify(servers, null, 2)); }
let saveHistoryTimer = null;
function scheduleSaveHistory() { if (saveHistoryTimer) return; saveHistoryTimer = setTimeout(() => { saveHistoryTimer = null; try { const obj = {}; for (const [k, v] of history) obj[k] = v; fs.writeFileSync(HISTORY_FILE, JSON.stringify(obj)); } catch (e) {} }, 800); }
function flushHistory() { try { const obj = {}; for (const [k, v] of history) obj[k] = v; fs.writeFileSync(HISTORY_FILE, JSON.stringify(obj)); } catch (e) {} }
process.on("SIGINT", () => { flushHistory(); process.exit(0); });
process.on("SIGTERM", () => { flushHistory(); process.exit(0); });

const SERVER_COLORS = ["#5865f2", "#e15e54", "#ee8a4a", "#bfa54e", "#5fb05f", "#4aa3a8", "#5a8fd6", "#8e6cc0", "#d463a4", "#6d8a96"];
function colorFor(name) { let h = 0; for (let i = 0; i < (name || "?").length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0; return SERVER_COLORS[h % SERVER_COLORS.length]; }

function norm(u) { return String(u || "").trim().toLowerCase(); }
function validUser(u) { return /^[a-zA-Z0-9_]{3,20}$/.test(u); }

function hashPassword(pw, salt) {
  salt = salt || crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(pw, salt, 64).toString("hex");
  return { salt, hash };
}
function verifyPassword(pw, salt, hash) {
  const h = crypto.scryptSync(pw, salt, 64).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(h, "hex"), Buffer.from(hash, "hex"));
}

function effectivePresence(uname) {
  const u = users[uname];
  if (!u) return "offline";
  return online.has(uname) ? (u.presence || "online") : "offline";
}
function publicProfile(uname) {
  const u = users[uname];
  if (!u) return null;
  return {
    username: u.username,
    displayName: u.displayName,
    pic: u.pic || "",
    bio: u.bio || "",
    pronouns: u.pronouns || "",
    banner: u.banner || "",
    badges: u.badges || [],
    createdAt: u.createdAt || 0,
    mute: !!u.mute,
    deafen: !!u.deafen,
    online: online.has(uname),
    presence: effectivePresence(uname),
    status: u.status || "",
    statusEmoji: u.statusEmoji || "",
    activity: u.activity || null,
    lastSeen: u.lastSeen || 0,
  };
}
function friendView(uname) { return publicProfile(uname); }
function memberView(uname) {
  const p = publicProfile(uname); if (!p) return null;
  const sid = serverOfMember(uname);
  const s = sid ? servers[sid] : null;
  if (s) {
    p.nickname = ((s.nicknames || {})[uname]) || "";
    const r = colorRoleFor(s, uname);
    p.roleColor = r ? r.color : "";
    p.roles = (s.roles || []).filter((x) => (x.members || []).includes(uname)).map((x) => ({ id: x.id, name: x.name, color: x.color }));
  }
  return p;
}
function serverOfMember(uname) { for (const id in servers) if (servers[id].members.includes(uname)) return id; return null; }
function colorRoleFor(s, username) {
  let best = null;
  (s.roles || []).forEach((r) => { if (r.members.includes(username) && r.color && (!best || (r.pos || 0) > (best.pos || 0))) best = r; });
  return best;
}
function permsFor(s, username) {
  if (s.owner === username) return 0xffff;
  let p = 0; (s.roles || []).forEach((r) => { if (r.members.includes(username)) p |= (r.permissions || 0); }); return p;
}
function serverView(id) {
  const s = servers[id];
  if (!s) return null;
  return {
    id: s.id, name: s.name, owner: s.owner, iconColor: s.iconColor,
    roles: (s.roles || []).map((r) => ({ id: r.id, name: r.name, color: r.color || "", permissions: r.permissions || 0, members: r.members || [], pos: r.pos || 0 })),
    emojis: s.emojis || [],
    stickers: s.stickers || [],
    nicknames: s.nicknames || {},
    bans: s.bans || [],
    audit: (s.audit || []).slice(-50),
    channels: s.channels.map((c) => ({ id: c.id, name: c.name, topic: c.topic || "", slow: c.slow || 0 })),
    members: s.members.map(memberView).filter(Boolean),
  };
}
function serverOfChannel(channelId) {
  for (const id in servers) if (servers[id].channels.some((c) => c.id === channelId)) return id;
  return null;
}

// ---- Sessions / presence / unread ----
const sessions = new Map();
function newSession(uname) { const t = crypto.randomBytes(24).toString("hex"); sessions.set(t, uname); return t; }
const online = new Set();
const unread = new Map(); // username -> { roomKey: count }

function roomMembers(room) {
  if (room.startsWith("dm:")) return room.slice(3).split("|");
  if (room.startsWith("chan:")) { const sid = serverOfChannel(room.slice(5)); return sid ? servers[sid].members : []; }
  return [];
}
function incUnread(room, sender, msg) {
  let serverId = null;
  if (room.startsWith("chan:")) serverId = serverOfChannel(room.slice(5));
  const text = (msg && (msg.text || "")) || "";
  for (const u of roomMembers(room)) {
    if (u === sender) continue;
    const mode = serverId && users[u] && users[u].notif ? users[u].notif[serverId] : null;
    if (mode === "none") continue;
    if (mode === "mentions" && !new RegExp("@(everyone|here|" + u + ")\\b").test(text)) continue;
    if (!unread.has(u)) unread.set(u, {});
    const m = unread.get(u); m[room] = (m[room] || 0) + 1;
    emitUnread(u);
  }
}
function resetUnread(user, room) { const m = unread.get(user); if (m && room in m) { delete m[room]; emitUnread(user); } }
  function emitUnread(user) { if (users[user]) io.to("user:" + user).emit("unread", unread.get(user) || {}); }
  function emitReadReceipts(room, byUser) {
    const ids = roomMsgs(room).filter((m) => m.user && m.user !== byUser && !m.deleted).map((m) => m.id);
    if (ids.length) io.to(room).emit("read", { user: byUser, ids });
  }

// ---- Push helpers ----
function emitFriendsTo(uname) { if (!users[uname]) return; io.to("user:" + uname).emit("friends", (users[uname].friends || []).map(friendView).filter(Boolean)); }
function emitRequestsTo(uname) {
  if (!users[uname]) return;
  io.to("user:" + uname).emit("requests", {
    incoming: (users[uname].incoming || []).map(publicProfile).filter(Boolean),
    outgoing: (users[uname].outgoing || []).map(publicProfile).filter(Boolean),
  });
}
function emitServersTo(uname) { if (!users[uname]) return; io.to("user:" + uname).emit("servers", (users[uname].servers || []).map(serverView).filter(Boolean)); }
function emitStateTo(uname) { emitFriendsTo(uname); emitRequestsTo(uname); emitServersTo(uname); emitUnread(uname); }
function notifyPresence(uname) {
  const seen = new Set();
  const push = (t) => { if (t && t !== uname && !seen.has(t)) { seen.add(t); emitFriendsTo(t); emitServersTo(t); } };
  (users[uname].friends || []).forEach(push);
  (users[uname].incoming || []).forEach(push);
  (users[uname].outgoing || []).forEach(push);
  (users[uname].servers || []).forEach((sid) => (servers[sid] ? servers[sid].members : []).forEach(push));
}

// ---- Rate limiting ----
const rateBuckets = new Map();
function getIp(req) { return (req.headers["x-forwarded-for"] || req.connection.remoteAddress || "").toString().split(",")[0].trim(); }
function rateLimit(key, max, windowMs) {
  const now = Date.now();
  const arr = (rateBuckets.get(key) || []).filter((t) => now - t < windowMs);
  if (arr.length >= max) { rateBuckets.set(key, arr); return false; }
  arr.push(now); rateBuckets.set(key, arr); return true;
}

// ---- HTTP API ----
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
app.get("/healthz", (req, res) => res.json({ ok: true }));
app.get("/api/version", (req, res) => {
  let v = "";
  try { v = require("./package.json").version; } catch {}
  res.json({ version: v, name: "Buddy" });
});

// ---- TURN relay via Metered.ca (dynamic, short-lived credentials) ----
// Priority: env METERED_API_KEY -> config.meteredKey -> render.yaml etc.
const METERED_KEY = process.env.METERED_API_KEY || fileConfig.meteredKey || "";
const METERED_SUBDOMAIN = process.env.METERED_SUBDOMAIN || fileConfig.meteredSubdomain || "buddy-chat";
const METERED_TURN_URL = "https://" + METERED_SUBDOMAIN + ".metered.live/api/v1/turn/credentials";
let turnCache = { at: 0, servers: [] };
async function getTurnServers() {
  if (!METERED_KEY) return [];
  if (turnCache.servers.length && Date.now() - turnCache.at < 60 * 60 * 1000) return turnCache.servers;
  try {
    const r = await fetch(METERED_TURN_URL + "?apiKey=" + encodeURIComponent(METERED_KEY));
    if (!r.ok) throw new Error("turn " + r.status);
    const data = await r.json();
    const arr = Array.isArray(data) ? data : (data && data.iceServers) || [];
    turnCache = { at: Date.now(), servers: arr };
    return arr;
  } catch (e) { console.error("TURN fetch failed:", e.message); return turnCache.servers || []; }
}
app.get("/api/turn", async (req, res) => { res.json({ iceServers: await getTurnServers().catch(() => []) }); });
app.get("/api/config", async (req, res) => {
  const ice = [{ urls: "stun:stun.l.google.com:19302" }, { urls: "stun:stun1.l.google.com:19302" }];
  // Self-hosted / free TURN relay. Env vars win; otherwise read from config.json
  // so you can run your own coturn server instead of paying for a hosted one.
  const turnUrl = process.env.TURN_URL || (fileConfig.turn ? (Array.isArray(fileConfig.turn) ? fileConfig.turn.join(",") : fileConfig.turn) : "");
  const turnUser = process.env.TURN_USER || fileConfig.turnUser || "";
  const turnPass = process.env.TURN_PASS || fileConfig.turnPass || "";
  if (turnUrl) ice.push({ urls: turnUrl.split(",").map((s) => s.trim()).filter(Boolean), username: turnUser, credential: turnPass });
  try { (await getTurnServers()).forEach((s) => ice.push(s)); } catch {}
  res.json({ iceServers: ice });
});

// ---- Desktop app download ----
// If DOWNLOAD_URL is set and GH_TOKEN is present, proxy the file through this
// server using an authenticated GitHub request so large release-asset downloads
// aren't throttled (GitHub throttles anonymous ones). Without GH_TOKEN it just
// redirects. If no DOWNLOAD_URL, serve a locally built installer from dist/ or
// public/download/.
app.get("/download", async (req, res) => {
  if (process.env.DOWNLOAD_URL) {
    if (process.env.GH_TOKEN) {
      try {
        const r = await fetch(process.env.DOWNLOAD_URL, { headers: { Authorization: "Bearer " + process.env.GH_TOKEN } });
        if (!r.ok) throw new Error("upstream " + r.status);
        const fn = decodeURIComponent((process.env.DOWNLOAD_URL.split("/").pop() || "Buddy-Setup.exe").split("?")[0]);
        res.setHeader("Content-Disposition", 'attachment; filename="' + fn + '"');
        res.setHeader("Content-Type", r.headers.get("content-type") || "application/octet-stream");
        const len = r.headers.get("content-length");
        if (len) res.setHeader("Content-Length", len);
        const reader = r.body.getReader();
        const pump = () => reader.read().then(({ done, value }) => {
          if (done) return res.end();
          if (res.write(Buffer.from(value))) pump();
          else res.once("drain", pump);
        });
        res.on("close", () => { try { reader.cancel(); } catch (e) {} });
        return pump();
      } catch (e) {
        return res.redirect(process.env.DOWNLOAD_URL);
      }
    }
    return res.redirect(process.env.DOWNLOAD_URL);
  }
  const candidates = [];
  for (const dir of [path.join(__dirname, "dist"), path.join(__dirname, "public", "download")]) {
    try {
      for (const f of fs.readdirSync(dir)) if (/\.exe$/i.test(f)) candidates.push(path.join(dir, f));
    } catch {}
  }
  if (!candidates.length) return res.status(404).send("No desktop installer available.");
  res.download(candidates[0], path.basename(candidates[0]));
});

  app.post("/api/upload", (req, res) => {
    const uname = requireUser(req, res); if (!uname) return;
    if (!rateLimit("upload:" + uname, 30, 60000)) return res.status(429).json({ error: "Slow down." });
    upload.single("file")(req, res, (err) => {
      if (err) return res.status(400).json({ error: err.message });
      if (!req.file) return res.status(400).json({ error: "No file received." });
      const ext = String(req.file.originalname || "");
      const kind = req.file.mimetype.startsWith("video") ? "video" : (DOC_EXT.test(ext) ? "file" : "image");
      res.json({ ok: true, url: "/uploads/" + req.file.filename, name: String(req.file.originalname || "file").slice(0, 200), kind, size: req.file.size });
    });
  });

function authToken(req) { const h = req.headers["authorization"] || ""; const t = h.startsWith("Bearer ") ? h.slice(7) : (req.body && req.body.token); return t; }
function userFromToken(t) { return t ? sessions.get(t) : null; }
function requireUser(req, res) { const uname = userFromToken(authToken(req)); if (!uname || !users[uname]) { res.status(401).json({ error: "Not authenticated." }); return null; } return uname; }
function findUser(login) { const u = norm(login); if (users[u]) return u; const lower = String(login || "").toLowerCase(); for (const k in users) if (users[k].email && users[k].email.toLowerCase() === lower) return k; return null; }

app.post("/api/signup", (req, res) => {
  if (!rateLimit("signup:" + getIp(req), 5, 60000)) return res.status(429).json({ error: "Too many signups. Try later." });
  const { username, password, displayName, email } = req.body || {};
  if (!validUser(username)) return res.status(400).json({ error: "Username must be 3-20 chars (letters, numbers, _)." });
  if (!password || password.length < 4) return res.status(400).json({ error: "Password must be at least 4 characters." });
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: "Enter a valid email." });
  const uname = norm(username);
  if (users[uname]) return res.status(409).json({ error: "That username is taken." });
  if (email) { const lower = email.toLowerCase(); for (const k in users) if (users[k].email && users[k].email.toLowerCase() === lower) return res.status(409).json({ error: "That email is already used." }); }
  const { salt, hash } = hashPassword(password);
  users[uname] = { username, displayName: (displayName && displayName.trim()) || username, email: email ? email.toLowerCase() : "", salt, hash, pic: "", bio: "", friends: [], incoming: [], outgoing: [], servers: [], blocked: [], presence: "online", status: "" };
  saveUsers();
  const token = newSession(uname);
  res.json({ ok: true, token, profile: publicProfile(uname) });
});

app.post("/api/login", (req, res) => {
  const { username, password } = req.body || {};
  const uname = findUser(username);
  const u = uname && users[uname];
  if (!u || !verifyPassword(password || "", u.salt, u.hash)) return res.status(401).json({ error: "Wrong username/email or password." });
  const token = newSession(uname);
  res.json({ ok: true, token, profile: publicProfile(uname) });
});

app.get("/api/me", (req, res) => {
  const uname = requireUser(req, res); if (!uname) return;
  res.json({
    profile: publicProfile(uname),
    friends: (users[uname].friends || []).map(friendView).filter(Boolean),
    requests: { incoming: (users[uname].incoming || []).map(publicProfile).filter(Boolean), outgoing: (users[uname].outgoing || []).map(publicProfile).filter(Boolean) },
    servers: (users[uname].servers || []).map(serverView).filter(Boolean),
    blocked: users[uname].blocked || [],
  });
});

app.post("/api/profile", (req, res) => {
  const uname = requireUser(req, res); if (!uname) return;
  const u = users[uname];
  const { displayName, pic, bio, pronouns, banner, voice, oldPassword, newPassword, presence, status } = req.body || {};
  if (typeof displayName === "string" && displayName.trim()) u.displayName = displayName.trim().slice(0, 32);
  if (typeof pic === "string") u.pic = pic.slice(0, 200000);
  if (typeof bio === "string") u.bio = bio.slice(0, 200);
  if (typeof pronouns === "string") u.pronouns = pronouns.slice(0, 40);
  if (typeof banner === "string") u.banner = banner.slice(0, 200000);
  if (voice && typeof voice === "object") u.voice = { echo: !!voice.echo, noise: !!voice.noise, agc: !!voice.agc, ptt: !!voice.ptt };
  if (typeof presence === "string" && ["online", "idle", "dnd", "invisible"].includes(presence)) u.presence = presence;
  if (typeof status === "string") u.status = status.slice(0, 64);
  if (newPassword) {
    if (!oldPassword || !verifyPassword(oldPassword, u.salt, u.hash)) return res.status(400).json({ error: "Current password is incorrect." });
    if (newPassword.length < 4) return res.status(400).json({ error: "New password too short." });
    const h = hashPassword(newPassword); u.salt = h.salt; u.hash = h.hash;
  }
  saveUsers();
  emitFriendsTo(uname); emitServersTo(uname);
  res.json({ ok: true, profile: publicProfile(uname) });
});

// ---- Presence / rich status ----
const ACTIVITY_TYPES = ["playing", "listening", "watching", "competing", "custom"];
app.post("/api/presence", (req, res) => {
  const uname = requireUser(req, res); if (!uname) return;
  const u = users[uname];
  const { presence, status, activity } = req.body || {};
  if (typeof presence === "string" && ["online", "idle", "dnd"].includes(presence)) u.presence = presence;
  if (typeof status === "string") u.status = status.slice(0, 64);
  if (typeof req.body.statusEmoji === "string") u.statusEmoji = (req.body.statusEmoji || "").slice(0, 8);
  else if (req.body.statusEmoji === null) u.statusEmoji = "";
  if (activity && typeof activity === "object" && activity !== null) {
    if (ACTIVITY_TYPES.includes(activity.type)) {
      const name = String(activity.name || "").slice(0, 64).trim();
      const details = String(activity.details || "").slice(0, 64).trim();
      u.activity = name ? { type: activity.type, name, details: details || undefined } : null;
    } else u.activity = null;
  } else if (activity === null || activity === undefined) {
    u.activity = null;
  }
  saveUsers();
  notifyPresence(uname);
  res.json({ ok: true, profile: publicProfile(uname) });
});

// ---- Friend requests ----
app.post("/api/friends/request", (req, res) => {
  const uname = requireUser(req, res); if (!uname) return;
  const friend = norm(req.body && req.body.friend);
  if (!validUser(friend)) return res.status(400).json({ error: "Invalid username." });
  if (friend === uname) return res.status(400).json({ error: "You can't add yourself." });
  if (!users[friend]) return res.status(404).json({ error: "No user with that username." });
  const me = users[uname], them = users[friend];
  if (me.friends.includes(friend)) return res.status(409).json({ error: "You're already friends." });
  if (me.outgoing.includes(friend)) return res.status(409).json({ error: "Friend request already sent." });
  if (me.incoming.includes(friend)) return res.status(409).json({ error: "They already sent you a request." });
  if ((me.blocked || []).includes(friend) || (them.blocked || []).includes(uname)) return res.status(403).json({ error: "You can't add this user." });
  me.outgoing.push(friend);
  if (!them.incoming.includes(uname)) them.incoming.push(uname);
  saveUsers();
  emitRequestsTo(uname); emitRequestsTo(friend);
  res.json({ ok: true });
});
app.post("/api/friends/accept", (req, res) => {
  const uname = requireUser(req, res); if (!uname) return;
  const friend = norm(req.body && req.body.friend);
  const me = users[uname], them = users[friend];
  if (!me || !them) return res.status(404).json({ error: "User not found." });
  if (!me.incoming.includes(friend)) return res.status(400).json({ error: "No pending request from that user." });
  me.incoming = me.incoming.filter((x) => x !== friend);
  them.outgoing = (them.outgoing || []).filter((x) => x !== uname);
  if (!me.friends.includes(friend)) me.friends.push(friend);
  if (!them.friends.includes(uname)) them.friends.push(uname);
  saveUsers();
  emitStateTo(uname); emitStateTo(friend);
  res.json({ ok: true, friends: me.friends.map(friendView).filter(Boolean) });
});
app.post("/api/friends/decline", (req, res) => {
  const uname = requireUser(req, res); if (!uname) return;
  const friend = norm(req.body && req.body.friend);
  const me = users[uname], them = users[friend];
  if (me) me.incoming = (me.incoming || []).filter((x) => x !== friend);
  if (them) them.outgoing = (them.outgoing || []).filter((x) => x !== uname);
  saveUsers();
  emitRequestsTo(uname); if (them) emitRequestsTo(friend);
  res.json({ ok: true });
});
app.post("/api/friends/remove", (req, res) => {
  const uname = requireUser(req, res); if (!uname) return;
  const friend = norm(req.body && req.body.friend);
  const me = users[uname], them = users[friend];
  if (me) { me.friends = (me.friends || []).filter((f) => f !== friend); me.incoming = (me.incoming || []).filter((f) => f !== friend); me.outgoing = (me.outgoing || []).filter((f) => f !== friend); }
  if (them) { them.friends = (them.friends || []).filter((f) => f !== uname); them.incoming = (them.incoming || []).filter((f) => f !== uname); them.outgoing = (them.outgoing || []).filter((f) => f !== uname); }
  saveUsers();
  emitStateTo(uname); if (them) emitStateTo(friend);
  res.json({ ok: true });
});

// ---- Block / unblock ----
app.post("/api/friends/block", (req, res) => {
  const uname = requireUser(req, res); if (!uname) return;
  const target = norm(req.body && req.body.target);
  if (!validUser(target) || !users[target]) return res.status(400).json({ error: "Invalid user." });
  if (target === uname) return res.status(400).json({ error: "You can't block yourself." });
  const me = users[uname], them = users[target];
  if (!Array.isArray(me.blocked)) me.blocked = [];
  if (!me.blocked.includes(target)) me.blocked.push(target);
  me.friends = (me.friends || []).filter((f) => f !== target);
  them.friends = (them.friends || []).filter((f) => f !== uname);
  me.incoming = (me.incoming || []).filter((f) => f !== target);
  them.incoming = (them.incoming || []).filter((f) => f !== uname);
  me.outgoing = (me.outgoing || []).filter((f) => f !== target);
  them.outgoing = (them.outgoing || []).filter((f) => f !== uname);
  saveUsers();
  emitStateTo(uname); emitStateTo(target);
  res.json({ ok: true, blocked: me.blocked });
});
app.post("/api/friends/unblock", (req, res) => {
  const uname = requireUser(req, res); if (!uname) return;
  const target = norm(req.body && req.body.target);
  const me = users[uname];
  me.blocked = (me.blocked || []).filter((f) => f !== target);
  saveUsers();
  res.json({ ok: true, blocked: me.blocked });
});

// ---- Reports ----
const REPORTS_FILE = path.join(DATA_DIR, "reports.json");
let reports = [];
try { reports = JSON.parse(fs.readFileSync(REPORTS_FILE, "utf8")); } catch {}
if (!Array.isArray(reports)) reports = [];
function saveReports() { try { fs.writeFileSync(REPORTS_FILE, JSON.stringify(reports)); } catch {} }
app.post("/api/report", (req, res) => {
  const uname = requireUser(req, res); if (!uname) return;
  const { type, target, reason } = req.body || {};
  if (!["user", "server"].includes(type)) return res.status(400).json({ error: "Invalid report type." });
  if (type === "user" && (!validUser(target) || !users[target])) return res.status(400).json({ error: "No such user." });
  if (type === "server" && !servers[target]) return res.status(400).json({ error: "No such server." });
  if (type === "user" && target === uname) return res.status(400).json({ error: "You can't report yourself." });
  reports.push({ by: uname, type, target, reason: String(reason || "").slice(0, 500), ts: Date.now() });
  if (reports.length > 500) reports = reports.slice(-500);
  saveReports();
  res.json({ ok: true });
});

// ---- Servers ----
function newId(p) { return p + crypto.randomBytes(6).toString("hex"); }
app.post("/api/servers/create", (req, res) => {
  const uname = requireUser(req, res); if (!uname) return;
  const name = (req.body && req.body.name || "").trim().slice(0, 40) || "New Server";
  const id = newId("srv_");
  servers[id] = {
    id, name, owner: uname, iconColor: colorFor(name), members: [uname],
    channels: [{ id: newId("ch_"), name: "general", topic: "", slow: 0 }],
    roles: [], emojis: [], nicknames: {}, bans: [], audit: [],
  };
  if (!users[uname].servers.includes(id)) users[uname].servers.push(id);
  saveServers(); saveUsers();
  emitServersTo(uname);
  res.json({ ok: true, server: serverView(id) });
});
app.post("/api/servers/invite", (req, res) => {
  const uname = requireUser(req, res); if (!uname) return;
  const id = req.body && req.body.serverId;
  const who = norm(req.body && req.body.username);
  const s = servers[id];
  if (!s) return res.status(404).json({ error: "Server not found." });
  if (!s.members.includes(uname)) return res.status(403).json({ error: "You're not in this server." });
   if (!users[who]) return res.status(404).json({ error: "No user with that username." });
   if (!users[uname].friends.includes(who)) return res.status(403).json({ error: "You can only add friends directly. Share an invite link to let others join." });
   if (s.members.includes(who)) return res.status(409).json({ error: "Already a member." });
   s.members.push(who);
  if (!users[who].servers.includes(id)) users[who].servers.push(id);
  saveServers(); saveUsers();
  emitServersTo(uname); emitServersTo(who);
  res.json({ ok: true, server: serverView(id) });
});
app.post("/api/servers/channel", (req, res) => {
  const uname = requireUser(req, res); if (!uname) return;
  const id = req.body && req.body.serverId;
  const name = (req.body && req.body.name || "").trim().slice(0, 40);
  const s = servers[id];
  if (!s) return res.status(404).json({ error: "Server not found." });
  if (!s.members.includes(uname)) return res.status(403).json({ error: "You're not in this server." });
  if (!/^[a-zA-Z0-9 _-]{1,40}$/.test(name)) return res.status(400).json({ error: "Invalid channel name." });
   const channelId = newId("ch_");
   s.channels.push({ id: channelId, name: name.toLowerCase().replace(/\s+/g, "-"), topic: "", slow: 0 });
  saveServers();
  s.members.forEach((m) => emitServersTo(m));
  res.json({ ok: true, server: serverView(id) });
});
app.post("/api/servers/leave", (req, res) => {
  const uname = requireUser(req, res); if (!uname) return;
  const id = req.body && req.body.serverId;
  const s = servers[id];
  if (!s) return res.status(404).json({ error: "Server not found." });
  s.members = s.members.filter((m) => m !== uname);
  users[uname].servers = (users[uname].servers || []).filter((x) => x !== id);
  if (s.members.length === 0) delete servers[id];
  else if (s.owner === uname) s.owner = s.members[0];
  saveServers(); saveUsers();
  emitServersTo(uname); s.members.forEach((m) => emitServersTo(m));
  res.json({ ok: true });
});

// ---- GIF / Sticker picker (Klipy primary, Reddit + keyless fallback) ----
// Returns a normalized shape the client understands: { data: [ { url, preview, format } ] }
function klipyToMedia(item, kind) {
  const f = item && item.file; if (!f) return null;
  const hd = f.hd || {}, md = f.md || {};
  const fullList = kind === "sticker" ? ["webp", "png", "gif"] : ["gif", "mp4", "webp"];
  for (const e of fullList) {
    const u = hd[e] || md[e];
    if (u && u.url) {
      const preview = (md.webp && md.webp.url) || (md.gif && md.gif.url) || u.url;
      const format = (e === "mp4" || e === "webm") ? "video" : "gif";
      return { url: u.url, preview, format };
    }
  }
  return null;
}
async function klipyPicker(kind, q) {
  const type = kind === "sticker" ? "stickers" : "gifs";
  const url = "https://api.klipy.com/api/v1/" + KLIPY_KEY + "/" + type + "/" + (q ? "search" : "trending") + "?per_page=40&page=1" + (q ? "&q=" + encodeURIComponent(q) : "");
  const r = await fetch(url, { headers: { Accept: "application/json" } });
  const j = await r.json().catch(() => ({}));
  const arr = (j.data && j.data.data) || (j.data && j.data.results) || (Array.isArray(j.data) ? j.data : []);
  const out = [];
  (Array.isArray(arr) ? arr : []).forEach((item) => {
    const m = klipyToMedia(item, kind);
    if (m && /\.(gif|mp4|webm)(\?|$)/i.test(m.url)) out.push(m);
  });
  return out;
}
function redditMedia(d) {
  const prev = d.preview && d.preview.images && d.preview.images[0];
  let gif = prev ? prev.source.url.replace(/&amp;/g, "&") : null;
  const mp4 = prev && prev.variants && prev.variants.mp4 && prev.variants.mp4.source ? prev.variants.mp4.source.url.replace(/&amp;/g, "&") : null;
  const rv = d.media && d.media.reddit_video ? d.media.reddit_video.fallback_url.replace(/&amp;/g, "&") : null;
  const url = mp4 || rv || gif || d.url;
  if (!url) return null;
  const isVideo = !!mp4 || !!rv;
  return { url, preview: gif || url, format: isVideo ? "video" : "gif", title: d.title || "", source: "https://reddit.com" + (d.permalink || "") };
}
async function redditPicker(kind, q) {
  const sub = kind === "sticker" ? ["discordstickers", "Stickers", "discord_emojis"] : ["reactiongifs", "gifs", "discord_emoji", "CatGifs", "funny"];
  const headers = { "User-Agent": "Buddy/1.0 (chat app)", Accept: "application/json" };
  const url = q ? "https://www.reddit.com/search.json?q=" + encodeURIComponent(q) + "&sort=top&t=year&type=link&limit=50" : "https://www.reddit.com/r/" + sub[0] + "/top.json?t=week&limit=60";
  const r = await fetch(url, { headers });
  if (!r.ok) throw new Error("reddit " + r.status);
  const json = await r.json();
  const children = (json && json.data && json.data.children) || [];
  const out = [];
  for (const c of children) {
    const d = c.data; if (!d || d.stickied) continue;
    const m = redditMedia(d);
    if (m && /\.(gif|mp4|webm)(\?|$)/i.test(m.url) && !/reddit\.com\/r\//i.test(m.url)) out.push(m);
    if (out.length >= 48) break;
  }
  return out;
}
async function animePicker(kind) {
  const tags = ["waifu", "smile", "wave", "blush", "happy", "cry", "dance", "cuddle", "pat", "highfive", "handhold", "kiss", "slap", "happy"];
  const out = [];
  for (const t of tags.slice(0, 14)) {
    try { const r = await fetch("https://api.waifu.pics/sfw/" + t); const j = await r.json(); if (j && j.url) out.push({ url: j.url, preview: j.url, format: "gif" }); } catch {}
    if (out.length >= 24) break;
  }
  return out;
}
async function gifProxy(req, res, kind) {
  const q = (req.query.q || "").toString().slice(0, 80).trim();
  if (KLIPY_KEY) { try { const data = await klipyPicker(kind, q); if (data.length) return res.json({ data }); } catch (e) { console.error("Klipy failed:", e.message); } }
  try { const data = await redditPicker(kind, q); if (data.length) return res.json({ data }); } catch (e) {}
  try { const data = await animePicker(kind); if (data.length) return res.json({ data }); } catch (e) {}
  res.status(502).json({ error: "proxy_failed", message: "All GIF sources unavailable." });
}
app.get("/api/gifs/trending", (req, res) => gifProxy(req, res, "gif"));
app.get("/api/gifs/search", (req, res) => gifProxy(req, res, "gif"));
app.get("/api/stickers/trending", (req, res) => gifProxy(req, res, "sticker"));
app.get("/api/stickers/search", (req, res) => gifProxy(req, res, "sticker"));

// ---- Socket ----
const dmRoom = (a, b) => "dm:" + [a, b].sort().join("|");
function roomMsgs(room) { if (!history.has(room)) history.set(room, []); return history.get(room); }
function findMsg(room, id) { return roomMsgs(room).find((m) => m.id === id); }
function canPost(room, uname) {
  if (room.startsWith("dm:")) { const parts = room.slice(3).split("|"); const other = parts[0] === uname ? parts[1] : parts[0]; return users[uname] && users[uname].friends.includes(other); }
  if (room.startsWith("chan:")) { const sid = serverOfChannel(room.slice(5)); const s = sid && servers[sid]; return !!(s && s.members.includes(uname)); }
  return false;
}
function deliver(room, msg, sender) {
  const arr = roomMsgs(room); arr.push(msg); if (arr.length > 500) arr.shift();
  scheduleSaveHistory(); incUnread(room, sender, msg);
  io.to(room).emit("message", msg);
}

io.on("connection", (socket) => {
  socket.user = null;
  socket.activeRoom = null;
  socket.callRooms = new Set();

  socket.on("auth", ({ token }) => {
    const u = userFromToken(token);
    if (!u || !users[u]) { socket.emit("auth-error", "Session expired. Please log in again."); return; }
    socket.user = u;
    online.add(u);
    socket.join("user:" + u);
    socket.emit("authed", { profile: publicProfile(u) });
    emitStateTo(u);
    notifyPresence(u);
  });

  function ensureAuth() { return !!socket.user; }

  socket.on("dm-open", ({ friend }) => {
    if (!ensureAuth()) return;
    const f = norm(friend);
    if (!users[socket.user].friends.includes(f)) return;
    const room = dmRoom(socket.user, f);
    if (socket.activeRoom && socket.activeRoom !== room) socket.leave(socket.activeRoom);
    socket.activeRoom = room; socket.join(room);
    resetUnread(socket.user, room);
    socket.emit("history", roomMsgs(room).slice(-100));
    emitReadReceipts(room, socket.user);
  });
  socket.on("channel-open", ({ channelId }) => {
    if (!ensureAuth()) return;
    const sid = serverOfChannel(channelId);
    const s = sid && servers[sid];
    if (!s || !s.members.includes(socket.user)) return;
    const room = "chan:" + channelId;
    if (socket.activeRoom && socket.activeRoom !== room) socket.leave(socket.activeRoom);
    socket.activeRoom = room; socket.join(room);
    resetUnread(socket.user, room);
    const ch = s.channels.find((c) => c.id === channelId);
    socket.emit("history", roomMsgs(room).slice(-100));
    socket.emit("channel-info", { serverId: sid, channelId, name: ch ? ch.name : "", serverName: s.name });
    emitReadReceipts(room, socket.user);
  });

  socket.on("typing", ({ on }) => { if (socket.activeRoom) socket.to(socket.activeRoom).emit("typing", { from: users[socket.user].displayName, user: socket.user, on: !!on }); });
  socket.on("read", ({ ids }) => {
    if (!ensureAuth() || !socket.activeRoom) return;
    const arr = roomMsgs(socket.activeRoom);
    const idSet = new Set((ids || []));
    const touched = [];
    arr.forEach((m) => { if (idSet.has(m.id) && m.user && !m.deleted) { m.readBy = m.readBy || []; if (!m.readBy.includes(socket.user)) { m.readBy.push(socket.user); touched.push(m.id); } } });
    if (touched.length) { scheduleSaveHistory(); io.to(socket.activeRoom).emit("read", { user: socket.user, ids: touched }); }
  });
  socket.on("unread:clear-all", () => { if (!ensureAuth()) return; const m = unread.get(socket.user); if (m) { unread.set(socket.user, {}); emitUnread(socket.user); } });

  socket.on("message", (text, replyTo) => {
    if (!ensureAuth() || !socket.activeRoom || !canPost(socket.activeRoom, socket.user)) return;
    if (!rateLimit("msg:" + socket.id, 8, 1000)) return;
    const slow = slowFor(socket.activeRoom);
    if (slow > 0) {
      const until = (slowState.get(socket.activeRoom + "|" + socket.user) || 0);
      if (Date.now() < until) { socket.emit("slow", { wait: Math.ceil((until - Date.now()) / 1000) }); return; }
    }
    const reply = replyTo ? (() => { const m = findMsg(socket.activeRoom, replyTo); return m ? { id: m.id, user: m.user, text: (m.text || (m.kind ? m.kind : "")).slice(0, 80) } : null; })() : null;
    deliver(socket.activeRoom, { id: Date.now() + "-" + socket.id + "-" + crypto.randomBytes(3).toString("hex"), user: users[socket.user].username, text: String(text).slice(0, 4000), ts: Date.now(), replyTo: reply }, socket.user);
    if (slow > 0) slowState.set(socket.activeRoom + "|" + socket.user, Date.now() + slow * 1000);
  });
  socket.on("media", ({ url, kind, format, replyTo }) => {
    if (!ensureAuth() || !socket.activeRoom || !canPost(socket.activeRoom, socket.user)) return;
    if (!/^https?:\/\//.test(url)) return;
    const k = ["gif", "sticker", "image", "video"].includes(kind) ? kind : "gif";
    const isVideo = k === "video" || format === "video";
    deliver(socket.activeRoom, { id: Date.now() + "-" + socket.id + "-" + crypto.randomBytes(3).toString("hex"), user: users[socket.user].username, kind: k, format: isVideo ? "video" : undefined, url: url.slice(0, 2000), ts: Date.now(), replyTo: replyTo ? { id: replyTo } : null }, socket.user);
  });
  socket.on("file", ({ url, kind, name, size, replyTo }) => {
    if (!ensureAuth() || !socket.activeRoom || !canPost(socket.activeRoom, socket.user)) return;
    if (!/^\/uploads\//.test(url)) return;
    const k = ["video", "image", "file"].includes(kind) ? kind : "image";
    deliver(socket.activeRoom, { id: Date.now() + "-" + socket.id + "-" + crypto.randomBytes(3).toString("hex"), user: users[socket.user].username, kind: k, url: url.slice(0, 400), name: String(name || "").slice(0, 200), size: Number(size) || 0, ts: Date.now(), replyTo: replyTo ? { id: replyTo } : null }, socket.user);
  });

  socket.on("edit", ({ id, text }) => {
    if (!ensureAuth() || !socket.activeRoom) return;
    const m = findMsg(socket.activeRoom, id);
    if (!m || m.user !== users[socket.user].username || m.kind) return;
    m.history = m.history || [];
    if (m.text) m.history.push({ text: m.text, ts: Date.now() });
    m.text = String(text).slice(0, 4000); m.edited = true;
    scheduleSaveHistory();
    io.to(socket.activeRoom).emit("edited", { id, text: m.text, edited: true, history: m.history });
  });
  socket.on("react", ({ id, emoji }) => {
    if (!ensureAuth() || !socket.activeRoom) return;
    const m = findMsg(socket.activeRoom, id);
    if (!m) return;
    m.reactions = m.reactions || {};
    const list = m.reactions[emoji] || [];
    const i = list.indexOf(socket.user);
    if (i >= 0) list.splice(i, 1); else list.push(socket.user);
    if (!list.length) delete m.reactions[emoji]; else m.reactions[emoji] = list;
    scheduleSaveHistory();
    io.to(socket.activeRoom).emit("reacted", { id, reactions: m.reactions });
  });
  socket.on("delete", ({ id }) => {
    if (!ensureAuth() || !socket.activeRoom) return;
    const arr = roomMsgs(socket.activeRoom);
    const m = arr.find((x) => x.id === id);
    if (!m) return;
    const isAdmin = socket.activeRoom.startsWith("chan:") && (() => { const sid = serverOfChannel(socket.activeRoom.slice(5)); const s = sid && servers[sid]; return s && (s.owner === socket.user || (permsFor(s, socket.user) & 32)); })();
    if (m.user !== socket.user && !isAdmin) return;
    m.deleted = true; m.text = ""; m.kind = null; m.reactions = {}; m.replyTo = null; m.poll = null;
    scheduleSaveHistory();
    io.to(socket.activeRoom).emit("deleted", { id, deleted: true });
  });

  socket.on("dm-invite", ({ friend }) => {
    if (!ensureAuth()) return;
    const f = norm(friend);
    if (users[socket.user].friends.includes(f)) io.to("user:" + f).emit("dm-invite", { from: users[socket.user].username });
  });

  // 1:1 DM calls
  socket.on("call:ring", () => { if (socket.activeRoom) socket.to(socket.activeRoom).emit("call:ring", { from: users[socket.user].username, fromName: users[socket.user].displayName }); });
  socket.on("call:offer", (offer) => { if (socket.activeRoom) socket.to(socket.activeRoom).emit("call:offer", { from: socket.id, offer }); });
  socket.on("call:answer", (answer) => { if (socket.activeRoom) socket.to(socket.activeRoom).emit("call:answer", { from: socket.id, answer }); });
  socket.on("call:ice", (candidate) => { if (socket.activeRoom) socket.to(socket.activeRoom).emit("call:ice", { from: socket.id, candidate }); });
  socket.on("call:accept", () => { if (socket.activeRoom) socket.to(socket.activeRoom).emit("call:accept"); });
  socket.on("call:reject", () => { if (socket.activeRoom) socket.to(socket.activeRoom).emit("call:reject"); });
  socket.on("call:end", () => { if (socket.activeRoom) socket.to(socket.activeRoom).emit("call:end"); });

  // Mesh group calls (per server)
  socket.on("call2:join", ({ callId }) => {
    if (!ensureAuth()) return;
    const room = "gcall:" + callId;
    socket.join(room); socket.callRooms.add(callId);
    socket.to(room).emit("call2:peer", { from: socket.id, fromName: users[socket.user].displayName, fromUser: socket.user });
  });
  socket.on("call2:signal", ({ callId, to, signal }) => {
    if (!ensureAuth()) return;
    socket.to(to).emit("call2:signal", { from: socket.id, fromName: users[socket.user].displayName, signal });
  });
  socket.on("call2:leave", ({ callId }) => {
    const room = "gcall:" + callId;
    socket.leave(room); socket.callRooms.delete(callId);
    socket.to(room).emit("call2:left", { from: socket.id });
  });

  socket.on("disconnect", () => {
    if (socket.user) {
      online.delete(socket.user);
      const u = users[socket.user];
      if (u) { u.lastSeen = Date.now(); saveUsers(); }
      notifyPresence(socket.user);
      socket.callRooms.forEach((cid) => { socket.to("gcall:" + cid).emit("call2:left", { from: socket.id }); });
    }
  });
});

// ====================================================================
//  EXTENDED DISCORD-LIKE FEATURES
// ====================================================================
const PERMS = { MANAGE: 1, KICK: 2, BAN: 4, MENTION: 8, INVITE: 16, PIN: 32 };
const PERM_BITS = { manage: 1, kick: 2, ban: 4, mention: 8, invite: 16, pin: 32 };
const slowState = new Map(); // room|user -> ts
const pins = new Map();      // room -> [msgId]
const invites = new Map();   // code -> {serverId, expires, uses}
function slowFor(room) {
  if (!room || !room.startsWith("chan:")) return 0;
  const sid = serverOfChannel(room.slice(5)); const s = sid && servers[sid];
  if (!s) return 0;
  const ch = s.channels.find((c) => c.id === room.slice(5));
  return ch ? (ch.slow || 0) : 0;
}
function serverAdmin(s, uname) { return s && (s.owner === uname || (permsFor(s, uname) & PERMS.MANAGE)); }
function audit(s, by, action, target) {
  s.audit = s.audit || [];
  s.audit.push({ by, action, target, ts: Date.now() });
  if (s.audit.length > 100) s.audit = s.audit.slice(-100);
  s.members.forEach((m) => emitServersTo(m));
}

// ---- Server admin / roles / emoji / moderation ----
app.post("/api/servers/role", (req, res) => {
  const uname = requireUser(req, res); if (!uname) return;
  const { serverId, action, roleId, name, color, perms, target } = req.body || {};
  const s = servers[serverId]; if (!s) return res.status(404).json({ error: "Server not found." });
  if (!serverAdmin(s, uname)) return res.status(403).json({ error: "You need Manage Server." });
  if (action === "create") {
    const r = { id: newId("role_"), name: (name || "new role").slice(0, 32), color: color || "#99aab5", permissions: 0, members: [], pos: s.roles.length };
    if (Array.isArray(perms)) perms.forEach((p) => { if (PERM_BITS[p]) r.permissions |= PERM_BITS[p]; });
    if (typeof perms === "number") r.permissions = perms | 0;
    s.roles.push(r); saveServers(); emitServersTo(uname); return res.json({ ok: true, role: r });
  }
  const r = s.roles.find((x) => x.id === roleId); if (!r) return res.status(404).json({ error: "Role not found." });
  if (action === "delete") { s.roles = s.roles.filter((x) => x.id !== roleId); saveServers(); emitServersTo(uname); return res.json({ ok: true }); }
  if (action === "rename") { r.name = (name || r.name).slice(0, 32); }
  if (action === "color") { r.color = color || r.color; }
  if (action === "perm") { r.permissions = 0; if (Array.isArray(perms)) perms.forEach((p) => { if (PERM_BITS[p]) r.permissions |= PERM_BITS[p]; }); if (typeof perms === "number") r.permissions = perms | 0; }
  if (action === "assign" && target) { const t = norm(target); if (s.members.includes(t) && !r.members.includes(t)) r.members.push(t); }
  if (action === "unassign" && target) { r.members = (r.members || []).filter((x) => x !== norm(target)); }
  saveServers(); s.members.forEach((m) => emitServersTo(m));
  res.json({ ok: true, role: r });
});
app.post("/api/servers/nick", (req, res) => {
  const uname = requireUser(req, res); if (!uname) return;
  const { serverId, nick } = req.body || {};
  const s = servers[serverId]; if (!s || !s.members.includes(uname)) return res.status(403).json({ error: "Not in server." });
  s.nicknames = s.nicknames || {};
  s.nicknames[uname] = (nick || "").slice(0, 32); if (!nick) delete s.nicknames[uname];
  saveServers(); s.members.forEach((m) => emitServersTo(m));
  res.json({ ok: true, nickname: s.nicknames[uname] || "" });
});
app.post("/api/servers/slow", (req, res) => {
  const uname = requireUser(req, res); if (!uname) return;
  const { serverId, channelId, seconds } = req.body || {};
  const s = servers[serverId]; if (!s) return res.status(404).json({ error: "Server not found." });
  if (!serverAdmin(s, uname)) return res.status(403).json({ error: "Need Manage Server." });
  const ch = s.channels.find((c) => c.id === channelId); if (!ch) return res.status(404).json({ error: "Channel not found." });
  ch.slow = Math.max(0, Math.min(3600, +seconds || 0)); saveServers(); s.members.forEach((m) => emitServersTo(m));
  res.json({ ok: true, slow: ch.slow });
});
app.post("/api/servers/emoji", (req, res) => {
  const uname = requireUser(req, res); if (!uname) return;
  const { serverId, action, name, url } = req.body || {};
  const s = servers[serverId]; if (!s) return res.status(404).json({ error: "Server not found." });
  if (!(s.owner === uname || (permsFor(s, uname) & PERMS.MANAGE))) return res.status(403).json({ error: "Need Manage Server." });
  s.emojis = s.emojis || [];
  if (action === "add") {
    const nm = (name || "").toLowerCase().replace(/[^a-z0-9_]/g, "");
    if (!nm) return res.status(400).json({ error: "Invalid emoji name." });
    if (!/^\/uploads\//.test(url || "")) return res.status(400).json({ error: "Emoji must be an uploaded image." });
    if (s.emojis.length >= 50) return res.status(400).json({ error: "Emoji limit reached." });
    const e = { name: nm, url }; s.emojis.push(e); saveServers(); s.members.forEach((m) => emitServersTo(m)); return res.json({ ok: true, emoji: e });
  }
   if (action === "del") { s.emojis = s.emojis.filter((e) => e.name !== name); saveServers(); s.members.forEach((m) => emitServersTo(m)); return res.json({ ok: true }); }
   res.status(400).json({ error: "Unknown action." });
});
app.post("/api/servers/sticker", (req, res) => {
  const uname = requireUser(req, res); if (!uname) return;
  const { serverId, action, name, url } = req.body || {};
  const s = servers[serverId]; if (!s) return res.status(404).json({ error: "Server not found." });
  if (!(s.owner === uname || (permsFor(s, uname) & PERMS.MANAGE))) return res.status(403).json({ error: "Need Manage Server." });
  s.stickers = s.stickers || [];
  if (action === "add") {
    const nm = (name || "").toLowerCase().replace(/[^a-z0-9_]/g, "");
    if (!nm) return res.status(400).json({ error: "Invalid sticker name." });
    if (!/^\/uploads\//.test(url || "")) return res.status(400).json({ error: "Sticker must be an uploaded image." });
    if (s.stickers.length >= 50) return res.status(400).json({ error: "Sticker limit reached." });
    const st = { name: nm, url }; s.stickers.push(st); saveServers(); s.members.forEach((m) => emitServersTo(m)); return res.json({ ok: true, sticker: st });
  }
  if (action === "del") { s.stickers = s.stickers.filter((e) => e.name !== name); saveServers(); s.members.forEach((m) => emitServersTo(m)); return res.json({ ok: true }); }
  res.status(400).json({ error: "Unknown action." });
});
function doKickBan(req, res, kind) {
  const uname = requireUser(req, res); if (!uname) return;
  const { serverId, target } = req.body || {};
  const s = servers[serverId]; if (!s) return res.status(404).json({ error: "Server not found." });
  const t = norm(target);
  if (s.owner === t) return res.status(403).json({ error: "You can't remove the owner." });
  const need = kind === "ban" ? PERMS.BAN : PERMS.KICK;
  if (!(s.owner === uname || (permsFor(s, uname) & need))) return res.status(403).json({ error: "Missing permission." });
  if (!s.members.includes(t)) return res.status(404).json({ error: "Not a member." });
  s.members = s.members.filter((m) => m !== t);
  users[t].servers = (users[t].servers || []).filter((x) => x !== serverId);
  if (kind === "ban") { s.bans = s.bans || []; if (!s.bans.includes(t)) s.bans.push(t); }
  saveServers(); saveUsers();
  io.to("user:" + t).emit("kicked", { serverId });
  audit(s, uname, kind, t);
  s.members.forEach((m) => emitServersTo(m));
  res.json({ ok: true });
}
app.post("/api/servers/kick", (req, res) => doKickBan(req, res, "kick"));
app.post("/api/servers/ban", (req, res) => doKickBan(req, res, "ban"));
app.post("/api/servers/unban", (req, res) => {
  const uname = requireUser(req, res); if (!uname) return;
  const { serverId, target } = req.body || {};
  const s = servers[serverId]; if (!s) return res.status(404).json({ error: "Server not found." });
  if (!(s.owner === uname || (permsFor(s, uname) & PERMS.BAN))) return res.status(403).json({ error: "Missing permission." });
  s.bans = (s.bans || []).filter((x) => x !== norm(target)); saveServers(); s.members.forEach((m) => emitServersTo(m));
  res.json({ ok: true });
});
app.post("/api/servers/invite-code", (req, res) => {
  const uname = requireUser(req, res); if (!uname) return;
  const { serverId, expires, maxUses } = req.body || {};
  const s = servers[serverId]; if (!s) return res.status(404).json({ error: "Server not found." });
  if (!(s.owner === uname || (permsFor(s, uname) & PERMS.INVITE))) return res.status(403).json({ error: "Missing permission." });
  const code = crypto.randomBytes(4).toString("hex");
  invites.set(code, { serverId, expires: expires ? Date.now() + expires * 1000 : 0, maxUses: maxUses || 0, uses: 0 });
  res.json({ ok: true, code, link: "/invite/" + code });
});
app.post("/api/invite/join", (req, res) => {
  const uname = requireUser(req, res); if (!uname) return;
  const { code } = req.body || {};
  const inv = invites.get(code);
  if (!inv) return res.status(404).json({ error: "Invalid invite." });
  if (inv.expires && Date.now() > inv.expires) { invites.delete(code); return res.status(410).json({ error: "Invite expired." }); }
  if (inv.maxUses && inv.uses >= inv.maxUses) return res.status(410).json({ error: "Invite max uses reached." });
  const s = servers[inv.serverId]; if (!s) { invites.delete(code); return res.status(404).json({ error: "Server gone." }); }
  if (s.bans && s.bans.includes(uname)) return res.status(403).json({ error: "You are banned from this server." });
  inv.uses++;
  if (!s.members.includes(uname)) s.members.push(uname);
  if (!users[uname].servers.includes(inv.serverId)) users[uname].servers.push(inv.serverId);
  saveServers(); saveUsers();
  s.members.forEach((m) => emitServersTo(m));
  res.json({ ok: true, server: serverView(inv.serverId) });
});
app.post("/api/servers/notif", (req, res) => {
  const uname = requireUser(req, res); if (!uname) return;
  const { serverId, mode } = req.body || {};
  if (!["all", "mentions", "none"].includes(mode)) return res.status(400).json({ error: "Bad mode." });
  users[uname].notif = users[uname].notif || {};
  users[uname].notif[serverId] = mode; saveUsers();
  res.json({ ok: true, notif: users[uname].notif });
});
app.get("/api/servers/:id/audit", (req, res) => {
  const uname = requireUser(req, res); if (!uname) return;
  const s = servers[req.params.id]; if (!s) return res.status(404).json({ error: "Server not found." });
  if (!serverAdmin(s, uname)) return res.status(403).json({ error: "Missing permission." });
  res.json({ audit: (s.audit || []).slice(-100).reverse() });
});
app.post("/api/friends/dm-mute", (req, res) => {
  const uname = requireUser(req, res); if (!uname) return;
  const { target, on } = req.body || {};
  const t = norm(target); if (!users[t]) return res.status(404).json({ error: "No user." });
  users[uname].dmMuted = users[uname].dmMuted || {};
  users[uname].dmMuted[t] = !!on; saveUsers();
  res.json({ ok: true, dmMuted: users[uname].dmMuted });
});

// ---- Friends: favorites / notes / nicknames ----
app.post("/api/friends/favorite", (req, res) => {
  const uname = requireUser(req, res); if (!uname) return;
  const { target, on } = req.body || {};
  const t = norm(target); if (!users[t]) return res.status(404).json({ error: "No user." });
  users[uname].favorites = users[uname].favorites || [];
  if (on) { if (!users[uname].favorites.includes(t)) users[uname].favorites.push(t); }
  else users[uname].favorites = users[uname].favorites.filter((x) => x !== t);
  saveUsers(); res.json({ ok: true, favorites: users[uname].favorites });
});
app.post("/api/friends/note", (req, res) => {
  const uname = requireUser(req, res); if (!uname) return;
  const { target, note } = req.body || {};
  users[uname].notes = users[uname].notes || {};
  users[uname].notes[norm(target)] = String(note || "").slice(0, 500); saveUsers();
  res.json({ ok: true });
});
app.post("/api/friends/nick", (req, res) => {
  const uname = requireUser(req, res); if (!uname) return;
  const { target, nick } = req.body || {};
  users[uname].friendNick = users[uname].friendNick || {};
  users[uname].friendNick[norm(target)] = String(nick || "").slice(0, 32); if (!nick) delete users[uname].friendNick[norm(target)];
  saveUsers(); emitFriendsTo(uname); res.json({ ok: true });
});

// ---- Voice / presence settings ----
app.post("/api/me/voice", (req, res) => {
  const uname = requireUser(req, res); if (!uname) return;
  const { echo, noise, agc, ptt } = req.body || {};
  const u = users[uname];
  u.voice = { echo: !!echo, noise: !!noise, agc: !!agc, ptt: !!ptt };
  saveUsers(); res.json({ ok: true, voice: u.voice });
});
app.post("/api/presence/voice", (req, res) => {
  const uname = requireUser(req, res); if (!uname) return;
  const { mute, deafen } = req.body || {};
  const u = users[uname];
  if (typeof mute === "boolean") u.mute = mute;
  if (typeof deafen === "boolean") u.deafen = deafen;
  saveUsers(); notifyPresence(uname); res.json({ ok: true });
});

// ---- Bookmarks / saved messages ----
app.post("/api/me/bookmark", (req, res) => {
  const uname = requireUser(req, res); if (!uname) return;
  const { room, id } = req.body || {};
  users[uname].bookmarks = users[uname].bookmarks || [];
  const i = users[uname].bookmarks.findIndex((b) => b.room === room && b.id === id);
  if (i >= 0) users[uname].bookmarks.splice(i, 1); else users[uname].bookmarks.push({ room, id });
  saveUsers(); res.json({ ok: true, bookmarks: users[uname].bookmarks });
});
app.get("/api/bookmarks", (req, res) => {
  const uname = requireUser(req, res); if (!uname) return;
  const out = (users[uname].bookmarks || []).map((b) => {
    const m = findMsg(b.room, b.id);
    return m ? Object.assign({ room: b.room }, m) : null;
  }).filter(Boolean);
  res.json({ bookmarks: out });
});

// ---- Search & history pagination ----
app.get("/api/search", (req, res) => {
  const uname = requireUser(req, res); if (!uname) return;
  const q = String(req.query.q || "").toLowerCase().slice(0, 80);
  const serverId = req.query.serverId;
  if (serverId) {
    const s = servers[serverId]; if (!s) return res.status(404).json({ error: "Server not found." });
    if (!s.members.includes(uname)) return res.status(403).json({ error: "No access." });
    const out = [];
    for (const ch of s.channels) {
      const room = "chan:" + ch.id;
      roomMsgs(room).forEach((m) => { if (!m.deleted && m.text && m.text.toLowerCase().includes(q)) out.push({ channel: ch.name, ...m }); });
    }
    out.sort((a, b) => (a.ts || 0) - (b.ts || 0));
    return res.json({ results: out.slice(-80) });
  }
  const room = req.query.room;
  if (!canPost(room, uname)) return res.status(403).json({ error: "No access." });
  const arr = roomMsgs(room);
  const results = arr.filter((m) => !m.deleted && m.text && m.text.toLowerCase().includes(q)).slice(-50);
  res.json({ results });
});
app.get("/api/history", (req, res) => {
  const uname = requireUser(req, res); if (!uname) return;
  const room = req.query.room; const before = +req.query.before || Date.now(); const limit = Math.min(100, +req.query.limit || 50);
  if (!canPost(room, uname)) return res.status(403).json({ error: "No access." });
  const arr = roomMsgs(room).filter((m) => (m.ts || 0) < before).slice(-limit);
  res.json({ messages: arr });
});

// ---- Message report ----
app.post("/api/report/message", (req, res) => {
  const uname = requireUser(req, res); if (!uname) return;
  const { room, id, reason } = req.body || {};
  reports.push({ by: uname, type: "message", room, target: id, reason: String(reason || "").slice(0, 500), ts: Date.now() });
  if (reports.length > 500) reports = reports.slice(-500); saveReports();
  res.json({ ok: true });
});

// ---- Live socket features (pins, forward, polls, voice) ----
io.on("connection", (socket) => {
  const me = () => socket.user;

  function canPin(room) {
    if (!room || !room.startsWith("chan:")) return true;
    const sid = serverOfChannel(room.slice(5)); const s = sid && servers[sid];
    return s ? (s.owner === socket.user || (permsFor(s, socket.user) & PERMS.PIN)) : false;
  }

  socket.on("pin", ({ id }) => {
    if (!socket.user || !socket.activeRoom || !canPost(socket.activeRoom, socket.user)) return;
    if (!canPin(socket.activeRoom)) return;
    const arr = pins.get(socket.activeRoom) || [];
    const i = arr.indexOf(id);
    if (i >= 0) arr.splice(i, 1); else arr.push(id);
    pins.set(socket.activeRoom, arr);
    io.to(socket.activeRoom).emit("pinned", { ids: arr });
  });
  socket.on("get-pins", () => {
    if (!socket.user || !socket.activeRoom) return;
    socket.emit("pinned", { ids: pins.get(socket.activeRoom) || [] });
  });
  socket.on("forward", ({ id, to }) => {
    if (!socket.user || !to || !canPost(to, socket.user)) return;
    const m = findMsg(socket.activeRoom, id) || findMsg(to, id);
    if (!m || m.deleted) return;
    const copy = Object.assign({}, m, { id: Date.now() + "-" + socket.id + "-" + crypto.randomBytes(3).toString("hex"), ts: Date.now(), forwarded: { from: m.user, room: socket.activeRoom } });
    delete copy.reactions; delete copy.edited;
    deliver(to, copy, socket.user);
  });
  socket.on("poll:create", ({ question, options }) => {
    if (!socket.user || !socket.activeRoom || !canPost(socket.activeRoom, socket.user)) return;
    const opts = (options || []).map((o) => String(o).slice(0, 80)).filter(Boolean).slice(0, 10);
    if (!question || opts.length < 2) return;
    deliver(socket.activeRoom, {
      id: Date.now() + "-" + socket.id + "-" + crypto.randomBytes(3).toString("hex"),
      user: users[socket.user].username, kind: "poll", ts: Date.now(),
      poll: { question: String(question).slice(0, 200), options: opts, votes: {} },
    }, socket.user);
  });
  socket.on("poll:vote", ({ id, option }) => {
    if (!socket.user || !socket.activeRoom) return;
    const m = findMsg(socket.activeRoom, id);
    if (!m || !m.poll) return;
    m.poll.votes = m.poll.votes || {};
    const prev = m.poll.votes[socket.user];
    if (prev === option) delete m.poll.votes[socket.user];
    else m.poll.votes[socket.user] = option;
    scheduleSaveHistory();
    io.to(socket.activeRoom).emit("poll:update", { id, votes: m.poll.votes });
  });
  socket.on("voice-state", ({ mute, deafen }) => {
    if (!socket.user) return;
    const u = users[socket.user]; if (!u) return;
    if (typeof mute === "boolean") u.mute = mute;
    if (typeof deafen === "boolean") u.deafen = deafen;
    saveUsers(); notifyPresence(socket.user);
  });
});

server.listen(PORT, () => console.log(`Buddy-chat running on http://localhost:${PORT}`));

module.exports = { server, io };
