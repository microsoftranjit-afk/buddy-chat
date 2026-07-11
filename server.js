const path = require("path");
const http = require("http");
const express = require("express");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public")));
app.get("/healthz", (req, res) => res.json({ ok: true }));

// ---- In-memory state ----
// rooms: Map<roomName, { messages: [], members: Set<socketId> }>
const rooms = new Map();
// socketMeta: Map<socketId, { room, user }>
const socketMeta = new Map();

function getRoom(name) {
  if (!rooms.has(name)) rooms.set(name, { messages: [], members: new Set() });
  return rooms.get(name);
}

function memberNames(roomName) {
  const r = getRoom(roomName);
  const names = [];
  for (const id of r.members) {
    const m = socketMeta.get(id);
    if (m) names.push(m.user);
  }
  return names;
}

io.on("connection", (socket) => {
  let joinedRoom = null;

  socket.on("join", ({ room, user }) => {
    if (!room || !user) return;
    joinedRoom = String(room).slice(0, 64);
    const username = String(user).slice(0, 32);
    socketMeta.set(socket.id, { room: joinedRoom, user: username });

    socket.join(joinedRoom);
    const r = getRoom(joinedRoom);
    r.members.add(socket.id);

    socket.emit("history", r.messages.slice(-100));
    socket.to(joinedRoom).emit("system", `${username} joined`);
    io.to(joinedRoom).emit("members", memberNames(joinedRoom));
  });

  socket.on("message", (text) => {
    const meta = socketMeta.get(socket.id);
    if (!meta) return;
    const msg = {
      id: Date.now() + "-" + socket.id,
      user: meta.user,
      text: String(text).slice(0, 4000),
      ts: Date.now(),
    };
    const r = getRoom(meta.room);
    r.messages.push(msg);
    if (r.messages.length > 500) r.messages.shift();
    io.to(meta.room).emit("message", msg);
  });

  // ---- WebRTC signaling (relayed to the rest of the room) ----
  socket.on("call:ring", () => {
    const meta = socketMeta.get(socket.id);
    if (meta) socket.to(meta.room).emit("call:ring", { fromName: meta.user });
  });
  socket.on("call:offer", (offer) => {
    const meta = socketMeta.get(socket.id);
    if (meta) socket.to(meta.room).emit("call:offer", { from: socket.id, offer });
  });
  socket.on("call:answer", (answer) => {
    const meta = socketMeta.get(socket.id);
    if (meta) socket.to(meta.room).emit("call:answer", { from: socket.id, answer });
  });
  socket.on("call:ice", (candidate) => {
    const meta = socketMeta.get(socket.id);
    if (meta) socket.to(meta.room).emit("call:ice", { from: socket.id, candidate });
  });
  socket.on("call:end", () => {
    const meta = socketMeta.get(socket.id);
    if (meta) socket.to(meta.room).emit("call:end");
  });

  socket.on("disconnect", () => {
    const meta = socketMeta.get(socket.id);
    if (meta) {
      const r = getRoom(meta.room);
      r.members.delete(socket.id);
      socketMeta.delete(socket.id);
      socket.to(meta.room).emit("system", `${meta.user} left`);
      io.to(meta.room).emit("members", memberNames(meta.room));
      socket.to(meta.room).emit("call:end");
    }
  });
});

server.listen(PORT, () => {
  console.log(`Buddy-chat running on http://localhost:${PORT}`);
});
