const path = require("path");
const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const express = require("express");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const PORT = process.env.PORT || 3000;

// ---- Config (Klipy key) ----
let fileConfig = {};
try { fileConfig = JSON.parse(fs.readFileSync(path.join(__dirname, "config.json"), "utf8")); } catch {}
const KLIPY_KEY = process.env.KLIPY_API_KEY || fileConfig.klipyKey || "";

app.use(express.static(path.join(__dirname, "public")));
app.get("/healthz", (req, res) => res.json({ ok: true }));

// ---- In-memory state ----
// rooms: Map<roomName, { messages: [], members: Set<socketId> }>
const rooms = new Map();
// socketMeta: Map<socketId, { room, user, pic, bio }>
const socketMeta = new Map();
// nameIndex: name -> socketId (last writer wins; for DM invites)
const nameIndex = new Map();

function getRoom(name) {
  if (!rooms.has(name)) rooms.set(name, { messages: [], members: new Set() });
  return rooms.get(name);
}
function profileOf(id) {
  const m = socketMeta.get(id);
  if (!m) return null;
  return { name: m.user, pic: m.pic || "", bio: m.bio || "" };
}
function roomRoster(roomName) {
  const r = getRoom(roomName);
  return [...r.members].map(profileOf).filter(Boolean);
}
function directory() {
  return [...socketMeta.values()].map((m) => ({ name: m.user, pic: m.pic || "", bio: m.bio || "" }));
}

function broadcastDirectory() {
  io.emit("directory", directory());
}

io.on("connection", (socket) => {
  let joinedRoom = null;

  socket.on("join", ({ room, user, pic, bio }) => {
    if (!room || !user) return;
    joinedRoom = String(room).slice(0, 80);
    socketMeta.set(socket.id, {
      room: joinedRoom,
      user: String(user).slice(0, 32),
      pic: typeof pic === "string" ? pic.slice(0, 200000) : "",
      bio: typeof bio === "string" ? bio.slice(0, 200) : "",
    });
    nameIndex.set(socketMeta.get(socket.id).user, socket.id);

    socket.join(joinedRoom);
    const r = getRoom(joinedRoom);
    r.members.add(socket.id);

    socket.emit("history", r.messages.slice(-100));
    socket.to(joinedRoom).emit("system", `${socketMeta.get(socket.id).user} joined`);
    io.to(joinedRoom).emit("roster", roomRoster(joinedRoom));
    broadcastDirectory();
  });

  socket.on("profile", ({ pic, bio, name }) => {
    const m = socketMeta.get(socket.id);
    if (!m) return;
    const oldName = m.user;
    if (typeof pic === "string") m.pic = pic.slice(0, 200000);
    if (typeof bio === "string") m.bio = bio.slice(0, 200);
    if (typeof name === "string" && name.trim()) m.user = name.trim().slice(0, 32);
    if (oldName !== m.user && nameIndex.get(oldName) === socket.id) nameIndex.delete(oldName);
    nameIndex.set(m.user, socket.id);
    if (m.room) io.to(m.room).emit("roster", roomRoster(m.room));
    broadcastDirectory();
  });

  socket.on("dm-invite", ({ to, room }) => {
    const id = nameIndex.get(to);
    if (id && id !== socket.id) {
      io.to(id).emit("dm-invite", { room, from: socketMeta.get(socket.id).user });
    }
  });

  socket.on("leave", () => {
    const m = socketMeta.get(socket.id);
    if (!m || !m.room) return;
    const r = getRoom(m.room);
    r.members.delete(socket.id);
    socket.to(m.room).emit("system", `${m.user} left`);
    io.to(m.room).emit("roster", roomRoster(m.room));
    m.room = null;
    joinedRoom = null;
  });

  socket.on("message", (text) => {
    const m = socketMeta.get(socket.id);
    if (!m || !m.room) return;
    const msg = {
      id: Date.now() + "-" + socket.id + "-" + crypto.randomBytes(3).toString("hex"),
      user: m.user,
      text: String(text).slice(0, 4000),
      ts: Date.now(),
    };
    const r = getRoom(m.room);
    r.messages.push(msg);
    if (r.messages.length > 500) r.messages.shift();
    io.to(m.room).emit("message", msg);
  });

  socket.on("media", ({ url, kind }) => {
    const m = socketMeta.get(socket.id);
    if (!m || !m.room) return;
    if (typeof url !== "string" || !/^https?:\/\//.test(url)) return;
    const msg = {
      id: Date.now() + "-" + socket.id + "-" + crypto.randomBytes(3).toString("hex"),
      user: m.user,
      kind: kind === "sticker" ? "sticker" : "gif",
      url: url.slice(0, 2000),
      ts: Date.now(),
    };
    const r = getRoom(m.room);
    r.messages.push(msg);
    if (r.messages.length > 500) r.messages.shift();
    io.to(m.room).emit("message", msg);
  });

  socket.on("delete", ({ id }) => {
    const m = socketMeta.get(socket.id);
    if (!m || !m.room) return;
    const r = getRoom(m.room);
    const idx = r.messages.findIndex((x) => x.id === id);
    if (idx === -1) return;
    // only allow deleting your own messages
    if (r.messages[idx].user !== m.user) return;
    r.messages.splice(idx, 1);
    io.to(m.room).emit("deleted", { id });
  });

  // ---- WebRTC signaling (relayed to the rest of the room) ----
  socket.on("call:ring", () => {
    const m = socketMeta.get(socket.id);
    if (m) socket.to(m.room).emit("call:ring", { fromName: m.user });
  });
  socket.on("call:offer", (offer) => {
    const m = socketMeta.get(socket.id);
    if (m) socket.to(m.room).emit("call:offer", { from: socket.id, offer });
  });
  socket.on("call:answer", (answer) => {
    const m = socketMeta.get(socket.id);
    if (m) socket.to(m.room).emit("call:answer", { from: socket.id, answer });
  });
  socket.on("call:ice", (candidate) => {
    const m = socketMeta.get(socket.id);
    if (m) socket.to(m.room).emit("call:ice", { from: socket.id, candidate });
  });
  socket.on("call:end", () => {
    const m = socketMeta.get(socket.id);
    if (m) socket.to(m.room).emit("call:end");
  });

  socket.on("disconnect", () => {
    const m = socketMeta.get(socket.id);
    if (m) {
      if (m.room) {
        const r = getRoom(m.room);
        r.members.delete(socket.id);
        socket.to(m.room).emit("system", `${m.user} left`);
        io.to(m.room).emit("roster", roomRoster(m.room));
      }
      socketMeta.delete(socket.id);
      if (nameIndex.get(m.user) === socket.id) nameIndex.delete(m.user);
      broadcastDirectory();
    }
  });
});

// ---- Klipy proxy (key stays server-side) ----
async function klipy(req, res, type, endpoint) {
  if (!KLIPY_KEY) return res.status(503).json({ error: "no_key", message: "Add your Klipy API key to config.json (klipyKey) or set KLIPY_API_KEY." });
  try {
    const cid = crypto.randomUUID();
    const url = new URL(`https://api.klipy.com/api/v1/${KLIPY_KEY}/${type}/${endpoint}`);
    url.searchParams.set("customer_id", cid);
    url.searchParams.set("per_page", String(Math.min(40, Math.max(1, parseInt(req.query.per_page) || 24))));
    url.searchParams.set("page", String(Math.max(1, parseInt(req.query.page) || 1)));
    if (req.query.q) url.searchParams.set("q", String(req.query.q).slice(0, 80));
    if (req.query.locale) url.searchParams.set("locale", String(req.query.locale).slice(0, 8));
    const r = await fetch(url, { headers: { Accept: "application/json" } });
    const data = await r.json().catch(() => ({}));
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: "proxy_failed", message: String(e.message || e) });
  }
}
app.get("/api/gifs/trending", (req, res) => klipy(req, res, "gifs", "trending"));
app.get("/api/gifs/search", (req, res) => klipy(req, res, "gifs", "search"));
app.get("/api/stickers/trending", (req, res) => klipy(req, res, "stickers", "trending"));
app.get("/api/stickers/search", (req, res) => klipy(req, res, "stickers", "search"));

server.listen(PORT, () => {
  console.log(`Buddy-chat running on http://localhost:${PORT}`);
});
