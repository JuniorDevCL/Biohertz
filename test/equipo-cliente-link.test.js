import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';

function runLink(store, calls) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eq-link-'));
  fs.writeFileSync(path.join(dir, 'store.json'), JSON.stringify(store));
  const serviceUrl = pathToFileURL(path.resolve('src/services/garantiaEquipo.js')).href;
  const script = `
    const { upsertEquipoFromCliente, EquipoLinkError } = await import(${JSON.stringify(serviceUrl)});
    const calls = ${JSON.stringify(calls)};
    const results = [];
    for (const call of calls) {
      try {
        const equipo = await upsertEquipoFromCliente(call);
        results.push({ ok: true, id: equipo && equipo.id, cliente_id: equipo && equipo.cliente_id, numero_serie: equipo && equipo.numero_serie });
      } catch (err) {
        results.push({ ok: false, code: err instanceof EquipoLinkError ? err.code : 'OTHER', message: err.message });
      }
    }
    const saved = JSON.parse(await import('fs').then(m => m.readFileSync('store.json', 'utf8')));
    console.log(JSON.stringify({
      results,
      equipos: saved.equipos.map(e => ({ id: e.id, cliente_id: e.cliente_id, numero_serie: e.numero_serie }))
    }));
  `;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
      cwd: dir,
      env: { ...process.env, DATABASE_URL: '', OFFLINE: 'true' }
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(err || out));
        return;
      }
      try {
        resolve(JSON.parse(out.trim()));
      } catch (e) {
        reject(new Error((err || out) + '\n' + e.message));
      }
    });
  });
}

const baseStore = () => ({
  seq: { usuarios: 1, tickets: 1, comentarios: 1, equipos: 3, clientes: 3, mantenciones_fichas: 1, eventos: 1 },
  usuarios: [],
  tickets: [],
  comentarios: [],
  mantenciones_fichas: [],
  eventos: [],
  clientes: [
    { id: 1, nombre: 'Hospital A' },
    { id: 2, nombre: 'Hospital B' }
  ],
  equipos: [
    { id: 1, nombre: 'Eco A', marca: 'ALPINION', modelo: 'E-CUBE', numero_serie: 'SN-100', cliente_id: 1, cliente: 'Hospital A', mp_garantia_fechas: ['2026-11-01'] },
    { id: 2, nombre: 'Stock', marca: 'GE', modelo: 'Voluson', numero_serie: 'SN-STOCK', cliente_id: null, cliente: null, mp_garantia_fechas: [] }
  ]
});

test('guardar un cliente no reasigna el equipo de otro cliente', async () => {
  const result = await runLink(baseStore(), [
    { clienteId: 2, clienteNombre: 'Hospital B', serie: 'sn-100', marca: 'ALPINION', modelo: 'E-CUBE' }
  ]);
  assert.equal(result.results[0].ok, false);
  assert.equal(result.results[0].code, 'EQUIPO_CLIENTE_CONFLICT');
  assert.equal(result.equipos.find((e) => e.id === 1).cliente_id, 1);
  assert.equal(result.equipos.find((e) => e.id === 1).numero_serie, 'SN-100');
  assert.equal(result.equipos.length, 2);
});

test('corregir la serie actualiza el equipo del cliente y no crea otro', async () => {
  const result = await runLink(baseStore(), [
    { clienteId: 1, clienteNombre: 'Hospital A', serie: 'SN-100-B', marca: 'ALPINION', modelo: 'E-CUBE', equipoId: 1 }
  ]);
  assert.equal(result.results[0].ok, true);
  assert.equal(result.results[0].id, 1);
  assert.equal(result.equipos.length, 2);
  assert.equal(result.equipos.find((e) => e.id === 1).numero_serie, 'SN-100-B');
  assert.equal(result.equipos.find((e) => e.id === 1).cliente_id, 1);
  assert.equal(result.equipos.find((e) => e.id === 2).numero_serie, 'SN-STOCK');
});

test('una serie en stock se asigna al cliente nuevo', async () => {
  const result = await runLink(baseStore(), [
    { clienteId: 2, clienteNombre: 'Hospital B', serie: 'SN-STOCK', marca: 'GE', modelo: 'Voluson' }
  ]);
  assert.equal(result.results[0].ok, true);
  assert.equal(result.results[0].id, 2);
  assert.equal(result.equipos.find((e) => e.id === 2).cliente_id, 2);
  assert.equal(result.equipos.find((e) => e.id === 1).cliente_id, 1);
});

test('no se puede pisar la serie de otro equipo al corregir', async () => {
  const result = await runLink(baseStore(), [
    { clienteId: 1, clienteNombre: 'Hospital A', serie: 'SN-STOCK', equipoId: 1 }
  ]);
  assert.equal(result.results[0].ok, false);
  assert.equal(result.results[0].code, 'EQUIPO_CLIENTE_CONFLICT');
  assert.equal(result.equipos.find((e) => e.id === 1).numero_serie, 'SN-100');
  assert.equal(result.equipos.find((e) => e.id === 2).cliente_id, null);
});
