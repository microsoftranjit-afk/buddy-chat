(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  if (typeof io === "undefined") { const e = $("authError"); if (e) { e.textContent = "Chat library failed to load. Refresh."; e.classList.remove("hidden"); } return; }

  const socket = io({ transports: ["websocket", "polling"] });

  const AVATAR_COLORS = ["#3390ec", "#e15e54", "#ee8a4a", "#bfa54e", "#5fb05f", "#4aa3a8", "#5a8fd6", "#8e6cc0", "#d463a4", "#6d8a96"];
  function colorFor(name) { let h = 0; for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0; return AVATAR_COLORS[h % AVATAR_COLORS.length]; }
  function initial(name) { return (name || "?").trim().charAt(0).toUpperCase() || "?"; }
  function setIcon(btn, id) { const u = btn.querySelector("use"); if (u) u.setAttribute("href", "#" + id); }
  function avatarEl(name, pic, extra) {
    const av = document.createElement("div"); av.className = "avatar" + (extra ? " " + extra : "");
    if (pic) { const i = document.createElement("img"); i.src = pic; av.appendChild(i); }
    else { av.textContent = initial(name); av.style.background = colorFor(name); }
    return av;
  }

  // Profiles keyed by username
  const profiles = new Map();
  function setProfile(p) { if (!p || !p.username) return; profiles.set(p.username, Object.assign({}, profiles.get(p.username), p)); }
  function nameOf(u) { const p = profiles.get(u); return (p && p.displayName) || u; }

  // ---- Auth state ----
  let token = localStorage.getItem("buddy-token") || "";
  let myUser = localStorage.getItem("buddy-user") || "";
  let myName = localStorage.getItem("buddy-name") || "";
  let myPic = localStorage.getItem("buddy-pic") || "";
  let authed = false;
  let activePeer = null; // {username, displayName, pic, bio}

  function persistAuth() {
    localStorage.setItem("buddy-token", token);
    localStorage.setItem("buddy-user", myUser);
    localStorage.setItem("buddy-name", myName);
    localStorage.setItem("buddy-pic", myPic);
  }
  function clearAuth() { token = ""; myUser = ""; myName = ""; myPic = ""; localStorage.removeItem("buddy-token"); localStorage.removeItem("buddy-user"); localStorage.removeItem("buddy-name"); localStorage.removeItem("buddy-pic"); }

  // DOM
  const authEl = $("auth"), appEl = $("app");
  const messagesEl = $("messages"), msgInput = $("msgInput"), connState = $("connState");

  // ====================================================================
  //  APPEARANCE SETTINGS (fixed: rebuild clears containers)
  // ====================================================================
  const ACCENTS = ["#3390ec", "#e15e54", "#ee8a4a", "#bfa54e", "#5fb05f", "#4aa3a8", "#5a8fd6", "#8e6cc0", "#d463a4", "#6d8a96"];
  const BG_PRESETS = [
    { name: "Classic", value: "var(--bg)" },
    { name: "Dots", value: "radial-gradient(circle at 1px 1px, rgba(130,130,128,.16) 1px, transparent 0) 0 0/20px 20px, var(--bg)" },
    { name: "Grid", value: "linear-gradient(rgba(130,130,128,.10) 1px,transparent 1px) 0 0/24px 24px, linear-gradient(90deg,rgba(130,130,128,.10) 1px,transparent 1px) 0 0/24px 24px, var(--bg)" },
    { name: "Tint", value: "radial-gradient(circle at 25% 15%, color-mix(in srgb, var(--accent) 16%, var(--bg)), var(--bg) 72%)" },
    { name: "Aurora", value: "linear-gradient(135deg, color-mix(in srgb, var(--accent) 12%, var(--bg)), var(--bg) 60%)" },
    { name: "Smoke", value: "radial-gradient(circle at 80% 10%, color-mix(in srgb, var(--accent) 10%, var(--bg)), var(--bg) 65%)" },
  ];
  const DEFAULTS = { theme: "dark", accent: "#3390ec", bg: "Classic", radius: 14, fontSize: 15 };
  const STORE_KEY = "buddy-settings";
  function loadState() { try { return Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem(STORE_KEY)) || {}); } catch { return Object.assign({}, DEFAULTS); } }
  const settings = loadState();
  function saveSettings() { localStorage.setItem(STORE_KEY, JSON.stringify(settings)); }
  function applySettings(s) {
    const root = document.documentElement;
    root.setAttribute("data-theme", s.theme);
    root.style.setProperty("--accent", s.accent);
    root.style.setProperty("--bubble-radius", s.radius + "px");
    root.style.setProperty("--font-size", s.fontSize + "px");
    const bg = BG_PRESETS.find((b) => b.name === s.bg) || BG_PRESETS[0];
    root.style.setProperty("--chat-bg", bg.value);
  }
  function renderAppearance() {
    const dots = $("accentDots"); dots.innerHTML = "";
    ACCENTS.forEach((c) => {
      const b = document.createElement("button");
      b.className = "dot" + (c.toLowerCase() === String(settings.accent).toLowerCase() ? " active" : "");
      b.style.background = c; b.title = c;
      b.addEventListener("click", () => { settings.accent = c; $("accentCustom").value = c; [...dots.children].forEach((d) => d.classList.remove("active")); b.classList.add("active"); applySettings(settings); saveSettings(); });
      dots.appendChild(b);
    });
    const grid = $("bgGrid"); grid.innerHTML = "";
    BG_PRESETS.forEach((p) => {
      const b = document.createElement("button");
      b.className = "bg-swatch" + (p.name === settings.bg ? " active" : "");
      b.style.background = p.value; b.title = p.name;
      b.addEventListener("click", () => { settings.bg = p.name; [...grid.children].forEach((g) => g.classList.remove("active")); b.classList.add("active"); applySettings(settings); saveSettings(); });
      grid.appendChild(b);
    });
    [...$("themeSeg").children].forEach((btn) => { btn.classList.toggle("active", btn.dataset.theme === settings.theme); btn.onclick = () => { settings.theme = btn.dataset.theme; [...$("themeSeg").children].forEach((b) => b.classList.remove("active")); btn.classList.add("active"); applySettings(settings); saveSettings(); }; });
    $("accentCustom").value = settings.accent;
    $("accentCustom").oninput = (e) => { settings.accent = e.target.value; [...dots.children].forEach((d) => d.classList.remove("active")); applySettings(settings); saveSettings(); };
    $("radiusRange").value = settings.radius; $("radiusVal").textContent = settings.radius + "px";
    $("radiusRange").oninput = (e) => { settings.radius = +e.target.value; $("radiusVal").textContent = settings.radius + "px"; applySettings(settings); saveSettings(); };
    $("fontRange").value = settings.fontSize; $("fontVal").textContent = settings.fontSize + "px";
    $("fontRange").oninput = (e) => { settings.fontSize = +e.target.value; $("fontVal").textContent = settings.fontSize + "px"; applySettings(settings); saveSettings(); };
  }
  $("resetSettings").onclick = () => { Object.assign(settings, DEFAULTS); saveSettings(); renderAppearance(); applySettings(settings); };
  $("settingsOpen").onclick = () => $("settings").classList.remove("hidden");
  $("settingsClose").onclick = () => $("settings").classList.add("hidden");
  applySettings(settings); renderAppearance();

  // ====================================================================
  //  API HELPERS
  // ====================================================================
  async function api(path, body, withAuth) {
    const headers = { "Content-Type": "application/json" };
    if (withAuth && token) headers["Authorization"] = "Bearer " + token;
    const res = await fetch(path, { method: "POST", headers, body: JSON.stringify(body || {}) });
    return res.json();
  }

  // ====================================================================
  //  AUTH (login / signup)
  // ====================================================================
  let mode = "login";
  function setMode(m) {
    mode = m;
    $("tabLogin").classList.toggle("active", m === "login");
    $("tabSignup").classList.toggle("active", m === "signup");
    $("dispField").classList.toggle("hidden", m !== "signup");
    $("authBtn").textContent = m === "login" ? "Log in" : "Sign up";
    $("authPass").setAttribute("autocomplete", m === "login" ? "current-password" : "new-password");
  }
  $("tabLogin").onclick = () => setMode("login");
  $("tabSignup").onclick = () => setMode("signup");

  function showAuthError(msg) { $("authError").textContent = msg; $("authError").classList.remove("hidden"); }
  async function doAuth() {
    const username = $("authUser").value.trim();
    const password = $("authPass").value;
    if (!username || !password) return showAuthError("Enter a username and password.");
    const body = { username, password };
    if (mode === "signup") body.displayName = $("authDisp").value.trim();
    showAuthError("");
    const res = await api(mode === "login" ? "/api/login" : "/api/signup", body, false);
    if (!res.ok) return showAuthError(res.error || "Something went wrong.");
    token = res.token; myUser = res.profile.username; myName = res.profile.displayName; myPic = res.profile.pic || "";
    persistAuth();
    enterApp(res.profile);
  }
  $("authBtn").onclick = doAuth;
  [$("authUser"), $("authPass"), $("authDisp")].forEach((el) => el.addEventListener("keydown", (e) => { if (e.key === "Enter") doAuth(); }));

  function enterApp(profile) {
    authEl.classList.add("hidden");
    appEl.classList.remove("hidden");
    renderMyIdentity(profile);
    if (socket.connected) socket.emit("auth", { token });
    loadFriends();
  }
  function renderMyIdentity(p) {
    myName = p.displayName; myPic = p.pic || "";
    $("meName").textContent = myName;
    $("meUser").textContent = "@" + myUser;
    renderMyAvatar();
    $("nameEdit").value = myName;
    $("userEdit").value = "@" + myUser;
    $("bioEdit").value = p.bio || "";
    renderProfilePic();
  }
  function renderMyAvatar() { const a = $("meAvatar"); a.innerHTML = ""; if (myPic) { const i = document.createElement("img"); i.src = myPic; a.appendChild(i); } else { a.textContent = initial(myName); a.style.background = colorFor(myName); } }
  function renderProfilePic() { const a = $("profilePic"); a.innerHTML = ""; if (myPic) { const i = document.createElement("img"); i.src = myPic; a.appendChild(i); } else { a.textContent = initial(myName); a.style.background = colorFor(myName); } }

  function logout() { try { socket.close(); } catch {} clearAuth(); location.reload(); }
  $("logoutBtn").onclick = logout;
  $("logoutBtn2").onclick = logout;

  socket.on("connect", () => { setConn("online"); if (token) socket.emit("auth", { token }); });
  socket.on("disconnect", () => setConn("offline"));
  socket.on("auth-error", () => { clearAuth(); location.reload(); });
  socket.on("authed", ({ profile }) => { renderMyIdentity(profile); renderMyAvatar(); });

  function setConn(state) {
    if (!connState) return;
    connState.className = "conn " + (state === "online" ? "online" : state === "offline" ? "offline" : "");
    connState.textContent = state === "online" ? "online" : state === "offline" ? "offline" : "connecting";
  }

  // ====================================================================
  //  FRIENDS + DMs
  // ====================================================================
  async function loadFriends() {
    try { const res = await api("/api/me", {}, true); if (res.profile) renderMyIdentity(res.profile); if (res.friends) renderFriends(res.friends); } catch {}
  }
  function renderFriends(list) {
    const fl = $("friendsList"); fl.innerHTML = "";
    const others = list || [];
    $("friendsEmpty").style.display = others.length ? "none" : "block";
    others.forEach((p) => {
      setProfile(p);
      const row = document.createElement("div"); row.className = "friend" + (activePeer && p.username === activePeer.username ? " active" : "");
      const av = avatarEl(p.displayName, p.pic);
      const dot = document.createElement("span"); dot.className = "ondot" + (p.online ? " on" : "");
      av.appendChild(dot);
      const meta = document.createElement("div"); meta.className = "friend-meta";
      const nm = document.createElement("div"); nm.className = "friend-name"; nm.textContent = p.displayName;
      const un = document.createElement("div"); un.className = "friend-user"; un.textContent = "@" + p.username;
      meta.append(nm, un); row.append(av, meta);
      row.addEventListener("click", () => openDM(p.username));
      fl.appendChild(row);
    });
  }
  function flashFriendMsg(msg, ok) { const e = $("friendMsg"); e.textContent = msg; e.className = "friend-msg" + (ok ? " ok" : " err"); e.classList.remove("hidden"); setTimeout(() => e.classList.add("hidden"), 2500); }
  $("addFriendBtn").onclick = async () => {
    const f = $("friendInput").value.trim(); if (!f) return;
    const res = await api("/api/friends/add", { friend: f }, true);
    if (!res.ok) return flashFriendMsg(res.error || "Could not add.", false);
    $("friendInput").value = ""; flashFriendMsg("Added @" + f, true); renderFriends(res.friends);
  };
  $("friendInput").addEventListener("keydown", (e) => { if (e.key === "Enter") $("addFriendBtn").click(); });

  function openDM(friendUser, silent) {
    activePeer = profiles.get(friendUser) || { username: friendUser, displayName: friendUser };
    updateHeader();
    messagesEl.innerHTML = "";
    msgInput.disabled = false; $("sendBtn").disabled = false;
    $("callBtn").classList.remove("hidden");
    socket.emit("dm-open", { friend: friendUser });
    msgInput.focus();
    if (!silent) socket.emit("dm-invite", { friend: friendUser });
    renderFriends([...profiles.values()].filter((p) => p.username !== myUser));
  }
  socket.on("friends", (list) => renderFriends(list));
  socket.on("dm-roster", (list) => list.forEach(setProfile));
  socket.on("dm-invite", ({ from }) => openDM(from, true));

  function updateHeader() {
    const peerAvatar = $("peerAvatar"), roomLabel = $("roomLabel"), presence = $("presence");
    if (activePeer) {
      peerAvatar.classList.remove("hidden"); peerAvatar.innerHTML = ""; peerAvatar.appendChild(avatarEl(activePeer.displayName, activePeer.pic, ""));
      roomLabel.textContent = activePeer.displayName;
      const on = (profiles.get(activePeer.username) || {}).online;
      presence.textContent = (activePeer.bio ? activePeer.bio + "  ·  " : "") + "@" + activePeer.username + (on ? "  ·  online" : "  ·  offline");
    } else {
      peerAvatar.classList.add("hidden"); roomLabel.textContent = "Buddy"; presence.textContent = "Select a friend to start chatting";
    }
  }

  // ====================================================================
  //  MESSAGES
  // ====================================================================
  function appendMessage(m) {
    const mine = m.system ? false : m.user === myUser;
    const el = document.createElement("div");
    el.className = "msg" + (mine ? " mine" : "") + (m.system ? " system" : "");
    if (m.id) el.dataset.id = m.id;
    if (m.system) { const b = document.createElement("div"); b.className = "bubble"; b.textContent = m.text; el.appendChild(b); }
    else {
      const p = profiles.get(m.user) || { displayName: m.user };
      el.appendChild(avatarEl(p.displayName, p.pic));
      const wrap = document.createElement("div"); wrap.className = "bubble-wrap";
      const author = document.createElement("div"); author.className = "author"; author.textContent = nameOf(m.user);
      const bubble = document.createElement("div"); bubble.className = "bubble" + (m.kind ? " media" : "");
      if (m.kind) {
        if (/\.(mp4|webm)(?:\?|$)/i.test(m.url)) { const v = document.createElement("video"); v.src = m.url; v.autoplay = true; v.loop = true; v.muted = true; v.playsInline = true; v.className = "media-video"; v.addEventListener("click", () => window.open(m.url, "_blank")); bubble.appendChild(v); }
        else { const img = document.createElement("img"); img.src = m.url; img.alt = m.kind; img.loading = "lazy"; img.addEventListener("click", () => window.open(m.url, "_blank")); bubble.appendChild(img); }
        if (m.kind === "sticker") bubble.classList.add("sticker");
      } else { bubble.textContent = m.text; }
      const time = document.createElement("div"); time.className = "time"; time.textContent = new Date(m.ts || Date.now()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      wrap.append(author, bubble, time); el.append(wrap);
      if (mine) { const del = document.createElement("button"); del.className = "del"; del.title = "Delete"; del.innerHTML = '<svg class="icon"><use href="#icon-trash"/></svg>'; del.addEventListener("click", () => { if (m.id) socket.emit("delete", { id: m.id }); }); el.appendChild(del); }
    }
    messagesEl.appendChild(el); messagesEl.scrollTop = messagesEl.scrollHeight;
  }
  function send() { const t = msgInput.value.trim(); if (!t) return; socket.emit("message", t); msgInput.value = ""; }
  $("sendBtn").addEventListener("click", send);
  msgInput.addEventListener("keydown", (e) => { if (e.key === "Enter" && !msgInput.disabled) send(); });

  socket.on("history", (msgs) => msgs.forEach((m) => appendMessage(m)));
  socket.on("message", (m) => appendMessage(m));
  socket.on("deleted", ({ id }) => { const el = [...messagesEl.children].find((c) => c.dataset.id === id); if (el) el.remove(); });

  // ====================================================================
  //  PROFILE EDITING (server)
  // ====================================================================
  $("picInput").addEventListener("change", (e) => {
    const file = e.target.files && e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      myPic = reader.result;
      renderMyAvatar(); renderProfilePic();
      await api("/api/profile", { pic: myPic }, true);
    };
    reader.readAsDataURL(file); e.target.value = "";
  });
  $("meAvatarBtn").onclick = () => $("picInput").click();
  $("profilePicBtn").onclick = () => $("picInput").click();
  $("nameEdit").addEventListener("change", () => { const v = $("nameEdit").value.trim(); if (!v) return; myName = v; $("meName").textContent = myName; api("/api/profile", { displayName: myName }, true); });
  $("bioEdit").addEventListener("change", () => { api("/api/profile", { bio: $("bioEdit").value.trim() }, true); });
  $("savePass").onclick = async () => {
    const res = await api("/api/profile", { oldPassword: $("oldPass").value, newPassword: $("newPass").value }, true);
    if (!res.ok) return flashFriendMsg(res.error || "Password not updated.", false);
    $("oldPass").value = ""; $("newPass").value = ""; flashFriendMsg("Password updated.", true);
  };

  // ====================================================================
  //  MEDIA PICKER (Klipy)
  // ====================================================================
  let mediaKind = "gif", mediaTimer = null;
  const mediaPanel = $("mediaPanel");
  function hideMedia() { mediaPanel.classList.add("hidden"); }
  $("mediaBtn").onclick = () => { mediaPanel.classList.toggle("hidden"); if (!mediaPanel.classList.contains("hidden")) loadMedia(""); };
  $("mediaClose").onclick = hideMedia;
  $("tabGif").onclick = () => { mediaKind = "gif"; tabGif.classList.add("active"); tabSticker.classList.remove("active"); loadMedia($("mediaSearch").value); };
  $("tabSticker").onclick = () => { mediaKind = "sticker"; tabSticker.classList.add("active"); tabGif.classList.remove("active"); loadMedia($("mediaSearch").value); };
  $("mediaSearch").addEventListener("input", () => { clearTimeout(mediaTimer); mediaTimer = setTimeout(() => loadMedia($("mediaSearch").value), 350); });

  function pickFrom(o, list) { if (!o) return null; for (const e of list) if (o[e] && o[e].url) return o[e].url; return null; }
  function extractMedia(item, kind) {
    const file = item && item.file;
    if (file && (file.hd || file.md)) {
      const hd = file.hd || {}, md = file.md || {};
      const fullList = kind === "sticker" ? ["webp", "png", "gif"] : ["mp4", "gif", "webp"];
      const prevList = ["gif", "webp", "png", "jpg"];
      const full = pickFrom(hd, fullList) || pickFrom(md, fullList);
      const preview = pickFrom(md, prevList) || pickFrom(hd, prevList) || full;
      if (full) return { full, preview: preview || full };
    }
    return null;
  }
  async function loadMedia(q) {
    const grid = $("mediaGrid"), status = $("mediaStatus");
    grid.innerHTML = ""; status.textContent = "Loading…";
    try {
      const base = mediaKind === "sticker" ? "/api/stickers/" : "/api/gifs/";
      const url = base + (q ? "search?q=" + encodeURIComponent(q) : "trending");
      const res = await fetch(url); const data = await res.json();
      const arr = (data.data && data.data.data) ? data.data.data : (data.results || data.items || (Array.isArray(data.data) ? data.data : []));
      if (data.error === "no_key") { status.textContent = "GIFs are not enabled on this server."; return; }
      if (!arr.length) { status.textContent = q ? "No results." : "Nothing found."; return; }
      status.textContent = "";
      arr.slice(0, 40).forEach((item) => {
        const m = extractMedia(item, mediaKind); if (!m || !m.full) return;
        const cell = document.createElement("div"); cell.className = "media-cell";
        const img = document.createElement("img"); img.src = m.preview || m.full; img.loading = "lazy";
        cell.appendChild(img);
        cell.addEventListener("click", () => { socket.emit("media", { url: m.full, kind: mediaKind }); hideMedia(); });
        grid.appendChild(cell);
      });
    } catch { status.textContent = "Could not load media."; }
  }

  // ====================================================================
  //  DEVICES
  // ====================================================================
  const DEV_KEY = "buddy-devices";
  let devices = { mic: "", speaker: "" };
  try { devices = Object.assign({}, devices, JSON.parse(localStorage.getItem(DEV_KEY)) || {}); } catch {}
  function saveDevices() { localStorage.setItem(DEV_KEY, JSON.stringify(devices)); }
  async function refreshDevices() {
    try { await navigator.mediaDevices.getUserMedia({ audio: true }); } catch {}
    const list = await navigator.mediaDevices.enumerateDevices();
    const mic = $("micSelect"), spk = $("speakerSelect");
    mic.innerHTML = '<option value="">Default</option>'; spk.innerHTML = '<option value="">Default</option>';
    list.forEach((d) => {
      if (d.kind === "audioinput") { const o = document.createElement("option"); o.value = d.deviceId; o.textContent = d.label || "Microphone"; mic.appendChild(o); }
      if (d.kind === "audiooutput") { const o = document.createElement("option"); o.value = d.deviceId; o.textContent = d.label || "Speaker"; spk.appendChild(o); }
    });
    mic.value = devices.mic; spk.value = devices.speaker;
  }
  $("deviceRefresh").onclick = refreshDevices;
  $("micSelect").onchange = (e) => { devices.mic = e.target.value; saveDevices(); };
  $("speakerSelect").onchange = (e) => { devices.speaker = e.target.value; saveDevices(); };
  if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) refreshDevices();

  // ====================================================================
  //  CALLS (WebRTC) with device selection
  // ====================================================================
  const callOverlay = $("callOverlay"), localVideo = $("localVideo"), remoteVideo = $("remoteVideo"), callStatus = $("callStatus");
  const STUN = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }, { urls: "stun:stun1.l.google.com:19302" }] };
  let localStream = null, peer = null, inCall = false, pendingOffer = null;

  function setupPeer(initiator) {
    peer = new RTCPeerConnection(STUN);
    peer.onicecandidate = (e) => { if (e.candidate) socket.emit("call:ice", e.candidate); };
    peer.ontrack = (e) => { remoteVideo.srcObject = e.streams[0]; if (devices.speaker && remoteVideo.setSinkId) remoteVideo.setSinkId(devices.speaker).catch(() => {}); };
    if (localStream) localStream.getTracks().forEach((t) => peer.addTrack(t, localStream));
    if (initiator) peer.onnegotiationneeded = async () => { try { const o = await peer.createOffer(); await peer.setLocalDescription(o); socket.emit("call:offer", o); } catch (e) { console.error(e); } };
  }
  async function startCall(asInitiator) {
    const audio = devices.mic ? { deviceId: { exact: devices.mic } } : true;
    try { localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio }); }
    catch { try { localStream = await navigator.mediaDevices.getUserMedia({ audio: devices.mic ? { deviceId: { exact: devices.mic } } : true }); } catch (e2) { alert("Camera or microphone blocked. (" + e2.message + ")"); return; } }
    localVideo.srcObject = localStream; inCall = true;
    callOverlay.classList.remove("hidden"); $("callBtn").classList.add("hidden"); $("hangupBtn").classList.remove("hidden");
    setupPeer(asInitiator); if (pendingOffer) { await handleOffer(pendingOffer); pendingOffer = null; }
  }
  async function handleOffer(offer) {
    if (!inCall) await startCall(false);
    callStatus.textContent = "Connected"; if (!peer) setupPeer(false);
    try { await peer.setRemoteDescription(new RTCSessionDescription(offer)); const a = await peer.createAnswer(); await peer.setLocalDescription(a); socket.emit("call:answer", a); } catch (e) { console.error(e); }
  }
  function endCall() {
    if (peer) { peer.close(); peer = null; }
    if (localStream) { localStream.getTracks().forEach((t) => t.stop()); localStream = null; }
    remoteVideo.srcObject = null; localVideo.srcObject = null; inCall = false; pendingOffer = null;
    callOverlay.classList.add("hidden"); $("callBtn").classList.remove("hidden"); $("hangupBtn").classList.add("hidden"); socket.emit("call:end");
  }
  $("callBtn").onclick = async () => { if (inCall || !activePeer) return; callStatus.textContent = "Ringing, waiting for friend"; socket.emit("call:ring"); await startCall(true); };
  socket.on("call:ring", async ({ fromName }) => { if (inCall) return; callStatus.textContent = fromName + " is calling"; if (confirm(fromName + " is calling. Accept?")) await startCall(false); });
  socket.on("call:offer", ({ offer }) => { if (inCall) handleOffer(offer); else pendingOffer = offer; });
  socket.on("call:answer", async ({ answer }) => { callStatus.textContent = "Connected"; if (peer) { try { await peer.setRemoteDescription(new RTCSessionDescription(answer)); } catch (e) {} } });
  socket.on("call:ice", async ({ candidate }) => { if (peer && candidate) { try { await peer.addIceCandidate(new RTCIceCandidate(candidate)); } catch (e) {} } });
  socket.on("call:end", () => { if (inCall) { callStatus.textContent = "Call ended"; endCall(); } });
  $("hangupBtn").onclick = endCall; $("endCall").onclick = endCall;
  $("toggleAudio").onclick = () => { const t = localStream && localStream.getAudioTracks()[0]; if (t) { t.enabled = !t.enabled; setIcon($("toggleAudio"), t.enabled ? "icon-mic" : "icon-mic-off"); $("toggleAudio").style.background = t.enabled ? "" : "#e2575b"; } };
  $("toggleVideo").onclick = () => { const t = localStream && localStream.getVideoTracks()[0]; if (t) { t.enabled = !t.enabled; setIcon($("toggleVideo"), t.enabled ? "icon-video" : "icon-video-off"); $("toggleVideo").style.background = t.enabled ? "" : "#e2575b"; } };

  // If we already have a token, go straight to the app
  if (token) { authEl.classList.add("hidden"); appEl.classList.remove("hidden"); loadFriends(); renderMyIdentityPlaceholder(); }
  function renderMyIdentityPlaceholder() { $("meUser").textContent = "@" + myUser; $("meName").textContent = myName; renderMyAvatar(); $("nameEdit").value = myName; $("userEdit").value = "@" + myUser; }
})();
