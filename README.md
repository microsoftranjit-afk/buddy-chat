# Buddy Chat

A lightweight, self-hostable real-time chat app with **text messaging** and **voice/video calls** — like a mini Discord/Telegram for you and a friend.

- 💬 Real-time text chat (rooms)
- 📞 1:1 voice + video calls (WebRTC, peer-to-peer)
- 🌐 Works across the internet
- 📦 Zero build step — plain Node.js + HTML/JS

## Quick start (local)

```bash
cd chat-app
npm install
npm start
```

Open http://localhost:3000 in your browser. Pick a display name and a room name.
Tell your friend the **same room name** and have them join. Done.

> Camera/mic require a secure context. On `localhost` it works. Over a LAN IP or
> the internet you must use **HTTPS** (see deployment) or browsers block the camera.

## Running it for a friend 100km away

For two people on different networks, the server must be reachable over the
internet. Two easy options:

### Option A — Free host (easiest)
1. Put this folder in a GitHub repo.
2. Deploy to [Render](https://render.com) (Web Service, `node server.js`) or
   [Railway](https://railway.app). They give you a public `https://...` URL.
3. Both of you open that URL, join the same room. HTTPS is provided
   automatically, so camera/mic work.

### Option B — Your own PC
1. Run `npm start`.
2. Forward port `3000` on your router to your PC.
3. Give your friend your public IP: `http://<your-public-ip>:3000`.
   For camera/mic you'll need HTTPS (use a tunnel like
   [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflared/) or
   [ngrok](https://ngrok.com)).

## Calls behind strict NATs (TURN)

WebRTC uses STUN to discover your address. It works for most home connections,
but **symmetric NATs** (some mobile/corporate networks) need a TURN relay.
To add one, edit the `STUN` config at the top of `public/client.js`:

```js
const STUN = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "turn:YOUR_TURN_HOST:3478", username: "user", credential: "pass" },
  ],
};
```

Free TURN credentials: [metered.ca](https://metered.ca) (free tier) or
[openrelay](https://www.metered.ca/tools/openrelay).

## Notes
- Chat history is kept in memory on the server (last 500 messages per room).
  Restarting the server clears it. It's not end-to-end encrypted — fine for
  personal use, not for secrets.
- One room = one conversation. Anyone who knows the room name can join, so use
  an unguessable name.
