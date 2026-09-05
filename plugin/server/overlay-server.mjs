// A tiny local HUD so the user can see Manoo working, plus a ticker for
// what's being typed — pushed here over Server-Sent Events so no extra
// npm dependency (like `ws`) is needed on top of Node's built-in `http`.
//
// The cursor itself doesn't need tracking here anymore: a real user
// reported that a detached corner window with a proxy dot wasn't what
// "neon cursor glow" should mean, and they were right — the actual
// system cursor is now swapped for a neon-glow one instead (see
// cursor-theme.mjs). This HUD is just "Manoo is here" plus the ticker.
import { createServer } from "node:http";

export const OVERLAY_WINDOW_TITLE = "Manoo · overlay";

const PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><title>${OVERLAY_WINDOW_TITLE}</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 12px; background: #05060a; color: #d8e8ff;
    font: 14px/1.3 -apple-system, "Segoe UI", sans-serif;
    overflow: hidden; user-select: none;
    border: 2px solid #1c2333;
    border-radius: 10px;
    transition: border-color 0.15s ease, box-shadow 0.15s ease;
  }
  body.active {
    border-color: #4dd8ff;
    box-shadow: 0 0 18px 2px #4dd8ff66, inset 0 0 18px 0 #4dd8ff22;
  }
  #hdr {
    display: flex; align-items: center; gap: 8px;
    font-weight: 700; font-size: 15px; letter-spacing: 0.03em;
    color: #baf1ff; text-shadow: 0 0 8px #4dd8ff99;
  }
  #dot {
    width: 12px; height: 12px; border-radius: 50%;
    background: #4dd8ff;
    box-shadow: 0 0 8px 3px #4dd8ff, 0 0 18px 8px #4dd8ff66;
    animation: pulse 1.6s ease-in-out infinite;
  }
  @keyframes pulse {
    0%, 100% { opacity: 0.6; transform: scale(0.85); }
    50% { opacity: 1; transform: scale(1.25); }
  }
  #ticker {
    margin-top: 10px; min-height: 24px; font-size: 17px; font-weight: 700;
    color: #baf1ff; text-shadow: 0 0 8px #4dd8ffcc, 0 0 18px #4dd8ff88;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    opacity: 0; transform: scale(0.94);
    transition: opacity 0.12s ease, transform 0.12s ease;
  }
  #ticker.show { opacity: 1; transform: scale(1); }
</style></head>
<body>
  <div id="hdr"><span id="dot"></span>Manoo</div>
  <div id="ticker"></div>
<script>
  const tickerEl = document.getElementById('ticker');
  let fadeTimer = null;

  let activeTimer = null;
  function flashActive() {
    document.body.classList.add('active');
    clearTimeout(activeTimer);
    activeTimer = setTimeout(() => document.body.classList.remove('active'), 400);
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
    flashActive();
    if (data.kind === 'type' || data.kind === 'key') {
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
