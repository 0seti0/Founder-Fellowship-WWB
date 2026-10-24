# Unfold Stage 2 demo video

`unfold-stage2-demo.mp4` is a ~55-second, no-input walkthrough of the real Unfold web app. A
script drives the UI in a headless browser: fixed prompt, initial directions, inspector, pin,
GROUND, LEAP, the expanded graph, and a reload that shows everything persisted.

> **Mock data only.** The video runs the server with `MODEL_MODE=mock` and the deterministic mock
> provider. No API key is used and no live model is called. It shows the product's workflow and
> persisted graph behavior, not the quality of live-model output.

## How it is recorded

[`record-demo.mjs`](./record-demo.mjs):

1. Recreates a dedicated `unfold_demo` MySQL database and applies migrations.
2. Starts the server (`MODEL_MODE=mock`, port 3001) and the Vite web app (port 5173).
3. Drives the UI with Playwright in headless Chromium (1440×750 viewport at 4/3 device scale),
   using only real clicks, typing, and scrolling. Graph state is never injected.
4. Captures the page through the Chrome DevTools screencast. Only the page content is captured,
   with no browser chrome or terminal.
5. Checks the reloaded graph: one pinned direction, GROUND and LEAP children present, the
   `Mock model` badge visible. It also checks for browser console or page errors and fails on
   any.
6. Encodes a 1920×1080 H.264 MP4 with ffmpeg and adds a caption strip below the app.

## Regenerating

Prerequisites: everything from the root [AGENTS.md](../AGENTS.md) setup, Playwright Chromium
installed, and `ffmpeg` with `libx264` and `drawtext` (DejaVu Sans font) on `PATH`. Ports 3001 and
5173 must be free.

```sh
source ~/.nvm/nvm.sh
pnpm install
pnpm db:up
node demo/record-demo.mjs
```

The script overwrites `demo/unfold-stage2-demo.mp4`. Set `DEMO_OUTPUT=path/to/file.mp4` to write
elsewhere. If UI labels or mock fixtures change, update the locators and captions in the script.
