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
const upload = multer({
  storage,
  limits: { fileSize: 120 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/^(image|video)\//.test(file.mimetype)) cb(null, true);
    else cb(new Error("Only image and video files are allowed."));
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
  if (!u.presence) u.presence = "online";
  if (typeof u.status !== "string") u.status = "";
  if (u.activity !== null && typeof u.activity !== "object") u.activity = null;
  if (typeof u.lastSeen !== "number") u.lastSeen = 0;
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
    online: online.has(uname),
    presence: effectivePresence(uname),
    status: u.status || "",
    activity: u.activity || null,
    lastSeen: u.lastSeen || 0,
  };
}
function friendView(uname) { return publicProfile(uname); }
function memberView(uname) { return publicProfile(uname); }
function serverView(id) {
  const s = servers[id];
  if (!s) return null;
  return {
    id: s.id, name: s.name, owner: s.owner, iconColor: s.iconColor,
    channels: s.channels.map((c) => ({ id: c.id, name: c.name })),
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
function incUnread(room, sender) {
  for (const u of roomMembers(room)) {
    if (u === sender) continue;
    if (!unread.has(u)) unread.set(u, {});
    const m = unread.get(u); m[room] = (m[room] || 0) + 1;
    emitUnread(u);
  }
}
function resetUnread(user, room) { const m = unread.get(user); if (m && room in m) { delete m[room]; emitUnread(user); } }
function emitUnread(user) { if (users[user]) io.to("user:" + user).emit("unread", unread.get(user) || {}); }

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

app.get("/api/config", (req, res) => {
  const ice = [{ urls: "stun:stun.l.google.com:19302" }, { urls: "stun:stun1.l.google.com:19302" }];
  if (process.env.TURN_URL) ice.push({ urls: process.env.TURN_URL.split(",").map((s) => s.trim()).filter(Boolean), username: process.env.TURN_USER || "", credential: process.env.TURN_PASS || "" });
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
    res.json({ ok: true, url: "/uploads/" + req.file.filename, name: String(req.file.originalname || "file").slice(0, 200), kind: req.file.mimetype.startsWith("video") ? "video" : "image", size: req.file.size });
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
  users[uname] = { username, displayName: (displayName && displayName.trim()) || username, email: email ? email.toLowerCase() : "", salt, hash, pic: "", bio: "", friends: [], incoming: [], outgoing: [], servers: [], presence: "online", status: "" };
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
  });
});

app.post("/api/profile", (req, res) => {
  const uname = requireUser(req, res); if (!uname) return;
  const u = users[uname];
  const { displayName, pic, bio, oldPassword, newPassword, presence, status } = req.body || {};
  if (typeof displayName === "string" && displayName.trim()) u.displayName = displayName.trim().slice(0, 32);
  if (typeof pic === "string") u.pic = pic.slice(0, 200000);
  if (typeof bio === "string") u.bio = bio.slice(0, 200);
  if (typeof presence === "string" && ["online", "idle", "dnd"].includes(presence)) u.presence = presence;
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
  if (activity && typeof activity === "object" && activity !== null) {
    if (ACTIVITY_TYPES.includes(activity.type)) {
      const name = String(activity.name || "").slice(0, 64).trim();
      u.activity = name ? { type: activity.type, name } : null;
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

// ---- Servers ----
function newId(p) { return p + crypto.randomBytes(6).toString("hex"); }
app.post("/api/servers/create", (req, res) => {
  const uname = requireUser(req, res); if (!uname) return;
  const name = (req.body && req.body.name || "").trim().slice(0, 40) || "New Server";
  const id = newId("srv_");
  servers[id] = { id, name, owner: uname, iconColor: colorFor(name), members: [uname], channels: [{ id: newId("ch_"), name: "general" }] };
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
  s.channels.push({ id: channelId, name: name.toLowerCase().replace(/\s+/g, "-") });
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

// ---- Klipy proxy ----
async function klipy(req, res, type, endpoint) {
  if (!KLIPY_KEY) return res.status(503).json({ error: "no_key", message: "Set KLIPY_API_KEY on the server." });
  try {
    const cid = crypto.randomUUID();
    const url = new URL(`https://api.klipy.com/api/v1/${KLIPY_KEY}/${type}/${endpoint}`);
    url.searchParams.set("customer_id", cid);
    url.searchParams.set("per_page", String(Math.min(40, Math.max(1, parseInt(req.query.per_page) || 24))));
    url.searchParams.set("page", String(Math.max(1, parseInt(req.query.page) || 1)));
    if (req.query.q) url.searchParams.set("q", String(req.query.q).slice(0, 80));
    const r = await fetch(url, { headers: { Accept: "application/json" } });
    const data = await r.json().catch(() => ({}));
    res.json(data);
  } catch (e) { res.status(502).json({ error: "proxy_failed", message: String(e.message || e) }); }
}
app.get("/api/gifs/trending", (req, res) => klipy(req, res, "gifs", "trending"));
app.get("/api/gifs/search", (req, res) => klipy(req, res, "gifs", "search"));
app.get("/api/stickers/trending", (req, res) => klipy(req, res, "stickers", "trending"));
app.get("/api/stickers/search", (req, res) => klipy(req, res, "stickers", "search"));

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
  scheduleSaveHistory(); incUnread(room, sender);
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
  });

  socket.on("typing", ({ on }) => { if (socket.activeRoom) socket.to(socket.activeRoom).emit("typing", { from: users[socket.user].displayName, user: socket.user, on: !!on }); });

  socket.on("message", (text, replyTo) => {
    if (!ensureAuth() || !socket.activeRoom || !canPost(socket.activeRoom, socket.user)) return;
    if (!rateLimit("msg:" + socket.id, 8, 1000)) return;
    const reply = replyTo ? (() => { const m = findMsg(socket.activeRoom, replyTo); return m ? { id: m.id, user: m.user, text: (m.text || (m.kind ? m.kind : "")).slice(0, 80) } : null; })() : null;
    deliver(socket.activeRoom, { id: Date.now() + "-" + socket.id + "-" + crypto.randomBytes(3).toString("hex"), user: users[socket.user].username, text: String(text).slice(0, 4000), ts: Date.now(), replyTo: reply }, socket.user);
  });
  socket.on("media", ({ url, kind, replyTo }) => {
    if (!ensureAuth() || !socket.activeRoom || !canPost(socket.activeRoom, socket.user)) return;
    if (!/^https?:\/\//.test(url)) return;
    deliver(socket.activeRoom, { id: Date.now() + "-" + socket.id + "-" + crypto.randomBytes(3).toString("hex"), user: users[socket.user].username, kind: kind === "sticker" ? "sticker" : "gif", url: url.slice(0, 2000), ts: Date.now(), replyTo: replyTo ? { id: replyTo } : null }, socket.user);
  });
  socket.on("file", ({ url, kind, name, size, replyTo }) => {
    if (!ensureAuth() || !socket.activeRoom || !canPost(socket.activeRoom, socket.user)) return;
    if (!/^\/uploads\//.test(url)) return;
    deliver(socket.activeRoom, { id: Date.now() + "-" + socket.id + "-" + crypto.randomBytes(3).toString("hex"), user: users[socket.user].username, kind: kind === "video" ? "video" : "image", url: url.slice(0, 400), name: String(name || "").slice(0, 200), size: Number(size) || 0, ts: Date.now(), replyTo: replyTo ? { id: replyTo } : null }, socket.user);
  });

  socket.on("edit", ({ id, text }) => {
    if (!ensureAuth() || !socket.activeRoom) return;
    const m = findMsg(socket.activeRoom, id);
    if (!m || m.user !== users[socket.user].username || m.kind) return;
    m.text = String(text).slice(0, 4000); m.edited = true;
    scheduleSaveHistory();
    io.to(socket.activeRoom).emit("edited", { id, text: m.text, edited: true });
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
    const i = arr.findIndex((x) => x.id === id);
    if (i === -1 || arr[i].user !== users[socket.user].username) return;
    arr.splice(i, 1); scheduleSaveHistory();
    io.to(socket.activeRoom).emit("deleted", { id });
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

server.listen(PORT, () => console.log(`Buddy-chat running on http://localhost:${PORT}`));

module.exports = { server, io };
