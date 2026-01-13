import { Router } from 'express';
import pool from '../db.js';
import authRequired from '../middleware/authRequired.js';

const router = Router();

let extendedReady = false;
async function ensureExtendedSchema() {
  if (extendedReady) return;
  try {
    await pool.query(`
      ALTER TABLE equipos ADD COLUMN IF NOT EXISTS aplicacion VARCHAR(150);
      ALTER TABLE equipos ADD COLUMN IF NOT EXISTS cliente VARCHAR(150);
      ALTER TABLE equipos ADD COLUMN IF NOT EXISTS anio_venta INTEGER;
      ALTER TABLE equipos ADD COLUMN IF NOT EXISTS cliente_id INTEGER;
      ALTER TABLE equipos ADD COLUMN IF NOT EXISTS mantenciones JSONB DEFAULT '[]'::jsonb;
    `);
  } catch {}
  extendedReady = true;
}

router.get('/', authRequired, async (req, res) => {
  try {
    await ensureExtendedSchema();
    const { q, estado, limit: limitStr, offset: offsetStr, marca, aplicacion, modelo, anio_venta, serie, cliente } = req.query;
    const where = [];
    const values = [];
    if (estado) {
      values.push(estado);
      where.push(`estado = $${values.length}`);
    }
    if (q) {
      values.push(`%${q}%`);
      where.push(`(nombre ILIKE $${values.length} OR marca ILIKE $${values.length} OR modelo ILIKE $${values.length} OR numero_serie ILIKE $${values.length} OR ubicacion ILIKE $${values.length})`);
    }
    if (marca) { values.push(`%${marca}%`); where.push(`marca ILIKE $${values.length}`); }
    if (aplicacion) { values.push(`%${aplicacion}%`); where.push(`aplicacion ILIKE $${values.length}`); }
    if (modelo) { values.push(`%${modelo}%`); where.push(`modelo ILIKE $${values.length}`); }
    if (anio_venta) { values.push(parseInt(anio_venta)); where.push(`anio_venta = $${values.length}`); }
    if (serie) { values.push(`%${serie}%`); where.push(`numero_serie ILIKE $${values.length}`); }
    if (cliente) { values.push(`%${cliente}%`); where.push(`cliente ILIKE $${values.length}`); }
    let limit = parseInt(limitStr);
    let offset = parseInt(offsetStr);
    if (isNaN(limit) || limit <= 0) limit = 50;
    if (limit > 100) limit = 100;
    if (isNaN(offset) || offset < 0) offset = 0;

    const sql = `SELECT * FROM equipos${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY actualizado_en DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`;
    const result = await pool.query(sql, [...values, limit, offset]);
    res.render('equipos', {
      equipos: result.rows,
      title: 'Equipos - BIOHERTS',
      user: req.user || req.session.user || { nombre: 'Usuario' }
    });
  } catch (err) {
    console.error('Error al listar equipos:', err);
    res.status(500).json({ error: 'Error al listar equipos' });
  }
});

router.get('/count', authRequired, async (req, res) => {
  try {
    await ensureExtendedSchema();
    const { q, estado, marca, aplicacion, modelo, anio_venta, serie, cliente } = req.query;
    const where = [];
    const values = [];
    if (estado) { values.push(estado); where.push(`estado = $${values.length}`); }
    if (q) { values.push(`%${q}%`); where.push(`(nombre ILIKE $${values.length} OR marca ILIKE $${values.length} OR modelo ILIKE $${values.length} OR numero_serie ILIKE $${values.length} OR ubicacion ILIKE $${values.length})`); }
    if (marca) { values.push(`%${marca}%`); where.push(`marca ILIKE $${values.length}`); }
    if (aplicacion) { values.push(`%${aplicacion}%`); where.push(`aplicacion ILIKE $${values.length}`); }
    if (modelo) { values.push(`%${modelo}%`); where.push(`modelo ILIKE $${values.length}`); }
    if (anio_venta) { values.push(parseInt(anio_venta)); where.push(`anio_venta = $${values.length}`); }
    if (serie) { values.push(`%${serie}%`); where.push(`numero_serie ILIKE $${values.length}`); }
    if (cliente) { values.push(`%${cliente}%`); where.push(`cliente ILIKE $${values.length}`); }
    const sql = `SELECT COUNT(*) FROM equipos${where.length ? ' WHERE ' + where.join(' AND ') : ''}`;
    const result = await pool.query(sql, values);
    res.json({ total: Number(result.rows[0].count) });
  } catch (err) {
    console.error('Error en /equipos/count:', err);
    res.status(500).json({ error: 'Error al contar equipos' });
  }
});

router.get('/:id', authRequired, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(`SELECT * FROM equipos WHERE id = $1`, [id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Equipo no encontrado' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error al obtener equipo:', err);
    res.status(500).json({ error: 'Error al obtener equipo' });
  }
});

router.post('/', authRequired, async (req, res) => {
  try {
    await ensureExtendedSchema();
    const { nombre, marca, modelo, numero_serie, ubicacion, estado, aplicacion, cliente, cliente_id, anio_venta, mantenciones } = req.body;
    if (!nombre) return res.status(400).json({ error: 'Nombre es obligatorio' });
    // if (!cliente_id) return res.status(400).json({ error: 'Debe seleccionar un cliente' }); // Permitir STOCK (null)

    let finalClienteName = cliente;
    let finalClienteId = (cliente_id && cliente_id !== 'STOCK') ? parseInt(cliente_id) : null;

    if (!finalClienteName && finalClienteId) {
      try {
        const cRes = await pool.query('SELECT * FROM clientes WHERE id = $1', [finalClienteId]);
        if (cRes.rowCount > 0) {
          finalClienteName = cRes.rows[0].nombre;
        }
      } catch (e) {
        console.warn('Could not fetch client name for equipment creation', e);
      }
    }

    const insert = await pool.query(
      `INSERT INTO equipos (nombre, marca, modelo, numero_serie, ubicacion, estado, aplicacion, cliente, cliente_id, anio_venta, mantenciones, creado_en, actualizado_en)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, COALESCE($11::jsonb, '[]'::jsonb), NOW(), NOW())
       RETURNING *`,
      [nombre, marca || null, modelo || null, numero_serie || null, ubicacion || null, estado || 'activo', aplicacion || null, finalClienteName || null, finalClienteId, anio_venta ? parseInt(anio_venta) : null, mantenciones ? JSON.stringify(mantenciones) : null]
    );

    // res.status(201).json({ mensaje: 'Equipo creado', equipo: insert.rows[0] });

    const io = req.app.get('io');
    io?.emit('equipo:created', insert.rows[0]);

    res.redirect('/equipos');
  } catch (err) {
    console.error('Error al crear equipo:', err);
    res.status(500).json({ error: 'Error al crear equipo' });
  }
});

router.patch('/:id', authRequired, async (req, res) => {
  try {
    const { id } = req.params;
    await ensureExtendedSchema();
    const { nombre, marca, modelo, numero_serie, ubicacion, estado, aplicacion, cliente, cliente_id, anio_venta, mantenciones } = req.body;

    let finalClienteName = cliente;
    let finalClienteId = cliente_id;

    // If updating client_id but not client name, try to fetch name
    if (cliente_id !== undefined && cliente === undefined) {
       const cid = (cliente_id && cliente_id !== 'STOCK') ? parseInt(cliente_id) : null;
       if (cid) {
          try {
             const cRes = await pool.query('SELECT nombre FROM clientes WHERE id = $1', [cid]);
             if (cRes.rowCount > 0) {
                finalClienteName = cRes.rows[0].nombre;
             }
          } catch (e) { console.warn('Error fetching client name in patch', e); }
       } else if (cliente_id === null || cliente_id === 'STOCK') {
           // If clearing client, clear name too if not provided
           finalClienteName = null;
       }
    }

    const update = await pool.query(
      `UPDATE equipos
       SET nombre = COALESCE($1, nombre),
           marca = COALESCE($2, marca),
           modelo = COALESCE($3, modelo),
           numero_serie = COALESCE($4, numero_serie),
           ubicacion = COALESCE($5, ubicacion),
           estado = COALESCE($6, estado),
           aplicacion = COALESCE($7, aplicacion),
           cliente = COALESCE($8, cliente),
           cliente_id = COALESCE($9, cliente_id),
           anio_venta = COALESCE($10, anio_venta),
           mantenciones = COALESCE($11::jsonb, mantenciones),
           actualizado_en = NOW()
       WHERE id = $12
       RETURNING *`,
      [nombre, marca, modelo, numero_serie, ubicacion, estado, aplicacion, finalClienteName, (finalClienteId && finalClienteId !== 'STOCK') ? parseInt(finalClienteId) : (finalClienteId === null || finalClienteId === 'STOCK' ? null : undefined), anio_venta ? parseInt(anio_venta) : null, mantenciones ? JSON.stringify(mantenciones) : null, id]
    );

    if (update.rowCount === 0) return res.status(404).json({ error: 'Equipo no encontrado' });

    res.json({ mensaje: 'Equipo actualizado', equipo: update.rows[0] });

    const io = req.app.get('io');
    io?.emit('equipo:updated', update.rows[0]);
  } catch (err) {
    console.error('Error al actualizar equipo:', err);
    res.status(500).json({ error: 'Error al actualizar equipo' });
  }
});

router.delete('/:id', authRequired, async (req, res) => {
  try {
    if (req.user?.rol !== 'admin') {
      return res.status(403).json({ error: 'Solo admin puede eliminar equipos' });
    }
    const { id } = req.params;
    const del = await pool.query(`DELETE FROM equipos WHERE id = $1`, [id]);
    if (del.rowCount === 0) return res.status(404).json({ error: 'Equipo no encontrado' });

    res.json({ mensaje: 'Equipo eliminado' });

    const io = req.app.get('io');
    io?.emit('equipo:deleted', { id });
  } catch (err) {
    console.error('Error al eliminar equipo:', err);
    res.status(500).json({ error: 'Error al eliminar equipo' });
  }
});

// Mantenciones
router.get('/:id/mantenciones', authRequired, async (req, res) => {
  try {
    await ensureExtendedSchema();
    const { id } = req.params;
    const r = await pool.query('SELECT mantenciones FROM equipos WHERE id = $1', [id]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'Equipo no encontrado' });
    res.json(r.rows[0].mantenciones || []);
  } catch (err) {
    console.error('Error al listar mantenciones:', err);
    res.status(500).json({ error: 'Error al listar mantenciones' });
  }
});

router.post('/:id/mantenciones', authRequired, async (req, res) => {
  try {
    await ensureExtendedSchema();
    const { id } = req.params;
    const { fecha, trabajo, nota } = req.body;
    const r = await pool.query('SELECT mantenciones FROM equipos WHERE id = $1', [id]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'Equipo no encontrado' });
    const list = Array.isArray(r.rows[0].mantenciones) ? r.rows[0].mantenciones : [];
    const entry = { id: Date.now(), fecha: fecha || null, trabajo: trabajo || '', nota: nota || '' };
    const next = [...list, entry];
    const u = await pool.query('UPDATE equipos SET mantenciones = $1::jsonb, actualizado_en = NOW() WHERE id = $2 RETURNING mantenciones', [JSON.stringify(next), id]);
    res.status(201).json(u.rows[0].mantenciones);
  } catch (err) {
    console.error('Error al agregar mantención:', err);
    res.status(500).json({ error: 'Error al agregar mantención' });
  }
});

router.patch('/:id/mantenciones/:mid', authRequired, async (req, res) => {
  try {
    await ensureExtendedSchema();
    const { id, mid } = req.params;
    const { fecha, trabajo, nota } = req.body;
    const r = await pool.query('SELECT mantenciones FROM equipos WHERE id = $1', [id]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'Equipo no encontrado' });
    const list = Array.isArray(r.rows[0].mantenciones) ? r.rows[0].mantenciones : [];
    const next = list.map(m => (String(m.id) === String(mid) ? { ...m, fecha: fecha ?? m.fecha, trabajo: trabajo ?? m.trabajo, nota: nota ?? m.nota } : m));
    const u = await pool.query('UPDATE equipos SET mantenciones = $1::jsonb, actualizado_en = NOW() WHERE id = $2 RETURNING mantenciones', [JSON.stringify(next), id]);
    res.json(u.rows[0].mantenciones);
  } catch (err) {
    console.error('Error al editar mantención:', err);
    res.status(500).json({ error: 'Error al editar mantención' });
  }
});

router.delete('/:id/mantenciones/:mid', authRequired, async (req, res) => {
  try {
    await ensureExtendedSchema();
    const { id, mid } = req.params;
    const r = await pool.query('SELECT mantenciones FROM equipos WHERE id = $1', [id]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'Equipo no encontrado' });
    const list = Array.isArray(r.rows[0].mantenciones) ? r.rows[0].mantenciones : [];
    const next = list.filter(m => String(m.id) !== String(mid));
    const u = await pool.query('UPDATE equipos SET mantenciones = $1::jsonb, actualizado_en = NOW() WHERE id = $2 RETURNING mantenciones', [JSON.stringify(next), id]);
    res.json(u.rows[0].mantenciones);
  } catch (err) {
    console.error('Error al eliminar mantención:', err);
    res.status(500).json({ error: 'Error al eliminar mantención' });
  }
});

export default router;
