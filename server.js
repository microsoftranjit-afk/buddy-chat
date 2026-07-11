const path = require("path");
const http = require("http");
const express = require("express");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public")));

// ---- In-memory state ----
// rooms: { roomName: { messages: [], members: Set<socketId> } }
const rooms = new Map();
// call state per room: who is in an active call
const callState = new Map();

function getRoom(name) {
  if (!rooms.has(name)) {
    rooms.set(name, { messages: [], members: new Set() });
  }
  return rooms.get(name);
}

io.on("connection", (socket) => {
  let joinedRoom = null;
  let username = null;

  socket.on("join", ({ room, user }) => {
    if (!room || !user) return;
    joinedRoom = String(room).slice(0, 64);
    username = String(user).slice(0, 32);
    socket.join(joinedRoom);
    const r = getRoom(joinedRoom);
    r.members.add(socket.id);

    // send recent history (last 100)
    socket.emit("history", r.messages.slice(-100));

    // notify others
    socket.to(joinedRoom).emit("system", `${username} joined the room`);
    io.to(joinedRoom).emit("members", r.members.size);
  });

  socket.on("message", (text) => {
    if (!joinedRoom || !username) return;
    const msg = {
      id: Date.now() + "-" + socket.id,
      user: username,
      text: String(text).slice(0, 4000),
      ts: Date.now(),
    };
    const r = getRoom(joinedRoom);
    r.messages.push(msg);
    if (r.messages.length > 500) r.messages.shift();
    io.to(joinedRoom).emit("message", msg);
  });

  // ---- WebRTC signaling for voice/video calls ----
  // Relay all signaling to the rest of the room (designed for 1:1 calls).
  socket.on("call:ring", () => {
    if (joinedRoom) socket.to(joinedRoom).emit("call:ring", { fromName: username });
  });
  socket.on("call:offer", (offer) => {
    if (joinedRoom) socket.to(joinedRoom).emit("call:offer", { from: socket.id, offer });
  });
  socket.on("call:answer", (answer) => {
    if (joinedRoom) socket.to(joinedRoom).emit("call:answer", { from: socket.id, answer });
  });
  socket.on("call:ice", (candidate) => {
    if (joinedRoom) socket.to(joinedRoom).emit("call:ice", { from: socket.id, candidate });
  });
  socket.on("call:end", () => {
    if (joinedRoom) socket.to(joinedRoom).emit("call:end");
  });

  socket.on("disconnect", () => {
    if (joinedRoom && username) {
      const r = getRoom(joinedRoom);
      r.members.delete(socket.id);
      socket.to(joinedRoom).emit("system", `${username} left the room`);
      io.to(joinedRoom).emit("members", r.members.size);
      socket.to(joinedRoom).emit("call:end");
    }
  });
});

server.listen(PORT, () => {
  console.log(`Buddy-chat running on http://localhost:${PORT}`);
});
