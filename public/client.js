(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);

  if (typeof io === "undefined") {
    const err = $("loginError");
    if (err) { err.textContent = "Could not load the chat library. Check your connection and refresh."; err.classList.remove("hidden"); }
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
  function setIcon(btn, id) { const use = btn.querySelector("use"); if (use) use.setAttribute("href", "#" + id); }

  function avatarEl(name, pic, extra) {
    const av = document.createElement("div");
    av.className = "avatar" + (extra ? " " + extra : "");
    if (pic) { const img = document.createElement("img"); img.src = pic; av.appendChild(img); }
    else { av.textContent = initial(name); av.style.background = colorFor(name); }
    return av;
  }

  // Profiles discovered from roster/directory
  const profiles = new Map();
  function setProfile(name, p) { profiles.set(name, Object.assign({}, profiles.get(name), p)); }

  // ---- State ----
  let myName = "";
  let myRoom = "";
  let myPic = "";
  let myBio = "";
  let joined = false;
  let activePeer = null;        // friend profile when in a DM
  let lastRosterCount = 0;
  let localStream = null, peer = null, inCall = false, pendingOffer = null;

  const STUN = {
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
    ],
  };

  const loginEl = $("login");
  const appEl = $("app");
  const nameInput = $("nameInput");
  const roomInput = $("roomInput");
  const joinBtn = $("joinBtn");
  const loginError = $("loginError");
  const messagesEl = $("messages");
  const msgInput = $("msgInput");
  const connState = $("connState");

  // saved profile (name/pic/bio persisted locally)
  const PROFILE_KEY = "buddy-profile";
  let savedProfile = {};
  try { savedProfile = JSON.parse(localStorage.getItem(PROFILE_KEY)) || {}; } catch {}
  if (savedProfile.name) nameInput.value = savedProfile.name;

  // ====================================================================
  //  APPEARANCE SETTINGS (fixed: rebuild clears containers, no duplicates)
  // ====================================================================
  const ACCENTS = ["#3390ec", "#e15e54", "#ee8a4a", "#bfa54e", "#5fb05f", "#4aa3a8", "#5a8fd6", "#8e6cc0", "#d463a4", "#6d8a96"];
  const BG_PRESETS = [
    { name: "Classic", value: "var(--bg)" },
    { name: "Dots", value: "radial-gradient(circle at 1px 1px, rgba(130,130,130,.16) 1px, transparent 0) 0 0/20px 20px, var(--bg)" },
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
    // Accent dots (clear first so reset never duplicates)
    const dots = $("accentDots"); dots.innerHTML = "";
    ACCENTS.forEach((c) => {
      const b = document.createElement("button");
      b.className = "dot" + (c.toLowerCase() === String(settings.accent).toLowerCase() ? " active" : "");
      b.style.background = c; b.title = c;
      b.addEventListener("click", () => {
        settings.accent = c; $("accentCustom").value = c;
        [...dots.children].forEach((d) => d.classList.remove("active"));
        b.classList.add("active"); applySettings(settings); saveSettings();
      });
      dots.appendChild(b);
    });

    // Background swatches
    const grid = $("bgGrid"); grid.innerHTML = "";
    BG_PRESETS.forEach((p) => {
      const b = document.createElement("button");
      b.className = "bg-swatch" + (p.name === settings.bg ? " active" : "");
      b.style.background = p.value; b.title = p.name;
      b.addEventListener("click", () => {
        settings.bg = p.name;
        [...grid.children].forEach((g) => g.classList.remove("active"));
        b.classList.add("active"); applySettings(settings); saveSettings();
      });
      grid.appendChild(b);
    });

    // Theme segmented control
    [...$("themeSeg").children].forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.theme === settings.theme);
      btn.onclick = () => {
        settings.theme = btn.dataset.theme;
        [...$("themeSeg").children].forEach((b) => b.classList.remove("active"));
        btn.classList.add("active"); applySettings(settings); saveSettings();
      };
    });

    // Custom accent
    $("accentCustom").value = settings.accent;
    $("accentCustom").oninput = (e) => {
      settings.accent = e.target.value;
      [...dots.children].forEach((d) => d.classList.remove("active"));
      applySettings(settings); saveSettings();
    };

    // Sliders
    $("radiusRange").value = settings.radius; $("radiusVal").textContent = settings.radius + "px";
    $("radiusRange").oninput = (e) => { settings.radius = +e.target.value; $("radiusVal").textContent = settings.radius + "px"; applySettings(settings); saveSettings(); };
    $("fontRange").value = settings.fontSize; $("fontVal").textContent = settings.fontSize + "px";
    $("fontRange").oninput = (e) => { settings.fontSize = +e.target.value; $("fontVal").textContent = settings.fontSize + "px"; applySettings(settings); saveSettings(); };
  }

  $("resetSettings").onclick = () => { Object.assign(settings, DEFAULTS); saveSettings(); renderAppearance(); applySettings(settings); };
  $("settingsOpen").onclick = () => $("settings").classList.remove("hidden");
  $("settingsClose").onclick = () => $("settings").classList.add("hidden");

  applySettings(settings);
  renderAppearance();

  // ====================================================================
  //  CONNECTION
  // ====================================================================
  function setConn(state) {
    if (!connState) return;
    connState.className = "conn " + (state === "online" ? "online" : state === "offline" ? "offline" : "");
    connState.textContent = state === "online" ? "online" : state === "offline" ? "offline" : "connecting";
  }
  socket.on("connect", () => { setConn("online"); if (joined) socket.emit("join", { room: myRoom, user: myName, pic: myPic, bio: myBio }); });
  socket.on("disconnect", () => setConn("offline"));

  // ====================================================================
  //  LOGIN
  // ====================================================================
  function showLoginError(msg) { loginError.textContent = msg; loginError.classList.remove("hidden"); }
  function tryJoin() {
    const name = nameInput.value.trim();
    const room = roomInput.value.trim();
    if (!name) return showLoginError("Please enter your name.");
    myName = name;
    myRoom = room || ("@" + name);   // empty room -> personal lobby (discoverable)
    myPic = savedProfile.pic || "";
    myBio = savedProfile.bio || "";
    joined = true;
    persistProfile();

    loginEl.classList.add("hidden");
    appEl.classList.remove("hidden");

    $("meName").textContent = myName;
    $("meBio").textContent = myBio;
    renderMyAvatar();
    $("nameEdit").value = myName;
    $("bioEdit").value = myBio;
    renderProfilePic();
    updateHeader();

    socket.emit("join", { room: myRoom, user: myName, pic: myPic, bio: myBio });
    if (socket.connected) setConn("online");
    msgInput.focus();
  }
  joinBtn.addEventListener("click", tryJoin);
  [nameInput, roomInput].forEach((el) => el.addEventListener("keydown", (e) => { if (e.key === "Enter") tryJoin(); }));

  function persistProfile() { localStorage.setItem(PROFILE_KEY, JSON.stringify({ name: myName, pic: myPic, bio: myBio })); }

  // ====================================================================
  //  MESSAGES
  // ====================================================================
  function appendMessage(m) {
    const mine = m.system ? false : m.user === myName;
    const el = document.createElement("div");
    el.className = "msg" + (mine ? " mine" : "") + (m.system ? " system" : "");
    if (m.id) el.dataset.id = m.id;

    if (m.system) {
      const b = document.createElement("div"); b.className = "bubble"; b.textContent = m.text; el.appendChild(b);
    } else {
      const p = profiles.get(m.user) || {};
      el.appendChild(avatarEl(m.user, p.pic));

      const wrap = document.createElement("div"); wrap.className = "bubble-wrap";
      const author = document.createElement("div"); author.className = "author"; author.textContent = m.user;
      const bubble = document.createElement("div");
      bubble.className = "bubble" + (m.kind ? " media" : "");
      if (m.kind) {
        if (/\.(mp4|webm)(?:\?|$)/i.test(m.url)) {
          const v = document.createElement("video");
          v.src = m.url; v.autoplay = true; v.loop = true; v.muted = true; v.playsInline = true;
          v.className = "media-video"; v.addEventListener("click", () => window.open(m.url, "_blank"));
          bubble.appendChild(v);
        } else {
          const img = document.createElement("img");
          img.src = m.url; img.alt = m.kind; img.loading = "lazy";
          img.addEventListener("click", () => window.open(m.url, "_blank"));
          bubble.appendChild(img);
        }
        if (m.kind === "sticker") bubble.classList.add("sticker");
      } else {
        bubble.textContent = m.text;
      }
      const time = document.createElement("div"); time.className = "time";
      time.textContent = new Date(m.ts || Date.now()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      wrap.append(author, bubble, time);
      el.append(wrap);

      if (mine) {
        const del = document.createElement("button");
        del.className = "del"; del.title = "Delete";
        del.innerHTML = '<svg class="icon"><use href="#icon-trash"/></svg>';
        del.addEventListener("click", () => { if (m.id) socket.emit("delete", { id: m.id }); });
        el.appendChild(del);
      }
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
  socket.on("roster", (list) => {
    (list || []).forEach((p) => setProfile(p.name, p));
    lastRosterCount = (list || []).length;
    updateHeader();
  });
  socket.on("directory", (list) => { (list || []).forEach((p) => setProfile(p.name, p)); renderFriends(list); });
  socket.on("deleted", ({ id }) => {
    const el = [...messagesEl.children].find((c) => c.dataset.id === id);
    if (el) el.remove();
  });

  // ====================================================================
  //  FRIENDS + DM
  // ====================================================================
  function renderFriends(list) {
    const fl = $("friendsList"); fl.innerHTML = "";
    const others = (list || []).filter((p) => p.name !== myName);
    $("friendsEmpty").style.display = others.length ? "none" : "block";
    others.forEach((p) => {
      const row = document.createElement("div"); row.className = "friend";
      if (activePeer && p.name === activePeer.name) row.classList.add("active");
      row.appendChild(avatarEl(p.name, p.pic));
      const meta = document.createElement("div"); meta.className = "friend-meta";
      const nm = document.createElement("div"); nm.className = "friend-name"; nm.textContent = p.name;
      const bi = document.createElement("div"); bi.className = "friend-bio"; bi.textContent = p.bio || "";
      meta.append(nm, bi); row.appendChild(meta);
      row.addEventListener("click", () => openDM(p));
      fl.appendChild(row);
    });
  }

  function dmRoomWith(friendName) { return "dm:" + [myName, friendName].sort().join("|"); }

  function switchRoom(room, peer) {
    if (myRoom && myRoom !== room) socket.emit("leave");
    myRoom = room;
    activePeer = peer || null;
    updateHeader();
    socket.emit("join", { room, user: myName, pic: myPic, bio: myBio });
    messagesEl.innerHTML = "";
    hideMedia();
  }

  function openDM(friend, roomOverride, silent) {
    const room = roomOverride || dmRoomWith(friend.name);
    switchRoom(room, friend);
    if (!silent) socket.emit("dm-invite", { to: friend.name, room });
  }

  socket.on("dm-invite", ({ room, from }) => {
    openDM({ name: from, pic: (profiles.get(from) || {}).pic, bio: (profiles.get(from) || {}).bio }, room, true);
  });

  function updateHeader() {
    const titleHash = $("titleHash"), roomLabel = $("roomLabel"), peerAvatar = $("peerAvatar"), presence = $("presence");
    if (activePeer) {
      titleHash.classList.add("hidden");
      peerAvatar.classList.remove("hidden");
      peerAvatar.innerHTML = "";
      peerAvatar.appendChild(avatarEl(activePeer.name, activePeer.pic, ""));
      roomLabel.textContent = activePeer.name;
      presence.textContent = activePeer.bio || "Direct message";
    } else {
      titleHash.classList.remove("hidden");
      peerAvatar.classList.add("hidden");
      roomLabel.textContent = myRoom.startsWith("@") ? "Your space" : myRoom;
      presence.textContent = myRoom.startsWith("@") ? "Pick a friend to chat" : (lastRosterCount + (lastRosterCount === 1 ? " member online" : " members online"));
    }
  }

  // ====================================================================
  //  INVITE LINK
  // ====================================================================
  $("inviteBtn").addEventListener("click", async () => {
    const url = location.origin + "/?room=" + encodeURIComponent(myRoom.replace(/^@/, ""));
    try {
      await navigator.clipboard.writeText(url);
      const btn = $("inviteBtn"); const old = btn.innerHTML;
      btn.textContent = "Link copied"; setTimeout(() => (btn.innerHTML = old), 1500);
    } catch { prompt("Copy this invite link:", url); }
  });

  // ====================================================================
  //  PROFILE EDITING
  // ====================================================================
  function renderMyAvatar() {
    const a = $("meAvatar"); a.innerHTML = "";
    if (myPic) { const img = document.createElement("img"); img.src = myPic; a.appendChild(img); }
    else { a.textContent = initial(myName); a.style.background = colorFor(myName); }
  }
  function renderProfilePic() {
    const a = $("profilePic"); a.innerHTML = "";
    if (myPic) { const img = document.createElement("img"); img.src = myPic; a.appendChild(img); }
    else { a.textContent = initial(myName); a.style.background = colorFor(myName); }
  }
  function emitProfile() { socket.emit("profile", { name: myName, pic: myPic, bio: myBio }); }

  $("picInput").addEventListener("change", (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      myPic = reader.result; persistProfile(); renderMyAvatar(); renderProfilePic(); emitProfile();
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  });
  $("meAvatarBtn").addEventListener("click", () => $("picInput").click());
  $("profilePicBtn").addEventListener("click", () => $("picInput").click());
  $("nameEdit").addEventListener("change", () => {
    const v = $("nameEdit").value.trim(); if (!v) return;
    myName = v; persistProfile(); $("meName").textContent = myName; emitProfile(); updateHeader();
  });
  $("bioEdit").addEventListener("change", () => {
    myBio = $("bioEdit").value.trim(); persistProfile(); $("meBio").textContent = myBio; emitProfile();
  });

  // ====================================================================
  //  MEDIA PICKER (Klipy, Discord-style)
  // ====================================================================
  let mediaKind = "gif";
  let mediaTimer = null;
  const mediaPanel = $("mediaPanel");
  function hideMedia() { mediaPanel.classList.add("hidden"); }
  $("mediaBtn").addEventListener("click", () => {
    mediaPanel.classList.toggle("hidden");
    if (!mediaPanel.classList.contains("hidden")) loadMedia("");
  });
  $("mediaClose").addEventListener("click", hideMedia);
  $("tabGif").onclick = () => { mediaKind = "gif"; tabGif.classList.add("active"); tabSticker.classList.remove("active"); loadMedia($("mediaSearch").value); };
  $("tabSticker").onclick = () => { mediaKind = "sticker"; tabSticker.classList.add("active"); tabGif.classList.remove("active"); loadMedia($("mediaSearch").value); };
  $("mediaSearch").addEventListener("input", () => {
    clearTimeout(mediaTimer);
    mediaTimer = setTimeout(() => loadMedia($("mediaSearch").value), 350);
  });

  function collectUrls(obj, out) {
    out = out || [];
    if (typeof obj === "string") { if (/^https?:\/\//.test(obj)) out.push(obj); }
    else if (obj && typeof obj === "object") { for (const k in obj) collectUrls(obj[k], out); }
    return out;
  }
  function pickFrom(o, list) { if (!o) return null; for (const e of list) if (o[e] && o[e].url) return o[e].url; return null; }
  function extractMedia(item, kind) {
    // Klipy shape: item.file.hd|md.{gif,webp,png,jpg,mp4,webm}.url
    const file = item && item.file;
    if (file && (file.hd || file.md)) {
      const hd = file.hd || {}, md = file.md || {};
      const fullList = kind === "sticker" ? ["webp", "png", "gif"] : ["mp4", "gif", "webp"];
      const prevList = ["gif", "webp", "png", "jpg"];
      const full = pickFrom(hd, fullList) || pickFrom(md, fullList);
      const preview = pickFrom(md, prevList) || pickFrom(hd, prevList) || full;
      if (full) return { full, preview: preview || full };
    }
    // Generic fallback
    const urls = collectUrls(item);
    const scored = urls.map((u) => { const m = u.match(/\.(mp4|webm|gif|webp|png|jpe?g)(?:\?|$)/i); return { u, ext: m ? m[1].toLowerCase() : "" }; });
    const want = kind === "sticker" ? ["png", "webp", "gif"] : ["mp4", "gif", "webp"];
    let full = null; for (const e of want) { const f = scored.find((s) => s.ext === e); if (f) { full = f.u; break; } }
    if (!full) { const any = scored.find((s) => ["gif", "webp", "png", "mp4"].includes(s.ext)); full = any ? any.u : urls[0]; }
    const imgList = ["gif", "webp", "png", "jpg"];
    let preview = null; for (const e of imgList) { const f = scored.find((s) => s.ext === e); if (f) { preview = f.u; break; } }
    return { full, preview: preview || full };
  }

  async function loadMedia(q) {
    const grid = $("mediaGrid"); const status = $("mediaStatus");
    grid.innerHTML = ""; status.textContent = "Loading…";
    try {
      const base = mediaKind === "sticker" ? "/api/stickers/" : "/api/gifs/";
      const url = base + (q ? "search?q=" + encodeURIComponent(q) : "trending");
      const res = await fetch(url);
      const data = await res.json();
      const arr = (data.data && data.data.data) ? data.data.data
        : (data.results || data.items || (Array.isArray(data.data) ? data.data : []));
      const results = arr || [];
      if (data.error === "no_key") { status.textContent = "Add your Klipy API key on the server to enable GIFs."; return; }
      if (!results.length) { status.textContent = q ? "No results." : "Nothing found."; return; }
      status.textContent = "";
      results.slice(0, 40).forEach((item) => {
        const m = extractMedia(item, mediaKind);
        if (!m.full) return;
        const cell = document.createElement("div"); cell.className = "media-cell";
        const img = document.createElement("img"); img.src = m.preview || m.full; img.loading = "lazy";
        cell.appendChild(img);
        cell.addEventListener("click", () => {
          socket.emit("media", { url: m.full, kind: mediaKind });
          hideMedia();
        });
        grid.appendChild(cell);
      });
    } catch (err) {
      status.textContent = "Could not load media.";
    }
  }

  // ====================================================================
  //  DEVICES (mic input + speaker/headset output)
  // ====================================================================
  const DEV_KEY = "buddy-devices";
  let devices = { mic: "", speaker: "" };
  try { devices = Object.assign({}, devices, JSON.parse(localStorage.getItem(DEV_KEY)) || {}); } catch {}
  function saveDevices() { localStorage.setItem(DEV_KEY, JSON.stringify(devices)); }

  async function refreshDevices() {
    try { await navigator.mediaDevices.getUserMedia({ audio: true }); } catch {}
    const list = await navigator.mediaDevices.enumerateDevices();
    const mic = $("micSelect"), spk = $("speakerSelect");
    const curMic = devices.mic, curSpk = devices.speaker;
    mic.innerHTML = '<option value="">Default</option>';
    spk.innerHTML = '<option value="">Default</option>';
    list.forEach((d) => {
      if (d.kind === "audioinput") { const o = document.createElement("option"); o.value = d.deviceId; o.textContent = d.label || "Microphone"; mic.appendChild(o); }
      if (d.kind === "audiooutput") { const o = document.createElement("option"); o.value = d.deviceId; o.textContent = d.label || "Speaker"; spk.appendChild(o); }
    });
    mic.value = curMic; spk.value = curSpk;
  }
  $("deviceRefresh").addEventListener("click", refreshDevices);
  $("micSelect").addEventListener("change", (e) => { devices.mic = e.target.value; saveDevices(); });
  $("speakerSelect").addEventListener("change", (e) => { devices.speaker = e.target.value; saveDevices(); });
  if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) refreshDevices();

  // ====================================================================
  //  CALLS (WebRTC) with device selection
  // ====================================================================
  const callOverlay = $("callOverlay");
  const localVideo = $("localVideo");
  const remoteVideo = $("remoteVideo");
  const callStatus = $("callStatus");

  function setupPeer(initiator) {
    peer = new RTCPeerConnection(STUN);
    peer.onicecandidate = (e) => { if (e.candidate) socket.emit("call:ice", e.candidate); };
    peer.ontrack = (e) => {
      remoteVideo.srcObject = e.streams[0];
      if (devices.speaker && remoteVideo.setSinkId) remoteVideo.setSinkId(devices.speaker).catch(() => {});
    };
    if (localStream) localStream.getTracks().forEach((t) => peer.addTrack(t, localStream));
    if (initiator) {
      peer.onnegotiationneeded = async () => {
        try { const offer = await peer.createOffer(); await peer.setLocalDescription(offer); socket.emit("call:offer", offer); } catch (e) { console.error(e); }
      };
    }
  }
  async function startCall(asInitiator) {
    const audio = devices.mic ? { deviceId: { exact: devices.mic } } : true;
    try { localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio }); }
    catch {
      try { localStream = await navigator.mediaDevices.getUserMedia({ audio: devices.mic ? { deviceId: { exact: devices.mic } } : true }); }
      catch (e2) { alert("Camera or microphone blocked. Allow access and try again. (" + e2.message + ")"); return; }
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
    remoteVideo.srcObject = null; localVideo.srcObject = null;
    inCall = false; pendingOffer = null;
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
  socket.on("call:ice", async ({ candidate }) => { if (peer && candidate) { try { await peer.addIceCandidate(new RTCIceCandidate(candidate)); } catch (e) {} } });
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
