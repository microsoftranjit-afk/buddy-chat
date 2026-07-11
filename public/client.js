(() => {
  const socket = io();
  let myName = "";
  let myRoom = "";
  let myId = null;
  let localStream = null;
  let peer = null;
  let inCall = false;

  const STUN = {
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
    ],
  };

  // DOM
  const $ = (id) => document.getElementById(id);
  const joinScreen = $("join");
  const app = $("app");
  const messagesEl = $("messages");
  const msgInput = $("msgInput");
  const membersLabel = $("membersLabel");

  // ---- Join ----
  $("joinBtn").addEventListener("click", () => {
    const name = $("nameInput").value.trim();
    const room = $("roomInput").value.trim();
    if (!name || !room) return alert("Enter a name and a room.");
    myName = name;
    myRoom = room;
    $("roomLabel").textContent = "#" + room;
    joinScreen.classList.add("hidden");
    app.classList.remove("hidden");
    socket.emit("join", { room, user: name });
    msgInput.focus();
  });

  // ---- Messaging ----
  function appendMessage({ user, text, ts, mine, system }) {
    const el = document.createElement("div");
    if (system) {
      el.className = "msg system";
      el.textContent = text;
    } else {
      el.className = "msg" + (mine ? " mine" : "");
      const author = document.createElement("div");
      author.className = "author";
      author.textContent = user;
      const body = document.createElement("div");
      body.className = "body";
      body.textContent = text;
      const time = document.createElement("div");
      time.className = "time";
      time.textContent = new Date(ts || Date.now()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      el.append(author, body, time);
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

  socket.on("history", (msgs) => msgs.forEach((m) => appendMessage({ ...m, mine: m.user === myName })));
  socket.on("message", (m) => appendMessage({ ...m, mine: m.user === myName }));
  socket.on("system", (t) => appendMessage({ system: true, text: t }));
  socket.on("members", (n) => { membersLabel.textContent = "• " + n + " online"; });

  $("leaveBtn").addEventListener("click", () => location.reload());

  // ---- Calls (WebRTC) ----
  const callOverlay = $("callOverlay");
  const localVideo = $("localVideo");
  const remoteVideo = $("remoteVideo");
  const callStatus = $("callStatus");

  function setupPeer(initiator) {
    peer = new RTCPeerConnection(STUN);
    peer.onicecandidate = (e) => {
      if (e.candidate) socket.emit("call:ice", e.candidate);
    };
    peer.ontrack = (e) => {
      remoteVideo.srcObject = e.streams[0];
    };
    if (localStream) localStream.getTracks().forEach((t) => peer.addTrack(t, localStream));

    if (initiator) {
      peer.onnegotiationneeded = async () => {
        const offer = await peer.createOffer();
        await peer.setLocalDescription(offer);
        socket.emit("call:offer", offer);
      };
    }
  }

  async function startCall(asInitiator) {
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      localVideo.srcObject = localStream;
    } catch (err) {
      // fall back to audio only
      try {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        localVideo.srcObject = localStream;
      } catch (e2) {
        alert("Could not access camera/microphone: " + e2.message);
        return;
      }
    }
    inCall = true;
    callOverlay.classList.remove("hidden");
    $("callBtn").classList.add("hidden");
    $("hangupBtn").classList.remove("hidden");
    setupPeer(asInitiator);
  }

  function endCall() {
    if (peer) { peer.close(); peer = null; }
    if (localStream) { localStream.getTracks().forEach((t) => t.stop()); localStream = null; }
    remoteVideo.srcObject = null;
    localVideo.srcObject = null;
    inCall = false;
    callOverlay.classList.add("hidden");
    $("callBtn").classList.remove("hidden");
    $("hangupBtn").classList.add("hidden");
    socket.emit("call:end");
  }

  // Caller: ring the room, then become the offer initiator.
  $("callBtn").addEventListener("click", async () => {
    if (inCall) return;
    callStatus.textContent = "Ringing… waiting for friend to pick up";
    socket.emit("call:ring");
    await startCall(true);
  });

  // Callee: incoming ring -> ask to accept -> wait for offer.
  socket.on("call:ring", async ({ fromName }) => {
    if (inCall) return;
    callStatus.textContent = fromName + " is calling…";
    const accept = confirm(fromName + " is calling you. Accept?");
    if (!accept) return;
    await startCall(false);
  });

  socket.on("call:offer", async ({ from, offer }) => {
    if (!inCall) await startCall(false);
    callStatus.textContent = "Connected";
    if (!peer) setupPeer(false);
    try {
      await peer.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      socket.emit("call:answer", answer);
    } catch (e) { console.error(e); }
  });

  socket.on("call:answer", async ({ answer }) => {
    callStatus.textContent = "Connected";
    if (!peer) return;
    try { await peer.setRemoteDescription(new RTCSessionDescription(answer)); } catch (e) {}
  });

  socket.on("call:ice", async ({ candidate }) => {
    if (peer && candidate) {
      try { await peer.addIceCandidate(new RTCIceCandidate(candidate)); } catch (e) {}
    }
  });

  socket.on("call:end", () => {
    if (inCall) { callStatus.textContent = "Call ended"; endCall(); }
  });

  $("hangupBtn").addEventListener("click", endCall);
  $("endCall").addEventListener("click", endCall);

  $("toggleAudio").addEventListener("click", () => {
    if (!localStream) return;
    const t = localStream.getAudioTracks()[0];
    if (t) { t.enabled = !t.enabled; $("toggleAudio").textContent = t.enabled ? "🎤" : "🔇"; }
  });
  $("toggleVideo").addEventListener("click", () => {
    if (!localStream) return;
    const t = localStream.getVideoTracks()[0];
    if (t) { t.enabled = !t.enabled; $("toggleVideo").textContent = t.enabled ? "📷" : "🚫"; }
  });
})();
