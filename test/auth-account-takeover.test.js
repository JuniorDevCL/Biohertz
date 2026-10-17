import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const STORE = path.join(ROOT, 'store.json');
const PORT = 4094;
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

async function jsonReq(method, urlPath, body, token) {
  const headers = { Accept: 'application/json', 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${urlPath}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

function rolFromToken(token) {
  const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
  return payload.rol;
}

test('un alta pública no queda admin y no puede tomar otras cuentas', async (t) => {
  const backup = fs.existsSync(STORE) ? fs.readFileSync(STORE, 'utf8') : null;
  t.after(() => {
    if (backup != null) fs.writeFileSync(STORE, backup);
    else if (fs.existsSync(STORE)) fs.unlinkSync(STORE);
  });

  const passwordHash = await bcrypt.hash('admin-pass', 10);
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
      nombre: 'Alexis',
      email: 'alexis.cruces2122@gmail.com',
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

  const child = spawn(process.execPath, ['src/index.js'], {
    cwd: ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => {
    try { child.kill('SIGTERM'); } catch {}
  });

  await waitHealth(child);

  const registered = await jsonReq('POST', '/auth/register', {
    nombre: 'Aplicaciones',
    email: 'aplicaciones@biohertz.cl',
    password: 'attacker-pass',
    rol: 'admin',
  });
  assert.equal(registered.status, 200, JSON.stringify(registered.data));

  const login = await jsonReq('POST', '/auth/login', {
    email: 'aplicaciones@biohertz.cl',
    password: 'attacker-pass',
  });
  assert.equal(login.status, 200, JSON.stringify(login.data));
  assert.equal(rolFromToken(login.data.token), 'user');

  const reset = await jsonReq('POST', '/mantenciones/admin/reset', { confirm: 'REINICIAR' }, login.data.token);
  assert.equal(reset.status, 403);

  const steal = await jsonReq('PUT', '/auth/users/1', {
    email: 'aplicaciones@biohertz.cl',
  }, login.data.token);
  assert.equal(steal.status, 403);

  const remove = await jsonReq('DELETE', '/auth/users/1', null, login.data.token);
  assert.equal(remove.status, 403);

  const stored = JSON.parse(fs.readFileSync(STORE, 'utf8'));
  const byEmail = Object.fromEntries(stored.usuarios.map((u) => [u.email, u]));
  assert.equal(byEmail['alexis.cruces2122@gmail.com'].rol, 'admin');
  assert.equal(byEmail['aplicaciones@biohertz.cl'].rol, 'user');
});
