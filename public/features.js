/* Buddy — Discord-like feature pack (client side)
 * Uses window.Buddy (exposed by client.js). Safe to load after client.js.
 */
(function () {
  "use strict";
  const B = window.Buddy;
  if (!B) return;
  const socket = B.socket, api = B.api, flash = B.flash, openPrompt = B.openPrompt;
  const $ = (id) => document.getElementById(id);
  const ce = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };

  // ---------------------------------------------------------------- Emoji data
  const EMOJI = {
    Smileys: ["😀","😃","😄","😁","😆","😅","😂","🤣","😊","😇","🙂","🙃","😉","😍","😘","😜","😎","🤩","🥳","😏","😢","😭","😤","😡","🤔","🤨","😐","😴","🥱","😇"],
    Gestures: ["👍","👎","👏","🙌","🙏","💪","👌","✌️","🤞","🤙","👋","🤝","✍️","💡","🔥","⭐","🌟","💯","✨","🎉","🎊","❤️","🧡","💛","💚","💙","💜","🖤","🤍","💔"],
    Animals: ["🐶","🐱","🐭","🐹","🐰","🦊","🐻","🐼","🐨","🐯","🦁","🐮","🐷","🐸","🐵","🐔","🐧","🐦","🦄","🐝","🦋","🐢","🐙","🦖","🐳","🐬","🐟","🐠","🐡","🦀"],
    Food: ["🍎","🍊","🍋","🍌","🍉","🍇","🍓","🫐","🍒","🍑","🥭","🍍","🥥","🍔","🍟","🍕","🌭","🌮","🌯","🍜","🍣","🍱","🍦","🍩","🍪","🎂","🍰","☕","🍫","🍿"],
    Activity: ["⚽","🏀","🏈","⚾","🎾","🏐","🎱","🏓","🏸","🥅","🏒","🏑","🥍","🏏","⛳","🎯","🎮","🕹️","🎲","🎸","🎺","🎻","🥁","🎤","🎧","🎬","🎨","🚀","⚡","💻"],
    Objects: ["💡","📱","💻","⌨️","🖥️","🖨️","🖱️","💾","💿","📷","🎥","📺","⏰","📚","📝","✏️","📌","📎","🔑","🔒","🔓","💡","🔔","🎁","🏆","🥇","🥈","🥉","💎","🔮"],
    Symbols: ["✅","❌","⚠️","❓","❗","💢","💬","💭","🔥","⭐","🌟","💯","✨","🆗","🆕","🆒","🆙","👀","🔍","🔔","📣","➡️","⬅️","⬆️","⬇️","🔄","♻️","🚫","❤️","💔"],
    Nature: ["🌍","🌕","⭐","🌟","🌈","☀️","🌤️","⛅","🌧️","⛈️","🌩️","🌨️","❄️","🌬️","💧","🌊","🌸","🌺","🌻","🌹","🌲","🌳","🌴","🍀","🍁","🍂","🍃","🌵","⛰️","🌋"],
  };
  const EMOJI_FLAT = [].concat(...Object.values(EMOJI));

  // ---------------------------------------------------------------- Root mount
  const root = ce("div"); root.id = "featRoot"; document.body.appendChild(root);

  // ============================================================ EMOJI PICKER
  let emojiMode = "insert", emojiTargetId = null;
  const emojiPanel = ce("div", "emoji-panel hidden");
  emojiPanel.innerHTML =
    '<div class="emoji-head"><input id="emojiSearch" placeholder="Search emoji" /><button id="emojiClose" class="icon-btn">✕</button></div>' +
    '<div id="emojiCats" class="emoji-cats"></div>' +
    '<div id="emojiGrid" class="emoji-grid"></div>';
  root.appendChild(emojiPanel);
  const emojiInput = $("emojiSearch"), emojiGrid = $("emojiGrid"), emojiCats = $("emojiCats");
  function renderEmojiCats() {
    emojiCats.innerHTML = "";
    Object.keys(EMOJI).forEach((cat, i) => {
      const b = ce("button", "emoji-cat" + (i === 0 ? " active" : ""), cat.slice(0, 2));
      b.title = cat; b.onclick = () => { [...emojiCats.children].forEach((x) => x.classList.remove("active")); b.classList.add("active"); renderEmojiGrid(EMOJI[cat]); };
      emojiCats.appendChild(b);
    });
  }
  function renderEmojiGrid(list) {
    emojiGrid.innerHTML = "";
    list.forEach((e) => {
      const c = ce("button", "emoji-cell", e);
      c.onclick = () => pickEmoji(e);
      emojiGrid.appendChild(c);
    });
  }
  function pickEmoji(e) {
    B.addRecentEmoji(e);
    if (emojiMode === "react" && emojiTargetId) { socket.emit("react", { id: emojiTargetId, emoji: e }); hideEmoji(); return; }
    const inp = B.getMsgInputEl();
    const s = inp.selectionStart || inp.value.length;
    inp.value = inp.value.slice(0, s) + e + inp.value.slice(inp.selectionEnd || s);
    inp.focus(); inp.selectionStart = inp.selectionEnd = s + e.length;
    hideEmoji();
  }
  function showEmoji(mode, targetId, anchor) {
    emojiMode = mode || "insert"; emojiTargetId = targetId || null;
    renderEmojiCats(); renderEmojiGrid(EMOJI[Object.keys(EMOJI)[0]]);
    emojiPanel.classList.remove("hidden");
    if (anchor) { const r = anchor.getBoundingClientRect(); emojiPanel.style.left = Math.max(8, r.left) + "px"; emojiPanel.style.top = Math.min(window.innerHeight - 360, r.bottom + 6) + "px"; }
  }
  function hideEmoji() { emojiPanel.classList.add("hidden"); }
  $("emojiClose").onclick = hideEmoji;
  emojiInput.addEventListener("input", () => {
    const q = emojiInput.value.trim().toLowerCase();
    if (!q) { renderEmojiGrid(EMOJI[Object.keys(EMOJI)[0]]); return; }
    renderEmojiGrid(EMOJI_FLAT.filter((e) => true).slice(0, 60));
  });
  const emojiBtn = ce("button", "icon-btn", "😊"); emojiBtn.title = "Emoji"; emojiBtn.id = "emojiBtn";
  emojiBtn.onclick = () => showEmoji("insert", null, emojiBtn);
  const composer = document.querySelector(".composer");
  if (composer) composer.insertBefore(emojiBtn, composer.querySelector("#mediaBtn"));

  // ============================================================ COMPOSER EXTRAS (mentions, slash, drafts)
  const drafts = {};
  const msgInput = B.getMsgInputEl();
  msgInput.addEventListener("input", () => { const r = B.currentRoom(); if (r) drafts[r] = msgInput.value; });
  socket.on("history", () => setTimeout(() => { const r = B.currentRoom(); if (r && drafts[r] != null && msgInput.value === "") msgInput.value = drafts[r]; }, 60));
  socket.on("message", (m) => { if (m.user === B.myUser() && B.currentRoom()) delete drafts[B.currentRoom()]; });

  // Slash commands (capture phase so we beat the client's Enter handler)
  msgInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && settings_enter() && !msgInput.disabled) {
      const v = msgInput.value;
      if (v.startsWith("/")) { e.stopPropagation(); e.preventDefault(); runSlash(v); return; }
      if (mentionOpen) { e.stopPropagation(); e.preventDefault(); acceptMention(); return; }
    }
    if (e.key === "Escape" && mentionOpen) { e.stopPropagation(); e.preventDefault(); closeMention(); }
  }, true);
  function settings_enter() {
    try { return JSON.parse(localStorage.getItem("buddy-settings") || "{}").enter !== false; } catch { return true; }
  }
  function runSlash(v) {
    const [cmd, ...rest] = v.slice(1).split(" ");
    const arg = rest.join(" ");
    switch (cmd.toLowerCase()) {
      case "me": B.sendRaw("_" + (arg || "…") + "_"); break;
      case "shrug": B.sendRaw(msgInput.value.replace(/^\/shrug\s*/, "") + " ¯\\_(ツ)_/¯"); break;
      case "tableflip": B.sendRaw("(╯°□°）╯︵ ┻━┻"); break;
      case "gif": case "tenor": $("mediaBtn").click(); break;
      case "tts": speak(arg); break;
      case "nick":
        if (B.activeServer()) api("/api/servers/nick", { serverId: B.activeServer(), nick: arg }, true).then((r) => r.ok ? flash("Nickname set.") : flash(r.error || "No.", "err"));
        else flash("Nicknames are for servers.", "err");
        break;
      case "poll": {
        const parts = v.slice(1).replace(/^poll\s*/i, "").split("|").map((s) => s.trim()).filter(Boolean);
        if (parts.length < 3) { flash("Usage: /poll Question | Option 1 | Option 2 …", "err"); break; }
        const [q, ...opts] = parts;
        socket.emit("poll:create", { question: q, options: opts });
        break;
      }
      case "clear": messages.innerHTML = ""; break;
      default: flash("Unknown command: /" + cmd, "err");
    }
    msgInput.value = "";
  }
  function speak(text) {
    if (!("speechSynthesis" in window)) return flash("Text-to-speech not supported.");
    const u = new SpeechSynthesisUtterance(text); speechSynthesis.cancel(); speechSynthesis.speak(u);
  }

  // Mention autocomplete
  let mentionOpen = false, mentionItems = [], mentionIndex = 0, mentionStart = 0;
  const mentionBox = ce("div", "mention-box hidden"); root.appendChild(mentionBox);
  msgInput.addEventListener("input", () => {
    const v = msgInput.value; const pos = msgInput.selectionStart || v.length;
    const m = /(^|\s)@([\w\d_]{0,20})$/.exec(v.slice(0, pos));
    if (!m) { closeMention(); return; }
    mentionStart = pos - m[2].length - 1;
    const q = m[2].toLowerCase();
    const names = collectMentions().filter((n) => n.toLowerCase().includes(q));
    if (!names.length) { closeMention(); return; }
    mentionItems = names.slice(0, 8); mentionIndex = 0;
    renderMention(); mentionOpen = true; mentionBox.classList.remove("hidden");
    const r = msgInput.getBoundingClientRect();
    mentionBox.style.left = r.left + "px"; mentionBox.style.top = (r.bottom + 4) + "px";
  });
  function collectMentions() {
    const set = new Set(["everyone", "here"]);
    (B.state.friends || []).forEach((f) => set.add(f.username));
    const s = (B.state.servers || []).find((x) => x.id === B.activeServer());
    if (s) (s.members || []).forEach((m) => set.add(m.username));
    return [...set];
  }
  function renderMention() {
    mentionBox.innerHTML = "";
    mentionItems.forEach((n, i) => {
      const row = ce("div", "mention-item" + (i === mentionIndex ? " active" : ""), "@" + n);
      row.onclick = () => { mentionIndex = i; acceptMention(); };
      mentionBox.appendChild(row);
    });
  }
  function acceptMention() {
    const v = msgInput.value, pos = msgInput.selectionStart || v.length;
    const before = v.slice(0, mentionStart); const after = v.slice(pos);
    msgInput.value = before + "@" + mentionItems[mentionIndex] + " " + after;
    closeMention(); msgInput.focus();
  }
  function closeMention() { mentionOpen = false; mentionBox.classList.add("hidden"); }

  // ============================================================ HEADER TOOLBAR (search, pins, bookmarks)
  const headerTools = ce("div", "header-tools");
  const searchBtn = ce("button", "icon-btn", "🔍"); searchBtn.title = "Search messages";
  const pinsBtn = ce("button", "icon-btn", "📌"); pinsBtn.title = "Pinned messages";
  const bookBtn = ce("button", "icon-btn", "🔖"); bookBtn.title = "Saved messages";
  headerTools.append(searchBtn, pinsBtn, bookBtn);
  const chatActions = document.querySelector(".chat-actions");
  if (chatActions) chatActions.prepend(headerTools);

  // ============================================================ CONTEXT MENU + HOVER TOOLBAR
  const ctx = ce("div", "ctx-menu hidden"); root.appendChild(ctx);
  const hover = ce("div", "hover-bar hidden"); hover.innerHTML = '<button data-act="react" title="React">😊</button><button data-act="reply" title="Reply">↩</button><button data-act="more" title="More">⋯</button>';
  root.appendChild(hover);
  let ctxMsgId = null;
  function msgElFrom(target) { return target.closest ? target.closest(".msg") : null; }
  document.getElementById("messages").addEventListener("contextmenu", (e) => {
    const el = msgElFrom(e.target); if (!el || !el.dataset.id || el.classList.contains("system")) return;
    e.preventDefault(); ctxMsgId = el.dataset.id; openContext(e.clientX, e.clientY);
  });
  function openContext(x, y) {
    const mine = msgOwns(ctxMsgId);
    ctx.innerHTML = "";
    const items = [
      ["React", "react"], ["Reply", "reply"], ["Quote", "quote"], ["Copy text", "copy"], ["Copy link", "link"],
      ["Forward", "forward"], ["Bookmark", "bookmark"], ["Pin", "pin"], mine ? ["Edit", "edit"] : null,
      mine ? ["Delete", "delete"] : ["Report", "report"],
    ].filter(Boolean);
    items.forEach(([label, act]) => {
      const it = ce("div", "ctx-item", label); it.onclick = () => { ctx.classList.add("hidden"); doAction(act); };
      ctx.appendChild(it);
    });
    ctx.style.left = Math.min(x, window.innerWidth - 180) + "px";
    ctx.style.top = Math.min(y, window.innerHeight - 260) + "px";
    ctx.classList.remove("hidden");
  }
  function msgOwns(id) { const el = [...document.getElementById("messages").children].find((c) => c.dataset.id === id); return el && el.classList.contains("mine"); }
  function getMsgText(id) {
    const el = [...document.getElementById("messages").children].find((c) => c.dataset.id === id);
    if (!el) return ""; const b = el.querySelector(".bubble"); return b ? b.textContent : "";
  }
  function doAction(act) {
    const id = ctxMsgId; if (!id) return;
    if (act === "react") { showEmoji("react", id, hover); }
    else if (act === "reply") { B.setMsgInput(""); /* focus reply later */ flash("Tip: quote to reply with context."); }
    else if (act === "quote") { B.setMsgInput("> " + getMsgText(id).slice(0, 400) + "\n"); }
    else if (act === "copy") { navigator.clipboard && navigator.clipboard.writeText(getMsgText(id)); flash("Copied."); }
    else if (act === "link") { navigator.clipboard && navigator.clipboard.writeText(location.href.split("#")[0] + "#" + id); flash("Link copied."); }
    else if (act === "forward") { openForward(id); }
    else if (act === "bookmark") { const room = B.currentRoom(); api("/api/me/bookmark", { room, id }, true).then((r) => r.ok ? flash("Saved.") : flash(r.error || "No.", "err")); }
    else if (act === "pin") { socket.emit("pin", { id }); }
    else if (act === "edit") { const t = getMsgText(id); B.setMsgInput(t); }
    else if (act === "delete") { socket.emit("delete", { id }); }
    else if (act === "report") { const reason = prompt("Why are you reporting this message?"); if (reason !== null) api("/api/report/message", { room: B.currentRoom(), id, reason }, true).then(() => flash("Reported.")); }
  }
  document.addEventListener("click", (e) => { if (!ctx.contains(e.target)) ctx.classList.add("hidden"); });
  hover.addEventListener("click", (e) => {
    const act = e.target.dataset.act; if (!act) return;
    const el = msgElFrom(e.target); if (!el) return; ctxMsgId = el.dataset.id; hover.classList.add("hidden");
    if (act === "react") showEmoji("react", ctxMsgId, hover);
    else if (act === "reply") doAction("quote");
    else if (act === "more") { const r = el.getBoundingClientRect(); openContext(r.right, r.top); }
  });
  document.getElementById("messages").addEventListener("mouseover", (e) => {
    const el = msgElFrom(e.target); if (!el || el.dataset.id === hover.dataset.for) return;
    hover.dataset.for = el.dataset.id; const r = el.getBoundingClientRect();
    hover.style.left = (r.right - 84) + "px"; hover.style.top = (r.top + 4) + "px"; hover.classList.remove("hidden");
  });
  document.getElementById("messages").addEventListener("mouseout", (e) => {
    const to = e.relatedTarget; if (to && hover.contains(to)) return; if (to && msgElFrom(to) === msgElFrom(e.target)) return; hover.classList.add("hidden"); hover.dataset.for = "";
  });
  document.getElementById("messages").addEventListener("click", (e) => {
    const add = e.target.closest && e.target.closest(".react-add");
    if (add && add.dataset.reactAdd) { showEmoji("react", add.dataset.reactAdd, add); }
    const sp = e.target.closest && e.target.closest(".spoiler");
    if (sp) sp.classList.add("revealed");
    const men = e.target.closest && e.target.closest(".mention");
    if (men && men.dataset.mention && !["everyone", "here"].includes(men.dataset.mention) && B.profiles.get(men.dataset.mention)) { /* optional profile open */ }
  });

  // ============================================================ PINNED PANEL
  let pinnedIds = new Set();
  const pinsPanel = ce("div", "side-panel hidden");
  pinsPanel.innerHTML = '<div class="sp-head"><span>Pinned messages</span><button id="pinsClose" class="icon-btn">✕</button></div><div id="pinsBody" class="sp-body"></div>';
  root.appendChild(pinsPanel);
  $("pinsClose").onclick = () => pinsPanel.classList.add("hidden");
  pinsBtn.onclick = () => { renderPins(); pinsPanel.classList.toggle("hidden"); };
  socket.on("pinned", ({ ids }) => { pinnedIds = new Set(ids || []); updatePinBadges(); });
  function updatePinBadges() {
    document.querySelectorAll("#messages .msg").forEach((el) => {
      if (!el.dataset.id) return;
      let badge = el.querySelector(".pin-badge");
      if (pinnedIds.has(el.dataset.id)) { if (!badge) { badge = ce("span", "pin-badge", "📌"); el.querySelector(".bubble-wrap").appendChild(badge); } }
      else if (badge) badge.remove();
    });
  }
  function renderPins() {
    const body = $("pinsBody"); body.innerHTML = "";
    const ids = [...pinnedIds];
    if (!ids.length) { body.innerHTML = '<p class="sp-empty">No pinned messages.</p>'; return; }
    ids.forEach((id) => {
      const el = [...document.getElementById("messages").children].find((c) => c.dataset.id === id);
      const txt = el ? (el.querySelector(".bubble") || {}).textContent || "" : "(not loaded)";
      const row = ce("div", "pin-row", txt.slice(0, 200)); row.onclick = () => { const m = document.getElementById("messages").querySelector('[data-id="' + id + '"]'); if (m) m.scrollIntoView({ behavior: "smooth", block: "center" }); };
      body.appendChild(row);
    });
  }

  // ============================================================ BOOKMARKS PANEL
  const bookPanel = ce("div", "side-panel hidden");
  bookPanel.innerHTML = '<div class="sp-head"><span>Saved messages</span><button id="bookClose" class="icon-btn">✕</button></div><div id="bookBody" class="sp-body"></div>';
  root.appendChild(bookPanel);
  $("bookClose").onclick = () => bookPanel.classList.add("hidden");
  bookBtn.onclick = async () => {
    try { const r = await api("/api/bookmarks", {}, true); const body = $("bookBody"); body.innerHTML = "";
      if (!r.bookmarks || !r.bookmarks.length) { body.innerHTML = '<p class="sp-empty">Nothing saved yet.</p>'; }
      else r.bookmarks.forEach((m) => { const row = ce("div", "pin-row", (m.text || m.kind || "media").slice(0, 200)); body.appendChild(row); });
    } catch {} bookPanel.classList.toggle("hidden");
  };

  // ============================================================ SEARCH PANEL
  const searchPanel = ce("div", "modal hidden");
  searchPanel.innerHTML = '<div class="modal-card search-card"><h3>Search messages</h3><input id="searchInput" placeholder="Search this channel…" /><div id="searchResults" class="search-results"></div><button id="searchClose" class="reset-btn">Close</button></div>';
  root.appendChild(searchPanel);
  searchBtn.onclick = () => openSearch();
  $("searchClose").onclick = () => searchPanel.classList.add("hidden");
  function openSearch() {
    const room = B.currentRoom(); if (!room) return flash("Open a chat first.", "err");
    searchPanel.classList.remove("hidden"); const inp = $("searchInput"); inp.value = ""; $("searchResults").innerHTML = ""; setTimeout(() => inp.focus(), 50);
    inp.oninput = debounce(async () => {
      const q = inp.value.trim(); if (q.length < 2) { $("searchResults").innerHTML = ""; return; }
      try { const r = await api("/api/search?room=" + encodeURIComponent(room) + "&q=" + encodeURIComponent(q), {}, true);
        const res = $("searchResults"); res.innerHTML = "";
        (r.results || []).forEach((m) => { const row = ce("div", "search-row", (m.text || m.kind || "").slice(0, 160)); row.onclick = () => { const el = document.getElementById("messages").querySelector('[data-id="' + m.id + '"]'); if (el) el.scrollIntoView({ behavior: "smooth", block: "center" }); searchPanel.classList.add("hidden"); }; res.appendChild(row); });
        if (!r.results || !r.results.length) res.innerHTML = '<p class="sp-empty">No results.</p>';
      } catch {}
    }, 300);
  }
  function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

  // ============================================================ FORWARD MODAL
  const fwdPanel = ce("div", "modal hidden");
  fwdPanel.innerHTML = '<div class="modal-card"><h3>Forward message</h3><div id="fwdList" class="fwd-list"></div><button id="fwdClose" class="reset-btn">Cancel</button></div>';
  root.appendChild(fwdPanel);
  $("fwdClose").onclick = () => fwdPanel.classList.add("hidden");
  function openForward(id) {
    const list = $("fwdList"); list.innerHTML = "";
    const mk = (label, room) => { const b = ce("button", "fwd-item", label); b.onclick = () => { socket.emit("forward", { id, to: room }); fwdPanel.classList.add("hidden"); flash("Forwarded."); }; list.appendChild(b); };
    (B.state.friends || []).forEach((f) => mk("DM · " + f.displayName, "dm:" + [B.myUser(), f.username].sort().join("|")));
    (B.state.servers || []).forEach((s) => (s.channels || []).forEach((c) => mk("" + s.name + " #" + c.name, "chan:" + c.id)));
    fwdPanel.classList.remove("hidden");
  }

  // ============================================================ QUICK SWITCHER (Ctrl+K)
  const qsPanel = ce("div", "modal hidden");
  qsPanel.innerHTML = '<div class="modal-card qs-card"><input id="qsInput" placeholder="Jump to friend, server, channel or type /help" /><div id="qsList" class="qs-list"></div></div>';
  root.appendChild(qsPanel);
  function openQs() {
    qsPanel.classList.remove("hidden"); const inp = $("qsInput"); inp.value = ""; setTimeout(() => inp.focus(), 30); renderQs("");
    inp.oninput = () => renderQs(inp.value.toLowerCase());
  }
  function renderQs(q) {
    const list = $("qsList"); list.innerHTML = "";
    const add = (label, sub, fn) => { const row = ce("div", "qs-row", "<span class='qs-label'>" + label + "</span><span class='qs-sub'>" + sub + "</span>"); row.onclick = () => { fn(); qsPanel.classList.add("hidden"); }; list.appendChild(row); };
    if (!q) {
      (B.state.friends || []).forEach((f) => add(f.displayName, "@" + f.username, () => B.openDM(f.username)));
      (B.state.servers || []).forEach((s) => add(s.name, "Server", () => B.selectServer(s.id)));
    } else {
      const cmds = [["/poll", "Create a poll"], ["/gif", "Open GIF picker"], ["/tts", "Text to speech"], ["/nick", "Set server nickname"], ["/shrug", "¯\\_(ツ)_/¯"], ["/me", "Action message"]];
      cmds.filter((c) => c[0].includes(q)).forEach((c) => add(c[0], c[1], () => { qsPanel.classList.add("hidden"); B.setMsgInput(c[0] + " "); }));
      (B.state.friends || []).filter((f) => f.displayName.toLowerCase().includes(q) || f.username.includes(q)).forEach((f) => add(f.displayName, "@" + f.username, () => B.openDM(f.username)));
      (B.state.servers || []).forEach((s) => { if (s.name.toLowerCase().includes(q)) add(s.name, "Server", () => B.selectServer(s.id)); (s.channels || []).forEach((c) => { if (c.name.includes(q)) add("#" + c.name, s.name, () => { B.selectServer(s.id); setTimeout(() => B.openChannel(c.id), 60); }); }); });
    }
  }
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); qsPanel.classList.contains("hidden") ? openQs() : qsPanel.classList.add("hidden"); }
    if (e.key === "Escape" && !qsPanel.classList.contains("hidden")) qsPanel.classList.add("hidden");
  });

  // ============================================================ SERVER SETTINGS MODAL
  const srvPanel = ce("div", "modal hidden");
  srvPanel.innerHTML = '<div class="modal-card srv-card"><h3 id="srvTitle">Server settings</h3><div id="srvBody" class="srv-body"></div><button id="srvClose" class="reset-btn">Close</button></div>';
  root.appendChild(srvPanel);
  function openSrvSettings() {
    const id = B.activeServer(); if (!id) return flash("Open a server first.", "err");
    const s = (B.state.servers || []).find((x) => x.id === id); if (!s) return;
    $("srvTitle").textContent = s.name + " · Settings";
    const body = $("srvBody"); body.innerHTML = "";
    const me = s.members.find((m) => m.username === B.myUser());
    const isAdmin = s.owner === B.myUser() || (me && me.roles && me.roles.some((r) => (r.permissions || 0) & 1));
    body.appendChild(ce("div", "srv-sec", "<b>Notification mode</b>"));
    const seg = ce("div", "seg");
    [["all", "All"], ["mentions", "Mentions"], ["none", "Mute"]].forEach(([v, l]) => { const b = ce("button", "", l); b.onclick = () => { api("/api/servers/notif", { serverId: id, mode: v }, true).then(() => flash("Notifications: " + l)); }; seg.appendChild(b); });
    body.appendChild(seg);
    const ch = s.channels.find((c) => c.id === B.activeChannel());
    if (ch) { body.appendChild(ce("div", "srv-sec", "<b>Slow mode (" + (ch.slow || 0) + "s)</b>")); const si = ce("input"); si.type = "number"; si.value = ch.slow || 0; si.min = 0; si.max = 3600; si.style.cssText = "width:90px"; const sb = ce("button", "reset-btn", "Set"); sb.onclick = () => { if (isAdmin) api("/api/servers/slow", { serverId: id, channelId: ch.id, seconds: +si.value }, true).then((r) => r.ok ? flash("Slow mode set.") : flash(r.error || "No.", "err")); else flash("Need Manage Server.", "err"); }; body.append(si, sb); }
    if (isAdmin) {
      body.appendChild(ce("div", "srv-sec", "<b>Roles</b>"));
      (s.roles || []).forEach((r) => {
        const row = ce("div", "srv-row");
        row.innerHTML = "<span class='srv-dot' style='background:" + (r.color || "#99aab5") + "'></span><span>" + escape(B.escapeHtml(r.name)) + "</span><span class='srv-meta'>" + (r.members || []).length + " members</span>";
        const perms = ["manage", "kick", "ban", "mention", "invite", "pin"].filter((p) => (r.permissions || 0) & ({ manage: 1, kick: 2, ban: 4, mention: 8, invite: 16, pin: 32 }[p]));
        const addM = ce("button", "reset-btn", "+ member"); addM.onclick = () => openPrompt("Add member to " + r.name, "username", (u) => api("/api/servers/role", { serverId: id, action: "assign", roleId: r.id, target: u }, true).then((res) => res.ok ? flash("Added.") : flash(res.error || "No.", "err")));
        row.appendChild(addM); body.appendChild(row);
        if (perms.length) body.appendChild(ce("div", "srv-perm", perms.join(", ")));
      });
      const cr = ce("button", "reset-btn", "+ Create role"); cr.onclick = () => openPrompt("New role", "Role name", (nm) => api("/api/servers/role", { serverId: id, action: "create", name: nm, perms: ["mention", "invite"] }, true).then((r) => r.ok ? openSrvSettings() : flash(r.error || "No.", "err"))); body.appendChild(cr);
      body.appendChild(ce("div", "srv-sec", "<b>Custom emoji</b>"));
      const em = ce("div", "srv-emoji"); (s.emojis || []).forEach((e) => { const i = ce("span", "srv-em", ":" + e.name + ":"); em.appendChild(i); }); body.appendChild(em);
      const ei = ce("input"); ei.placeholder = "emoji name"; const ea = ce("button", "reset-btn", "Upload emoji"); ea.onclick = () => {
        if (!ei.value) return flash("Name required.");
        const name = ei.value;
        openPrompt("Upload emoji :" + name + ":", "paste /uploads/ URL", (url) => {
          if (!url.startsWith("/uploads/")) return flash("Upload an image first (attach button), then paste its /uploads URL.", "err");
          api("/api/servers/emoji", { serverId: id, action: "add", name: name, url: url }, true).then((r) => r.ok ? (flash("Emoji added."), openSrvSettings()) : flash(r.error || "No.", "err"));
        });
      }; body.append(ei, ea);
      body.appendChild(ce("div", "srv-sec", "<b>Bans (" + (s.bans || []).length + ")</b>"));
      (s.bans || []).forEach((u) => { const row = ce("div", "srv-row"); row.textContent = "@" + u; const ub = ce("button", "reset-btn", "Unban"); ub.onclick = () => api("/api/servers/unban", { serverId: id, target: u }, true).then(() => openSrvSettings()); row.appendChild(ub); body.appendChild(row); });
      body.appendChild(ce("div", "srv-sec", "<b>Invite</b>"));
      const ib = ce("button", "reset-btn", "Create invite link"); ib.onclick = () => api("/api/servers/invite-code", { serverId: id }, true).then((r) => r.ok ? (navigator.clipboard && navigator.clipboard.writeText(location.origin + "/invite/" + r.code), flash("Invite copied: " + r.code)) : flash(r.error || "No.", "err")); body.appendChild(ib);
      body.appendChild(ce("div", "srv-sec", "<b>Audit log</b>"));
      (s.audit || []).slice().reverse().slice(0, 20).forEach((a) => body.appendChild(ce("div", "srv-audit", new Date(a.ts).toLocaleString() + " · " + a.action + " · " + a.target)));
    }
    srvPanel.classList.remove("hidden");
  }
  $("srvClose").onclick = () => srvPanel.classList.add("hidden");
  const srvBtn = ce("button", "icon-btn", "⚙"); srvBtn.title = "Server settings"; srvBtn.id = "srvBtn";
  srvBtn.onclick = openSrvSettings;
  if (chatActions) chatActions.prepend(srvBtn);
  function escape(s) { return s; }

  // ============================================================ ROLE COLORS + NICKNAMES
  let serverExtras = { colors: {}, nicks: {} };
  function applyServerExtras() {
    const s = (B.state.servers || []).find((x) => x.id === B.activeServer());
    const colors = {}, nicks = {};
    if (s) { (s.roles || []).forEach((r) => { if (r.color) (r.members || []).forEach((m) => { if (!colors[m]) colors[m] = r.color; }); }); Object.assign(nicks, s.nicknames || {}); }
    serverExtras = { colors, nicks }; colorize();
  }
  function colorize() {
    document.querySelectorAll("#messages .msg").forEach((el) => {
      const u = el.dataset.user; if (!u) return;
      const a = el.querySelector(".author"); if (a && serverExtras.colors[u]) a.style.color = serverExtras.colors[u];
    });
    const s = (B.state.servers || []).find((x) => x.id === B.activeServer()); if (!s) return;
    const rows = document.querySelectorAll("#memberList .member");
    s.members.forEach((m, i) => { const row = rows[i]; if (!row) return; const nm = row.querySelector(".member-name"); if (nm) { const base = (B.profiles.get(m.username) || {}).displayName || m.username; nm.textContent = (m.username === B.myUser()) ? base + " (you)" : (serverExtras.nicks[m.username] || base); if (serverExtras.colors[m.username]) nm.style.color = serverExtras.colors[m.username]; } });
  }
  socket.on("servers", () => setTimeout(applyServerExtras, 0));
  socket.on("message", () => setTimeout(colorize, 0));
  socket.on("history", () => setTimeout(colorize, 0));

  // ============================================================ DESKTOP NOTIFICATIONS
  let notifOn = false;
  if ("Notification" in window && Notification.permission === "granted") notifOn = true;
  function notify(title, body) { if (notifOn && "Notification" in window) { try { new Notification(title, { body }); } catch {} } }
  socket.on("message", (m) => {
    if (m.user === B.myUser()) return;
    const ment = new RegExp("@(everyone|here|" + B.myUser() + ")\\b").test(m.text || "");
    const inRoom = B.currentRoom() && B.currentRoom() === currentRoomOf(m);
    if (document.hidden || !inRoom) {
      if (ment || window.BUDDY_NOTIF_ALL) notify((B.profiles.get(m.user) || {}).displayName || m.user, (m.text || "").slice(0, 120));
    }
  });
  function currentRoomOf(m) { return B.currentRoom(); }
  const notifBtn = ce("button", "reset-btn", "🔔 Enable notifications"); notifBtn.style.marginTop = "8px";
  notifBtn.onclick = async () => { if (!("Notification" in window)) return flash("Not supported."); const p = await Notification.requestPermission(); notifOn = p === "granted"; flash(p === "granted" ? "Notifications on." : "Notifications blocked."); notifBtn.style.display = "none"; };
  const blockedSec = document.querySelector(".set-section"); // append to first settings section as a simple hook
  const setChat = [...document.querySelectorAll(".set-section")].find((s) => s.querySelector("h3") && s.querySelector("h3").textContent === "Chat");
  if (setChat) setChat.appendChild(notifBtn);

  // ============================================================ CALL EXTRAS (timer, PiP, TURN status)
  const callExtra = ce("div", "call-extra hidden");
  callExtra.innerHTML = '<span id="callTimer">00:00</span><button id="callPip" class="round" title="Picture in picture">⧉</button>';
  const callBar = document.querySelector(".call-bar");
  if (callBar) callBar.prepend(callExtra);
  let callStart = 0, callTick = null;
  const co = new MutationObserver(() => {
    const c = B.call(); const vis = !$("callOverlay").classList.contains("hidden");
    callExtra.classList.toggle("hidden", !vis);
    if (vis && !callTick) { callStart = Date.now(); callTick = setInterval(() => { const s = Math.floor((Date.now() - callStart) / 1000); $("callTimer").textContent = String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0"); }, 1000); }
    if (!vis && callTick) { clearInterval(callTick); callTick = null; }
  });
  co.observe($("callOverlay"), { attributes: true, attributeFilter: ["class"] });
  $("callPip").onclick = () => { const rv = $("remoteVideo"); if (rv && rv.requestPictureInPicture) rv.requestPictureInPicture().catch(() => {}); };

  // ============================================================ SOUNDBOARD
  const sbPanel = ce("div", "soundboard hidden");
  const SOUNDS = [["Ding", 880], ["Coin", 1320], ["Level up", 660], ["Airhorn", 220], ["Tada", 1046], ["Blip", 520]];
  SOUNDS.forEach(([n, f]) => { const b = ce("button", "sb-btn", n); b.onclick = () => playTone(f); sbPanel.appendChild(b); });
  const sbToggle = ce("button", "icon-btn", "🎵"); sbToggle.title = "Soundboard"; sbToggle.onclick = () => sbPanel.classList.toggle("hidden");
  if (chatActions) chatActions.prepend(sbToggle);
  root.appendChild(sbPanel);
  function playTone(freq) { try { const ac = new (window.AudioContext || window.webkitAudioContext)(); const o = ac.createOscillator(), g = ac.createGain(); o.connect(g); g.connect(ac.destination); o.frequency.value = freq; g.gain.value = 0.08; o.start(); o.stop(ac.currentTime + 0.25); } catch {} }

  // ============================================================ SHORTCUTS HELP
  const kbPanel = ce("div", "modal hidden");
  kbPanel.innerHTML = '<div class="modal-card"><h3>Keyboard shortcuts</h3><div class="kb-list">' +
    "<div><kbd>Ctrl</kbd>+<kbd>K</kbd> Quick switcher</div><div><kbd>Enter</kbd> Send</div><div><kbd>Shift</kbd>+<kbd>Enter</kbd> New line</div>" +
    "<div><kbd>@</kbd> Mention</div><div><kbd>/</kbd> Slash commands</div><div><kbd>:</kbd> Emoji (auto)</div><div><kbd>Esc</kbd> Close menus</div>" +
    "<div><kbd>Space</kbd> (hold in call) Push to talk</div></div><button id=\"kbClose\" class=\"reset-btn\">Close</button></div>";
  root.appendChild(kbPanel);
  $("kbClose").onclick = () => kbPanel.classList.add("hidden");
  document.addEventListener("keydown", (e) => { if ((e.ctrlKey || e.metaKey) && e.key === "/") { e.preventDefault(); kbPanel.classList.toggle("hidden"); } });

  // ============================================================ AFK AUTO-IDLE
  let afkTimer = null;
  function resetAfk() { clearTimeout(afkTimer); afkTimer = setTimeout(() => { api("/api/presence", { presence: "idle" }, true).catch(() => {}); }, 5 * 60 * 1000); }
  ["mousemove", "keydown", "click", "scroll"].forEach((ev) => document.addEventListener(ev, resetAfk, { passive: true }));
  resetAfk();

  // ============================================================ INVITE LINK ROUTING
  if (location.pathname.startsWith("/invite/")) {
    const code = location.pathname.split("/").pop();
    if (code) { api("/api/invite/join", { code }, true).then((r) => { if (r.ok) flash("Joined " + (r.server ? r.server.name : "server") + "!"); else flash(r.error || "Invalid invite.", "err"); history.replaceState({}, "", "/"); }); }
  }

  // ============================================================ PROFILE POPUP EXTENSIONS (pronouns, banner, note, favorite, friend nick)
  const _openProfile = window.__openProfile;
  socket.on("servers", () => {}); // extras applied via observer below
  const pmObserver = new MutationObserver(() => { /* placeholder for future */ });
  function extendProfile(p) {
    const banner = $("pmBanner"); if (banner) { banner.style.background = p.banner ? (p.banner.startsWith("#") ? p.banner : "center/cover no-repeat url(" + p.banner + ")") : "var(--bg-2)"; }
    const sub = $("pmPresence");
    if (p.pronouns) { let pr = document.getElementById("pmPronouns"); if (!pr) { pr = ce("div", "pm-pronouns"); sub.parentNode.insertBefore(pr, sub); } pr.textContent = p.pronouns; }
    if (B.myUser() !== p.username) {
      let box = document.getElementById("pmFriendExtra");
      if (!box) { box = ce("div", "pm-extra"); $("profileModal").querySelector(".profile-actions").before(box); box.id = "pmFriendExtra"; }
      box.innerHTML = "";
      const u = B.profiles.get(p.username) || {};
      const fav = (B.state.friends || []).some((f) => f.username === p.username);
      const favBtn = ce("button", "reset-btn", fav ? "★ Favorited" : "☆ Favorite"); favBtn.onclick = () => api("/api/friends/favorite", { target: p.username, on: !fav }, true).then(() => { flash("Updated."); extendProfile(p); });
      const noteBtn = ce("button", "reset-btn", "📝 Note"); noteBtn.onclick = () => openPrompt("Private note", "Note", (n) => api("/api/friends/note", { target: p.username, note: n }, true).then(() => flash("Note saved.")));
      const nickBtn = ce("button", "reset-btn", "Nickname"); nickBtn.onclick = () => openPrompt("Friend nickname", "Nickname", (n) => api("/api/friends/nick", { target: p.username, nick: n }, true).then(() => flash("Nickname saved.")));
      box.append(favBtn, noteBtn, nickBtn);
    }
  }
  // hook into profile open by observing class changes is hard; instead wrap after load
  const origOpen = B.openDM; // unused, just to keep reference
  function patchProfileOpen() {
    const modal = $("profileModal"); if (!modal) return;
    const mo = new MutationObserver(() => {
      if (!modal.classList.contains("hidden")) { const p = B.profiles.get(window.__pmTarget || ""); }
    });
  }
  // Re-apply on every servers/friends sync by polling the modal when visible
  setInterval(() => {
    const modal = $("profileModal"); if (modal && !modal.classList.contains("hidden")) { const u = window.__pmTarget; if (u) { const p = B.profiles.get(u); if (p) extendProfile(p); } }
  }, 1000);

  // ============================================================ SETTINGS: GIF AUTOPLAY + VOICE
  const setVoice = [...document.querySelectorAll(".set-section")].find((s) => s.querySelector("h3") && s.querySelector("h3").textContent === "Devices");
  if (setVoice) {
    setVoice.appendChild(ce("div", "srv-sec", "<b>Voice processing</b>"));
    [["echo", "Echo cancellation"], ["noise", "Noise suppression"], ["agc", "Automatic gain"], ["ptt", "Push to talk"]].forEach(([k, l]) => {
      const row = ce("label", "switch-row"); row.innerHTML = "<span>" + l + "</span><span class='switch'><input type='checkbox' id='vc_" + k + "'><span class='slider-sw'></span></span>";
      setVoice.appendChild(row);
      row.querySelector("input").onchange = (e) => { const v = {}; ["echo", "noise", "agc", "ptt"].forEach((x) => { v[x] = $("vc_" + x).checked; }); api("/api/me/voice", v, true).then(() => flash("Voice settings saved.")); };
    });
    const gifToggle = ce("label", "switch-row"); gifToggle.innerHTML = "<span>GIF autoplay</span><span class='switch'><input type='checkbox' id='gifAuto' checked><span class='slider-sw'></span></span>";
    setVoice.appendChild(gifToggle);
  }

  if ($("app") && !$("app").classList.contains("hidden")) flash("Discord features loaded: emoji, reactions, pins, polls, slash commands, search, roles, mentions, bookmarks & more.");
})();
