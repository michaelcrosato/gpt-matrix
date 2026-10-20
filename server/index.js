import fs from 'node:fs';
import path from 'node:path';
import { root } from './domain.js';
import { Store } from './store.js';
import { Runner } from './runner.js';
import { apiApp, artifactApp, providerStatus } from './app.js';

const port = Number(process.env.PORT || 4310),
  artifactPort = Number(process.env.ARTIFACT_PORT || port + 1),
  dir = path.resolve(process.env.HUB_DATA_DIR || path.join(root, 'data'));
fs.mkdirSync(dir, { recursive: true });
const lock = path.join(dir, 'server.lock');
try {
  const pid = Number(fs.readFileSync(lock, 'utf8'));
  try {
    process.kill(pid, 0);
    throw new Error(`A GPT Hub server already owns this data directory (PID ${pid}).`);
  } catch (e) {
    if (e.code !== 'ESRCH') throw e;
  }
  fs.unlinkSync(lock);
} catch (e) {
  if (e.code !== 'ENOENT') throw e;
}
fs.writeFileSync(lock, String(process.pid), { flag: 'wx' });
const store = new Store(dir),
  runner = new Runner(store),
  providers = await providerStatus();
const app = apiApp(store, runner, { artifactPort, providers });
let vite;
if (process.argv.includes('--dev')) {
  const { createServer } = await import('vite');
  vite = await createServer({
    root,
    server: { middlewareMode: true, hmr: { port: port + 100 } },
    appType: 'spa',
  });
  app.use(vite.middlewares);
} else {
  const express = (await import('express')).default;
  app.use(express.static(path.join(root, 'dist')));
  app.get('/{*splat}', (req, res) => res.sendFile(path.join(root, 'dist/index.html')));
}
const preview = artifactApp(store).listen(artifactPort, '127.0.0.1');
const server = app.listen(port, '127.0.0.1', () => {
  runner.start();
  console.log(
    `GPT Hub: http://localhost:${port}\nArtifact preview: http://localhost:${artifactPort}\nData: ${dir}`
  );
});
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await runner.shutdown();
  server.close();
  preview.close();
  await vite?.close();
  store.close();
  try {
    fs.unlinkSync(lock);
  } catch {}
  process.exit(0);
}
server.on('error', (e) => {
  console.error(e.message);
  stop();
});
preview.on('error', (e) => {
  console.error(e.message);
  stop();
});
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
process.on('exit', () => {
  try {
    if (fs.readFileSync(lock, 'utf8') === String(process.pid)) fs.unlinkSync(lock);
  } catch {}
});
