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

  const firma = `data:image/png;base64,${'A'.repeat(120)}`;
  const clientA = await jsonReq('POST', '/clientes', { nombre: 'Clinica Portal A' }, token);
  const clientB = await jsonReq('POST', '/clientes', { nombre: 'Clinica Portal B' }, token);
  assert.equal(clientA.status, 201, JSON.stringify(clientA.data));
  assert.equal(clientB.status, 201, JSON.stringify(clientB.data));

  const eqA = await jsonReq('POST', '/equipos', {
    nombre: 'ECO PORTAL A',
    marca: 'ALPINION',
    modelo: 'E-CUBE',
    numero_serie: 'PORTAL-A-1',
    cliente_id: clientA.data.id,
    estado: 'operativo',
  }, token);
  const eqB = await jsonReq('POST', '/equipos', {
    nombre: 'ECO PORTAL B',
    marca: 'ALPINION',
    modelo: 'E-CUBE',
    numero_serie: 'PORTAL-B-1',
    cliente_id: clientB.data.id,
    estado: 'operativo',
  }, token);
  const equipoAId = eqA.data.equipo?.id || eqA.data.id;
  const equipoBId = eqB.data.equipo?.id || eqB.data.id;
  assert.ok(equipoAId && equipoBId);

  const fichaA = await jsonReq('POST', '/mantenciones', {
    equipo_id: equipoAId,
    tipo: 'preventiva',
    fecha: '2026-10-01',
    hora: '09:00',
    senores: 'CLINICA PORTAL A',
    email_cliente: 'typo@example.com',
    firmante_cliente: 'Ana',
    firma_tecnico: firma,
    firma_cliente: firma,
    guardar_y_firmar: 'true',
  }, token);
  assert.equal(fichaA.status, 201, JSON.stringify(fichaA.data));
  assert.equal(fichaA.data.estado, 'firmada');

  const fichaB = await jsonReq('POST', '/mantenciones', {
    equipo_id: equipoBId,
    tipo: 'preventiva',
    fecha: '2026-10-02',
    hora: '10:00',
    senores: 'CLINICA PORTAL B',
    email_cliente: 'shared@example.com',
    firmante_cliente: 'Bruno',
    firma_tecnico: firma,
    firma_cliente: firma,
    guardar_y_firmar: 'true',
  }, token);
  assert.equal(fichaB.status, 201, JSON.stringify(fichaB.data));

  const corrected = await jsonReq('PATCH', `/mantenciones/${fichaA.data.id}/textos`, {
    email_cliente: 'correcto@example.com',
  }, token);
  assert.equal(corrected.status, 200, JSON.stringify(corrected.data));
  assert.equal(corrected.data.email_cliente, 'correcto@example.com');
  assert.equal(corrected.data.estado, 'firmada');
  assert.equal(corrected.data.firma_tecnico, fichaA.data.firma_tecnico);

  const stolen = await jsonReq('PATCH', `/mantenciones/${fichaA.data.id}/textos`, {
    email_cliente: 'shared@example.com',
  }, token);
  assert.equal(stolen.status, 200, JSON.stringify(stolen.data));
  assert.equal(stolen.data.email_cliente, 'shared@example.com');

  const store = JSON.parse(fs.readFileSync(STORE, 'utf8'));
  const portal = store.portal_usuarios || [];
  const byEmail = (email) => portal.find((p) => p.email === email);
  assert.equal(byEmail('correcto@example.com')?.cliente_id, clientA.data.id);
  assert.equal(byEmail('shared@example.com')?.cliente_id, clientB.data.id);
  assert.equal(byEmail('typo@example.com')?.cliente_id, clientA.data.id);

  try { child.kill('SIGTERM'); } catch {}
  await Promise.race([once(child, 'exit'), new Promise((r) => setTimeout(r, 2000))]);
});
