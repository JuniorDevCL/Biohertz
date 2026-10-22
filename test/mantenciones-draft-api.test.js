import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const STORE = path.join(ROOT, 'store.json');
const PORT = 4055;
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

test('PATCH borrador: se puede guardar varias veces sin tocar otras fichas', async (t) => {
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
  assert.ok(token);

  const eq = await jsonReq('POST', '/equipos', {
    nombre: 'ECOGRAFO TEST',
    marca: 'ALPINION',
    modelo: 'E-CUBE LE',
    numero_serie: 'L03330-TEST',
    estado: 'activo',
  }, token);
  assert.ok(eq.status === 200 || eq.status === 201, JSON.stringify(eq.data));
  const equipoId = eq.data.equipo?.id || eq.data.id;
  assert.ok(equipoId);

  const created = await jsonReq('POST', '/mantenciones', {
    equipo_id: equipoId,
    tipo: 'preventiva',
    fecha: '2020-03-02',
    hora: '20:37',
    rut_cliente: '762955105',
    senores: 'CLINICA UROMED',
    direccion: 'SANTIAGO',
    ciudad_comuna: 'Providencia',
    categorias: ['facturable', 'mantencion'],
    trabajo: 'Borrador inicial',
    guardar_y_firmar: 'false',
  }, token);
  assert.ok(created.status === 200 || created.status === 201, JSON.stringify(created.data));
  const fichaId = created.data.id;
  assert.ok(fichaId);
  assert.equal(created.data.estado, 'borrador');

  const other = await jsonReq('POST', '/mantenciones', {
    equipo_id: equipoId,
    tipo: 'preventiva',
    fecha: '2021-01-15',
    hora: '10:00',
    senores: 'OTRA FICHA NO TOCAR',
    trabajo: 'no-cambiar',
    guardar_y_firmar: 'false',
  }, token);
  assert.ok(other.data.id);
  const otherId = other.data.id;
  const otherTrabajo = other.data.trabajo;

  const badDate = await jsonReq('PATCH', `/mantenciones/${fichaId}`, {
    equipo_id: equipoId,
    tipo: 'preventiva',
    fecha: 'Mon Mar 02',
    hora: '20:37',
    senores: 'CLINICA UROMED EDITADA',
    ciudad_comuna: 'Providencia',
    direccion: 'SANTIAGO',
    rut_cliente: '762955105',
    trabajo: 'Cambio 1',
    categorias: ['facturable', 'mantencion'],
    checklist: JSON.stringify([{ id: 'p1', label: 'item', checked: true }]),
    guardar_y_firmar: 'false',
  }, token);
  assert.equal(badDate.status, 200, JSON.stringify(badDate.data));
  assert.equal(badDate.data.senores, 'CLINICA UROMED EDITADA');
  assert.equal(badDate.data.trabajo, 'Cambio 1');
  assert.equal(badDate.data.fecha, '2020-03-02');
  assert.equal(badDate.data.estado, 'borrador');

  const second = await jsonReq('PATCH', `/mantenciones/${fichaId}`, {
    equipo_id: equipoId,
    tipo: 'preventiva',
    fecha: '2020-03-02',
    hora: '21:15',
    senores: 'CLINICA UROMED EDITADA',
    ciudad_comuna: 'Las Condes',
    trabajo: 'Cambio 2',
    categorias: ['facturable'],
    checklist: JSON.stringify([{ id: 'p1', label: 'item', checked: false }]),
    guardar_y_firmar: 'false',
  }, token);
  assert.equal(second.status, 200, JSON.stringify(second.data));
  assert.equal(second.data.trabajo, 'Cambio 2');
  assert.equal(second.data.ciudad_comuna, 'Las Condes');
  assert.equal(second.data.hora, '21:15');
  assert.equal(second.data.estado, 'borrador');

  const withSchedule = await jsonReq('PATCH', `/mantenciones/${fichaId}`, {
    email_cliente: 'cliente-equivocado@ejemplo.cl',
    proxima_mantencion: '2026-11-01',
    fecha: '2020-03-02',
    hora: '21:15',
    guardar_y_firmar: 'false',
  }, token);
  assert.equal(withSchedule.status, 200, JSON.stringify(withSchedule.data));
  assert.equal(withSchedule.data.email_cliente, 'cliente-equivocado@ejemplo.cl');
  assert.equal(withSchedule.data.proxima_mantencion, '2026-11-01');

  const omitted = await jsonReq('PATCH', `/mantenciones/${fichaId}`, {
    trabajo: 'Cambio 2',
    guardar_y_firmar: 'false',
  }, token);
  assert.equal(omitted.status, 200, JSON.stringify(omitted.data));
  assert.equal(omitted.data.email_cliente, 'cliente-equivocado@ejemplo.cl');
  assert.equal(omitted.data.proxima_mantencion, '2026-11-01');
  assert.equal(omitted.data.fecha, '2020-03-02');
  assert.equal(omitted.data.hora, '21:15');

  const cleared = await jsonReq('PATCH', `/mantenciones/${fichaId}`, {
    email_cliente: '',
    proxima_mantencion: '',
    fecha: '',
    hora: '',
    guardar_y_firmar: 'false',
  }, token);
  assert.equal(cleared.status, 200, JSON.stringify(cleared.data));
  assert.equal(cleared.data.email_cliente, null);
  assert.equal(cleared.data.proxima_mantencion, null);
  assert.equal(cleared.data.fecha, null);
  assert.equal(cleared.data.hora, null);
  assert.equal(cleared.data.trabajo, 'Cambio 2');

  const restored = await jsonReq('PATCH', `/mantenciones/${fichaId}`, {
    email_cliente: 'cliente-equivocado@ejemplo.cl',
    proxima_mantencion: '2026-11-01',
    fecha: '2020-03-02',
    hora: '21:15',
    guardar_y_firmar: 'false',
  }, token);
  assert.equal(restored.status, 200, JSON.stringify(restored.data));

  const signedCleared = await jsonReq('PATCH', `/mantenciones/${fichaId}`, {
    email_cliente: '',
    proxima_mantencion: '',
    fecha: '2020-04-01',
    hora: '09:00',
    firmante_cliente: 'Cliente',
    firma_tecnico: `data:image/png;base64,${'A'.repeat(80)}`,
    firma_cliente: `data:image/png;base64,${'B'.repeat(80)}`,
    guardar_y_firmar: 'true',
  }, token);
  assert.equal(signedCleared.status, 200, JSON.stringify(signedCleared.data));
  assert.equal(signedCleared.data.estado, 'firmada');
  assert.equal(signedCleared.data.email_cliente, null);
  assert.equal(signedCleared.data.proxima_mantencion, null);
  assert.equal(signedCleared.data.fecha, '2020-04-01');

  const otherAfter = await jsonReq('GET', `/mantenciones/${otherId}`, null, token);
  assert.equal(otherAfter.status, 200);
  assert.equal(otherAfter.data.trabajo, otherTrabajo);
  assert.equal(otherAfter.data.senores, 'OTRA FICHA NO TOCAR');

  const signed = await jsonReq('PATCH', `/mantenciones/${otherId}`, {
    equipo_id: equipoId,
    tipo: 'preventiva',
    trabajo: 'intento firmar',
    firmante_cliente: 'Cliente',
    firma_tecnico: `data:image/png;base64,${'A'.repeat(80)}`,
    firma_cliente: `data:image/png;base64,${'B'.repeat(80)}`,
    guardar_y_firmar: 'true',
  }, token);
  if (signed.status === 200 && signed.data.estado === 'firmada') {
    const blocked = await jsonReq('PATCH', `/mantenciones/${otherId}`, {
      trabajo: 'no deberia',
      guardar_y_firmar: 'false',
    }, token);
    assert.equal(blocked.status, 403);
    const still = await jsonReq('GET', `/mantenciones/${otherId}`, null, token);
    assert.notEqual(still.data.trabajo, 'no deberia');
  }

  try { child.kill('SIGTERM'); } catch {}
  await Promise.race([once(child, 'exit'), new Promise((r) => setTimeout(r, 2000))]);
});
