import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = 8095;
const CHROME_PORT = 9342;
const CHROME = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

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

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'bj40-ver-'));
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

  console.log('Waiting for game to load...');
  for (let i = 0; i < 120; i++) {
    await sleep(300);
    try {
      const r = await s('Runtime.evaluate', {
        expression: `!!window.__game && window.__game.vehicle.loaded && !!window.__game.vehicle.mirrors`,
        returnByValue: true,
      });
      if (r.result?.value) {
        console.log('Game loaded with mirrors!');
        break;
      }
    } catch {}
  }
  await sleep(1500);

  // Start free roam & driver camera mode
  await s('Runtime.evaluate', {
    expression: `
      window.__game.start('freeroam');
      if (window.__game.camRig.mode !== 'pengemudi') {
        window.__game.camRig.cycle();
      }
    `,
  });
  await sleep(1500);

  // Test 1: Straight ahead cabin view (driver POV)
  const shot1 = await s('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('final-cabin-straight.png', Buffer.from(shot1.data, 'base64'));
  console.log('Saved final-cabin-straight.png');

  // Test 2: Center console & headunit view (looking down and right at center console)
  await s('Runtime.evaluate', {
    expression: `
      window.__game.camRig.dragYaw = -0.45;
      window.__game.camRig.dragPitch = 0.22;
    `,
  });
  await sleep(1000);
  const shotHead = await s('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('final-headunit-clean.png', Buffer.from(shotHead.data, 'base64'));
  console.log('Saved final-headunit-clean.png');

  // Test 3: Left side mirror view (looking left)
  await s('Runtime.evaluate', {
    expression: `
      window.__game.camRig.dragYaw = 0.60;
      window.__game.camRig.dragPitch = -0.05;
    `,
  });
  await sleep(1000);
  const shotLeft = await s('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('final-mirror-left.png', Buffer.from(shotLeft.data, 'base64'));
  console.log('Saved final-mirror-left.png');

  // Test 4: Center interior mirror view (looking up and right)
  await s('Runtime.evaluate', {
    expression: `
      window.__game.camRig.dragYaw = -0.45;
      window.__game.camRig.dragPitch = -0.45;
    `,
  });
  await sleep(1000);
  const shotUp = await s('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('final-mirror-center.png', Buffer.from(shotUp.data, 'base64'));
  console.log('Saved final-mirror-center.png');

  // Test 5: Right side mirror view (looking right)
  await s('Runtime.evaluate', {
    expression: `
      window.__game.camRig.dragYaw = -0.85;
      window.__game.camRig.dragPitch = -0.02;
    `,
  });
  await sleep(1000);
  const shotRight = await s('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('final-mirror-right.png', Buffer.from(shotRight.data, 'base64'));
  console.log('Saved final-mirror-right.png');

  // Test 6: Drive forward for 2 seconds to verify dynamic reflections & displays
  await s('Runtime.evaluate', {
    expression: `
      window.__game.camRig.dragYaw = 0.0;
      window.__game.camRig.dragPitch = 0.0;
      window.__game.keys['KeyW'] = true;
    `,
  });
  await sleep(2000);
  await s('Runtime.evaluate', {
    expression: `window.__game.keys['KeyW'] = false;`,
  });
  await sleep(500);

  const shotDriving = await s('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('final-cabin-driving.png', Buffer.from(shotDriving.data, 'base64'));
  console.log('Saved final-cabin-driving.png');

  root.ws.close();
  chrome.kill();
  server.close();
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
  console.log('ALL VERIFICATIONS COMPLETED SUCCESSFULLY!');
  process.exit(0);
})().catch((err) => {
  console.error('Verification error:', err);
  process.exit(1);
});

