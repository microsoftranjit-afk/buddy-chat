(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);

  // ---- Guard: socket.io must be loaded ----
  if (typeof io === "undefined") {
    const err = $("loginError");
    if (err) {
      err.textContent = "Could not load the chat library. Check your connection and refresh.";
      err.classList.remove("hidden");
    }
    return;
  }

  // Connect to same origin (works for web + Electron shell).
  const socket = io({ transports: ["websocket", "polling"] });

  const AVATAR_COLORS = ["#5865f2", "#23a55a", "#eb459e", "#f0b232", "#e67e22", "#3498db", "#9b59b6", "#1abc9c"];
  function colorFor(name) {
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    return AVATAR_COLORS[h % AVATAR_COLORS.length];
  }
  function initial(name) { return (name || "?").trim().charAt(0).toUpperCase() || "?"; }

  // ---- State ----
  let myName = "";
  let myRoom = "";
  let joined = false;
  let localStream = null;
  let peer = null;
  let inCall = false;
  let pendingOffer = null; // offer received before local stream ready

  const STUN = {
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
    ],
  };

  // ---- DOM refs ----
  const loginEl = $("login");
  const appEl = $("app");
  const nameInput = $("nameInput");
  const roomInput = $("roomInput");
  const joinBtn = $("joinBtn");
  const loginError = $("loginError");
  const messagesEl = $("messages");
  const msgInput = $("msgInput");
  const memberList = $("memberList");
  const connState = $("connState");

  // Prefill room from ?room= invite link
  const params = new URLSearchParams(location.search);
  if (params.get("room")) roomInput.value = params.get("room");

  // ---- Connection state UI ----
  function setConn(state) {
    if (!connState) return;
    connState.className = "conn " + (state === "online" ? "online" : state === "offline" ? "offline" : "");
    connState.textContent = state === "online" ? "online" : state === "offline" ? "disconnected" : "connecting…";
  }
  socket.on("connect", () => {
    setConn("online");
    if (joined) socket.emit("join", { room: myRoom, user: myName }); // rejoin after reconnect
  });
  socket.on("disconnect", () => setConn("offline"));

  // ---- Login ----
  function showLoginError(msg) {
    loginError.textContent = msg;
    loginError.classList.remove("hidden");
  }
  function tryJoin() {
    const name = nameInput.value.trim();
    const room = roomInput.value.trim();
    if (!name) return showLoginError("Please enter your name.");
    if (!room) return showLoginError("Please enter a room name.");
    myName = name;
    myRoom = room;
    joined = true;

    loginEl.classList.add("hidden");
    appEl.classList.remove("hidden");

    $("meName").textContent = myName;
    $("meAvatar").textContent = initial(myName);
    $("meAvatar").style.background = colorFor(myName);
    $("roomLabel").textContent = myRoom;
    $("sideRoom").textContent = myRoom;
    msgInput.placeholder = "Message #" + myRoom + "…";

    socket.emit("join", { room: myRoom, user: myName });
    if (socket.connected) setConn("online");
    msgInput.focus();
  }
  joinBtn.addEventListener("click", tryJoin);
  [nameInput, roomInput].forEach((el) =>
    el.addEventListener("keydown", (e) => { if (e.key === "Enter") tryJoin(); })
  );

  // ---- Messages ----
  function appendMessage(m) {
    const mine = m.system ? false : m.user === myName;
    const el = document.createElement("div");
    el.className = "msg" + (mine ? " mine" : "") + (m.system ? " system" : "");

    if (m.system) {
      const b = document.createElement("div");
      b.className = "bubble";
      b.textContent = m.text;
      el.appendChild(b);
    } else {
      const av = document.createElement("div");
      av.className = "avatar";
      av.textContent = initial(m.user);
      av.style.background = colorFor(m.user);

      const wrap = document.createElement("div");
      wrap.className = "bubble-wrap";
      const author = document.createElement("div");
      author.className = "author";
      author.textContent = m.user;
      const bubble = document.createElement("div");
      bubble.className = "bubble";
      bubble.textContent = m.text;
      const time = document.createElement("div");
      time.className = "time";
      time.textContent = new Date(m.ts || Date.now()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      wrap.append(author, bubble, time);
      el.append(av, wrap);
    }
    messagesEl.appendChild(el);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function send() {
    const text = msgInput.value.trim();
    if (!text) return;
    socket.emit("message", text);
    msgInput.value = "";
  }
  $("sendBtn").addEventListener("click", send);
  msgInput.addEventListener("keydown", (e) => { if (e.key === "Enter") send(); });

  socket.on("history", (msgs) => msgs.forEach((m) => appendMessage(m)));
  socket.on("message", (m) => appendMessage(m));
  socket.on("system", (t) => appendMessage({ system: true, text: t }));
  socket.on("members", (names) => renderMembers(names));

  function renderMembers(names) {
    memberList.innerHTML = "";
    (names || []).forEach((n) => {
      const row = document.createElement("div");
      row.className = "member";
      const av = document.createElement("div");
      av.className = "avatar";
      av.textContent = initial(n);
      av.style.background = colorFor(n);
      const nm = document.createElement("div");
      nm.className = "m-name";
      nm.textContent = n + (n === myName ? " (you)" : "");
      const dot = document.createElement("div");
      dot.className = "dot";
      row.append(av, nm, dot);
      memberList.appendChild(row);
    });
  }

  // ---- Invite link ----
  $("inviteBtn").addEventListener("click", async () => {
    const url = location.origin + "/?room=" + encodeURIComponent(myRoom);
    try {
      await navigator.clipboard.writeText(url);
      const btn = $("inviteBtn");
      const old = btn.textContent;
      btn.textContent = "✓ Link copied";
      setTimeout(() => (btn.textContent = old), 1500);
    } catch {
      prompt("Copy this invite link:", url);
    }
  });

  // ---- Calls (WebRTC) ----
  const callOverlay = $("callOverlay");
  const localVideo = $("localVideo");
  const remoteVideo = $("remoteVideo");
  const callStatus = $("callStatus");

  function setupPeer(initiator) {
    peer = new RTCPeerConnection(STUN);
    peer.onicecandidate = (e) => { if (e.candidate) socket.emit("call:ice", e.candidate); };
    peer.ontrack = (e) => { remoteVideo.srcObject = e.streams[0]; };
    if (localStream) localStream.getTracks().forEach((t) => peer.addTrack(t, localStream));

    if (initiator) {
      peer.onnegotiationneeded = async () => {
        try {
          const offer = await peer.createOffer();
          await peer.setLocalDescription(offer);
          socket.emit("call:offer", offer);
        } catch (e) { console.error(e); }
      };
    }
  }

  async function startCall(asInitiator) {
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    } catch {
      try {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (e2) {
        alert("Camera/microphone blocked. Allow access and try again. (" + e2.message + ")");
        return;
      }
    }
    localVideo.srcObject = localStream;
    inCall = true;
    callOverlay.classList.remove("hidden");
    $("callBtn").classList.add("hidden");
    $("hangupBtn").classList.remove("hidden");
    setupPeer(asInitiator);
    if (pendingOffer) {
      await handleOffer(pendingOffer);
      pendingOffer = null;
    }
  }

  async function handleOffer(offer) {
    if (!inCall) await startCall(false);
    callStatus.textContent = "Connected";
    if (!peer) setupPeer(false);
    try {
      await peer.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      socket.emit("call:answer", answer);
    } catch (e) { console.error(e); }
  }

  function endCall() {
    if (peer) { peer.close(); peer = null; }
    if (localStream) { localStream.getTracks().forEach((t) => t.stop()); localStream = null; }
    remoteVideo.srcObject = null;
    localVideo.srcObject = null;
    inCall = false;
    pendingOffer = null;
    callOverlay.classList.add("hidden");
    $("callBtn").classList.remove("hidden");
    $("hangupBtn").classList.add("hidden");
    socket.emit("call:end");
  }

  $("callBtn").addEventListener("click", async () => {
    if (inCall) return;
    callStatus.textContent = "Ringing… waiting for friend";
    socket.emit("call:ring");
    await startCall(true);
  });

  socket.on("call:ring", async ({ fromName }) => {
    if (inCall) return;
    callStatus.textContent = fromName + " is calling…";
    if (confirm(fromName + " is calling you. Accept?")) {
      await startCall(false);
    }
  });
  socket.on("call:offer", ({ offer }) => { if (inCall) handleOffer(offer); else pendingOffer = offer; });
  socket.on("call:answer", async ({ answer }) => {
    callStatus.textContent = "Connected";
    if (peer) { try { await peer.setRemoteDescription(new RTCSessionDescription(answer)); } catch (e) {} }
  });
  socket.on("call:ice", async ({ candidate }) => {
    if (peer && candidate) { try { await peer.addIceCandidate(new RTCIceCandidate(candidate)); } catch (e) {} }
  });
  socket.on("call:end", () => { if (inCall) { callStatus.textContent = "Call ended"; endCall(); } });

  $("hangupBtn").addEventListener("click", endCall);
  $("endCall").addEventListener("click", endCall);
  $("toggleAudio").addEventListener("click", () => {
    const t = localStream && localStream.getAudioTracks()[0];
    if (t) { t.enabled = !t.enabled; $("toggleAudio").textContent = t.enabled ? "🎤" : "🔇"; $("toggleAudio").style.background = t.enabled ? "" : "var(--red)"; }
  });
  $("toggleVideo").addEventListener("click", () => {
    const t = localStream && localStream.getVideoTracks()[0];
    if (t) { t.enabled = !t.enabled; $("toggleVideo").textContent = t.enabled ? "📷" : "🚫"; $("toggleVideo").style.background = t.enabled ? "" : "var(--red)"; }
  });
})();
