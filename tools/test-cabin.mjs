import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = 8089;
const CHROME_PORT = 9336;
const CHROME = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

// Simple static server for dist/
const MIME = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.glb': 'model/gltf-binary',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
};

const server = http.createServer((req, res) => {
  let u = req.url.split('?')[0];
  if (u === '/') u = '/index.html';
  const filePath = path.join(process.cwd(), 'dist', u);
  if (!fs.existsSync(filePath)) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'require-corp',
  });
  fs.createReadStream(filePath).pipe(res);
});

await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
console.log(`Server running at http://127.0.0.1:${PORT}`);

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'bj40-cabin-'));
const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${CHROME_PORT}`,
  `--user-data-dir=${profile}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-gpu',
  '--use-gl=swiftshader',
  '--enable-unsafe-swiftshader',
  '--window-size=1280,720',
  'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function endpoint() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${CHROME_PORT}/json/version`);
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
      if (m.method === 'Runtime.consoleAPICalled') {
        console.log('[Browser Console]', m.params.type, m.params.args?.map(a => a.value || a.description).join(' '));
      }
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
  await s('Network.enable');
  await s('Network.setBypassServiceWorker', { bypass: true });
  await s('Page.navigate', { url: `http://127.0.0.1:${PORT}` });

  // Wait for game to load
  console.log('Waiting for game to load...');
  for (let i = 0; i < 120; i++) {
    await sleep(300);
    try {
      const r = await s('Runtime.evaluate', {
        expression: `!!window.__game && window.__game.vehicle.loaded`,
        returnByValue: true,
      });
      if (r.result?.value) {
        console.log('Game loaded!');
        break;
      }
    } catch {}
  }
  await sleep(1500);

  // Start free drive by clicking freeRoamBtn
  console.log('Clicking freeRoamBtn...');
  await s('Runtime.evaluate', {
    expression: `document.getElementById('freeRoamBtn').click();`,
  });
  await sleep(1000);

  // Switch camera to 'pengemudi' (driver)
  console.log('Switching camera to driver mode...');
  await s('Runtime.evaluate', {
    expression: `
      if (window.__game.camRig.mode !== 'pengemudi') {
        window.__game.camRig.cycle();
      }
      console.log('Current cam mode:', window.__game.camRig.mode);
    `,
  });
  await sleep(1500);

  // Capture idle cabin screenshot
  const shot1 = await s('Page.captureScreenshot', { format: 'png' });
  const out1 = path.join(process.cwd(), 'cabin-view1.png');
  fs.writeFileSync(out1, Buffer.from(shot1.data, 'base64'));
  console.log('Saved:', out1);

  // Drive forward using keys so readInput() sees it
  console.log('Driving forward...');
  await s('Runtime.evaluate', {
    expression: `
      window.__game.keys['KeyW'] = true;
    `,
  });
  await sleep(1500);

  // Capture driving cabin screenshot
  const shot2 = await s('Page.captureScreenshot', { format: 'png' });
  const out2 = path.join(process.cwd(), 'cabin-driving.png');
  fs.writeFileSync(out2, Buffer.from(shot2.data, 'base64'));
  console.log('Saved:', out2);

  // Release gas and look towards head unit
  await s('Runtime.evaluate', {
    expression: `
      window.__game.keys['KeyW'] = false;
      window.__game.camRig.beginDrag();
      window.__game.camRig.dragYaw = -0.55;
      window.__game.camRig.dragPitch = -0.05;
    `,
  });
  await sleep(800);

  const shotHead = await s('Page.captureScreenshot', { format: 'png' });
  const outHead = path.join(process.cwd(), 'cabin-headunit.png');
  fs.writeFileSync(outHead, Buffer.from(shotHead.data, 'base64'));
  console.log('Saved:', outHead);

  root.ws.close();
  chrome.kill();
  server.close();
  await sleep(400);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
  console.log('DONE!');
  process.exit(0);
})().catch((e) => {
  console.error('ERROR:', e);
  try { chrome.kill(); } catch {}
  try { server.close(); } catch {}
  process.exit(1);
});
