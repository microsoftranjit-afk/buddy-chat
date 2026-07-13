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

## What's new (v1.6.0)

- **Beautiful new login/signup** — split hero with floating gradient orbs, glass
  card, inline icons and a show/hide password toggle.
- **Read receipts** — your sent messages show *Sent → Read* once the other
  person has seen them.
- **Edit messages in place** — hover a message, hit Edit, change the text
  (shows an "(edited)" tag). Delete is one click too.
- **Animated chat backgrounds** — Aurora Flow, Drift and Waves (respect the
  animations toggle). Plus 4 new static patterns (Graph, Polka, Carbon, finer
  Diagonal) — all theme-aware.
- **Liquid glass mode** — a frosted, refractive glass look for every panel,
  toggle in Settings → Effects.
- **Link previews** — pasted URLs render as a neat embed card.
- **Reaction hover** — hover a reaction chip to see exactly who reacted.
- **Voice lobby** — start an always-on group voice room from any chat (mesh
  WebRTC). Mic/camera/leave controls, live participant tiles.
- **Installable PWA** — add Buddy to your home screen; works offline.

## Notes
- Chat history is kept in memory on the server (last 500 messages per room).

## Notes
- Chat history is kept in memory on the server (last 500 messages per room).
  Restarting the server clears it. It's not end-to-end encrypted — fine for
  personal use, not for secrets.
- One room = one conversation. Anyone who knows the room name can join, so use
  an unguessable name.

## Calling over distance — free, no paid TURN

Buddy is peer-to-peer (WebRTC). Across town or across a country (100km+),
calls usually connect directly using free public **STUN** servers. When both
peers are behind restrictive/symmetric NATs, a **TURN relay** is required to
punch through. The app can use a hosted TURN (Metered.ca, paid) — but you
don't have to pay:

- **Self-host a free TURN server** (e.g. [coturn](https://github.com/coturn/coturn)
  on any cheap VPS) and point Buddy at it. Add to `config.json`:
  ```json
  "turn": "turn:your.server.com:3478",
  "turnUser": "buddy",
  "turnPass": "secret"
  ```
  or set the env vars `TURN_URL`, `TURN_USER`, `TURN_PASS` (comma-separate
  multiple URLs). Remove `meteredKey` from `config.json` to stop using the
  paid relay entirely.
- **Screen sharing** works in any 1:1 call: open the call overlay and press
  the screen icon. It swaps your camera for the screen (or adds a video track
  and renegotiates automatically if the call started audio-only).

Note: a TURN relay carries the media, so the server must be publicly reachable
and have enough bandwidth for the call.
