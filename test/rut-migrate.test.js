import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';

test('la migración offline reformatea RUT y no toca el resto del cliente', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rut-mig-'));
  const stamp = '2020-01-01T00:00:00.000Z';
  const store = {
    seq: { usuarios: 1, tickets: 1, comentarios: 1, equipos: 1, clientes: 4, mantenciones_fichas: 1, eventos: 1 },
    usuarios: [],
    tickets: [],
    comentarios: [],
    equipos: [],
    mantenciones_fichas: [{ id: 1, rut_cliente: '762955105' }],
    eventos: [],
    clientes: [
      { id: 1, nombre: 'Alpha', empresa: 'Bio', email: 'a@b.c', rut: '220671925', actualizado_en: stamp },
      { id: 2, nombre: 'Beta', rut: 'sin rut', actualizado_en: stamp },
      { id: 3, nombre: 'Gamma', rut: '22.067.192-5', actualizado_en: stamp },
      { id: 4, nombre: 'Delta', rut: null, actualizado_en: stamp }
    ]
  };
  fs.writeFileSync(path.join(dir, 'store.json'), JSON.stringify(store));

  const dbUrl = pathToFileURL(path.resolve('src/db.js')).href;
  const rutUrl = pathToFileURL(path.resolve('src/services/rut.js')).href;
  const script = `
    const pool = (await import(${JSON.stringify(dbUrl)})).default;
    const { formatRutChileno } = await import(${JSON.stringify(rutUrl)});
    const found = await pool.query("SELECT id, rut FROM clientes WHERE rut IS NOT NULL AND BTRIM(rut) <> ''");
    for (const row of found.rows) {
      const next = formatRutChileno(row.rut);
      if (!next || next === row.rut) continue;
      await pool.query('UPDATE clientes SET rut = $2 WHERE id = $1 AND rut = $3', [row.id, next, row.rut]);
    }
    const listed = await pool.query('SELECT * FROM clientes ORDER BY actualizado_en DESC LIMIT $1 OFFSET $2', [50, 0]);
    const listedSnap = listed.rows.map((c) => ({ id: c.id, nombre: c.nombre, empresa: c.empresa || null, rut: c.rut, actualizado_en: c.actualizado_en }));
    const formattedPatch = formatRutChileno('76123456');
    const patched = await pool.query(
      'UPDATE clientes SET nombre = COALESCE($1, nombre), empresa = COALESCE($2, empresa), email = COALESCE($3, email), telefono = COALESCE($4, telefono), ubicacion = COALESCE($5, ubicacion), rut = COALESCE($6, rut), direccion = COALESCE($7, direccion), comuna = COALESCE($8, comuna), ciudad = COALESCE($9, ciudad), contacto = COALESCE($10, contacto), actualizado_en = NOW() WHERE id = $11 RETURNING *',
      ['Alpha', null, null, null, null, formattedPatch, null, null, null, null, 1]
    );
    console.log(JSON.stringify({ found: found.rows, listed: listedSnap, patched: { id: patched.rows[0].id, nombre: patched.rows[0].nombre, empresa: patched.rows[0].empresa, rut: patched.rows[0].rut } }));
  `;

  const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
    cwd: dir,
    env: { ...process.env, DATABASE_URL: '', OFFLINE: 'true' }
  });
  let out = '';
  let err = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { err += d; });
  const code = await new Promise((resolve) => child.on('close', resolve));
  assert.equal(code, 0, err || out);

  const result = JSON.parse(out.trim());
  const byId = Object.fromEntries(result.listed.map((c) => [c.id, c]));
  assert.equal(byId[1].rut, '22.067.192-5');
  assert.equal(byId[1].nombre, 'Alpha');
  assert.equal(byId[1].empresa, 'Bio');
  assert.equal(byId[1].actualizado_en, stamp);
  assert.equal(byId[2].rut, 'sin rut');
  assert.equal(byId[2].nombre, 'Beta');
  assert.equal(byId[3].rut, '22.067.192-5');
  assert.equal(byId[4].rut, null);
  assert.equal(result.patched.rut, '7.612.345-6');
  assert.equal(result.patched.nombre, 'Alpha');
  assert.equal(result.patched.empresa, 'Bio');

  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'store.json'), 'utf8'));
  assert.equal(saved.mantenciones_fichas[0].rut_cliente, '762955105');
});
