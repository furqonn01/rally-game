import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = 8096;
const CHROME_PORT = 9343;
const CHROME = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

const MIME = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.glb': 'model/gltf-binary',
  '.png': 'image/png',
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
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
});

await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'hu-test-'));
const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${CHROME_PORT}`,
  `--user-data-dir=${profile}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-gpu',
  '--use-gl=swiftshader',
  '--window-size=1280,720',
  'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${CHROME_PORT}/json/version`);
      if (res.ok) break;
    } catch {}
    await sleep(200);
  }

  const list = await (await fetch(`http://127.0.0.1:${CHROME_PORT}/json/list`)).json();
  const ws = new WebSocket(list[0].webSocketDebuggerUrl);
  let id = 1;
  const send = (method, params = {}) => new Promise((resolve) => {
    const cur = id++;
    const handler = (evt) => {
      const data = JSON.parse(evt.data);
      if (data.id === cur) {
        ws.removeEventListener('message', handler);
        resolve(data.result);
      }
    };
    ws.addEventListener('message', handler);
    ws.send(JSON.stringify({ id: cur, method, params }));
  });

  await new Promise((r) => { ws.onopen = r; });
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}` });

  console.log('Waiting for game...');
  for (let i = 0; i < 120; i++) {
    await sleep(300);
    const r = await send('Runtime.evaluate', {
      expression: `!!window.__game && window.__game.vehicle?.loaded && !!window.__game.vehicle?.cabinDisplay?.headUnitMesh`,
      returnByValue: true,
    });
    if (r?.result?.value) break;
  }

  // Click freeroam and switch to cabin camera
  await send('Runtime.evaluate', {
    expression: `
      document.getElementById('freeRoamBtn').click();
      if (window.__game.camRig.mode !== 'pengemudi') {
        window.__game.camRig.cycle();
      }
    `,
  });
  await sleep(1000);

  // Let's test a few Y values for headUnitMesh:
  // e.g. 0.690, 0.710, 0.730
  const tests = [
    { y: 0.665, z: -0.340, label: 'original_0665' },
    { y: 0.685, z: -0.340, label: 'raised_0685' },
    { y: 0.705, z: -0.342, label: 'raised_0705' },
    { y: 0.725, z: -0.345, label: 'raised_0725' },
  ];

  for (const t of tests) {
    await send('Runtime.evaluate', {
      expression: `
        const hu = window.__game.vehicle.cabinDisplay.headUnitMesh;
        hu.position.set(0.000, ${t.y}, ${t.z});
        // also look slightly toward center console so we can see clearly
        window.__game.camRig.dragYaw = -0.25;
        window.__game.camRig.dragPitch = 0.05;
      `,
    });
    await sleep(300);
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(`test-hu-${t.label}.png`, Buffer.from(shot.data, 'base64'));
    console.log(`Saved test-hu-${t.label}.png`);
  }

  // Also capture from straight ahead POV (dragYaw = 0, dragPitch = 0)
  for (const t of [tests[1], tests[2], tests[3]]) {
    await send('Runtime.evaluate', {
      expression: `
        const hu = window.__game.vehicle.cabinDisplay.headUnitMesh;
        hu.position.set(0.000, ${t.y}, ${t.z});
        window.__game.camRig.dragYaw = 0;
        window.__game.camRig.dragPitch = 0;
      `,
    });
    await sleep(300);
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(`test-straight-${t.label}.png`, Buffer.from(shot.data, 'base64'));
    console.log(`Saved test-straight-${t.label}.png`);
  }

  ws.close();
  chrome.kill();
  server.close();
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
  console.log('Done test');
}

main().catch(console.error);

