// A tiny local HUD so the user can see Manoo working without staring at
// the exact pixel the cursor is on. A small always-on-top window (opened
// separately, see index.mjs) shows a neon mini-map dot that tracks the
// real cursor position, plus a ticker for what's being typed — pushed
// here over Server-Sent Events so no extra npm dependency (like `ws`) is
// needed on top of Node's built-in `http`.
import { createServer } from "node:http";

export const OVERLAY_WINDOW_TITLE = "Manoo · overlay";

const PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><title>${OVERLAY_WINDOW_TITLE}</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 10px; background: #05060a; color: #d8e8ff;
    font: 13px/1.3 -apple-system, "Segoe UI", sans-serif;
    overflow: hidden; user-select: none;
  }
  #hdr {
    display: flex; align-items: center; gap: 6px; margin-bottom: 8px;
    font-weight: 600; letter-spacing: 0.03em;
  }
  #dot {
    width: 8px; height: 8px; border-radius: 50%;
    background: #4dd8ff; box-shadow: 0 0 6px 2px #4dd8ff;
    animation: pulse 1.6s ease-in-out infinite;
  }
  @keyframes pulse {
    0%, 100% { opacity: 0.5; transform: scale(0.85); }
    50% { opacity: 1; transform: scale(1.15); }
  }
  #map {
    display: block; border-radius: 6px; background: #0b0e16;
    border: 1px solid #1c2333;
  }
  #cursor {
    position: absolute; width: 10px; height: 10px; border-radius: 50%;
    background: radial-gradient(circle, #baf1ff 0%, #4dd8ff 55%, transparent 75%);
    box-shadow: 0 0 12px 4px #4dd8ffaa;
    transform: translate(-50%, -50%);
    transition: left 0.08s linear, top 0.08s linear;
    pointer-events: none;
  }
  #mapWrap { position: relative; }
  #ticker {
    margin-top: 8px; min-height: 18px; font-size: 12px;
    color: #4dd8ff; text-shadow: 0 0 6px #4dd8ff99;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    opacity: 0; transition: opacity 0.15s ease;
  }
  #ticker.show { opacity: 1; }
</style></head>
<body>
  <div id="hdr"><span id="dot"></span>Manoo</div>
  <div id="mapWrap">
    <canvas id="map" width="220" height="130"></canvas>
    <div id="cursor" style="left:0px; top:0px;"></div>
  </div>
  <div id="ticker"></div>
<script>
  const mapEl = document.getElementById('map');
  const cursorEl = document.getElementById('cursor');
  const tickerEl = document.getElementById('ticker');
  const ctx = mapEl.getContext('2d');
  let fadeTimer = null;

  function drawGrid() {
    ctx.clearRect(0, 0, mapEl.width, mapEl.height);
    ctx.strokeStyle = '#161c2b';
    ctx.lineWidth = 1;
    for (let x = 0; x <= mapEl.width; x += 20) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, mapEl.height); ctx.stroke();
    }
    for (let y = 0; y <= mapEl.height; y += 20) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(mapEl.width, y); ctx.stroke();
    }
  }
  drawGrid();

  function placeCursor(x, y, screenW, screenH) {
    const px = (x / screenW) * mapEl.width;
    const py = (y / screenH) * mapEl.height;
    cursorEl.style.left = px + 'px';
    cursorEl.style.top = py + 'px';
  }

  function flashTicker(text) {
    tickerEl.textContent = text;
    tickerEl.classList.add('show');
    clearTimeout(fadeTimer);
    fadeTimer = setTimeout(() => tickerEl.classList.remove('show'), 1500);
  }

  const es = new EventSource('/events');
  es.onmessage = (ev) => {
    const data = JSON.parse(ev.data);
    if (data.kind === 'mouse') {
      placeCursor(data.x, data.y, data.screenW, data.screenH);
    } else if (data.kind === 'type') {
      flashTicker('⌨ ' + data.text);
    } else if (data.kind === 'key') {
      flashTicker('⌨ ' + data.text);
    } else if (data.kind === 'scroll') {
      flashTicker('⟳ scroll ' + data.text);
    }
  };
</script>
</body></html>`;

/** Starts the local HUD server and returns a handle to push events to it
 * and shut it down. Binds to 127.0.0.1 only — this never needs to be
 * reachable from outside the machine. */
export function startOverlayServer() {
  const clients = new Set();

  const server = createServer((req, res) => {
    if (req.url === "/events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.write("\n");
      clients.add(res);
      req.on("close", () => clients.delete(res));
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(PAGE);
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}/`,
        push(event) {
          const line = `data: ${JSON.stringify(event)}\n\n`;
          for (const res of clients) res.write(line);
        },
        close() {
          for (const res of clients) res.end();
          server.close();
        },
      });
    });
  });
}
