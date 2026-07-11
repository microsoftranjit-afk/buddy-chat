(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);

  if (typeof io === "undefined") {
    const err = $("loginError");
    if (err) {
      err.textContent = "Could not load the chat library. Check your connection and refresh.";
      err.classList.remove("hidden");
    }
    return;
  }

  const socket = io({ transports: ["websocket", "polling"] });

  const AVATAR_COLORS = ["#3390ec", "#e15e54", "#ee8a4a", "#bfa54e", "#5fb05f", "#4aa3a8", "#5a8fd6", "#8e6cc0", "#d463a4", "#6d8a96"];
  function colorFor(name) {
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    return AVATAR_COLORS[h % AVATAR_COLORS.length];
  }
  function initial(name) { return (name || "?").trim().charAt(0).toUpperCase() || "?"; }
  function setIcon(btn, id) {
    const use = btn.querySelector("use");
    if (use) use.setAttribute("href", "#" + id);
  }

  // ---- State ----
  let myName = "";
  let myRoom = "";
  let joined = false;
  let localStream = null;
  let peer = null;
  let inCall = false;
  let pendingOffer = null;

  const STUN = {
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
    ],
  };

  // ---- DOM ----
  const loginEl = $("login");
  const appEl = $("app");
  const nameInput = $("nameInput");
  const roomInput = $("roomInput");
  const joinBtn = $("joinBtn");
  const loginError = $("loginError");
  const messagesEl = $("messages");
  const msgInput = $("msgInput");
  const connState = $("connState");
  const sideSub = $("sideSub");

  const params = new URLSearchParams(location.search);
  if (params.get("room")) roomInput.value = params.get("room");

  // ---- Settings / customization ----
  const ACCENTS = ["#3390ec", "#e15e54", "#ee8a4a", "#bfa54e", "#5fb05f", "#4aa3a8", "#5a8fd6", "#8e6cc0", "#d463a4", "#6d8a96"];
  const BG_PRESETS = [
    { name: "Classic", value: "var(--bg)" },
    { name: "Dots", value: "radial-gradient(circle at 1px 1px, rgba(130,130,130,.16) 1px, transparent 0) 0 0/20px 20px, var(--bg)" },
    { name: "Grid", value: "linear-gradient(rgba(130,130,130,.10) 1px,transparent 1px) 0 0/24px 24px, linear-gradient(90deg,rgba(130,130,128,.10) 1px,transparent 1px) 0 0/24px 24px, var(--bg)" },
    { name: "Tint", value: "radial-gradient(circle at 25% 15%, color-mix(in srgb, var(--accent) 16%, var(--bg)), var(--bg) 72%)" },
    { name: "Aurora", value: "linear-gradient(135deg, color-mix(in srgb, var(--accent) 12%, var(--bg)), var(--bg) 60%)" },
    { name: "Smoke", value: "radial-gradient(circle at 80% 10%, color-mix(in srgb, var(--accent) 10%, var(--bg)), var(--bg) 65%)" },
  ];
  const DEFAULTS = { theme: "dark", accent: "#3390ec", bg: "Classic", radius: 14, fontSize: 15 };
  const STORE_KEY = "buddy-settings";

  function loadState() {
    try {
      const s = JSON.parse(localStorage.getItem(STORE_KEY));
      return Object.assign({}, DEFAULTS, s || {});
    } catch { return Object.assign({}, DEFAULTS); }
  }
  const settings = loadState();

  function applySettings(s) {
    const root = document.documentElement;
    root.setAttribute("data-theme", s.theme);
    root.style.setProperty("--accent", s.accent);
    root.style.setProperty("--bubble-radius", s.radius + "px");
    root.style.setProperty("--font-size", s.fontSize + "px");
    const bg = BG_PRESETS.find((b) => b.name === s.bg) || BG_PRESETS[0];
    root.style.setProperty("--chat-bg", bg.value);
  }

  function saveSettings() { localStorage.setItem(STORE_KEY, JSON.stringify(settings)); }

  function buildSettingsUI() {
    // Accent dots
    const dots = $("accentDots");
    ACCENTS.forEach((c) => {
      const b = document.createElement("button");
      b.className = "dot" + (c.toLowerCase() === settings.accent.toLowerCase() ? " active" : "");
      b.style.background = c;
      b.title = c;
      b.addEventListener("click", () => {
        settings.accent = c;
        $("accentCustom").value = c;
        [...dots.children].forEach((d) => d.classList.remove("active"));
        b.classList.add("active");
        applySettings(settings); saveSettings();
      });
      dots.appendChild(b);
    });

    // Background swatches
    const grid = $("bgGrid");
    BG_PRESETS.forEach((p) => {
      const b = document.createElement("button");
      b.className = "bg-swatch" + (p.name === settings.bg ? " active" : "");
      b.style.background = p.value;
      b.title = p.name;
      b.addEventListener("click", () => {
        settings.bg = p.name;
        [...grid.children].forEach((g) => g.classList.remove("active"));
        b.classList.add("active");
        applySettings(settings); saveSettings();
      });
      grid.appendChild(b);
    });

    // Theme segmented control
    [...$("themeSeg").children].forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.theme === settings.theme);
      btn.addEventListener("click", () => {
        settings.theme = btn.dataset.theme;
        [...$("themeSeg").children].forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        applySettings(settings); saveSettings();
      });
    });

    // Custom accent
    $("accentCustom").value = settings.accent;
    $("accentCustom").addEventListener("input", (e) => {
      settings.accent = e.target.value;
      [...dots.children].forEach((d) => d.classList.remove("active"));
      applySettings(settings); saveSettings();
    });

    // Sliders
    $("radiusRange").value = settings.radius;
    $("radiusVal").textContent = settings.radius + "px";
    $("radiusRange").addEventListener("input", (e) => {
      settings.radius = +e.target.value;
      $("radiusVal").textContent = settings.radius + "px";
      applySettings(settings); saveSettings();
    });
    $("fontRange").value = settings.fontSize;
    $("fontVal").textContent = settings.fontSize + "px";
    $("fontRange").addEventListener("input", (e) => {
      settings.fontSize = +e.target.value;
      $("fontVal").textContent = settings.fontSize + "px";
      applySettings(settings); saveSettings();
    });

    // Reset
    $("resetSettings").addEventListener("click", () => {
      Object.assign(settings, DEFAULTS);
      saveSettings();
      buildSettingsUI();
      applySettings(settings);
    });

    // Drawer open/close
    $("settingsOpen").addEventListener("click", () => $("settings").classList.remove("hidden"));
    $("settingsClose").addEventListener("click", () => $("settings").classList.add("hidden"));
  }

  applySettings(settings);
  buildSettingsUI();

  // ---- Connection state ----
  function setConn(state) {
    if (!connState) return;
    connState.className = "conn " + (state === "online" ? "online" : state === "offline" ? "offline" : "");
    connState.textContent = state === "online" ? "online" : state === "offline" ? "offline" : "connecting";
  }
  socket.on("connect", () => {
    setConn("online");
    if (joined) socket.emit("join", { room: myRoom, user: myName });
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
    $("sideRoomAvatar").textContent = "#";
    $("sideRoomAvatar").style.background = colorFor(myRoom);
    msgInput.placeholder = "Message #" + myRoom;
    sideSub.textContent = "connected";

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
  socket.on("members", (names) => {
    const n = (names || []).length;
    sideSub.textContent = n + (n === 1 ? " member online" : " members online");
  });

  // ---- Invite link ----
  $("inviteBtn").addEventListener("click", async () => {
    const url = location.origin + "/?room=" + encodeURIComponent(myRoom);
    try {
      await navigator.clipboard.writeText(url);
      const btn = $("inviteBtn");
      const old = btn.innerHTML;
      btn.textContent = "Link copied";
      setTimeout(() => (btn.innerHTML = old), 1500);
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
        alert("Camera or microphone blocked. Allow access and try again. (" + e2.message + ")");
        return;
      }
    }
    localVideo.srcObject = localStream;
    inCall = true;
    callOverlay.classList.remove("hidden");
    $("callBtn").classList.add("hidden");
    $("hangupBtn").classList.remove("hidden");
    setupPeer(asInitiator);
    if (pendingOffer) { await handleOffer(pendingOffer); pendingOffer = null; }
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
    callStatus.textContent = "Ringing, waiting for friend";
    socket.emit("call:ring");
    await startCall(true);
  });

  socket.on("call:ring", async ({ fromName }) => {
    if (inCall) return;
    callStatus.textContent = fromName + " is calling";
    if (confirm(fromName + " is calling. Accept?")) await startCall(false);
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
    if (t) { t.enabled = !t.enabled; setIcon($("toggleAudio"), t.enabled ? "icon-mic" : "icon-mic-off"); $("toggleAudio").style.background = t.enabled ? "" : "#e2575b"; }
  });
  $("toggleVideo").addEventListener("click", () => {
    const t = localStream && localStream.getVideoTracks()[0];
    if (t) { t.enabled = !t.enabled; setIcon($("toggleVideo"), t.enabled ? "icon-video" : "icon-video-off"); $("toggleVideo").style.background = t.enabled ? "" : "#e2575b"; }
  });
})();
