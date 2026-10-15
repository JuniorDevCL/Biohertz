import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const STORE = path.join(ROOT, 'store.json');
const PORT = 4061;
const BASE = `http://127.0.0.1:${PORT}`;

async function waitHealth(child, timeoutMs = 20000) {
  const start = Date.now();
  let logs = '';
  child.stdout.on('data', (d) => { logs += d.toString(); });
  child.stderr.on('data', (d) => { logs += d.toString(); });
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return;
    } catch {}
    if (child.exitCode != null) {
      throw new Error('Servidor salió: ' + child.exitCode + '\n' + logs);
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('Servidor no levantó\n' + logs);
}

test('el acceso tester no entra como admin si ALLOW_TESTER_LOGIN no está activo', async (t) => {
  const backup = fs.existsSync(STORE) ? fs.readFileSync(STORE, 'utf8') : null;
  t.after(() => {
    if (backup != null) fs.writeFileSync(STORE, backup);
    else if (fs.existsSync(STORE)) fs.unlinkSync(STORE);
  });

  const passwordHash = await bcrypt.hash('tester123', 10);
  fs.writeFileSync(STORE, JSON.stringify({
    seq: {
      usuarios: 2,
      tickets: 1,
      comentarios: 1,
      equipos: 1,
      clientes: 1,
      mantenciones_fichas: 1,
      eventos: 1,
    },
    usuarios: [{
      id: 1,
      nombre: 'Tester',
      email: 'tester@biohertz.com',
      password: passwordHash,
      rol: 'admin',
    }],
    tickets: [],
    comentarios: [],
    equipos: [],
    clientes: [],
    mantenciones_fichas: [],
    eventos: [],
  }));

  const env = {
    ...process.env,
    OFFLINE: 'true',
    PORT: String(PORT),
    NODE_ENV: 'test',
    JWT_SECRET: 'offline_secret',
    GOOGLE_CLIENT_ID: 'test-client-id',
    GOOGLE_CLIENT_SECRET: 'test-client-secret',
  };
  delete env.DATABASE_URL;
  delete env.ALLOW_TESTER_LOGIN;

  const child = spawn(process.execPath, ['src/index.js'], {
    cwd: ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => {
    try { child.kill('SIGTERM'); } catch {}
  });

  await waitHealth(child);

  const testerPage = await fetch(`${BASE}/auth/tester`, { redirect: 'manual' });
  assert.equal(testerPage.status, 404);
  assert.notEqual(testerPage.headers.get('location'), '/dashboard');

  const testerLogin = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ email: 'tester@biohertz.com', password: 'tester123' }),
  });
  const testerBody = await testerLogin.json();
  assert.equal(testerLogin.status, 400);
  assert.equal(testerBody.token, undefined);

  const adminLogin = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ email: 'admin@biohertz.com', password: 'password123' }),
  });
  const adminBody = await adminLogin.json();
  assert.equal(adminLogin.status, 200, JSON.stringify(adminBody));
  assert.ok(adminBody.token);
});
