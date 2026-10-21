import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { io as ioClient } from 'socket.io-client';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const STORE = path.join(ROOT, 'store.json');
const PORT = 4067;
const BASE = `http://127.0.0.1:${PORT}`;

function cookieHeader(res) {
  const list = typeof res.headers.getSetCookie === 'function'
    ? res.headers.getSetCookie()
    : [res.headers.get('set-cookie')].filter(Boolean);
  return list.map((c) => String(c).split(';')[0]).filter(Boolean).join('; ');
}

function waitFor(socket, event, ms = 8000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout esperando ${event}`)), ms);
    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

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

test('socket de tickets no entrega datos a clientes sin sesión', async (t) => {
  const backup = fs.existsSync(STORE) ? fs.readFileSync(STORE, 'utf8') : null;
  if (fs.existsSync(STORE)) fs.unlinkSync(STORE);
  t.after(() => {
    if (backup != null) fs.writeFileSync(STORE, backup);
    else if (fs.existsSync(STORE)) fs.unlinkSync(STORE);
  });

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
  const sockets = [];
  t.after(() => {
    for (const socket of sockets) {
      try { socket.close(); } catch {}
    }
    try { child.kill('SIGTERM'); } catch {}
  });

  await waitHealth(child);

  const anon = ioClient(BASE, {
    transports: ['websocket'],
    reconnection: false,
    timeout: 4000,
  });
  sockets.push(anon);
  const anonFailure = await Promise.race([
    waitFor(anon, 'connect_error', 6000).then(() => 'rejected'),
    waitFor(anon, 'connect', 6000).then(() => 'connected'),
  ]);
  assert.equal(anonFailure, 'rejected');

  const loginRes = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ email: 'admin@biohertz.com', password: 'password123' }),
  });
  const login = await loginRes.json();
  assert.equal(loginRes.status, 200, JSON.stringify(login));
  const cookie = cookieHeader(loginRes);
  assert.ok(cookie.includes('connect.sid'), cookie);

  const staff = ioClient(BASE, {
    transports: ['websocket'],
    reconnection: false,
    timeout: 4000,
    extraHeaders: { cookie },
  });
  sockets.push(staff);
  await waitFor(staff, 'connect');

  const leaked = {
    titulo: 'Visita filtro de osmosis',
    descripcion: 'Fuga en sala de bombas',
    telefono_contacto: '+56911112222',
    lugar_instalacion: 'Clinica Norte, piso 3',
  };
  const pendingEvent = waitFor(staff, 'ticket:created');
  const created = await fetch(`${BASE}/tickets`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${login.token}`,
    },
    body: JSON.stringify({ ...leaked, tipo: 'visita_tecnica' }),
  });
  const createdBody = await created.json().catch(() => ({}));
  assert.equal(created.status, 201, JSON.stringify(createdBody));

  const event = await pendingEvent;
  assert.equal(event.titulo, leaked.titulo);
  assert.equal(event.descripcion, leaked.descripcion);
  assert.equal(anon.connected, false);
});
