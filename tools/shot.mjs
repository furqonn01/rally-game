// Screenshot menu utama pada viewport HP untuk URL tertentu.
// Pakai: node tools/shot.mjs <url> <outfile> [width] [height]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9334;
const [url, outFile, w = '844', h = '390'] = process.argv.slice(2);

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'bj40-shot-'));
const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check',
  '--disable-gpu', '--use-gl=swiftshader', '--enable-unsafe-swiftshader',
  `--window-size=${w},${h}`,
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

(async () => {
  const root = await connect(await endpoint());
  const { targetId } = await root.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await root.send('Target.attachToTarget', { targetId, flatten: true });
  const s = (m, p) => root.send(m, p, sessionId);

  await s('Page.enable');
  await s('Runtime.enable');
  await s('Emulation.setDeviceMetricsOverride', {
    width: Number(w), height: Number(h), deviceScaleFactor: 2, mobile: true,
  });
  await s('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
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
  await sleep(1500);

  const shot = await s('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(outFile, Buffer.from(shot.data, 'base64'));
  console.log('tersimpan: ' + outFile + ' (' + fs.statSync(outFile).size + ' B)');

  root.ws.close();
  chrome.kill();
  await sleep(400);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
  process.exit(0);
})().catch((e) => { console.error('GAGAL:', e); try { chrome.kill(); } catch {}; process.exit(1); });
