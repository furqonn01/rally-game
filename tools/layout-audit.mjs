// Audit tata letak menu utama (khususnya kotak peringatan origin) di beberapa ukuran layar HP.
// Pakai: node tools/layout-audit.mjs <url> [w,h] [w,h] ...
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9335;
const [url, ...sizes] = process.argv.slice(2);
const dims = (sizes.length ? sizes : ['844x390', '390x844', '360x640', '412x915']).map((s) => {
  const [w, h] = s.split('x').map(Number);
  return { w, h };
});

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'bj40-audit-'));
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check',
  '--disable-gpu', '--use-gl=swiftshader', '--enable-unsafe-swiftshader',
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
    this.ws = ws; this.id = 0; this.pending = new Map();
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
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

const connect = (u) => new Promise((res, rej) => {
  const ws = new WebSocket(u);
  ws.addEventListener('open', () => res(new CDP(ws)));
  ws.addEventListener('error', rej);
});

const probe = `(() => {
  const out = { vw: innerWidth, vh: innerHeight };
  const box = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      w: Math.round(r.width), h: Math.round(r.height),
      top: Math.round(r.top), bottom: Math.round(r.bottom),
      left: Math.round(r.left), right: Math.round(r.right),
      shown: !el.hidden && cs.display !== 'none' && cs.visibility !== 'hidden',
      clippedTop: r.top < -1, clippedBottom: r.bottom > innerHeight + 1,
      clippedLeft: r.left < -1, clippedRight: r.right > innerWidth + 1,
    };
  };
  const start = document.getElementById('start');
  out.start = box(start);
  out.hint = box(document.getElementById('installHint'));
  out.btn = box(document.getElementById('installBtn'));
  if (start) {
    const cs = getComputedStyle(start);
    out.overlayScroll = {
      scrollH: start.scrollHeight,
      clientH: start.clientHeight,
      scrollTop: Math.round(start.scrollTop),
      scrollable: start.scrollHeight > start.clientHeight + 1,
      overflowY: cs.overflowY,
      justify: cs.justifyContent,
    };
    const kids = Array.prototype.map.call(start.children, (el) => {
      const r = el.getBoundingClientRect();
      return {
        cls: el.className + (el.id ? '#' + el.id : ''),
        top: Math.round(r.top),
        bottom: Math.round(r.bottom),
        offTop: r.top < -1,
      };
    });
    out.kids = kids;
    // Bisakah bagian atas dijangkau lewat scroll?
    const first = start.firstElementChild;
    out.firstKidReachable = first ? first.getBoundingClientRect().top >= -1 : null;
  }
  out.docScrollW = document.documentElement.scrollWidth;
  out.docScrollH = document.documentElement.scrollHeight;
  out.overflowX = document.documentElement.scrollWidth > innerWidth + 1;
  out.overflowY = document.documentElement.scrollHeight > innerHeight + 1;
  return out;
})()`;

(async () => {
  const root = await connect(await endpoint());
  const { targetId } = await root.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await root.send('Target.attachToTarget', { targetId, flatten: true });
  const s = (m, p) => root.send(m, p, sessionId);
  await s('Page.enable');
  await s('Runtime.enable');
  await s('Page.navigate', { url });

  for (let i = 0; i < 120; i++) {
    await sleep(300);
    try {
      const r = await s('Runtime.evaluate', {
        expression: `!!window.__game && !!document.getElementById('start') && !document.getElementById('start').classList.contains('hidden')`,
        returnByValue: true,
      });
      if (r.result?.value) break;
    } catch {}
  }
  await sleep(1200);

  for (const d of dims) {
    await s('Emulation.setDeviceMetricsOverride', {
      width: d.w, height: d.h, deviceScaleFactor: 2, mobile: true,
    });
    await s('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await sleep(700);
    const r = await s('Runtime.evaluate', { expression: probe, returnByValue: true });
    console.log('\n=== ' + d.w + 'x' + d.h + (d.h > d.w ? ' (potret)' : ' (lanskap)') + ' ===');
    console.log(JSON.stringify(r.result.value, null, 2));
  }

  root.ws.close();
  chrome.kill();
  await sleep(400);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
  process.exit(0);
})().catch((e) => { console.error('GAGAL:', e); try { chrome.kill(); } catch {}; process.exit(1); });
