// Memeriksa perilaku tombol pasang + service worker pada origin aman dan tidak aman.
// Pakai: node tools/install-guard-check.mjs <url> [...]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9333;
const urls = process.argv.slice(2);
if (!urls.length) {
  console.error('berikan minimal satu URL');
  process.exit(1);
}

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'bj40-guard-'));
const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-gpu',
  '--use-gl=swiftshader',
  '--enable-unsafe-swiftshader',
  'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function endpoint() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (res.ok) return (await res.json()).webSocketDebuggerUrl;
    } catch {}
    await sleep(250);
  }
  throw new Error('Chrome tidak siap');
}

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
      }
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.addEventListener('open', () => resolve(new CDP(ws)));
    ws.addEventListener('error', reject);
  });
}

const probe = `(() => {
  const btn = document.getElementById('installBtn');
  const hint = document.getElementById('installHint');
  const originEl = document.getElementById('installOrigin');
  const start = document.getElementById('start');
  const vis = (el) => {
    if (!el) return 'missing';
    if (el.hidden) return 'hidden';
    const cs = getComputedStyle(el);
    if (cs.display === 'none') return 'css-display-none';
    if (cs.visibility === 'hidden') return 'css-visibility-hidden';
    if (Number(cs.opacity) === 0) return 'css-opacity-0';
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return 'zero-size';
    return 'visible';
  };
  const rect = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height) };
  };
  return {
    isSecureContext: window.isSecureContext,
    hasSW: 'serviceWorker' in navigator,
    menuReady: !!start && !start.classList.contains('hidden'),
    btn: vis(btn),
    hint: vis(hint),
    hintRect: rect(hint),
    hintWarn: hint ? hint.hasAttribute('data-warn') : null,
    hintText: hint ? hint.textContent.replace(/\\s+/g, ' ').trim().slice(0, 260) : null,
    originShown: originEl ? originEl.textContent : null,
    game: !!window.__game,
    menu: !!document.getElementById('start'),
    overflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
    vw: window.innerWidth,
  };
})()`;

(async () => {
  const wsUrl = await endpoint();
  const root = await connect(wsUrl);

  for (const url of urls) {
    const { targetId } = await root.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await root.send('Target.attachToTarget', { targetId, flatten: true });
    const s = (m, p) => root.send(m, p, sessionId);

    await s('Page.enable');
    await s('Runtime.enable');
    await s('Page.navigate', { url });

    let result = null;
    for (let i = 0; i < 100; i++) {
      await sleep(300);
      try {
        const r = await s('Runtime.evaluate', { expression: probe, returnByValue: true });
        const v = r.result?.value;
        if (v && v.menu && v.menuReady) {
          // Overlay menu punya transisi opacity/visibility 0.5s; tunggu selesai
          // supaya probe tidak menangkap keadaan setengah jalan.
          await sleep(900);
          const settled = await s('Runtime.evaluate', { expression: probe, returnByValue: true });
          result = settled.result?.value || v;
          break;
        }
      } catch {}
    }

    // Tunggu SW selesai mendaftar bila origin aman.
    if (result && result.isSecureContext) {
      for (let i = 0; i < 40; i++) {
        try {
          const r = await s('Runtime.evaluate', {
            expression: `navigator.serviceWorker.getRegistrations().then(r => r.length)`,
            awaitPromise: true,
            returnByValue: true,
          });
          if (r.result?.value > 0) { result.swRegistrations = r.result.value; break; }
        } catch {}
        await sleep(250);
      }
      try {
        const r = await s('Runtime.evaluate', {
          expression: `caches.keys()`,
          awaitPromise: true, returnByValue: true,
        });
        result.cacheKeys = r.result?.value;
      } catch (e) { result.cacheError = String(e.message).slice(0, 120); }
    }

    console.log('\n=== ' + url + ' ===');
    console.log(JSON.stringify(result, null, 2));

    await root.send('Target.closeTarget', { targetId });
  }

  root.ws.close();
  chrome.kill();
  await sleep(400);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
  process.exit(0);
})().catch((e) => {
  console.error('GAGAL:', e);
  try { chrome.kill(); } catch {}
  process.exit(1);
});
