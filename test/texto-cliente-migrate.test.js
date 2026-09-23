import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';

test('la migración deja los textos del cliente en mayúsculas sin tocar correo, RUT ni otra etiqueta', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'texto-cli-'));
  const stamp = '2020-01-01T00:00:00.000Z';
  const store = {
    seq: { usuarios: 1, tickets: 1, comentarios: 1, equipos: 3, clientes: 2, mantenciones_fichas: 1, eventos: 1 },
    usuarios: [{ id: 1, nombre: 'Alexis', email: 'alexis@example.com' }],
    tickets: [],
    comentarios: [],
    equipos: [
      { id: 1, nombre: 'Monitor X', numero_serie: 'SN-1', cliente_id: 1, cliente: 'Clínica Ñuñoa', ubicacion: 'Piso 2' },
      { id: 2, nombre: 'Monitor Y', numero_serie: 'SN-2', cliente_id: 1, cliente: 'Sede especial', ubicacion: 'Piso 2' }
    ],
    mantenciones_fichas: [{ id: 1, rut_cliente: '762955105', senores: 'Clínica Ñuñoa' }],
    eventos: [],
    clientes: [
      {
        id: 1,
        nombre: 'Clínica Ñuñoa',
        empresa: 'Bio',
        email: 'ana@correo.cl',
        telefono: '+56911111111',
        ubicacion: 'Ñuñoa',
        rut: '22.067.192-5',
        direccion: 'Av. Irarrázaval 1',
        comuna: 'Ñuñoa',
        ciudad: 'Santiago',
        contacto: 'José Pérez',
        actualizado_en: stamp
      }
    ]
  };
  fs.writeFileSync(path.join(dir, 'store.json'), JSON.stringify(store));

  const dbUrl = pathToFileURL(path.resolve('src/db.js')).href;
  const textoUrl = pathToFileURL(path.resolve('src/services/textoCliente.js')).href;
  const script = `
    const pool = (await import(${JSON.stringify(dbUrl)})).default;
    const { textoCliente } = await import(${JSON.stringify(textoUrl)});
    const found = await pool.query('SELECT id, nombre, empresa, ubicacion, direccion, comuna, ciudad, contacto FROM clientes');
    for (const row of found.rows) {
      const next = {
        nombre: textoCliente(row.nombre),
        empresa: textoCliente(row.empresa),
        ubicacion: textoCliente(row.ubicacion),
        direccion: textoCliente(row.direccion),
        comuna: textoCliente(row.comuna),
        ciudad: textoCliente(row.ciudad),
        contacto: textoCliente(row.contacto)
      };
      await pool.query(
        'UPDATE clientes SET nombre = $2, empresa = $3, ubicacion = $4, direccion = $5, comuna = $6, ciudad = $7, contacto = $8 WHERE id = $1 AND nombre IS NOT DISTINCT FROM $9',
        [row.id, next.nombre, next.empresa, next.ubicacion, next.direccion, next.comuna, next.ciudad, next.contacto, row.nombre]
      );
      if (next.nombre && next.nombre !== row.nombre) {
        const equipos = await pool.query('SELECT id, cliente_id, cliente FROM equipos WHERE cliente_id = $1', [row.id]);
        for (const equipo of equipos.rows) {
          if (textoCliente(equipo.cliente) !== next.nombre || equipo.cliente === next.nombre) continue;
          await pool.query('UPDATE equipos SET cliente = $2 WHERE id = $1 AND cliente = $3', [equipo.id, next.nombre, equipo.cliente]);
        }
      }
    }
    const listed = await pool.query('SELECT * FROM clientes ORDER BY actualizado_en DESC LIMIT $1 OFFSET $2', [50, 0]);
    const equipos = await pool.query('SELECT id, cliente_id, cliente FROM equipos WHERE cliente_id = $1', [1]);
    console.log(JSON.stringify({
      cliente: listed.rows[0],
      equipos: equipos.rows
    }));
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
  const c = result.cliente;
  assert.equal(c.nombre, 'CLINICA NUNOA');
  assert.equal(c.empresa, 'BIO');
  assert.equal(c.ubicacion, 'NUNOA');
  assert.equal(c.direccion, 'AV. IRARRAZAVAL 1');
  assert.equal(c.comuna, 'NUNOA');
  assert.equal(c.ciudad, 'SANTIAGO');
  assert.equal(c.contacto, 'JOSE PEREZ');
  assert.equal(c.email, 'ana@correo.cl');
  assert.equal(c.telefono, '+56911111111');
  assert.equal(c.rut, '22.067.192-5');
  assert.equal(c.actualizado_en, stamp);
  const byId = Object.fromEntries(result.equipos.map((e) => [e.id, e]));
  assert.equal(byId[1].cliente, 'CLINICA NUNOA');
  assert.equal(byId[2].cliente, 'Sede especial');

  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'store.json'), 'utf8'));
  assert.equal(saved.usuarios[0].nombre, 'Alexis');
  assert.equal(saved.equipos[0].nombre, 'Monitor X');
  assert.equal(saved.equipos[0].ubicacion, 'Piso 2');
  assert.equal(saved.mantenciones_fichas[0].senores, 'Clínica Ñuñoa');
  assert.equal(saved.mantenciones_fichas[0].rut_cliente, '762955105');
});
