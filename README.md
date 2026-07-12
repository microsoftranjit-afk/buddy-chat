# Buddy Chat

A lightweight, self-hostable real-time chat app with **text messaging** and **voice/video calls** — like a mini Discord/Telegram for you and a friend.

- 💬 Real-time text chat (rooms)
- 📞 1:1 voice + video calls (WebRTC, peer-to-peer)
- 🌐 Works across the internet
- 📦 Zero build step — plain Node.js + HTML/JS

## Make it yours — deep customization

Open **Settings → appearance** to reshape the whole app:

- **13 built-in themes** — Midnight, Obsidian (AMOLED), Discord, Nord, Dracula,
  Mocha, Tokyo Night, Ocean, Forest, Rosé Pine, Light, Latte, Cotton. Pick from a
  live theme gallery.
- **Accent color** — 14 presets, a custom color picker, optional gradient
  messages with your own gradient end color.
- **Fonts** — System, Inter, Rounded, Serif or Mono, plus a text-size slider.
- **Layout & density** — Bubble or Classic (flat) message layout; Roomy / Cozy /
  Compact spacing; adjustable corner roundness.
- **Chat backgrounds** — 9 generated patterns (Dots, Grid, Aurora, Mesh, Glow…)
  or any image URL.
- **Effects** — toggle animations/motion and glass blur on panels.
- **Advanced** — a custom-CSS box for power users to restyle anything.

All preferences are saved per device and applied instantly.

## Quick start (local)

```bash
cd chat-app
npm install
npm start          # web server on http://localhost:3000
npm run electron   # (optional) launch the desktop app
```

Open http://localhost:3000 (or the desktop app). Pick a display name and a room
name. Tell your friend the **same room name** and have them join. Done.

> Camera/mic require a secure context. On `localhost` it works. Over a LAN IP or
> the internet you must use **HTTPS** (see deployment) or browsers block the camera.

## Desktop app (Electron)

The desktop app connects to your **shared server** by default (the Render URL in
`config.json` → `serverUrl`, or the `ELECTRON_SERVER_URL` env var, falling back to
`https://buddy-chat-bd6c.onrender.com`). That means desktop and web users share
the same accounts, servers, and messages.

- Run in dev: `npm run electron` (needs `npm install` first).
- To build a Windows installer: `npm run dist` (produces `dist/Buddy Setup.exe`).
  Requires `electron-builder` (already a dev dependency).
- To point the desktop app at a specific server: set `ELECTRON_SERVER_URL` before
  launching, or edit `serverUrl` in `config.json` (not committed).
- Optional offline/self-contained mode: set `BUDDY_LOCAL=1` to run the bundled
  server inside the app (data stored under the app's user-data folder).

## Desktop app (Tauri, tiny installer)

For a small (~5–10 MB) Windows installer, the app is also packaged with
**[Tauri](https://tauri.app)**, which uses the OS WebView2 instead of bundling
Chromium. The Tauri window simply loads your shared server URL (same resolution
rules as above), so it stays a thin client.

Prerequisites (one-time): install [Rust](https://rustup.rs), the **VS Build
Tools** (MSVC `Desktop development with C++` workload), and the **WebView2
SDK**. Then:

```
npm install
npm run tauri:build
```

Output: `src-tauri/target/release/bundle/nsis/Buddy_1.1.0_x64-setup.exe`.
Run in dev with `npm run tauri:dev`. The backend URL can be overridden with the
`ELECTRON_SERVER_URL` env var.

## How the login works (no "stuck" screen)

The join screen is fully client-side. The socket.io client is **vendored**
(`public/vendor/socket.io.min.js`) so it never depends on the server being warm
— this fixes the old bug where a cold Render instance returned 404 for the
library and the join button silently did nothing. Press **Enter** in either
field or click **Start chatting**; errors show inline.


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
TURN is **already wired up** — the server fetches short-lived Metered.ca
credentials at call time and the client refreshes them before every call
(`/api/turn` + `/api/config`), so 1:1 and group calls traverse restrictive
NATs via the TURN relay automatically.

To enable it, provide your Metered API key (the call already works on the
bundled `buddy-chat` Metered account). Set it in **one** of these ways:

- `config.json` → `"meteredKey": "YOUR_KEY"` and optionally `"meteredSubdomain": "buddy-chat"`
- environment variable `METERED_API_KEY=YOUR_KEY` (e.g. on Render)

The live call overlay shows **Direct · P2P** vs **Relay · TURN** so you can see
which path a call is taking. No client-side config edits are required.

Free TURN credentials: [metered.ca](https://metered.ca) (free tier).

## Desktop app download on the website

The web app shows a prominent **Download Buddy for Windows** button (on the login
screen and in Settings). It hits `GET /download`, which:

- redirects to `DOWNLOAD_URL` if that env var is set (point it at a GitHub
  Release asset so the installer works on Render), or
- serves a locally built installer from `dist/` or `public/download/`.

The installer is built and published automatically by GitHub Actions
(`.github/workflows/release.yml`): on every push to `main` it builds the Windows
installer on a Windows runner and uploads it to the **`desktop-latest`** release
as `Buddy-Setup.exe`. `render.yaml` sets `DOWNLOAD_URL` to that stable asset URL.

To avoid GitHub throttling large anonymous release downloads (the download
stalls partway through), set a **`GH_TOKEN`** environment variable on Render
(dashboard → Environment) to a GitHub token with `public_repo` / read access.
The server then proxies the file with an authenticated request so it streams at
full speed. Without `GH_TOKEN` it just redirects (and may be throttled). You can
also drop the `.exe` into `public/download/` and commit it to serve it directly
from the app (no GitHub dependency). To rebuild manually, run the workflow from
the Actions tab.

## Notes
- Chat history is kept in memory on the server (last 500 messages per room).

## Notes
- Chat history is kept in memory on the server (last 500 messages per room).
  Restarting the server clears it. It's not end-to-end encrypted — fine for
  personal use, not for secrets.
- One room = one conversation. Anyone who knows the room name can join, so use
  an unguessable name.
