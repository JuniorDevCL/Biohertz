import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

test('guardar el equipo con cliente vacío lo saca de ese cliente', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'equipo-cliente-'));
  const previous = process.cwd();
  process.chdir(dir);
  try {
    const { default: pool } = await import('../src/db.js');
    const inserted = await pool.query(
      `INSERT INTO equipos (nombre, marca, modelo, numero_serie, numero_orden, fecha_embarque, fecha_ingreso, ubicacion, estado, aplicacion, cliente, cliente_id, anio_venta, fecha_instalacion, plazo_garantia_meses, fecha_vencimiento_garantia, mp_garantia_fechas, mantenciones, creado_en, actualizado_en)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17::jsonb, $18::jsonb, NOW(), NOW())
       RETURNING *`,
      ['Monitor', 'GE', 'X1', 'SN-1', null, null, null, 'Box', 'operativo', null, 'CLINICA SUR', 7, null, null, null, null, '[]', '[]']
    );
    const id = inserted.rows[0].id;
    assert.equal(inserted.rows[0].cliente_id, 7);

    const kept = await pool.query(
      `UPDATE equipos
       SET nombre = COALESCE($1, nombre),
           cliente = CASE WHEN $20::boolean THEN $11 ELSE cliente END,
           cliente_id = CASE WHEN $20::boolean THEN $12::integer ELSE cliente_id END,
           actualizado_en = NOW()
       WHERE id = $19
       RETURNING *`,
      ['Monitor nuevo', null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, id, false]
    );
    assert.equal(kept.rows[0].cliente_id, 7);
    assert.equal(kept.rows[0].cliente, 'CLINICA SUR');
    assert.equal(kept.rows[0].nombre, 'Monitor nuevo');

    const updated = await pool.query(
      `UPDATE equipos
       SET nombre = COALESCE($1, nombre),
           marca = COALESCE($2, marca),
           modelo = COALESCE($3, modelo),
           numero_serie = COALESCE($4, numero_serie),
           numero_orden = COALESCE($5, numero_orden),
           fecha_embarque = COALESCE($6, fecha_embarque),
           fecha_ingreso = COALESCE($7, fecha_ingreso),
           ubicacion = COALESCE($8, ubicacion),
           estado = COALESCE($9, estado),
           aplicacion = COALESCE($10, aplicacion),
           cliente = CASE WHEN $20::boolean THEN $11 ELSE cliente END,
           cliente_id = CASE WHEN $20::boolean THEN $12::integer ELSE cliente_id END,
           anio_venta = COALESCE($13, anio_venta),
           fecha_instalacion = COALESCE($14, fecha_instalacion),
           plazo_garantia_meses = COALESCE($15, plazo_garantia_meses),
           fecha_vencimiento_garantia = COALESCE($16, fecha_vencimiento_garantia),
           mp_garantia_fechas = COALESCE($17::jsonb, mp_garantia_fechas),
           mantenciones = COALESCE($18::jsonb, mantenciones),
           actualizado_en = NOW()
       WHERE id = $19
       RETURNING *`,
      ['Monitor', 'GE', 'X1', 'SN-1', null, null, null, 'Box', 'operativo', null, null, null, null, null, null, null, null, null, id, true]
    );

    assert.equal(updated.rowCount, 1);
    assert.equal(updated.rows[0].cliente_id, null);
    assert.equal(updated.rows[0].cliente, null);
    assert.equal(updated.rows[0].nombre, 'Monitor');
    assert.equal(updated.rows[0].numero_serie, 'SN-1');
  } finally {
    process.chdir(previous);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
