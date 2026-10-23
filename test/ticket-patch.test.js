import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const STORE = path.join(ROOT, 'store.json');
const PORT = 4063;
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
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${urlPath}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

function userIdFromToken(token) {
  const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
  return payload.id;
}

test('PATCH ticket: Sin asignar y la descripción vacía se guardan, y un título suelto no borra el resto', async (t) => {
  const backup = fs.existsSync(STORE) ? fs.readFileSync(STORE, 'utf8') : null;
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
  t.after(() => {
    try { child.kill('SIGTERM'); } catch {}
  });

  await waitHealth(child);

  const login = await jsonReq('POST', '/auth/login', {
    email: 'admin@biohertz.com',
    password: 'password123',
  });
  assert.equal(login.status, 200, JSON.stringify(login.data));
  const token = login.data.token;
  const userId = userIdFromToken(token);

  const equipo = await jsonReq('POST', '/equipos', {
    marca: 'ALPINION',
    modelo: 'E-CUBE',
    numero_serie: 'SN-PATCH-1',
  }, token);
  assert.equal(equipo.status, 201, JSON.stringify(equipo.data));
  const equipoId = equipo.data.equipo.id;

  const created = await jsonReq('POST', '/tickets', {
    titulo: 'Visita original',
    descripcion: 'Llevar repuesto',
    asignado_a: userId,
    equipo_id: equipoId,
    tipo: 'visita_tecnica',
  }, token);
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const ticketId = created.data.ticket.id;
  assert.equal(Number(created.data.ticket.asignado_a), Number(userId));
  assert.equal(Number(created.data.ticket.equipo_id), Number(equipoId));

  const cleared = await jsonReq('PATCH', `/tickets/${ticketId}`, {
    titulo: 'Visita original',
    descripcion: '',
    asignado_a: null,
  }, token);
  assert.equal(cleared.status, 200, JSON.stringify(cleared.data));
  assert.equal(cleared.data.ticket.asignado_a, null);
  assert.equal(cleared.data.ticket.descripcion, null);
  assert.equal(Number(cleared.data.ticket.equipo_id), Number(equipoId));

  const titleOnly = await jsonReq('PATCH', `/tickets/${ticketId}`, {
    titulo: 'Visita renombrada',
  }, token);
  assert.equal(titleOnly.status, 200, JSON.stringify(titleOnly.data));
  assert.equal(titleOnly.data.ticket.titulo, 'Visita renombrada');
  assert.equal(titleOnly.data.ticket.asignado_a, null);
  assert.equal(titleOnly.data.ticket.descripcion, null);
  assert.equal(Number(titleOnly.data.ticket.equipo_id), Number(equipoId));

  const reassigned = await jsonReq('PATCH', `/tickets/${ticketId}`, {
    titulo: 'Visita renombrada',
    descripcion: 'Confirmar horario',
    asignado_a: userId,
  }, token);
  assert.equal(reassigned.status, 200, JSON.stringify(reassigned.data));
  assert.equal(Number(reassigned.data.ticket.asignado_a), Number(userId));
  assert.equal(reassigned.data.ticket.descripcion, 'Confirmar horario');
});
