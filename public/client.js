(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  if (typeof io === "undefined") { const e = $("authError"); if (e) { e.textContent = "Chat library failed to load. Refresh."; e.classList.remove("hidden"); } return; }

  const socket = io({ transports: ["websocket", "polling"] });

  const AVATAR_COLORS = ["#5865f2", "#e15e54", "#ee8a4a", "#bfa54e", "#5fb05f", "#4aa3a8", "#5a8fd6", "#8e6cc0", "#d463a4", "#6d8a96"];
  function colorFor(name) { let h = 0; for (let i = 0; i < (name || "?").length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0; return AVATAR_COLORS[h % AVATAR_COLORS.length]; }
  function initial(name) { return (name || "?").trim().charAt(0).toUpperCase() || "?"; }
  function setIcon(btn, id) { const u = btn.querySelector("use"); if (u) u.setAttribute("href", "#" + id); }
  function avatarEl(name, pic, extra) {
    const av = document.createElement("div"); av.className = "avatar" + (extra ? " " + extra : "");
    if (pic) { const i = document.createElement("img"); i.src = pic; av.appendChild(i); }
    else { av.textContent = initial(name); av.style.background = colorFor(name); }
    return av;
  }
  function fmtSize(b) { if (!b) return ""; const u = ["B", "KB", "MB", "GB"]; let i = 0; while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; } return b.toFixed(b < 10 && i > 0 ? 1 : 0) + " " + u[i]; }
  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

  const profiles = new Map();
  function setProfile(p) { if (!p || !p.username) return; profiles.set(p.username, Object.assign({}, profiles.get(p.username), p)); }
  function nameOf(u) { const p = profiles.get(u); return (p && p.displayName) || u; }

  // ---- Auth state ----
  let token = localStorage.getItem("buddy-token") || "";
  let myUser = localStorage.getItem("buddy-user") || "";
  let myName = localStorage.getItem("buddy-name") || "";
  let myPic = localStorage.getItem("buddy-pic") || "";
  let activePeer = null;

  function persistAuth() {
    localStorage.setItem("buddy-token", token);
    localStorage.setItem("buddy-user", myUser);
    localStorage.setItem("buddy-name", myName);
    localStorage.setItem("buddy-pic", myPic);
  }
  function clearAuth() { token = ""; myUser = ""; myName = ""; myPic = ""; ["buddy-token", "buddy-user", "buddy-name", "buddy-pic"].forEach((k) => localStorage.removeItem(k)); }

  const authEl = $("auth"), appEl = $("app");
  const messagesEl = $("messages"), msgInput = $("msgInput"), connState = $("connState");

  // ====================================================================
  //  APPEARANCE
  // ====================================================================
  const ACCENTS = ["#5865f2", "#e15e54", "#ee8a4a", "#bfa54e", "#5fb05f", "#4aa3a8", "#5a8fd6", "#8e6cc0", "#d463a4", "#6d8a96"];
  const BG_PRESETS = [
    { name: "Classic", value: "var(--bg)" },
    { name: "Dots", value: "radial-gradient(circle at 1px 1px, rgba(130,130,128,.16) 1px, transparent 0) 0 0/20px 20px, var(--bg)" },
    { name: "Grid", value: "linear-gradient(rgba(130,130,128,.10) 1px,transparent 1px) 0 0/24px 24px, linear-gradient(90deg,rgba(130,130,128,.10) 1px,transparent 1px) 0 0/24px 24px, var(--bg)" },
    { name: "Tint", value: "radial-gradient(circle at 25% 15%, color-mix(in srgb, var(--accent) 16%, var(--bg)), var(--bg) 72%)" },
    { name: "Aurora", value: "linear-gradient(135deg, color-mix(in srgb, var(--accent) 12%, var(--bg)), var(--bg) 60%)" },
    { name: "Smoke", value: "radial-gradient(circle at 80% 10%, color-mix(in srgb, var(--accent) 10%, var(--bg)), var(--bg) 65%)" },
  ];
  const DEFAULTS = { theme: "dark", accent: "#5865f2", bg: "Classic", radius: 14, fontSize: 15, enter: true, compact: false, timestamps: false, sound: false };
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
    const t = (id, key) => { $(id).checked = !!settings[key]; $(id).onchange = (e) => { settings[key] = e.target.checked; saveSettings(); }; };
    t("toggleEnter", "enter"); t("toggleCompact", "compact"); t("toggleTimestamps", "timestamps"); t("toggleSound", "sound");
  }
  $("resetSettings").onclick = () => { Object.assign(settings, DEFAULTS); saveSettings(); renderAppearance(); applySettings(settings); };
  $("settingsOpen").onclick = () => $("settings").classList.remove("hidden");
  $("settingsClose").onclick = () => $("settings").classList.add("hidden");
  applySettings(settings); renderAppearance();

  // ====================================================================
  //  API
  // ====================================================================
  async function api(path, body, withAuth) {
    const headers = { "Content-Type": "application/json" };
    if (withAuth && token) headers["Authorization"] = "Bearer " + token;
    const res = await fetch(path, { method: "POST", headers, body: JSON.stringify(body || {}) });
    return res.json();
  }

  // ---- ICE config ----
  let ICE = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }, { urls: "stun:stun1.l.google.com:19302" }] };
  fetch("/api/config").then((r) => r.json()).then((d) => { if (d && d.iceServers) ICE = d; }).catch(() => {});

  // ====================================================================
  //  AUTH
  // ====================================================================
  let mode = "login";
  function setMode(m) {
    mode = m;
    $("tabLogin").classList.toggle("active", m === "login");
    $("tabSignup").classList.toggle("active", m === "signup");
    $("dispField").classList.toggle("hidden", m !== "signup");
    $("emailField").classList.toggle("hidden", m !== "signup");
    $("authBtn").textContent = m === "login" ? "Log in" : "Sign up";
    $("authPass").setAttribute("autocomplete", m === "login" ? "current-password" : "new-password");
  }
  $("tabLogin").onclick = () => setMode("login");
  $("tabSignup").onclick = () => setMode("signup");

  function showAuthError(msg) { const e = $("authError"); e.textContent = msg; e.classList.remove("hidden"); }
  async function doAuth() {
    const username = $("authUser").value.trim();
    const password = $("authPass").value;
    if (!username || !password) return showAuthError("Enter a username and password.");
    const body = { username, password };
    if (mode === "signup") { body.displayName = $("authDisp").value.trim(); body.email = $("authEmail").value.trim(); }
    showAuthError("");
    const res = await api(mode === "login" ? "/api/login" : "/api/signup", body, false);
    if (!res.ok) return showAuthError(res.error || "Something went wrong.");
    token = res.token; myUser = res.profile.username; myName = res.profile.displayName; myPic = res.profile.pic || "";
    persistAuth();
    enterApp(res.profile);
  }
  $("authBtn").onclick = doAuth;
  [$("authUser"), $("authPass"), $("authDisp"), $("authEmail")].forEach((el) => el.addEventListener("keydown", (e) => { if (e.key === "Enter") doAuth(); }));

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
    connState.className = "conn-pill " + (state === "online" ? "online" : state === "offline" ? "offline" : "");
  }

  // ====================================================================
  //  FRIENDS + DMs
  // ====================================================================
  async function loadFriends() {
    try { const res = await api("/api/me", {}, true); if (res.profile) renderMyIdentity(res.profile); if (res.friends) renderFriends(res.friends); } catch {}
  }
  function renderFriends(list) {
    const fl = $("friendsList"); fl.innerHTML = "";
    const others = (list || []);
    $("friendsEmpty").style.display = others.length ? "none" : "block";
    others.forEach((p) => {
      setProfile(p);
      const row = document.createElement("div"); row.className = "friend" + (activePeer && p.username === activePeer.username ? " active" : "");
      const av = avatarEl(p.displayName, p.pic);
      const dot = document.createElement("span"); dot.className = "ondot" + (p.online ? " on" : "");
      av.appendChild(dot);
      const meta = document.createElement("div"); meta.className = "friend-meta";
      const nm = document.createElement("div"); nm.className = "friend-name"; nm.textContent = p.displayName;
      const un = document.createElement("div"); un.className = "friend-bio"; un.textContent = p.bio ? p.bio : "@" + p.username;
      meta.append(nm, un); row.append(av, meta);
      row.addEventListener("click", () => openDM(p.username));
      fl.appendChild(row);
    });
  }
  function flashFriendMsg(msg, ok) { const e = $("friendMsg"); e.textContent = msg; e.className = "friend-msg" + (ok ? " ok" : " err"); e.classList.remove("hidden"); setTimeout(() => e.classList.add("hidden"), 2500); }
  $("friendInput").addEventListener("keydown", (e) => { if (e.key === "Enter") addFriend(); });
  async function addFriend() {
    const f = $("friendInput").value.trim(); if (!f) return;
    const res = await api("/api/friends/add", { friend: f }, true);
    if (!res.ok) return flashFriendMsg(res.error || "Could not add.", false);
    $("friendInput").value = ""; flashFriendMsg("Added @" + f, true); renderFriends(res.friends);
  }
  // add-friend button is the + icon inside the input; make whole row clickable
  document.querySelector(".add-friend").addEventListener("click", (e) => { if (e.target.closest(".field-icon")) addFriend(); });

  function openDM(friendUser, silent) {
    activePeer = profiles.get(friendUser) || { username: friendUser, displayName: friendUser };
    updateHeader();
    messagesEl.innerHTML = ""; lastDay = "";
    msgInput.disabled = false; $("sendBtn").disabled = false; $("attachBtn").disabled = false; $("mediaBtn").disabled = false;
    $("callBtn").classList.remove("hidden");
    socket.emit("dm-open", { friend: friendUser });
    if (!silent) socket.emit("dm-invite", { friend: friendUser });
    renderFriends([...profiles.values()].filter((p) => p.username !== myUser));
  }
  socket.on("friends", (list) => renderFriends(list));
  socket.on("dm-roster", (list) => list.forEach(setProfile));
  socket.on("dm-invite", ({ from }) => { if (!inCall) openDM(from, true); });

  function updateHeader() {
    const peerAvatar = $("peerAvatar"), roomLabel = $("roomLabel"), presence = $("presence");
    if (activePeer) {
      peerAvatar.classList.remove("hidden"); peerAvatar.innerHTML = ""; peerAvatar.appendChild(avatarEl(activePeer.displayName, activePeer.pic, ""));
      roomLabel.textContent = activePeer.displayName;
      const on = (profiles.get(activePeer.username) || {}).online;
      presence.textContent = (activePeer.bio ? activePeer.bio + "  ·  " : "") + "@" + activePeer.username;
      presence.classList.toggle("online", !!on);
    } else {
      peerAvatar.classList.add("hidden"); roomLabel.textContent = "Buddy"; presence.textContent = "Select a friend to start chatting"; presence.classList.remove("online");
    }
  }

  // ====================================================================
  //  MESSAGES
  // ====================================================================
  let lastDay = "";
  function dayLabel(ts) { const d = new Date(ts); const today = new Date(); const y = new Date(); y.setDate(today.getDate() - 1); const same = (a, b) => a.toDateString() === b.toDateString(); if (same(d, today)) return "Today"; if (same(d, y)) return "Yesterday"; return d.toLocaleDateString([], { month: "short", day: "numeric", year: d.getFullYear() === today.getFullYear() ? undefined : "numeric" }); }
  function dayKey(ts) { return new Date(ts).toDateString(); }

  function appendMessage(m) {
    if (m.id && [...messagesEl.children].some((c) => c.dataset.id === m.id)) return;
    const key = dayKey(m.ts || Date.now());
    if (key !== lastDay) {
      lastDay = key;
      const sep = document.createElement("div"); sep.className = "day-sep"; sep.textContent = dayLabel(m.ts || Date.now());
      messagesEl.appendChild(sep);
    }
    const mine = m.system ? false : m.user === myUser;
    const el = document.createElement("div");
    el.className = "msg" + (mine ? " mine" : "") + (m.system ? " system" : "") + (settings.compact ? " compact" : "");
    if (m.id) el.dataset.id = m.id;
    if (m.system) { const b = document.createElement("div"); b.className = "bubble"; b.textContent = m.text; el.appendChild(b); }
    else {
      const p = profiles.get(m.user) || { displayName: m.user };
      el.appendChild(avatarEl(p.displayName, p.pic));
      const wrap = document.createElement("div"); wrap.className = "bubble-wrap";
      const author = document.createElement("div"); author.className = "author"; author.textContent = nameOf(m.user);
      const bubble = document.createElement("div"); bubble.className = "bubble" + (m.kind ? " media" : "");
      if (m.kind) {
        if (m.kind === "sticker") { const img = document.createElement("img"); img.src = m.url; img.alt = "sticker"; img.addEventListener("click", () => window.open(m.url, "_blank")); bubble.appendChild(img); bubble.classList.add("sticker"); }
        else if (m.kind === "video") {
          const v = document.createElement("video"); v.src = m.url; v.controls = true; v.playsInline = true; v.preload = "metadata"; bubble.appendChild(v);
          const cap = document.createElement("div"); cap.className = "file-size"; cap.style.padding = "6px 4px 2px"; cap.textContent = "Video" + (m.size ? " · " + fmtSize(m.size) : ""); bubble.appendChild(cap);
        }
        else if (m.kind === "image") {
          const img = document.createElement("img"); img.src = m.url; img.alt = m.name || "image"; img.loading = "lazy"; img.addEventListener("click", () => window.open(m.url, "_blank")); bubble.appendChild(img);
        }
        else { const img = document.createElement("img"); img.src = m.url; img.alt = m.kind; img.loading = "lazy"; img.addEventListener("click", () => window.open(m.url, "_blank")); bubble.appendChild(img); }
      } else { bubble.textContent = m.text; }
      const time = document.createElement("div"); time.className = "time"; time.textContent = new Date(m.ts || Date.now()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      wrap.append(author, bubble, time); el.append(wrap);
      if (mine) { const del = document.createElement("button"); del.className = "del"; del.title = "Delete"; del.innerHTML = '<svg class="icon"><use href="#icon-trash"/></svg>'; del.addEventListener("click", () => { if (m.id) socket.emit("delete", { id: m.id }); }); el.appendChild(del); }
    }
    messagesEl.appendChild(el); messagesEl.scrollTop = messagesEl.scrollHeight;
    if (!mine && settings.sound && m.kind !== "sticker" && m.kind !== "gif") playPing();
  }
  let pingAudio = null;
  function playPing() { try { if (!pingAudio) { const c = new (window.AudioContext || window.webkitAudioContext)(); pingAudio = c; } const o = pingAudio.createOscillator(); const g = pingAudio.createGain(); o.connect(g); g.connect(pingAudio.destination); o.frequency.value = 660; g.gain.value = 0.04; o.start(); o.stop(pingAudio.currentTime + 0.12); } catch {} }

  function send() { const t = msgInput.value.trim(); if (!t) return; socket.emit("message", t); msgInput.value = ""; }
  $("sendBtn").addEventListener("click", send);
  msgInput.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && settings.enter && !msgInput.disabled) { e.preventDefault(); send(); } });

  socket.on("history", (msgs) => msgs.forEach((m) => appendMessage(m)));
  socket.on("message", (m) => appendMessage(m));
  socket.on("deleted", ({ id }) => { const el = [...messagesEl.children].find((c) => c.dataset.id === id); if (el) el.remove(); });

  // ====================================================================
  //  PROFILE EDITING
  // ====================================================================
  $("picInput").addEventListener("change", (e) => {
    const file = e.target.files && e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => { myPic = reader.result; renderMyAvatar(); renderProfilePic(); await api("/api/profile", { pic: myPic }, true); };
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
  //  FILE UPLOADS (images / videos)
  // ====================================================================
  $("attachBtn").onclick = () => $("fileInput").click();
  $("fileInput").addEventListener("change", (e) => { handleFiles(e.target.files); e.target.value = ""; });

  function handleFiles(files) {
    [...(files || [])].forEach((file) => {
      if (!/^(image|video)\//.test(file.type)) { flashFriendMsg("Only images and videos can be sent.", false); return; }
      uploadFile(file);
    });
  }
  async function uploadFile(file) {
    const sending = appendSending(file);
    try {
      const fd = new FormData();
      fd.append("file", file, file.name);
      const res = await fetch("/api/upload", { method: "POST", headers: { Authorization: "Bearer " + token }, body: fd });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Upload failed.");
      socket.emit("file", { url: data.url, kind: data.kind, name: data.name, size: data.size });
    } catch (err) {
      flashFriendMsg(err.message || "Upload failed.", false);
    } finally {
      sending.remove();
    }
  }
  function appendSending(file) {
    const el = document.createElement("div"); el.className = "msg mine";
    const wrap = document.createElement("div"); wrap.className = "bubble-wrap";
    const bubble = document.createElement("div"); bubble.className = "bubble";
    const isImg = file.type.startsWith("image");
    if (isImg) { const img = document.createElement("img"); img.src = URL.createObjectURL(file); img.style.maxWidth = "320px"; img.style.maxHeight = "360px"; img.style.borderRadius = "10px"; bubble.appendChild(img); }
    else { bubble.textContent = "Sending " + file.name + "…"; }
    const time = document.createElement("div"); time.className = "time"; time.textContent = "sending…";
    wrap.append(bubble, time); el.append(wrap); messagesEl.appendChild(el); messagesEl.scrollTop = messagesEl.scrollHeight;
    return el;
  }

  // Drag & drop
  const chat = document.querySelector(".chat");
  ["dragenter", "dragover"].forEach((ev) => chat.addEventListener(ev, (e) => { if ([...(e.dataTransfer && e.dataTransfer.types || [])].includes("Files")) { e.preventDefault(); $("dropHint").classList.remove("hidden"); } }));
  ["dragleave", "drop"].forEach((ev) => chat.addEventListener(ev, (e) => { e.preventDefault(); if (ev === "dragleave" && e.relatedTarget && chat.contains(e.relatedTarget)) return; $("dropHint").classList.add("hidden"); }));
  chat.addEventListener("drop", (e) => { if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) handleFiles(e.dataTransfer.files); });

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
  $("micSelect").onchange = (e) => { devices.mic = e.target.value; saveDevices(); if (localStream) restartStream(); };
  $("speakerSelect").onchange = (e) => { devices.speaker = e.target.value; saveDevices(); if (remoteVideo && remoteVideo.setSinkId) remoteVideo.setSinkId(devices.speaker).catch(() => {}); };
  if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) refreshDevices();

  // ====================================================================
  //  CALLS (WebRTC) — robust, with audio
  // ====================================================================
  const callOverlay = $("callOverlay"), localVideo = $("localVideo"), remoteVideo = $("remoteVideo"), callStatus = $("callStatus"), callAvatar = $("callAvatar");
  let localStream = null, peer = null, inCall = false, pendingOffer = null, ringFrom = null, pendingCandidates = [];

  function makePeer() {
    const pc = new RTCPeerConnection(ICE);
    pc.onicecandidate = (e) => { if (e.candidate) socket.emit("call:ice", e.candidate); };
    pc.ontrack = (e) => {
      remoteVideo.srcObject = e.streams[0];
      const hasVideo = e.streams[0] && e.streams[0].getVideoTracks().length > 0;
      callAvatar.classList.toggle("hidden", !!hasVideo);
      if (devices.speaker && remoteVideo.setSinkId) remoteVideo.setSinkId(devices.speaker).catch(() => {});
      remoteVideo.play().catch(() => {});
    };
    return pc;
  }
  async function restartStream() {
    if (!peer) return;
    const newStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: devices.mic ? { deviceId: { exact: devices.mic } } : true });
    localStream.getTracks().forEach((t) => t.stop());
    localStream = newStream; localVideo.srcObject = localStream;
    const senders = peer.getSenders();
    localStream.getTracks().forEach((t) => { const s = senders.find((x) => x.track && x.track.kind === t.kind); if (s) s.replaceTrack(t); else peer.addTrack(t, localStream); });
  }
  async function startCall(asInitiator) {
    const audio = devices.mic ? { deviceId: { exact: devices.mic } } : true;
    try { localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio }); }
    catch { try { localStream = await navigator.mediaDevices.getUserMedia({ audio: devices.mic ? { deviceId: { exact: devices.mic } } : true }); } catch (e2) { alert("Camera or microphone blocked. (" + e2.message + ")"); return; } }
    localVideo.srcObject = localStream; inCall = true;
    callOverlay.classList.remove("hidden");
    $("callBtn").classList.add("hidden"); $("hangupBtn").classList.remove("hidden");
    callAvatar.innerHTML = ""; if (activePeer) callAvatar.appendChild(avatarEl(activePeer.displayName, activePeer.pic)); callAvatar.classList.remove("hidden");
    peer = makePeer();
    localStream.getTracks().forEach((t) => peer.addTrack(t, localStream));
    if (asInitiator) {
      callStatus.textContent = "Ringing…";
      try { const offer = await peer.createOffer(); await peer.setLocalDescription(offer); socket.emit("call:offer", offer); } catch (e) { console.error(e); }
    } else if (pendingOffer) {
      await handleOffer(pendingOffer); pendingOffer = null;
    }
  }
  async function handleOffer(offer) {
    if (!inCall) await startCall(false);
    callStatus.textContent = "Connected";
    if (!peer) { peer = makePeer(); localStream.getTracks().forEach((t) => peer.addTrack(t, localStream)); }
    try {
      await peer.setRemoteDescription(new RTCSessionDescription(offer));
      await flushCandidates();
      const answer = await peer.createAnswer(); await peer.setLocalDescription(answer); socket.emit("call:answer", answer);
    } catch (e) { console.error(e); }
  }
  async function flushCandidates() {
    while (pendingCandidates.length) { try { await peer.addIceCandidate(pendingCandidates.shift()); } catch (e) {} }
  }
  function endCall() {
    hideIncoming();
    if (peer) { try { peer.close(); } catch {} peer = null; }
    if (localStream) { localStream.getTracks().forEach((t) => t.stop()); localStream = null; }
    remoteVideo.srcObject = null; localVideo.srcObject = null; localVideo.classList.remove("hidden-cam");
    inCall = false; pendingOffer = null; pendingCandidates = [];
    callOverlay.classList.add("hidden"); callAvatar.classList.add("hidden");
    $("callBtn").classList.remove("hidden"); $("hangupBtn").classList.add("hidden");
    socket.emit("call:end");
  }
  $("callBtn").onclick = async () => { if (inCall || !activePeer) return; callStatus.textContent = "Ringing…"; socket.emit("call:ring"); await startCall(true); };
  $("hangupBtn").onclick = endCall;
  $("endCall").onclick = endCall;

  // Incoming call UI
  const incoming = $("incoming");
  function showIncoming(from, fromName) {
    ringFrom = from;
    const p = profiles.get(from) || { displayName: fromName, pic: "" };
    $("incomingName").textContent = p.displayName || fromName || "Friend";
    const av = $("incomingAvatar"); av.innerHTML = ""; av.appendChild(avatarEl(p.displayName || fromName, p.pic, "big"));
    incoming.classList.remove("hidden");
    beep();
  }
  function hideIncoming() { incoming.classList.add("hidden"); ringFrom = null; }
  async function acceptCall() {
    hideIncoming();
    if (ringFrom) openDM(ringFrom, true);
    socket.emit("call:accept");
    await startCall(false);
  }
  function declineCall() { socket.emit("call:reject"); hideIncoming(); }
  $("incomingAccept").onclick = acceptCall;
  $("incomingDecline").onclick = declineCall;

  // Call signaling
  socket.on("call:ring", ({ from, fromName }) => { if (inCall) return; showIncoming(from, fromName); });
  socket.on("call:offer", ({ offer }) => { if (inCall) handleOffer(offer); else pendingOffer = offer; });
  socket.on("call:answer", async ({ answer }) => { callStatus.textContent = "Connected"; if (peer) { try { await peer.setRemoteDescription(new RTCSessionDescription(answer)); await flushCandidates(); } catch (e) {} } });
  socket.on("call:ice", async ({ candidate }) => { if (peer && candidate) { try { if (peer.remoteDescription && peer.remoteDescription.type) await peer.addIceCandidate(new RTCIceCandidate(candidate)); else pendingCandidates.push(candidate); } catch (e) {} } else if (candidate) pendingCandidates.push(candidate); });
  socket.on("call:accept", () => { callStatus.textContent = "Connected"; });
  socket.on("call:reject", () => { callStatus.textContent = "Call declined"; endCall(); });
  socket.on("call:end", () => { if (inCall || !incoming.classList.contains("hidden")) { callStatus.textContent = "Call ended"; endCall(); } });

  // Mute / camera
  $("toggleAudio").onclick = () => { const t = localStream && localStream.getAudioTracks()[0]; if (t) { t.enabled = !t.enabled; setIcon($("toggleAudio"), t.enabled ? "icon-mic" : "icon-mic-off"); $("toggleAudio").classList.toggle("hangup", !t.enabled); } };
  $("toggleVideo").onclick = () => { const t = localStream && localStream.getVideoTracks()[0]; if (t) { t.enabled = !t.enabled; setIcon($("toggleVideo"), t.enabled ? "icon-video" : "icon-video-off"); $("toggleVideo").classList.toggle("hangup", !t.enabled); localVideo.classList.toggle("hidden-cam", !t.enabled); if (!t.enabled) callAvatar.classList.remove("hidden"); else callAvatar.classList.add("hidden"); } };

  let beepAudio = null;
  function beep() { try { beepAudio = beepAudio || new (window.AudioContext || window.webkitAudioContext)(); const o = beepAudio.createOscillator(); const g = beepAudio.createGain(); o.connect(g); g.connect(beepAudio.destination); o.frequency.value = 520; g.gain.value = 0.06; o.start(); o.stop(beepAudio.currentTime + 0.9); } catch {} }

  // ====================================================================
  //  AUTO-LOGIN
  // ====================================================================
  if (token) { authEl.classList.add("hidden"); appEl.classList.remove("hidden"); loadFriends(); renderMyIdentityPlaceholder(); }
  function renderMyIdentityPlaceholder() { $("meUser").textContent = "@" + myUser; $("meName").textContent = myName; renderMyAvatar(); $("nameEdit").value = myName; $("userEdit").value = "@" + myUser; }
})();
