import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const STORE = path.join(ROOT, 'store.json');
const PORT = 4077;
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
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

test('crear ticket reutiliza el equipo aunque la serie cambie de mayúsculas', async (t) => {
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

  delete process.env.DATABASE_URL;
  await waitHealth(child);

  const login = await jsonReq('POST', '/auth/login', {
    email: 'admin@biohertz.com',
    password: 'password123',
  });
  assert.equal(login.status, 200, JSON.stringify(login.data));
  const token = login.data.token;

  const serie = 'L03330-TICKET-CASE';
  const eq = await jsonReq('POST', '/equipos', {
    nombre: 'ECOGRAFO SERIE',
    marca: 'ALPINION',
    modelo: 'E-CUBE',
    numero_serie: serie,
    estado: 'operativo',
  }, token);
  assert.ok(eq.status === 200 || eq.status === 201, JSON.stringify(eq.data));
  const equipoId = eq.data.equipo?.id || eq.data.id;
  assert.ok(equipoId);

  const ticket = await jsonReq('POST', '/tickets', {
    titulo: 'MP equipo existente',
    tipo: 'mantencion_preventiva',
    numero_serie: serie.toLowerCase(),
    equipo_nombre: 'NO DEBE CREARSE',
    equipo_marca: 'OTRA',
    equipo_modelo: 'OTRO',
  }, token);
  assert.equal(ticket.status, 201, JSON.stringify(ticket.data));
  assert.equal(Number(ticket.data.ticket.equipo_id), Number(equipoId));

  const listed = await jsonReq('GET', `/equipos?serie=${encodeURIComponent(serie)}`, null, token);
  const sameSerie = (listed.data.equipos || []).filter((row) =>
    String(row.numero_serie || '').trim().toLowerCase() === serie.toLowerCase()
  );
  assert.equal(sameSerie.length, 1);
  assert.equal(Number(sameSerie[0].id), Number(equipoId));

  const nuevo = await jsonReq('POST', '/tickets', {
    titulo: 'MP serie nueva',
    tipo: 'visita_tecnica',
    numero_serie: 'SERIE-NUEVA-TICKET-99',
    equipo_nombre: 'Equipo nuevo',
  }, token);
  assert.equal(nuevo.status, 201, JSON.stringify(nuevo.data));
  assert.ok(nuevo.data.ticket.equipo_id);
  assert.notEqual(Number(nuevo.data.ticket.equipo_id), Number(equipoId));

  try { child.kill('SIGTERM'); } catch {}
  await Promise.race([once(child, 'exit'), new Promise((r) => setTimeout(r, 2000))]);
});
