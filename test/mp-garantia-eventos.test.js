import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

test('guardar un cliente no borra horarios de MP si las fechas no cambian', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-eventos-'));
  const store = {
    seq: { usuarios: 1, tickets: 1, comentarios: 1, equipos: 2, clientes: 2, mantenciones_fichas: 1, eventos: 2 },
    usuarios: [],
    tickets: [],
    comentarios: [],
    mantenciones_fichas: [],
    clientes: [{ id: 1, nombre: 'CLINICA' }],
    equipos: [{
      id: 1,
      nombre: 'Monitor X',
      marca: 'ACME',
      modelo: 'M1',
      numero_serie: 'SN-100',
      cliente_id: 1,
      cliente: 'CLINICA',
      mp_garantia_fechas: ['2026-11-01', '2026-12-01'],
    }],
    eventos: [{
      id: 1,
      titulo: 'Visita acordada',
      descripcion: 'Llevar repuesto',
      fecha: '2026-11-01',
      hora_inicio: '09:30',
      tipo: 'mp_garantia',
      equipo_id: 1,
      cliente_id: 1,
    }],
  };
  fs.writeFileSync(path.join(dir, 'store.json'), JSON.stringify(store));

  const serviceUrl = pathToFileURL(path.resolve('src/services/garantiaEquipo.js')).href;
  const script = `
    const fs = await import('node:fs');
    const { mpUpdateFromBody, sameMpFechas, upsertEquipoFromCliente } = await import(${JSON.stringify(serviceUrl)});
    const read = () => JSON.parse(fs.readFileSync('store.json', 'utf8'));

    if (mpUpdateFromBody({}) !== null) throw new Error('sin fechas debe ser null');
    if (mpUpdateFromBody({ numero_serie: 'SN-100', cant_mp_garantia: '' }) !== null) throw new Error('cantidad vacia no debe borrar');
    const cleared = mpUpdateFromBody({ cant_mp_garantia: '0' });
    if (!Array.isArray(cleared) || cleared.length !== 0) throw new Error('cantidad 0 debe borrar');
    if (!sameMpFechas(['2026-12-01', '2026-11-01'], ['2026-11-01', '2026-12-01'])) throw new Error('mismo conjunto');

    await upsertEquipoFromCliente({
      clienteId: 1,
      clienteNombre: 'CLINICA',
      serie: 'SN-100',
      mpFechas: null,
      userId: 1,
    });
    let snap = read();
    let ev = snap.eventos.find((e) => e.tipo === 'mp_garantia');
    if (!ev || ev.hora_inicio !== '09:30' || ev.descripcion !== 'Llevar repuesto') {
      throw new Error('un guardado sin fechas borro el evento: ' + JSON.stringify(snap.eventos));
    }
    if (snap.equipos[0].mp_garantia_fechas.join(',') !== '2026-11-01,2026-12-01') {
      throw new Error('fechas borradas: ' + JSON.stringify(snap.equipos[0].mp_garantia_fechas));
    }

    await upsertEquipoFromCliente({
      clienteId: 1,
      clienteNombre: 'CLINICA',
      serie: 'SN-100',
      mpFechas: ['2026-12-01', '2026-11-01'],
      userId: 1,
    });
    snap = read();
    ev = snap.eventos.find((e) => e.tipo === 'mp_garantia');
    if (!ev || ev.hora_inicio !== '09:30' || ev.descripcion !== 'Llevar repuesto') {
      throw new Error('reenviar las mismas fechas recreo el evento: ' + JSON.stringify(snap.eventos));
    }

    await upsertEquipoFromCliente({
      clienteId: 1,
      clienteNombre: 'CLINICA',
      serie: 'SN-100',
      mpFechas: ['2026-11-01'],
      userId: 1,
    });
    snap = read();
    const left = snap.eventos.filter((e) => e.tipo === 'mp_garantia');
    if (left.length !== 1 || left[0].fecha !== '2026-11-01' || left[0].descripcion === 'Llevar repuesto') {
      throw new Error('cambiar fechas debio reemplazar eventos: ' + JSON.stringify(left));
    }
    if (snap.equipos[0].mp_garantia_fechas.join(',') !== '2026-11-01') {
      throw new Error('fechas no actualizadas: ' + JSON.stringify(snap.equipos[0].mp_garantia_fechas));
    }
    console.log('ok');
  `;

  const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
    cwd: dir,
    env: { ...process.env, DATABASE_URL: '', OFFLINE: 'true' },
  });
  let out = '';
  let err = '';
  child.stdout.on('data', (d) => { out += d.toString(); });
  child.stderr.on('data', (d) => { err += d.toString(); });
  const code = await new Promise((resolve) => child.on('close', resolve));
  assert.equal(code, 0, err || out);
  assert.match(out, /ok/);
});
