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

  const profiles = new Map();
  function setProfile(p) { if (!p || !p.username) return; profiles.set(p.username, Object.assign({}, profiles.get(p.username), p)); }
  function nameOf(u) { const p = profiles.get(u); return (p && p.displayName) || u; }

  const PRESENCE_LABEL = { online: "Online", idle: "Idle", dnd: "Do Not Disturb", offline: "Offline" };
  function presenceDotClass(status) { return status === "online" ? "online" : status === "idle" ? "idle" : status === "dnd" ? "dnd" : "offline"; }
  function activityText(a) {
    const verb = { playing: "Playing", listening: "Listening to", watching: "Watching", competing: "Competing in", custom: "" }[a.type] || "";
    let s = (verb ? verb + " " : "") + (a.name || "");
    if (a.details) s += " — " + a.details;
    return s;
  }
  function relTime(ts) {
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 45) return "just now";
    const m = Math.floor(s / 60); if (m < 60) return m + "m ago";
    const h = Math.floor(m / 60); if (h < 24) return h + "h ago";
    const d = Math.floor(h / 24); return d + "d ago";
  }
  function buildSub(p) {
    if (p.activity && p.activity.name) return '<svg class="icon act-ico"><use href="#icon-activity"/></svg>' + escapeHtml(activityText(p.activity));
    if (p.status) return escapeHtml(p.status);
    if (p.bio) return escapeHtml(p.bio);
    if (!p.online && p.lastSeen) return '<span class="last-seen">Last seen ' + escapeHtml(relTime(p.lastSeen)) + '</span>';
    return '<span class="muted">@' + escapeHtml(p.username) + '</span>';
  }
  function makeDot(status) { const d = document.createElement("span"); d.className = "ondot " + presenceDotClass(status); return d; }
  function headerPresence(p) {
    if (!p) return "Offline";
    if (p.online) { if (p.activity && p.activity.name) return activityText(p.activity); if (p.status) return p.status; return PRESENCE_LABEL[p.presence] || "Online"; }
    if (p.lastSeen) return "Last seen " + relTime(p.lastSeen);
    return "Offline";
  }
  function dmRoomKey(a, b) { return "dm:" + [a, b].sort().join("|"); }
  function unreadFor(key) { const n = unreadMap[key]; return n ? n : 0; }

  // State
  const state = { friends: [], requests: { incoming: [], outgoing: [] }, servers: [], blocked: [] };
  let view = "dm"; // "dm" | "server"
  let activePeer = null;   // username (DM)
  let activeServer = null; // id
  let activeChannel = null;// id

  // ---- Auth ----
  let token = localStorage.getItem("buddy-token") || "";
  let myUser = localStorage.getItem("buddy-user") || "";
  let myName = localStorage.getItem("buddy-name") || "";
  let myPic = localStorage.getItem("buddy-pic") || "";
  let myPresence = "online", myStatus = "", myActivity = null, manualActivity = false;
  let unreadMap = {};
  let typingName = null, typingTimer = null;
  function persistAuth() { localStorage.setItem("buddy-token", token); localStorage.setItem("buddy-user", myUser); localStorage.setItem("buddy-name", myName); localStorage.setItem("buddy-pic", myPic); }
  function saveLogin() { if (window.buddyDesktop && window.buddyDesktop.saveLogin) { try { window.buddyDesktop.saveLogin({ token, user: myUser, name: myName, pic: myPic }); } catch {} } }
  function clearAuth() { token = ""; myUser = ""; myName = ""; myPic = ""; ["buddy-token", "buddy-user", "buddy-name", "buddy-pic"].forEach((k) => localStorage.removeItem(k)); if (window.buddyDesktop && window.buddyDesktop.clearLogin) { try { window.buddyDesktop.clearLogin(); } catch {} } }

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
  //  API + ICE
  // ====================================================================
  async function api(path, body, withAuth) {
    const headers = { "Content-Type": "application/json" };
    if (withAuth && token) headers["Authorization"] = "Bearer " + token;
    const res = await fetch(path, { method: "POST", headers, body: JSON.stringify(body || {}) });
    return res.json();
  }
  let ICE = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }, { urls: "stun:stun1.l.google.com:19302" }] };
  fetch("/api/config").then((r) => r.json()).then((d) => { if (d && d.iceServers) ICE = d; }).catch(() => {});
  async function refreshIce() {
    try {
      const r = await fetch("/api/turn"); const d = await r.json();
      if (d && Array.isArray(d.iceServers) && d.iceServers.length) {
        ICE = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }, { urls: "stun:stun1.l.google.com:19302" }].concat(d.iceServers) };
      }
    } catch {}
  }

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
    saveLogin();
    enterApp(res.profile);
  }
  $("authBtn").onclick = doAuth;
  [$("authUser"), $("authPass"), $("authDisp"), $("authEmail")].forEach((el) => el.addEventListener("keydown", (e) => { if (e.key === "Enter") doAuth(); }));

  function enterApp(profile) {
    authEl.classList.add("hidden");
    appEl.classList.remove("hidden");
    renderMyIdentity(profile);
    if (socket.connected) socket.emit("auth", { token });
    loadMe();
  }
  function renderMyIdentity(p) {
    myName = p.displayName; myPic = p.pic || "";
    myPresence = p.presence || "online"; myStatus = p.status || ""; myActivity = p.activity || null;
    $("meName").textContent = myName;
    renderMyAvatar();
    $("nameEdit").value = myName;
    $("userEdit").value = "@" + myUser;
    $("bioEdit").value = p.bio || "";
    renderProfilePic();
    renderMyStatus();
  }
  function renderMyStatus() {
    const dot = $("meStatusDot"), txt = $("meStatusText");
    if (!dot || !txt) return;
    dot.className = "ondot " + presenceDotClass(myPresence);
    let label = PRESENCE_LABEL[myPresence] || "Online";
    if (myActivity && myActivity.name) label = activityText(myActivity);
    else if (myStatus) label = myStatus;
    txt.textContent = label;
  }
  function renderMyAvatar() { const a = $("meAvatar"); a.innerHTML = ""; if (myPic) { const i = document.createElement("img"); i.src = myPic; a.appendChild(i); } else { a.textContent = initial(myName); a.style.background = colorFor(myName); } }
  function renderProfilePic() { const a = $("profilePic"); a.innerHTML = ""; if (myPic) { const i = document.createElement("img"); i.src = myPic; a.appendChild(i); } else { a.textContent = initial(myName); a.style.background = colorFor(myName); } }

  function logout() { try { socket.close(); } catch {} clearAuth(); location.reload(); }
  $("logoutBtn").onclick = logout;
  $("logoutBtn2").onclick = logout;

  socket.on("connect", () => { setConn("online"); if (token) socket.emit("auth", { token }); });
  socket.on("disconnect", () => setConn("offline"));
  socket.on("auth-error", () => { clearAuth(); showAuthScreen(); });
  function showAuthScreen() {
    try { if (socket && socket.connected) socket.close(); } catch {}
    authEl.classList.remove("hidden");
    appEl.classList.add("hidden");
    const e = $("authError"); if (e) { e.textContent = "Your session expired. Please log in again."; e.classList.remove("hidden"); }
  }
  socket.on("authed", ({ profile }) => { renderMyIdentity(profile); renderMyAvatar(); saveLogin(); loadMe(); });

  function setConn(state) {
    if (!connState) return;
    connState.className = "conn-pill " + (state === "online" ? "online" : state === "offline" ? "offline" : "");
  }

  // ====================================================================
  //  STATE SYNC
  // ====================================================================
  async function loadMe() {
    try {
      const res = await api("/api/me", {}, true);
      if (res.profile) renderMyIdentity(res.profile);
      if (res.friends) { state.friends = res.friends; res.friends.forEach(setProfile); }
      if (res.requests) { state.requests = res.requests; (res.requests.incoming || []).forEach(setProfile); (res.requests.outgoing || []).forEach(setProfile); }
      if (res.servers) { state.servers = res.servers; res.servers.forEach((s) => (s.members || []).forEach(setProfile)); }
      if (res.blocked) state.blocked = res.blocked;
      renderBlocked();
      renderRail();
      if (view === "dm") { renderFriendsDom(); renderRequestsDom(); }
      else renderServerView();
    } catch {}
  }
  socket.on("friends", (list) => { state.friends = list || []; list.forEach(setProfile); if (view === "dm") renderFriendsDom(); updateHeader(); });
  socket.on("requests", (r) => {
    const prev = (state.requests.incoming || []).map((p) => p.username);
    state.requests = r || { incoming: [], outgoing: [] };
    (r.incoming || []).forEach(setProfile);
    (r.outgoing || []).forEach(setProfile);
    if (view === "dm") renderRequestsDom();
    const inc = state.requests.incoming || [];
    if (inc.length && inc.some((p) => !prev.includes(p.username))) flash(inc[inc.length - 1].displayName + " wants to be friends");
  });
  socket.on("servers", (list) => {
    state.servers = list || [];
    list.forEach((s) => (s.members || []).forEach(setProfile));
    renderRail();
    if (view === "server") {
      if (!state.servers.find((x) => x.id === activeServer)) selectHome();
      else renderServerView();
    }
    updateHeader();
  });
  socket.on("dm-roster", (list) => list.forEach(setProfile));

  socket.on("unread", (obj) => { unreadMap = obj || {}; if (view === "dm") renderFriendsDom(); else renderServerView(); renderRail(); });
  socket.on("typing", ({ from, user, on }) => {
    const inDm = view === "dm" && activePeer && user === activePeer.username;
    const inChan = view === "server" && activeChannel && activeServer && (() => { const s = state.servers.find((x) => x.id === activeServer); return s && (s.members || []).includes(user); })();
    if (!inDm && !inChan) return;
    if (on) { typingName = from; clearTimeout(typingTimer); typingTimer = setTimeout(() => { typingName = null; updateHeader(); }, 4000); updateHeader(); }
    else if (typingName === from) { typingName = null; updateHeader(); }
  });

  // ====================================================================
  //  RAIL (servers)
  // ====================================================================
  function renderRail() {
    const list = $("serverList"); list.innerHTML = "";
    state.servers.forEach((s) => {
      const b = document.createElement("button");
      b.className = "rail-item" + (view === "server" && activeServer === s.id ? " active" : "");
      b.style.background = s.iconColor || colorFor(s.name);
      b.textContent = (s.name || "?").trim().charAt(0).toUpperCase();
      b.title = s.name;
      const total = (s.channels || []).reduce((a, c) => a + unreadFor("chan:" + c.id), 0);
      if (total > 0) { const bd = document.createElement("span"); bd.className = "rail-badge"; bd.textContent = total > 99 ? "99+" : total; b.appendChild(bd); }
      b.onclick = () => selectServer(s.id);
      list.appendChild(b);
    });
  }
  $("homeBtn").onclick = () => selectHome();
  $("addServerBtn").onclick = () => openPrompt("Create a server", "Server name", async (name) => {
    const res = await api("/api/servers/create", { name }, true);
    if (!res.ok) return flash(res.error || "Could not create server.", "err");
    selectServer(res.server.id);
  });
  function selectHome() {
    view = "dm"; activePeer = null; activeServer = null; activeChannel = null;
    $("homeBtn").classList.add("active");
    $("dmView").classList.remove("hidden");
    $("serverView").classList.add("hidden");
    messagesEl.innerHTML = ""; lastDay = "";
    updateHeader(); updateComposer();
    renderRail(); renderFriendsDom(); renderRequestsDom();
  }
  function selectServer(id) {
    view = "server"; activePeer = null; activeServer = id; activeChannel = null;
    $("homeBtn").classList.remove("active");
    $("dmView").classList.add("hidden");
    $("serverView").classList.remove("hidden");
    const s = state.servers.find((x) => x.id === id);
    renderRail(); renderServerView();
    if (s && s.channels && s.channels.length) openChannel(s.channels[0].id);
    else { messagesEl.innerHTML = ""; lastDay = ""; updateHeader(); updateComposer(); }
  }
  function openChannel(channelId) {
    activeChannel = channelId; activePeer = null;
    socket.emit("channel-open", { channelId });
    messagesEl.innerHTML = ""; lastDay = "";
    updateHeader(); updateComposer();
    renderServerView();
  }

  // ====================================================================
  //  SIDEBAR RENDERING
  // ====================================================================
  function renderFriendsDom() {
    const fl = $("friendsList"); fl.innerHTML = "";
    const others = state.friends || [];
    $("friendsEmpty").style.display = others.length ? "none" : "block";
    others.forEach((p) => {
      setProfile(p);
      const row = document.createElement("div"); row.className = "friend" + (activePeer && p.username === activePeer.username ? " active" : "");
      const av = avatarEl(p.displayName, p.pic);
      av.appendChild(makeDot(p.presence));
      av.addEventListener("click", (e) => { e.stopPropagation(); openProfile(p.username); });
      const meta = document.createElement("div"); meta.className = "friend-meta";
      const nm = document.createElement("div"); nm.className = "friend-name"; nm.textContent = p.displayName;
      const un = document.createElement("div"); un.className = "friend-bio"; un.innerHTML = buildSub(p);
      meta.append(nm, un); row.append(av, meta);
      const n = unreadFor(dmRoomKey(myUser, p.username));
      if (n > 0) { const b = document.createElement("span"); b.className = "badge"; b.textContent = n > 99 ? "99+" : n; row.appendChild(b); }
      row.addEventListener("click", () => openDM(p.username));
      fl.appendChild(row);
    });
  }

  function renderRequestsDom() {
    const box = $("requestsBox"); box.innerHTML = "";
    const inc = state.requests.incoming || [];
    const out = state.requests.outgoing || [];
    if (!inc.length && !out.length) { box.classList.add("hidden"); return; }
    box.classList.remove("hidden");
    if (inc.length) {
      const h = document.createElement("div"); h.className = "req-head"; h.textContent = "Incoming — " + inc.length; box.appendChild(h);
      inc.forEach((p) => {
        setProfile(p);
        const card = document.createElement("div"); card.className = "req-card";
        const av = avatarEl(p.displayName, p.pic, "small");
        av.addEventListener("click", (e) => { e.stopPropagation(); openProfile(p.username); });
        const meta = document.createElement("div"); meta.className = "req-meta";
        meta.innerHTML = '<div class="req-name">' + escapeHtml(p.displayName) + '</div><div class="req-sub">@' + escapeHtml(p.username) + ' wants to be friends</div>';
        const acts = document.createElement("div"); acts.className = "req-acts";
        const acc = document.createElement("button"); acc.className = "req-btn accept"; acc.innerHTML = '<svg class="icon"><use href="#icon-check"/></svg>';
        const dec = document.createElement("button"); dec.className = "req-btn decline"; acc.title = "Accept"; dec.title = "Decline"; dec.innerHTML = '<svg class="icon"><use href="#icon-close"/></svg>';
        acc.onclick = async () => { await api("/api/friends/accept", { friend: p.username }, true); flash("You are now friends with @" + p.username + "."); };
        dec.onclick = async () => { await api("/api/friends/decline", { friend: p.username }, true); };
        acts.append(acc, dec); card.append(av, meta, acts); box.appendChild(card);
      });
    }
    if (out.length) {
      const h = document.createElement("div"); h.className = "req-head"; h.textContent = "Outgoing — " + out.length; box.appendChild(h);
      out.forEach((p) => {
        setProfile(p);
        const card = document.createElement("div"); card.className = "req-card";
        const av = avatarEl(p.displayName, p.pic, "small");
        av.addEventListener("click", (e) => { e.stopPropagation(); openProfile(p.username); });
        const meta = document.createElement("div"); meta.className = "req-meta";
        meta.innerHTML = '<div class="req-name">' + escapeHtml(p.displayName) + '</div><div class="req-sub">Request sent to @' + escapeHtml(p.username) + '</div>';
        card.append(av, meta); box.appendChild(card);
      });
    }
  }

  function renderServerView() {
    const s = state.servers.find((x) => x.id === activeServer);
    if (!s) { $("serverView").classList.add("hidden"); $("dmView").classList.remove("hidden"); return; }
    $("serverName").textContent = s.name;
    // channels
    const cl = $("channelList"); cl.innerHTML = "";
    (s.channels || []).forEach((c) => {
      const row = document.createElement("div");
      row.className = "channel" + (c.id === activeChannel ? " active" : "");
      row.innerHTML = '<svg class="icon chan-icon"><use href="#icon-hash"/></svg><span>' + escapeHtml(c.name) + '</span>';
      const n = unreadFor("chan:" + c.id);
      if (n > 0) { const b = document.createElement("span"); b.className = "badge channel-badge"; b.textContent = n > 99 ? "99+" : n; row.appendChild(b); }
      row.onclick = () => openChannel(c.id);
      cl.appendChild(row);
    });
    // members (online first)
    const ml = $("memberList"); ml.innerHTML = "";
    const members = (s.members || []).slice().sort((a, b) => (b.online ? 1 : 0) - (a.online ? 1 : 0));
    members.forEach((m) => {
      const row = document.createElement("div"); row.className = "member";
      const av = avatarEl(m.displayName, m.pic, "small");
      av.appendChild(makeDot(m.presence));
      av.addEventListener("click", (e) => { e.stopPropagation(); openProfile(m.username); });
      const meta = document.createElement("div"); meta.className = "member-meta";
      const nm = document.createElement("div"); nm.className = "member-name"; nm.textContent = (m.username === myUser ? m.displayName + " (you)" : m.displayName);
      const sub = document.createElement("div"); sub.className = "member-sub"; sub.innerHTML = buildSub(m);
      meta.append(nm, sub); row.append(av, meta); ml.appendChild(row);
    });
    $("memberCount").textContent = (s.members || []).length;
  }

  function flash(msg, type) {
    const t = document.createElement("div");
    t.className = "toast " + (type === "err" ? "err" : type === "info" ? "info" : "ok");
    const iconId = type === "err" ? "#icon-close" : "#icon-check";
    t.innerHTML = '<span class="t-dot"></span><span class="t-ico"><svg class="icon"><use href="' + iconId + '"/></svg></span><span>' + escapeHtml(msg) + '</span>';
    const box = $("toasts"); if (box) { box.appendChild(t); setTimeout(() => { t.classList.add("leaving"); setTimeout(() => t.remove(), 260); }, 3000); }
  }

  function renderBlocked() {
    const list = $("blockedList"); if (!list) return;
    const empty = $("blockedEmpty");
    const names = (state.blocked || []).slice();
    list.querySelectorAll(".blocked-row").forEach((n) => n.remove());
    if (!names.length) { if (empty) empty.style.display = ""; return; }
    if (empty) empty.style.display = "none";
    names.forEach((u) => {
      const p = profiles.get(u) || { username: u, displayName: u };
      const row = document.createElement("div"); row.className = "blocked-row";
      const av = avatarEl(p.displayName, p.pic, "small");
      const meta = document.createElement("div"); meta.className = "b-meta";
      meta.innerHTML = '<div class="b-name">' + escapeHtml(p.displayName || u) + '</div><div class="b-sub">@' + escapeHtml(u) + '</div>';
      const un = document.createElement("button"); un.className = "sm-p"; un.style.cssText = "flex:0 0 auto;padding:6px 10px;border:1px solid var(--border);background:var(--bg-2);color:var(--text-2);border-radius:6px;font-size:12px;font-weight:600;cursor:pointer";
      un.textContent = "Unblock";
      un.onclick = async () => { const r = await api("/api/friends/unblock", { target: u }, true); if (r && r.blocked) state.blocked = r.blocked; flash("Unblocked @" + u + "."); renderBlocked(); };
      row.append(av, meta, un); list.appendChild(row);
    });
  }

  // ---- Profile popup ----
  const ACT_LABELS = { playing: "Playing", listening: "Listening to", watching: "Watching", competing: "Competing in", custom: "Custom" };
  let profileTarget = null;
  function openProfile(username) {
    const p = profiles.get(username); if (!p) return;
    profileTarget = username; window.__pmTarget = username;
    const av = $("pmAvatar"); av.innerHTML = ""; av.appendChild(avatarEl(p.displayName, p.pic, "xxl"));
    $("pmName").textContent = p.displayName || username;
    $("pmUser").textContent = "@" + username;
    const pres = p.online ? presenceDotClass(p.presence) : "offline";
    const pd = $("pmPresence"); pd.innerHTML = "";
    const dot = makeDot(pres); const txt = document.createElement("span");
    txt.textContent = p.online ? headerPresence({ online: true, presence: p.presence, activity: p.activity, status: p.status }) : (p.lastSeen ? "Last seen " + relTime(p.lastSeen) : "Offline");
    pd.append(dot, txt);
    const act = $("pmActivity");
    if (p.activity && p.activity.name) {
      act.classList.remove("hidden");
      $("pmActLabel").textContent = ACT_LABELS[p.activity.type] || "Activity";
      $("pmActName").textContent = p.activity.name || "";
      const d = $("pmActDetails"); d.textContent = p.activity.details || ""; d.style.display = p.activity.details ? "" : "none";
    } else act.classList.add("hidden");
    const bioWrap = $("pmBioWrap");
    if (p.bio) { bioWrap.classList.remove("hidden"); $("pmBio").textContent = p.bio; } else bioWrap.classList.add("hidden");
    const isFriend = (state.friends || []).some((f) => f.username === username);
    const isBlocked = (state.blocked || []).includes(username);
    $("pmMessage").style.display = isFriend ? "" : "none";
    $("pmRemove").style.display = isFriend ? "" : "none";
    $("pmBlock").style.display = isBlocked ? "none" : "";
    $("pmUnblock").style.display = isBlocked ? "" : "none";
    $("pmReport").style.display = "";
    $("profileModal").classList.remove("hidden");
  }
  function closeProfile() { $("profileModal").classList.add("hidden"); profileTarget = null; }
  $("profileModal").addEventListener("click", (e) => { if (e.target === $("profileModal")) closeProfile(); });
  function reportPrompt(kind, target) {
    const reason = window.prompt("Why are you reporting this " + kind + "? (optional)");
    if (reason === null) return;
    api("/api/report", { type: kind, target, reason }, true).then((r) => flash(r && r.ok ? "Reported. Thanks for the report." : "Report failed.")).catch(() => flash("Report failed."));
  }
  $("pmMessage").onclick = () => { if (!profileTarget) return; closeProfile(); openDM(profileTarget); };
  $("pmRemove").onclick = async () => { if (!profileTarget) return; await api("/api/friends/remove", { friend: profileTarget }, true); flash("Removed friend."); closeProfile(); };
  $("pmBlock").onclick = async () => { if (!profileTarget) return; const r = await api("/api/friends/block", { target: profileTarget }, true); if (r && r.blocked) state.blocked = r.blocked; renderBlocked(); flash("Blocked. They can't message you."); closeProfile(); };
  $("pmUnblock").onclick = async () => { if (!profileTarget) return; const r = await api("/api/friends/unblock", { target: profileTarget }, true); if (r && r.blocked) state.blocked = r.blocked; renderBlocked(); flash("Unblocked."); closeProfile(); };
  $("pmReport").onclick = () => { if (!profileTarget) return; const u = profileTarget; closeProfile(); reportPrompt("person", u); };

  // Add friend (sends request)
  document.querySelector(".add-friend").addEventListener("click", (e) => { if (e.target.closest(".field-icon, #addFriendBtn, .add-friend-btn")) { e.preventDefault(); addFriend(); } });
  $("friendInput").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addFriend(); } });
  const addBtn = $("addFriendBtn"); if (addBtn) addBtn.onclick = (e) => { e.preventDefault(); addFriend(); };
  async function addFriend() {
    const f = $("friendInput").value.trim(); if (!f) return;
    const res = await api("/api/friends/request", { friend: f }, true);
    if (!res.ok) return flash(res.error || "Could not send request.", "err");
    $("friendInput").value = ""; flash("Friend request sent to @" + f + ".");
  }

  // Server actions
  $("addChannelBtn").onclick = () => { if (!activeServer) return; openPrompt("Create channel", "channel-name", async (name) => {     const res = await api("/api/servers/channel", { serverId: activeServer, name }, true); if (!res.ok) return flash(res.error || "Could not create channel.", "err"); const ch = res.server.channels[res.server.channels.length - 1]; openChannel(ch.id); }); };
  $("inviteBtn").onclick = () => { if (!activeServer) return; openPrompt("Invite to server", "Username", async (name) => {     const res = await api("/api/servers/invite", { serverId: activeServer, username: name }, true); if (!res.ok) return flash(res.error || "Could not invite.", "err"); flash("@" + name + " invited."); }); };
  $("serverActionsBtn").onclick = (e) => { e.stopPropagation(); $("serverMenu").classList.toggle("hidden"); };
  document.addEventListener("click", (e) => { const m = $("serverMenu"); if (m && !m.classList.contains("hidden") && !m.contains(e.target) && e.target !== $("serverActionsBtn") && !$("serverActionsBtn").contains(e.target)) m.classList.add("hidden"); });
  $("serverLeave").onclick = async () => { if (!activeServer) return; if (!confirm("Leave this server?")) return; const res = await api("/api/servers/leave", { serverId: activeServer }, true); if (res.ok) { $("serverMenu").classList.add("hidden"); selectHome(); flash("Left server."); } };
  $("serverReport").onclick = () => { const id = activeServer; $("serverMenu").classList.add("hidden"); const reason = window.prompt("Why are you reporting this server? (optional)"); if (reason === null) return; api("/api/report", { type: "server", target: id, reason }, true).then((r) => flash(r && r.ok ? "Reported. Thanks." : "Report failed.")).catch(() => flash("Report failed.")); };

  function openDM(friendUser, silent) {
    activePeer = profiles.get(friendUser) || { username: friendUser, displayName: friendUser };
    activeChannel = null; activeServer = null; view = "dm";
    $("homeBtn").classList.add("active");
    $("serverView").classList.add("hidden");
    $("dmView").classList.remove("hidden");
    updateHeader(); messagesEl.innerHTML = ""; lastDay = "";
    updateComposer();
    socket.emit("dm-open", { friend: friendUser });
    if (!silent) socket.emit("dm-invite", { friend: friendUser });
    renderFriendsDom();
  }
  socket.on("dm-invite", ({ from }) => { if (!inCall) openDM(from, true); });

  function updateHeader() {
    const peerAvatar = $("peerAvatar"), roomLabel = $("roomLabel"), presence = $("presence");
    presence.classList.remove("online", "idle", "dnd");
    if (view === "dm" && activePeer) {
      peerAvatar.classList.remove("hidden"); peerAvatar.innerHTML = ""; peerAvatar.appendChild(avatarEl(activePeer.displayName, activePeer.pic, ""));
      roomLabel.textContent = activePeer.displayName;
      if (typingName) {
        presence.textContent = typingName + " is typing…";
      } else {
        const p = profiles.get(activePeer.username) || activePeer;
        presence.textContent = headerPresence(p);
        presence.classList.add(presenceDotClass(p.presence));
      }
      $("callBtn").classList.remove("hidden");
    } else if (view === "server" && activeServer) {
      const s = state.servers.find((x) => x.id === activeServer);
      const ch = s && s.channels.find((c) => c.id === activeChannel);
      peerAvatar.classList.add("hidden");
      roomLabel.textContent = ch ? "# " + ch.name : "Server";
      presence.textContent = typingName ? typingName + " is typing…" : (s ? s.name : "");
      $("callBtn").classList.add("hidden");
    } else {
      peerAvatar.classList.add("hidden"); roomLabel.textContent = "Buddy"; presence.textContent = "Select a friend or server to start"; $("callBtn").classList.add("hidden");
    }
  }
  function updateComposer() {
    const on = (view === "dm" && activePeer) || (view === "server" && activeChannel);
    msgInput.disabled = !on; $("sendBtn").disabled = !on; $("attachBtn").disabled = !on; $("mediaBtn").disabled = !on;
  }

  // ====================================================================
  //  MESSAGES
  // ====================================================================
  let lastDay = "";
  function dayLabel(ts) { const d = new Date(ts); const today = new Date(); const y = new Date(); y.setDate(today.getDate() - 1); const same = (a, b) => a.toDateString() === b.toDateString(); if (same(d, today)) return "Today"; if (same(d, y)) return "Yesterday"; return d.toLocaleDateString([], { month: "short", day: "numeric", year: d.getFullYear() === today.getFullYear() ? undefined : "numeric" }); }
  function dayKey(ts) { return new Date(ts).toDateString(); }

  function appendMessage(m) {
    if (m.id && [...messagesEl.children].some((c) => c.dataset.id === m.id)) return;
    if (m.deleted) return renderDeleted(m);
    const key = dayKey(m.ts || Date.now());
    if (key !== lastDay) {
      lastDay = key;
      const sep = document.createElement("div"); sep.className = "day-sep"; sep.textContent = dayLabel(m.ts || Date.now());
      messagesEl.appendChild(sep);
    }
    const mine = m.system ? false : m.user === myUser;
    let grouped = false;
    const prev = messagesEl.lastElementChild;
    if (prev && prev.dataset.user === m.user && prev.dataset.day === key && !m.system && !m.replyTo && !m.forwarded) {
      const pts = +prev.dataset.ts || 0, mts = m.ts || Date.now();
      if (mts - pts < 5 * 60 * 1000) grouped = true;
    }
    const el = document.createElement("div");
    el.className = "msg" + (mine ? " mine" : "") + (m.system ? " system" : "") + (settings.compact ? " compact" : "") + (grouped ? " grouped" : "");
    if (m.id) el.dataset.id = m.id;
    el.dataset.user = m.user || ""; el.dataset.ts = m.ts || Date.now(); el.dataset.day = key;
    if (m.system) { const b = document.createElement("div"); b.className = "bubble"; b.textContent = m.text; el.appendChild(b); }
    else {
      const p = profiles.get(m.user) || { displayName: m.user };
      el.appendChild(avatarEl(p.displayName, p.pic));
      const wrap = document.createElement("div"); wrap.className = "bubble-wrap";
      if (m.forwarded) { const fwd = document.createElement("div"); fwd.className = "forwarded"; fwd.textContent = "Forwarded from " + nameOf(m.forwarded.from); wrap.appendChild(fwd); }
      const rep = resolveReply(m.replyTo);
      if (rep) {
        const rr = document.createElement("div"); rr.className = "reply-ref";
        rr.innerHTML = '<svg class="icon reply-ref-ico"><use href="#icon-reply"/></svg><span class="reply-ref-name">' + escapeHtml(nameOf(rep.user)) + '</span><span class="reply-ref-text">' + escapeHtml(rep.text) + '</span>';
        rr.addEventListener("click", (e) => { e.stopPropagation(); jumpToMessage(rep.id); });
        wrap.appendChild(rr);
      }
      const author = document.createElement("div"); author.className = "author"; author.textContent = nameOf(m.user);
      const bubble = document.createElement("div"); bubble.className = "bubble" + (m.kind ? " media" : "");
      if (m.kind === "poll") { renderPoll(bubble, m); }
      else if (m.kind) {
        if (m.kind === "sticker") { const img = document.createElement("img"); img.src = m.url; img.alt = "sticker"; img.addEventListener("click", () => window.open(m.url, "_blank")); bubble.appendChild(img); bubble.classList.add("sticker"); }
        else if (m.kind === "video") {
          const v = document.createElement("video"); v.src = m.url; v.controls = true; v.playsInline = true; v.preload = "metadata"; bubble.appendChild(v);
          const cap = document.createElement("div"); cap.className = "file-size"; cap.style.padding = "6px 4px 2px"; cap.textContent = "Video" + (m.size ? " · " + fmtSize(m.size) : ""); bubble.appendChild(cap);
        }
        else if (m.kind === "image") { const img = document.createElement("img"); img.src = m.url; img.alt = m.name || "image"; img.loading = "lazy"; img.addEventListener("click", () => window.open(m.url, "_blank")); bubble.appendChild(img); }
        else if (m.kind === "gif") {
          if (m.format === "video") {
            const v = document.createElement("video"); v.src = m.url; v.autoplay = true; v.loop = true; v.muted = true; v.playsInline = true; v.preload = "auto"; v.addEventListener("click", () => window.open(m.url, "_blank")); bubble.appendChild(v);
          } else {
            const img = document.createElement("img"); img.src = m.url; img.alt = "GIF"; img.loading = "lazy"; img.addEventListener("click", () => window.open(m.url, "_blank")); bubble.appendChild(img);
          }
          bubble.classList.add("gif");
        }
        else { const img = document.createElement("img"); img.src = m.url; img.alt = m.kind; img.loading = "lazy"; img.addEventListener("click", () => window.open(m.url, "_blank")); bubble.appendChild(img); }
      } else {
        bubble.innerHTML = renderText(m.text);
        if (m.edited) { const ed = document.createElement("span"); ed.className = "edited-tag"; ed.textContent = "(edited)"; bubble.appendChild(ed); }
      }
      const time = document.createElement("div"); time.className = "time"; time.textContent = new Date(m.ts || Date.now()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      wrap.append(author, bubble, time);
      if (m.reactions) renderReactions(el, m);
      el.append(wrap);
      if (mine) { const del = document.createElement("button"); del.className = "del"; del.title = "Delete"; del.innerHTML = '<svg class="icon"><use href="#icon-trash"/></svg>'; del.addEventListener("click", () => { if (m.id) socket.emit("delete", { id: m.id }); }); el.appendChild(del); }
      el._msg = m;
    }
    messagesEl.appendChild(el); messagesEl.scrollTop = messagesEl.scrollHeight;
    if (!mine && settings.sound && m.kind !== "sticker" && m.kind !== "gif") playPing();
  }
  function renderReactions(el, m) {
    const bar = document.createElement("div"); bar.className = "reactions";
    const fill = () => {
      bar.innerHTML = "";
      const rs = m.reactions || {};
      Object.keys(rs).forEach((emoji) => {
        const users = rs[emoji]; if (!users || !users.length) return;
        const chip = document.createElement("button"); chip.className = "react-chip" + (users.includes(myUser) ? " mine" : "");
        chip.innerHTML = '<span class="react-emoji">' + emoji + '</span><span class="react-count">' + users.length + "</span>";
        chip.title = users.map(nameOf).join(", ");
        chip.addEventListener("click", () => socket.emit("react", { id: m.id, emoji }));
        bar.appendChild(chip);
      });
      const add = document.createElement("button"); add.className = "react-add"; add.dataset.reactAdd = m.id; add.title = "Add reaction";
      add.innerHTML = '<svg class="icon"><use href="#icon-plus"/></svg>';
      bar.appendChild(add);
    };
    fill(); el._fillReactions = fill; el._msg = m;
  }
  let pingAudio = null;
  function playPing() { try { if (!pingAudio) { const c = new (window.AudioContext || window.webkitAudioContext)(); pingAudio = c; } const o = pingAudio.createOscillator(); const g = pingAudio.createGain(); o.connect(g); g.connect(pingAudio.destination); o.frequency.value = 660; g.gain.value = 0.04; o.start(); o.stop(pingAudio.currentTime + 0.12); } catch {} }

  function isMediaUrl(s) { return /^https?:\/\/\S+\.(gif|jpe?g|png|webp|mp4|webm)(\?\S*)?$/i.test(s); }

  // ---- Reply state ----
  let replyingTo = null; // { id, user, text }
  function findMsgEl(id) { return id ? [...messagesEl.children].find((c) => c.dataset.id === id) : null; }
  function previewOfMsg(el, m) {
    if (m && m.text) return m.text;
    if (m && m.kind) return ({ image: "Photo", video: "Video", gif: "GIF", sticker: "Sticker", poll: "Poll" }[m.kind] || "Attachment");
    if (el) { const b = el.querySelector(".bubble"); if (b) { if (el.querySelector(".bubble.media img, .bubble.media video")) return "Attachment"; return (b.textContent || "").trim(); } }
    return "";
  }
  function startReply(id) {
    const el = findMsgEl(id); if (!el || el.classList.contains("system")) return;
    const m = el._msg || {};
    const user = el.dataset.user || m.user || "";
    const text = previewOfMsg(el, m);
    replyingTo = { id, user, text };
    $("replyBarName").textContent = nameOf(user);
    $("replyBarPreview").textContent = text ? " · " + text.slice(0, 80) : "";
    $("replyBar").classList.remove("hidden");
    msgInput.focus();
  }
  function clearReply() { replyingTo = null; $("replyBar").classList.add("hidden"); }
  $("replyCancel").onclick = clearReply;

  function resolveReply(rt) {
    if (!rt || !rt.id) return null;
    let user = rt.user, text = rt.text;
    if (!user || text == null || text === "") {
      const el = findMsgEl(rt.id);
      if (el) { user = user || el.dataset.user || ""; if (text == null || text === "") text = previewOfMsg(el, el._msg); }
    }
    return { id: rt.id, user: user || "", text: text || "" };
  }
  function jumpToMessage(id) {
    const el = findMsgEl(id); if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.remove("flash-target"); void el.offsetWidth; el.classList.add("flash-target");
    setTimeout(() => el.classList.remove("flash-target"), 1600);
  }

  function send() {
    const t = msgInput.value.trim(); if (!t) return;
    const reply = replyingTo ? replyingTo.id : undefined;
    if (isMediaUrl(t)) {
      const isVid = /\.(mp4|webm)(\?|$)/i.test(t);
      socket.emit("media", { url: t, kind: isVid ? "video" : "image", format: isVid ? "video" : undefined, replyTo: reply });
    } else {
      socket.emit("message", t, reply);
    }
    msgInput.value = "";
    clearReply();
  }
  $("sendBtn").addEventListener("click", send);
  msgInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && settings.enter && !msgInput.disabled) { e.preventDefault(); send(); }
    else if (e.key === "Escape" && replyingTo) { e.preventDefault(); clearReply(); }
  });

  socket.on("history", (msgs) => { clearReply(); messagesEl.innerHTML = ""; lastDay = ""; msgs.forEach((m) => appendMessage(m)); });
  socket.on("message", (m) => appendMessage(m));
  socket.on("deleted", ({ id, deleted }) => {
    const el = [...messagesEl.children].find((c) => c.dataset.id === id);
    if (!el) return;
    if (deleted) {
      el.className = "msg system deleted-msg"; el.innerHTML = ""; el.dataset.id = id;
      const b = document.createElement("div"); b.className = "bubble"; b.textContent = "Message deleted"; el.appendChild(b);
    } else el.remove();
  });
  socket.on("reacted", ({ id, reactions }) => {
    const el = [...messagesEl.children].find((c) => c.dataset.id === id); if (!el) return;
    if (el._msg) el._msg.reactions = reactions;
    if (el._fillReactions) el._fillReactions();
  });
  socket.on("channel-info", () => updateHeader());

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
    if (!res.ok) return flash(res.error || "Password not updated.", "err");
    $("oldPass").value = ""; $("newPass").value = ""; flash("Password updated.");
  };

  // ---- Rich presence / status menu ----
  let smPresence = "online";
  function openStatusMenu() {
    const m = $("statusMenu"); m.classList.remove("hidden");
    smPresence = myPresence;
    [...$("smPresences").children].forEach((b) => b.classList.toggle("active", b.dataset.p === smPresence));
    $("statusText").value = myStatus || "";
    const act = myActivity || null;
    $("activityType").value = act ? act.type : "";
    $("activityName").value = act ? act.name : "";
    $("activityDetails").value = act ? (act.details || "") : "";
    $("activityName").disabled = !act;
    $("activityDetails").disabled = !act;
  }
  function closeStatusMenu() { $("statusMenu").classList.add("hidden"); }
  $("meStatusBtn").addEventListener("click", (e) => { e.stopPropagation(); const m = $("statusMenu"); if (m.classList.contains("hidden")) openStatusMenu(); else closeStatusMenu(); });
  document.addEventListener("click", (e) => {
    const m = $("statusMenu");
    if (m && !m.classList.contains("hidden") && !m.contains(e.target) && e.target !== $("meStatusBtn") && !$("meStatusBtn").contains(e.target)) closeStatusMenu();
  });
  [...$("smPresences").children].forEach((b) => { b.addEventListener("click", () => { smPresence = b.dataset.p; [...$("smPresences").children].forEach((x) => x.classList.remove("active")); b.classList.add("active"); }); });
  $("activityType").addEventListener("change", (e) => { $("activityName").disabled = !e.target.value; $("activityDetails").disabled = !e.target.value; if (e.target.value) $("activityName").focus(); });
  $("statusSave").addEventListener("click", async () => {
    const type = $("activityType").value;
    const name = $("activityName").value.trim();
    const details = $("activityDetails").value.trim();
    const activity = type ? { type, name, details } : null;
    manualActivity = !!activity;
    if (window.buddyDesktop && window.buddyDesktop.setManualOverride) window.buddyDesktop.setManualOverride(manualActivity);
    const res = await api("/api/presence", { presence: smPresence, status: $("statusText").value.trim(), activity }, true);
    if (res && res.ok && res.profile) { myPresence = res.profile.presence; myStatus = res.profile.status; myActivity = res.profile.activity; renderMyStatus(); }
    closeStatusMenu();
  });

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
      const fullList = kind === "sticker" ? ["webp", "png", "gif"] : ["gif", "mp4", "webp"];
      const prevList = ["gif", "webp", "png", "jpg"];
      for (const f of fullList) {
        const u = hd[f] || md[f];
        if (u) {
          const preview = prevList.map((p) => hd[p] || md[p]).find(Boolean) || u;
          const format = (f === "mp4" || f === "webm") ? "video" : "gif";
          return { full: u, preview, format };
        }
      }
    }
    // Fallback: some providers put a direct media url on the item.
    const direct = (item && (item.url || item.media_url || item.content_url));
    if (direct) {
      const format = /\.(mp4|webm)(\?|$)/i.test(direct) ? "video" : "gif";
      return { full: direct, preview: direct, format };
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
      if (data.error) { status.textContent = "GIFs are not available right now."; return; }
      const arr = Array.isArray(data.data) ? data.data : [];
      if (!arr.length) { status.textContent = q ? "No results." : "Nothing found."; return; }
      status.textContent = "";
      arr.slice(0, 48).forEach((m) => {
        if (!m || !m.url) return;
        const cell = document.createElement("div"); cell.className = "media-cell";
        const img = document.createElement("img"); img.src = m.preview || m.url; img.loading = "lazy";
        cell.appendChild(img);
        cell.addEventListener("click", () => { socket.emit("media", { url: m.url, kind: mediaKind, format: m.format }); hideMedia(); });
        grid.appendChild(cell);
      });
    } catch { status.textContent = "Could not load media."; }
  }

  // ====================================================================
  //  FILE UPLOADS
  // ====================================================================
  $("attachBtn").onclick = () => $("fileInput").click();
  $("fileInput").addEventListener("change", (e) => { handleFiles(e.target.files); e.target.value = ""; });
  function handleFiles(files) {
    [...(files || [])].forEach((file) => {
      if (!/^(image|video)\//.test(file.type)) { flash("Only images and videos can be sent."); return; }
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
    }     catch (err) { flash(err.message || "Upload failed.", "err"); }
    finally { sending.remove(); }
  }
  function appendSending(file) {
    const el = document.createElement("div"); el.className = "msg mine";
    const wrap = document.createElement("div"); wrap.className = "bubble-wrap";
    const bubble = document.createElement("div"); bubble.className = "bubble";
    if (file.type.startsWith("image")) { const img = document.createElement("img"); img.src = URL.createObjectURL(file); img.style.maxWidth = "320px"; img.style.maxHeight = "360px"; img.style.borderRadius = "10px"; bubble.appendChild(img); }
    else { bubble.textContent = "Sending " + file.name + "…"; }
    const time = document.createElement("div"); time.className = "time"; time.textContent = "sending…";
    wrap.append(bubble, time); el.append(wrap); messagesEl.appendChild(el); messagesEl.scrollTop = messagesEl.scrollHeight;
    return el;
  }
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
  function applySpeaker() { if (remoteVideo && devices.speaker && remoteVideo.setSinkId) remoteVideo.setSinkId(devices.speaker).catch(() => {}); }
  $("deviceRefresh").onclick = refreshDevices;
  $("micSelect").onchange = (e) => { devices.mic = e.target.value; saveDevices(); if (peer && localStream && inCall) restartStream(); else if (localStream) { const a = localStream.getAudioTracks()[0]; if (a) a.enabled = true; } };
  $("speakerSelect").onchange = (e) => { devices.speaker = e.target.value; saveDevices(); if (remoteVideo && remoteVideo.setSinkId) remoteVideo.setSinkId(devices.speaker).catch(() => {}); };
  if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) refreshDevices();

  // ====================================================================
  //  DESKTOP AUTO GAME DETECTION (Electron)
  // ====================================================================
  if (window.buddyDesktop && window.buddyDesktop.subscribeGame) {
    window.buddyDesktop.subscribeGame((game) => {
      if (manualActivity || !token) return;
      const activity = game ? { type: game.type || "playing", name: game.name, details: game.details || "" } : null;
      api("/api/presence", { presence: myPresence, status: myStatus, activity }, true)
        .then((res) => { if (res && res.ok && res.profile) { myPresence = res.profile.presence; myStatus = res.profile.status; myActivity = res.profile.activity; renderMyStatus(); updateHeader(); } })
        .catch(() => {});
    });
  }

  // ====================================================================
  //  ELECTRON: DURABLE LOGIN + UPDATE BANNER
  // ====================================================================
  async function restoreLogin() {
    if (token || !window.buddyDesktop || !window.buddyDesktop.loadLogin) return;
    try {
      const saved = await window.buddyDesktop.loadLogin();
      if (saved && saved.token) {
        token = saved.token; myUser = saved.user || ""; myName = saved.name || ""; myPic = saved.pic || "";
        persistAuth();
        authEl.classList.add("hidden"); appEl.classList.remove("hidden");
        loadMe(); renderMyIdentityPlaceholder();
        if (socket.connected) socket.emit("auth", { token });
      }
    } catch {}
  }
  restoreLogin();

  if (window.buddyDesktop) {
    const banner = $("updateBanner"), btn = $("updateBtn"), close = $("updateClose");
    if (banner) {
      window.buddyDesktop.onUpdateAvailable((v) => {
        banner.classList.remove("hidden");
        $("updateText").textContent = "Update to the latest version of Buddy" + (v ? " (v" + v + ")" : "");
        const us = $("updateStatus"); if (us) us.textContent = "";
      });
      window.buddyDesktop.onUpdateProgress((p) => { if (typeof p === "number") btn.textContent = "Downloading " + Math.round(p) + "%"; });
      window.buddyDesktop.onUpdateDownloaded(() => { btn.textContent = "Installing…"; if (window.buddyDesktop.installUpdate) window.buddyDesktop.installUpdate(); });
      window.buddyDesktop.onUpdateError(() => {});
      let busy = false;
      btn.onclick = () => { if (busy) return; busy = true; btn.textContent = "Downloading…"; if (window.buddyDesktop.startUpdateDownload) window.buddyDesktop.startUpdateDownload(); };
      close.onclick = () => banner.classList.add("hidden");
    }
    const cu = $("checkUpdateBtn"), us = $("updateStatus");
    if (cu) {
      window.buddyDesktop.onUpdateChecking(() => { if (us) us.textContent = "Checking for updates…"; });
      window.buddyDesktop.onUpdateLatest(() => { if (us) us.textContent = "You're on the latest version."; });
      cu.onclick = () => { if (window.buddyDesktop.checkForUpdates) { if (us) us.textContent = "Checking for updates…"; window.buddyDesktop.checkForUpdates(); } else if (us) us.textContent = "Updates only run in the desktop app."; };
    }
  }

  // ====================================================================
  //  CALLS (WebRTC)
  // ====================================================================
  const callOverlay = $("callOverlay"), localVideo = $("localVideo"), remoteVideo = $("remoteVideo"), callStatus = $("callStatus"), callAvatar = $("callAvatar");
  let localStream = null, peer = null, inCall = false, pendingOffer = null, ringFrom = null, pendingCandidates = [];
  let screenStream = null;

  let callFailTimer = null;
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
    pc.onconnectionstatechange = () => {
      const s = pc.connectionState;
      if (s === "connected" || s === "completed") {
        if (callFailTimer) { clearTimeout(callFailTimer); callFailTimer = null; }
        callStatus.textContent = "Connected";
        setTimeout(() => updateCallRoute(pc), 1000);
      } else if (s === "failed") {
        if (callFailTimer) { clearTimeout(callFailTimer); callFailTimer = null; }
        callStatus.textContent = "Call failed";
        flash("Call couldn't connect. If you're on different networks, a TURN relay may be required.", "err");
      } else if (s === "disconnected") {
        callStatus.textContent = "Reconnecting…";
      }
    };
    return pc;
  }
  async function updateCallRoute(pc) {
    const route = $("callRoute"); if (!route || !pc) return;
    let relayed = false;
    try {
      const stats = await pc.getStats();
      stats.forEach((rep) => {
        if (rep.type === "candidate-pair" && (rep.selected || rep.nominated) && rep.state === "succeeded") {
          const local = stats.get(rep.localCandidateId);
          const remote = stats.get(rep.remoteCandidateId);
          if ((local && local.candidateType === "relay") || (remote && remote.candidateType === "relay")) relayed = true;
        }
      });
    } catch {}
    route.classList.remove("hidden");
    if (relayed) { route.textContent = "Relay · TURN"; route.classList.add("relay"); route.classList.remove("direct"); }
    else { route.textContent = "Direct · P2P"; route.classList.add("direct"); route.classList.remove("relay"); }
  }
  function applyCallDevices() {
    if (remoteVideo && devices.speaker && remoteVideo.setSinkId) remoteVideo.setSinkId(devices.speaker).catch(() => {});
    if (peer && localStream && inCall) restartStream();
  }
  async function restartStream() {
    if (!peer || !localStream) return;
    const hadVideo = localStream.getVideoTracks().length > 0;
    const videoEnabled = hadVideo ? localStream.getVideoTracks()[0].enabled : true;
    const audioEnabled = localStream.getAudioTracks()[0] ? localStream.getAudioTracks()[0].enabled : true;
    const constraints = { audio: devices.mic ? { deviceId: { ideal: devices.mic } } : true };
    if (hadVideo) constraints.video = true;
    let newStream;
    try { newStream = await navigator.mediaDevices.getUserMedia(constraints); }
    catch (e) { console.error("Could not switch input device:", e); flash("Could not switch microphone."); return; }
    const oldStream = localStream;
    localStream = newStream;
    localVideo.srcObject = localStream;
    const senders = peer.getSenders();
    newStream.getTracks().forEach((t) => {
      const s = senders.find((x) => x.track && x.track.kind === t.kind);
      if (s) s.replaceTrack(t); else peer.addTrack(t, localStream);
    });
    if (localStream.getVideoTracks()[0]) localStream.getVideoTracks()[0].enabled = videoEnabled;
    if (localStream.getAudioTracks()[0]) localStream.getAudioTracks()[0].enabled = audioEnabled;
    oldStream.getTracks().forEach((t) => t.stop());
  }
  async function startScreenShare() {
    if (!peer) { flash("Start a call before sharing your screen.", "err"); return; }
    let stream;
    try { stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 15 }, audio: false }); }
    catch (e) { return; } // user cancelled
    screenStream = stream;
    const screenTrack = stream.getVideoTracks()[0];
    const sender = peer.getSenders().find((s) => s.track && s.track.kind === "video");
    if (sender) sender.replaceTrack(screenTrack);
    localVideo.srcObject = stream; localVideo.classList.remove("hidden-cam");
    screenTrack.onended = () => stopScreenShare();
    $("toggleScreen").classList.add("hangup");
    flash("Sharing your screen.");
  }
  function stopScreenShare() {
    if (screenStream) { screenStream.getTracks().forEach((t) => t.stop()); screenStream = null; }
    const sender = peer && peer.getSenders().find((s) => s.track && s.track.kind === "video");
    const camTrack = localStream && localStream.getVideoTracks()[0];
    if (sender) sender.replaceTrack(camTrack || null);
    if (localStream) { localVideo.srcObject = localStream; localVideo.classList.toggle("hidden-cam", !(localStream.getVideoTracks()[0] && localStream.getVideoTracks()[0].enabled)); }
    const ts = $("toggleScreen"); if (ts) ts.classList.remove("hangup");
  }
  async function startCall(asInitiator) {
    const audio = devices.mic ? { deviceId: { ideal: devices.mic } } : true;
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ video: true, audio }); }
    catch { try { stream = await navigator.mediaDevices.getUserMedia({ audio: devices.mic ? { deviceId: { ideal: devices.mic } } : true }); } catch (e2) { flash("Camera or microphone blocked. (" + (e2 && e2.message) + ")", "err"); return; } }
    localStream = stream;
    localVideo.srcObject = localStream; inCall = true;
    callOverlay.classList.remove("hidden");
    $("callRoute").classList.add("hidden");
    $("callBtn").classList.add("hidden"); $("hangupBtn").classList.remove("hidden");
    callAvatar.innerHTML = ""; if (activePeer) callAvatar.appendChild(avatarEl(activePeer.displayName, activePeer.pic)); callAvatar.classList.remove("hidden");
    if (devices.speaker && remoteVideo.setSinkId) remoteVideo.setSinkId(devices.speaker).catch(() => {});
    try { refreshDevices(); } catch {}
    await refreshIce();
    peer = makePeer();
    localStream.getTracks().forEach((t) => peer.addTrack(t, localStream));
    if (callFailTimer) { clearTimeout(callFailTimer); callFailTimer = null; }
    if (asInitiator) {
      callStatus.textContent = "Ringing…";
      callFailTimer = setTimeout(() => { if (peer && peer.connectionState !== "connected" && peer.connectionState !== "completed") flash("Still connecting… if this hangs, a TURN relay may be needed for your network.", "info"); }, 12000);
      try { const offer = await peer.createOffer(); await peer.setLocalDescription(offer); socket.emit("call:offer", offer); } catch (e) { console.error(e); }
    } else if (pendingOffer) { await handleOffer(pendingOffer); pendingOffer = null; }
  }
  async function handleOffer(offer) {
    if (!inCall) await startCall(false);
    callStatus.textContent = "Connected";
    if (!peer) { await refreshIce(); peer = makePeer(); localStream.getTracks().forEach((t) => peer.addTrack(t, localStream)); }
    try { await peer.setRemoteDescription(new RTCSessionDescription(offer)); await flushCandidates(); const answer = await peer.createAnswer(); await peer.setLocalDescription(answer); socket.emit("call:answer", answer); } catch (e) { console.error(e); }
  }
  async function flushCandidates() { while (pendingCandidates.length) { try { await peer.addIceCandidate(pendingCandidates.shift()); } catch (e) {} } }
  function endCall() {
    hideIncoming();
    if (peer) { try { peer.close(); } catch {} peer = null; }
    if (localStream) { localStream.getTracks().forEach((t) => t.stop()); localStream = null; }
    remoteVideo.srcObject = null; localVideo.srcObject = null; localVideo.classList.remove("hidden-cam");
    inCall = false; pendingOffer = null; pendingCandidates = [];
    callOverlay.classList.add("hidden"); callAvatar.classList.add("hidden");
    $("callRoute").classList.add("hidden");
    $("callPill").classList.add("hidden");
    $("callBtn").classList.remove("hidden"); $("hangupBtn").classList.add("hidden");
    socket.emit("call:end");
    // Stop any active screen share when the call ends
    if (screenStream) { screenStream.getTracks().forEach((t) => t.stop()); screenStream = null; const ts = $("toggleScreen"); if (ts) ts.classList.remove("hangup"); }
  }
  function showCallOverlay() { callOverlay.classList.remove("hidden"); $("callPill").classList.add("hidden"); }
  function hideCallOverlay() { callOverlay.classList.add("hidden"); if (inCall) $("callPill").classList.remove("hidden"); }

  $("callBtn").onclick = async () => { if (inCall || !activePeer) return; callStatus.textContent = "Ringing…"; socket.emit("call:ring"); await startCall(true); };
  $("hangupBtn").onclick = endCall;
  $("endCall").onclick = endCall;
  $("toggleScreen").onclick = () => { if (screenStream) stopScreenShare(); else startScreenShare(); };
  $("toggleCallView").onclick = () => { if (callOverlay.classList.contains("hidden")) showCallOverlay(); else hideCallOverlay(); };
  $("showCallBtn").onclick = showCallOverlay;
  $("endCallPill").onclick = endCall;

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
  async function acceptCall() { hideIncoming(); if (ringFrom) openDM(ringFrom, true); socket.emit("call:accept"); await startCall(false); }
  function declineCall() { socket.emit("call:reject"); hideIncoming(); }
  $("incomingAccept").onclick = acceptCall;
  $("incomingDecline").onclick = declineCall;

  socket.on("call:ring", ({ from, fromName }) => { if (inCall) return; showIncoming(from, fromName); });
  socket.on("call:offer", ({ offer }) => { if (inCall) handleOffer(offer); else pendingOffer = offer; });
  socket.on("call:answer", async ({ answer }) => { callStatus.textContent = "Connected"; if (peer) { try { await peer.setRemoteDescription(new RTCSessionDescription(answer)); await flushCandidates(); if (remoteVideo && devices.speaker && remoteVideo.setSinkId) remoteVideo.setSinkId(devices.speaker).catch(() => {}); } catch (e) {} } });
  socket.on("call:ice", async ({ candidate }) => { if (peer && candidate) { try { if (peer.remoteDescription && peer.remoteDescription.type) await peer.addIceCandidate(new RTCIceCandidate(candidate)); else pendingCandidates.push(candidate); } catch (e) {} } else if (candidate) pendingCandidates.push(candidate); });
  socket.on("call:accept", () => { callStatus.textContent = "Connected"; });
  socket.on("call:reject", () => { callStatus.textContent = "Call declined"; endCall(); });
  socket.on("call:end", () => { if (inCall || !incoming.classList.contains("hidden")) { callStatus.textContent = "Call ended"; endCall(); } });

  $("toggleAudio").onclick = () => { const t = localStream && localStream.getAudioTracks()[0]; if (t) { t.enabled = !t.enabled; setIcon($("toggleAudio"), t.enabled ? "icon-mic" : "icon-mic-off"); $("toggleAudio").classList.toggle("hangup", !t.enabled); } };
  $("toggleVideo").onclick = () => { const t = localStream && localStream.getVideoTracks()[0]; if (t) { t.enabled = !t.enabled; setIcon($("toggleVideo"), t.enabled ? "icon-video" : "icon-video-off"); $("toggleVideo").classList.toggle("hangup", !t.enabled); localVideo.classList.toggle("hidden-cam", !t.enabled); if (!t.enabled) callAvatar.classList.remove("hidden"); else callAvatar.classList.add("hidden"); } };

  let beepAudio = null;
  function beep() { try { beepAudio = beepAudio || new (window.AudioContext || window.webkitAudioContext)(); const o = beepAudio.createOscillator(); const g = beepAudio.createGain(); o.connect(g); g.connect(beepAudio.destination); o.frequency.value = 520; g.gain.value = 0.06; o.start(); o.stop(beepAudio.currentTime + 0.9); } catch {} }

  // ====================================================================
  //  PROMPT MODAL
  // ====================================================================
  let promptCb = null;
  function openPrompt(title, placeholder, cb, value) {
    $("promptTitle").textContent = title;
    const i = $("promptInput"); i.value = value || ""; i.placeholder = placeholder || "";
    promptCb = cb; $("promptModal").classList.remove("hidden"); setTimeout(() => i.focus(), 50);
  }
  function closePrompt() { $("promptModal").classList.add("hidden"); promptCb = null; }
  $("promptOk").onclick = () => { const v = $("promptInput").value.trim(); const cb = promptCb; closePrompt(); if (cb && v) cb(v); };
  $("promptCancel").onclick = closePrompt;
  $("promptInput").addEventListener("keydown", (e) => { if (e.key === "Enter") $("promptOk").click(); if (e.key === "Escape") closePrompt(); });

  // ====================================================================
  //  AUTO-LOGIN
  // ====================================================================
  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

  // ---- Markdown + mentions + spoilers + emoji rendering ----
  function renderText(t) {
    if (t == null) return "";
    let s = escapeHtml(t);
    // code blocks ```...```
    s = s.replace(/```([\s\S]*?)```/g, (m, c) => '<pre class="md-pre"><code>' + c.replace(/^\n/, "") + "</code></pre>");
    // inline code `...`
    s = s.replace(/`([^`\n]+)`/g, '<code class="md-code">$1</code>');
    // blockquote > ...
    s = s.replace(/(^|\n)&gt;\s?([^\n]+)/g, '$1<blockquote class="md-quote">$2</blockquote>');
    // bold **x**, italic *x* or _x_, underline __x__, strike ~~x~~
    s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/__([^_]+)__/g, "<u>$1</u>");
    s = s.replace(/~~([^~]+)~~/g, "<del>$1</del>");
    s = s.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");
    s = s.replace(/(^|[^_])_([^_\n]+)_(?!_)/g, "$1<em>$2</em>");
    // spoilers ||x||
    s = s.replace(/\|\|([^|]+)\|\|/g, '<span class="spoiler">$1</span>');
    // links
    s = s.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
    // mentions @user @here @everyone and :emoji: (custom emoji replaced by features.js if available)
    s = s.replace(/@(everyone|here|\w[\w\d_]{2,19})/g, (m, u) => '<span class="mention" data-mention="' + u + '">@' + u + "</span>");
    return s;
  }
  function renderDeleted(m) {
    const el = document.createElement("div");
    el.className = "msg system deleted-msg";
    if (m.id) el.dataset.id = m.id;
    const b = document.createElement("div"); b.className = "bubble"; b.textContent = "Message deleted";
    el.appendChild(b); messagesEl.appendChild(el);
    return;
  }
  const polls = new Map();
  function renderPoll(bubble, m) {
    polls.set(m.id, { question: m.poll.question, options: m.poll.options });
    const wrap = document.createElement("div"); wrap.className = "poll";
    const q = document.createElement("div"); q.className = "poll-q"; q.textContent = m.poll.question; wrap.appendChild(q);
    const opts = document.createElement("div"); opts.className = "poll-opts"; wrap.appendChild(opts);
    bubble.appendChild(wrap);
    updatePollVotes(m.id, m.poll.votes || {});
  }
  function updatePollVotes(id, votes) {
    const el = [...messagesEl.children].find((c) => c.dataset.id === id); if (!el) return;
    const opts = el.querySelector(".poll-opts"); if (!opts) return;
    const data = polls.get(id); if (!data) return;
    const tally = {}; Object.values(votes).forEach((v) => { tally[v] = (tally[v] || 0) + 1; });
    const total = Object.keys(votes).length;
    opts.innerHTML = "";
    data.options.forEach((opt) => {
      const row = document.createElement("button"); row.className = "poll-opt"; row.type = "button";
      const mine = votes[myUser] === opt; if (mine) row.classList.add("voted");
      const cnt = tally[opt] || 0; const pct = total ? Math.round((cnt / total) * 100) : 0;
      row.innerHTML = '<span class="poll-bar" style="width:' + pct + '%"></span><span class="poll-label">' + escapeHtml(opt) + '</span><span class="poll-cnt">' + cnt + (mine ? ' <svg class="icon poll-check"><use href="#icon-check"/></svg>' : "") + "</span>";
      row.addEventListener("click", () => socket.emit("poll:vote", { id, option: opt }));
      opts.appendChild(row);
    });
  }
  socket.on("poll:update", ({ id, votes }) => updatePollVotes(id, votes || {}));
  // expose internals for the features module
  window.Buddy = {
    socket, api, flash, openPrompt, profiles, state, escapeHtml, renderText,
    refreshIce,
    getICE: () => ICE,
    sendRaw: (t) => socket.emit("message", t),
    sendMedia: (url, kind, format) => socket.emit("media", { url, kind, format }),
    myUser: () => myUser,
    currentRoom: () => (view === "dm" && activePeer ? dmRoomKey(myUser, activePeer.username) : (view === "server" && activeChannel ? "chan:" + activeChannel : null)),
    currentView: () => view,
    activePeer: () => activePeer,
    activeServer: () => activeServer,
    activeChannel: () => activeChannel,
    openDM, selectServer, openChannel, appendMessage, loadMe,
    startReply, jumpToMessage,
    setMsgInput: (v) => { msgInput.value = v; msgInput.focus(); },
    getMsgInput: () => msgInput.value,
    getMsgInputEl: () => msgInput,
    call: () => ({ inCall, peer, localStream }),
    setLocalAudio: (on) => { if (localStream && localStream.getAudioTracks()[0]) localStream.getAudioTracks()[0].enabled = on; },
    addRecentEmoji: (e) => { try { const k = "buddy-emoji-recent"; let a = JSON.parse(localStorage.getItem(k) || "[]"); a = a.filter((x) => x !== e); a.unshift(e); a = a.slice(0, 24); localStorage.setItem(k, JSON.stringify(a)); } catch {} },
  };

  fetch("/api/version").then((r) => r.json()).then((d) => { const v = d && d.version; if (v) { const a = $("authVersion"), s = $("settingsVersion"); if (a) a.textContent = "v" + v; if (s) s.textContent = "Buddy v" + v; } }).catch(() => {});
  if (token) { authEl.classList.add("hidden"); appEl.classList.remove("hidden"); loadMe(); renderMyIdentityPlaceholder(); }
  function renderMyIdentityPlaceholder() { $("meName").textContent = myName; renderMyAvatar(); $("nameEdit").value = myName; $("userEdit").value = "@" + myUser; renderMyStatus(); }
})();
