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

// ---- File uploads (images / videos) ----
const UPLOAD_DIR = path.join(__dirname, "public", "uploads");
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

// ---- User store (persisted) ----
const DATA_DIR = path.join(__dirname, "data");
const USERS_FILE = path.join(DATA_DIR, "users.json");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
let users = {};
try { users = JSON.parse(fs.readFileSync(USERS_FILE, "utf8")); } catch {}
function saveUsers() { fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2)); }

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

function publicProfile(uname) {
  const u = users[uname];
  if (!u) return null;
  return { username: u.username, displayName: u.displayName, pic: u.pic || "", bio: u.bio || "" };
}
function friendView(uname) {
  const p = publicProfile(uname);
  if (!p) return null;
  p.online = online.has(uname);
  return p;
}

// ---- Sessions (in-memory) ----
const sessions = new Map(); // token -> usernameLower
function newSession(uname) { const t = crypto.randomBytes(24).toString("hex"); sessions.set(t, uname); return t; }

// online usernames
const online = new Set();

// ---- HTTP API ----
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
app.get("/healthz", (req, res) => res.json({ ok: true }));

// ---- ICE servers (STUN + optional TURN via env) ----
app.get("/api/config", (req, res) => {
  const ice = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ];
  if (process.env.TURN_URL) {
    ice.push({
      urls: process.env.TURN_URL.split(",").map((s) => s.trim()).filter(Boolean),
      username: process.env.TURN_USER || "",
      credential: process.env.TURN_PASS || "",
    });
  }
  res.json({ iceServers: ice });
});

// ---- Media upload (images / videos) ----
app.post("/api/upload", (req, res) => {
  const uname = requireUser(req, res); if (!uname) return;
  upload.single("file")(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: "No file received." });
    res.json({
      ok: true,
      url: "/uploads/" + req.file.filename,
      name: String(req.file.originalname || "file").slice(0, 200),
      kind: req.file.mimetype.startsWith("video") ? "video" : "image",
      size: req.file.size,
    });
  });
});

function authToken(req) {
  const h = req.headers["authorization"] || "";
  const t = h.startsWith("Bearer ") ? h.slice(7) : (req.body && req.body.token);
  return t;
}
function userFromToken(t) { return t ? sessions.get(t) : null; }

function findUser(login) {
  const u = norm(login);
  if (users[u]) return u;
  const lower = String(login || "").toLowerCase();
  for (const k in users) if (users[k].email && users[k].email.toLowerCase() === lower) return k;
  return null;
}

app.post("/api/signup", (req, res) => {
  const { username, password, displayName, email } = req.body || {};
  if (!validUser(username)) return res.status(400).json({ error: "Username must be 3-20 chars (letters, numbers, _)." });
  if (!password || password.length < 4) return res.status(400).json({ error: "Password must be at least 4 characters." });
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: "Enter a valid email." });
  const uname = norm(username);
  if (users[uname]) return res.status(409).json({ error: "That username is taken." });
  if (email) {
    const lower = email.toLowerCase();
    for (const k in users) if (users[k].email && users[k].email.toLowerCase() === lower) return res.status(409).json({ error: "That email is already used." });
  }
  const { salt, hash } = hashPassword(password);
  users[uname] = {
    username, displayName: (displayName && displayName.trim()) || username,
    email: email ? email.toLowerCase() : "", salt, hash, pic: "", bio: "", friends: [],
  };
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

function requireUser(req, res) {
  const uname = userFromToken(authToken(req));
  if (!uname || !users[uname]) { res.status(401).json({ error: "Not authenticated." }); return null; }
  return uname;
}

app.get("/api/me", (req, res) => {
  const uname = requireUser(req, res); if (!uname) return;
  res.json({ profile: publicProfile(uname), friends: (users[uname].friends || []).map(friendView).filter(Boolean) });
});

app.post("/api/profile", (req, res) => {
  const uname = requireUser(req, res); if (!uname) return;
  const u = users[uname];
  const { displayName, pic, bio, oldPassword, newPassword } = req.body || {};
  if (typeof displayName === "string" && displayName.trim()) u.displayName = displayName.trim().slice(0, 32);
  if (typeof pic === "string") u.pic = pic.slice(0, 200000);
  if (typeof bio === "string") u.bio = bio.slice(0, 200);
  if (newPassword) {
    if (!oldPassword || !verifyPassword(oldPassword, u.salt, u.hash)) return res.status(400).json({ error: "Current password is incorrect." });
    if (newPassword.length < 4) return res.status(400).json({ error: "New password too short." });
    const h = hashPassword(newPassword); u.salt = h.salt; u.hash = h.hash;
  }
  saveUsers();
  emitFriendsTo(uname);
  res.json({ ok: true, profile: publicProfile(uname) });
});

app.post("/api/friends/add", (req, res) => {
  const uname = requireUser(req, res); if (!uname) return;
  const friend = norm(req.body && req.body.friend);
  if (!validUser(friend)) return res.status(400).json({ error: "Invalid username." });
  if (friend === uname) return res.status(400).json({ error: "You can't add yourself." });
  if (!users[friend]) return res.status(404).json({ error: "No user with that username." });
  const me = users[uname], them = users[friend];
  if (!me.friends.includes(friend)) me.friends.push(friend);
  if (!them.friends.includes(uname)) them.friends.push(uname);
  saveUsers();
  emitFriendsTo(uname); emitFriendsTo(friend);
  res.json({ ok: true, friends: me.friends.map(friendView).filter(Boolean) });
});

app.post("/api/friends/remove", (req, res) => {
  const uname = requireUser(req, res); if (!uname) return;
  const friend = norm(req.body && req.body.friend);
  const me = users[uname], them = users[friend];
  if (me) me.friends = (me.friends || []).filter((f) => f !== friend);
  if (them) them.friends = (them.friends || []).filter((f) => f !== uname);
  saveUsers();
  emitFriendsTo(uname); emitFriendsTo(friend);
  res.json({ ok: true });
});

function emitFriendsTo(uname) {
  if (!users[uname]) return;
  const list = (users[uname].friends || []).map(friendView).filter(Boolean);
  io.to("user:" + uname).emit("friends", list);
}

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

// ---- Socket (DMs) ----
const dmRoom = (a, b) => "dm:" + [a, b].sort().join("|");
// per-room message history (in-memory)
const history = new Map(); // room -> [msg]
function roomMsgs(room) { if (!history.has(room)) history.set(room, []); return history.get(room); }

io.on("connection", (socket) => {
  socket.user = null;
  socket.activeRoom = null;

  socket.on("auth", ({ token }) => {
    const u = userFromToken(token);
    if (!u || !users[u]) { socket.emit("auth-error", "Session expired. Please log in again."); return; }
    socket.user = u;
    online.add(u);
    socket.join("user:" + u);
    socket.emit("authed", { profile: publicProfile(u) });
    emitFriendsTo(u);
    // notify friends of presence
    (users[u].friends || []).forEach((f) => emitFriendsTo(f));
  });

  function ensureAuth() { return !!socket.user; }

  socket.on("dm-open", ({ friend }) => {
    if (!ensureAuth()) return;
    const f = norm(friend);
    if (!users[socket.user].friends.includes(f)) return;
    if (socket.activeRoom) socket.leave(socket.activeRoom);
    const room = dmRoom(socket.user, f);
    socket.activeRoom = room;
    socket.join(room);
    socket.emit("history", roomMsgs(room).slice(-100));
    socket.emit("dm-roster", [publicProfile(socket.user), publicProfile(f)].filter(Boolean));
  });

  socket.on("dm-invite", ({ friend }) => {
    if (!ensureAuth()) return;
    const f = norm(friend);
    if (users[socket.user].friends.includes(f)) io.to("user:" + f).emit("dm-invite", { from: users[socket.user].username });
  });

  socket.on("message", (text) => {
    if (!ensureAuth() || !socket.activeRoom) return;
    const msg = { id: Date.now() + "-" + socket.id + "-" + crypto.randomBytes(3).toString("hex"), user: users[socket.user].username, text: String(text).slice(0, 4000), ts: Date.now() };
    const arr = roomMsgs(socket.activeRoom); arr.push(msg); if (arr.length > 500) arr.shift();
    io.to(socket.activeRoom).emit("message", msg);
  });

  socket.on("media", ({ url, kind }) => {
    if (!ensureAuth() || !socket.activeRoom) return;
    if (typeof url !== "string" || !/^https?:\/\//.test(url)) return;
    const msg = { id: Date.now() + "-" + socket.id + "-" + crypto.randomBytes(3).toString("hex"), user: users[socket.user].username, kind: kind === "sticker" ? "sticker" : "gif", url: url.slice(0, 2000), ts: Date.now() };
    const arr = roomMsgs(socket.activeRoom); arr.push(msg); if (arr.length > 500) arr.shift();
    io.to(socket.activeRoom).emit("message", msg);
  });

  socket.on("file", ({ url, kind, name, size }) => {
    if (!ensureAuth() || !socket.activeRoom) return;
    if (typeof url !== "string" || !/^\/uploads\//.test(url)) return;
    const msg = {
      id: Date.now() + "-" + socket.id + "-" + crypto.randomBytes(3).toString("hex"),
      user: users[socket.user].username,
      kind: kind === "video" ? "video" : "image",
      url: url.slice(0, 400), name: String(name || "").slice(0, 200), size: Number(size) || 0, ts: Date.now(),
    };
    const arr = roomMsgs(socket.activeRoom); arr.push(msg); if (arr.length > 500) arr.shift();
    io.to(socket.activeRoom).emit("message", msg);
  });

  socket.on("delete", ({ id }) => {
    if (!ensureAuth() || !socket.activeRoom) return;
    const arr = roomMsgs(socket.activeRoom);
    const i = arr.findIndex((x) => x.id === id);
    if (i === -1 || arr[i].user !== users[socket.user].username) return;
    arr.splice(i, 1);
    io.to(socket.activeRoom).emit("deleted", { id });
  });

  // calls relayed to the active DM room
  socket.on("call:ring", () => {
    if (socket.activeRoom) socket.to(socket.activeRoom).emit("call:ring", { from: users[socket.user].username, fromName: users[socket.user].displayName });
  });
  socket.on("call:offer", (offer) => { if (socket.activeRoom) socket.to(socket.activeRoom).emit("call:offer", { from: socket.id, offer }); });
  socket.on("call:answer", (answer) => { if (socket.activeRoom) socket.to(socket.activeRoom).emit("call:answer", { from: socket.id, answer }); });
  socket.on("call:ice", (candidate) => { if (socket.activeRoom) socket.to(socket.activeRoom).emit("call:ice", { from: socket.id, candidate }); });
  socket.on("call:accept", () => { if (socket.activeRoom) socket.to(socket.activeRoom).emit("call:accept"); });
  socket.on("call:reject", () => { if (socket.activeRoom) socket.to(socket.activeRoom).emit("call:reject"); });
  socket.on("call:end", () => { if (socket.activeRoom) socket.to(socket.activeRoom).emit("call:end"); });

  socket.on("disconnect", () => {
    if (socket.user) {
      online.delete(socket.user);
      (users[socket.user].friends || []).forEach((f) => emitFriendsTo(f));
    }
  });
});

server.listen(PORT, () => console.log(`Buddy-chat running on http://localhost:${PORT}`));
