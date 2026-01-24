import { Router } from 'express';
import pool from '../db.js';
import authRequired from '../middleware/authRequired.js';
import { clearEquiposClientsCache } from './equipos.js';

const router = Router();

let ready = false;
async function ensureSchema() {
  if (ready) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS clientes (
        id SERIAL PRIMARY KEY,
        nombre VARCHAR(150),
        empresa VARCHAR(150),
        creado_en TIMESTAMP DEFAULT NOW(),
        actualizado_en TIMESTAMP DEFAULT NOW()
      );
    `);
    await pool.query(`
      ALTER TABLE equipos ADD COLUMN IF NOT EXISTS cliente_id INTEGER;
    `);
    await pool.query(`
      ALTER TABLE clientes ADD COLUMN IF NOT EXISTS email VARCHAR(150);
      ALTER TABLE clientes ADD COLUMN IF NOT EXISTS telefono VARCHAR(50);
await pool.query(`
      ALTER TABLE clientes ADD COLUMN IF NOT EXISTS ubicacion VARCHAR(200);
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS contactos_cliente (
        id SERIAL PRIMARY KEY,
        cliente_id INTEGER REFERENCES clientes(id) ON DELETE CASCADE,
        nombre VARCHAR(150) NOT NULL,
        cargo VARCHAR(100),
        email VARCHAR(150),
        telefono VARCHAR(50),
        creado_en TIMESTAMP DEFAULT NOW()
      );
    `);
  } catch (err) {
    console.error('Error al actualizar esquema de clientes:', err);
  }
  ready = true;
}

router.get('/', authRequired, async (req, res) => {
  try {
    await ensureSchema();
    const { q, limit: limitStr, offset: offsetStr } = req.query;
    const where = [];
    const values = [];
    if (q) { values.push(`%${q}%`); where.push(`(nombre ILIKE $${values.length} OR empresa ILIKE $${values.length} OR email ILIKE $${values.length})`); }
    let limit = parseInt(limitStr); if (isNaN(limit) || limit <= 0) limit = 50; if (limit > 100) limit = 100;
    let offset = parseInt(offsetStr); if (isNaN(offset) || offset < 0) offset = 0;
    const sql = `SELECT * FROM clientes${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY actualizado_en DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`;
    const r = await pool.query(sql, [...values, limit, offset]);

    const clientesCountResult = await pool.query('SELECT COUNT(*) FROM clientes');
    const totalClientes = Number(clientesCountResult.rows[0].count) || 0;

    if (req.accepts('json') && !req.accepts('html')) {
      return res.json({
        clientes: r.rows,
        total: totalClientes,
        limit,
        offset
      });
    }

    res.render('clientes', {
      clientes: r.rows,
      query: q || '',
      totalClientes,
      title: 'Clientes - BIOHERTS',
      user: req.user || req.session.user || { nombre: 'Usuario' }
    });
  } catch (err) {
    console.error('Error al listar clientes:', err);
    res.status(500).json({ error: 'Error al listar clientes' });
  }
});

router.post('/', authRequired, async (req, res) => {
  try {
    await ensureSchema();
    const { nombre, empresa, email, telefono, ubicacion } = req.body;
    console.log('Crear cliente request:', { nombre, empresa });
    const ins = await pool.query(`
      INSERT INTO clientes (nombre, empresa, email, telefono, ubicacion, creado_en, actualizado_en)
      VALUES ($1, $2, $3, $4, $5, NOW(), NOW()) RETURNING *
    `, [nombre || null, empresa || null, email || null, telefono || null, ubicacion || null]);
    console.log('Cliente creado:', ins.rows[0]);
    clearEquiposClientsCache();
    
    if (req.accepts('json') && !req.accepts('html')) {
      return res.status(201).json(ins.rows[0]);
    }

    res.redirect('/clientes');
  } catch (err) {
    console.error('Error al crear cliente:', err);
    res.status(500).json({ error: 'Error al crear cliente: ' + err.message });
  }
});

router.get('/count', authRequired, async (req, res) => {
  try {
    await ensureSchema();
    const { q } = req.query;
    const where = [];
    const values = [];
    if (q) { values.push(`%${q}%`); where.push(`(nombre ILIKE $${values.length} OR empresa ILIKE $${values.length})`); }
    const sql = `SELECT COUNT(*) FROM clientes${where.length ? ' WHERE ' + where.join(' AND ') : ''}`;
    const result = await pool.query(sql, values);
    res.json({ total: Number(result.rows[0].count) });
  } catch (err) {
    console.error('Error en /clientes/count:', err);
    res.status(500).json({ error: 'Error al contar clientes' });
  }
});

router.get('/:id', authRequired, async (req, res) => {
  try {
    await ensureSchema();
    const { id } = req.params;
    if (id === 'count') return;

    const [clientRes, equiposRes, ticketsRes] = await Promise.all([
      pool.query('SELECT * FROM clientes WHERE id = $1', [id]),
      pool.query('SELECT * FROM equipos WHERE cliente_id = $1 ORDER BY actualizado_en DESC', [id]),
      pool.query(
        `SELECT t.*, u.nombre AS asignado_a_nombre
         FROM tickets t
         LEFT JOIN usuarios u ON u.id = t.asignado_a
         LEFT JOIN equipos e ON e.id = t.equipo_id
         ORDER BY t.creado_en DESC`
      )
    ]);

    console.log(`[DEBUG] Cliente ${id} tickets found: ${ticketsRes.rowCount}`);
    if (ticketsRes.rowCount > 0) {
        console.log(`[DEBUG] Sample ticket: ID=${ticketsRes.rows[0].id}, ClientID=${ticketsRes.rows[0].cliente_id}`);
    }

    if (clientRes.rows.length === 0) return res.status(404).json({ error: 'Cliente no encontrado' });

    if (req.accepts('json') && !req.accepts('html')) {
      return res.json({
        cliente: clientRes.rows[0],
        equipos: equiposRes.rows,
        tickets: ticketsRes.rows
      });
    }

    res.render('cliente_detalle', {
      cliente: clientRes.rows[0],
      equipos: equiposRes.rows,
      tickets: ticketsRes.rows,
      title: `${clientRes.rows[0].nombre} - Detalle Cliente`,
      user: req.user || req.session.user || { nombre: 'Usuario' }
    });
  } catch (err) {
    console.error('Error al obtener cliente:', err);
    res.status(500).render('error', { error: 'Error al obtener cliente' });
  }
});

router.get('/:id/equipos', authRequired, async (req, res) => {
  try {
    await ensureSchema();
    const { id } = req.params;
    const r = await pool.query(`SELECT * FROM equipos WHERE cliente_id = $1 ORDER BY actualizado_en DESC`, [id]);
    res.json(r.rows);
  } catch (err) {
    console.error('Error al listar equipos del cliente:', err);
    res.status(500).json({ error: 'Error al listar equipos del cliente' });
  }
});

router.patch('/:id', authRequired, async (req, res) => {
  try {
    await ensureSchema();
    const { id } = req.params;
    const { nombre, empresa, email, telefono, ubicacion } = req.body;
    const u = await pool.query(`
      UPDATE clientes 
      SET nombre = COALESCE($1, nombre), 
          empresa = COALESCE($2, empresa),
          email = COALESCE($3, email),
          telefono = COALESCE($4, telefono),
          ubicacion = COALESCE($5, ubicacion),
          actualizado_en = NOW()
      WHERE id = $6 RETURNING *
    `, [nombre, empresa, email, telefono, ubicacion, id]);
    if (u.rows.length === 0) return res.status(404).json({ error: 'Cliente no encontrado' });
    clearEquiposClientsCache();
    res.json(u.rows[0]);
  } catch (err) {
    console.error('Error al actualizar cliente:', err);
    res.status(500).json({ error: 'Error al actualizar cliente' });
  }
});

router.delete('/:id', authRequired, async (req, res) => {
  try {
    await ensureSchema();
    const { id } = req.params;
    console.log(`[DELETE] Request para eliminar cliente ID: '${id}' (Tipo: ${typeof id})`);
    
    // Check existence first
    const check = await pool.query('SELECT * FROM clientes WHERE id = $1', [id]);
    if (check.rows.length === 0) {
        console.log(`[DELETE] Cliente ID ${id} no encontrado en la base de datos.`);
        return res.status(404).json({ error: `Cliente con ID ${id} no encontrado` });
    }
    console.log(`[DELETE] Cliente encontrado:`, check.rows[0]);

    await pool.query('UPDATE equipos SET cliente_id = NULL WHERE cliente_id = $1', [id]);
    const d = await pool.query('DELETE FROM clientes WHERE id = $1 RETURNING *', [id]);
    
    if (d.rows.length === 0) {
        // Should not happen if check passed, unless concurrent delete
        return res.status(404).json({ error: 'Cliente no encontrado al intentar eliminar' });
    }
    console.log(`[DELETE] Cliente eliminado exitosamente.`);
    clearEquiposClientsCache();
    res.json({ message: 'Cliente eliminado', deleted: d.rows[0] });
  } catch (err) {
    console.error('Error al eliminar cliente:', err);
    res.status(500).json({ error: 'Error al eliminar cliente: ' + err.message });
  }
});

// Contactos Routes
router.get('/:id/contactos', authRequired, async (req, res) => {
  try {
    await ensureSchema();
    const { id } = req.params;
    const r = await pool.query('SELECT * FROM contactos_cliente WHERE cliente_id = $1 ORDER BY nombre', [id]);
    res.json(r.rows);
  } catch (err) {
    console.error('Error al listar contactos:', err);
    res.status(500).json({ error: 'Error al listar contactos' });
  }
});

router.post('/:id/contactos', authRequired, async (req, res) => {
  try {
    await ensureSchema();
    const { id } = req.params;
    const { nombre, cargo, email, telefono } = req.body;
    
    if (!nombre) return res.status(400).json({ error: 'El nombre es obligatorio' });

    const r = await pool.query(`
      INSERT INTO contactos_cliente (cliente_id, nombre, cargo, email, telefono)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `, [id, nombre, cargo || null, email || null, telefono || null]);
    
    res.status(201).json(r.rows[0]);
  } catch (err) {
    console.error('Error al crear contacto:', err);
    res.status(500).json({ error: 'Error al crear contacto' });
  }
});

router.delete('/:id/contactos/:contactoId', authRequired, async (req, res) => {
  try {
    await ensureSchema();
    const { id, contactoId } = req.params;
    const r = await pool.query('DELETE FROM contactos_cliente WHERE id = $1 AND cliente_id = $2 RETURNING *', [contactoId, id]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Contacto no encontrado' });
    res.json({ message: 'Contacto eliminado', deleted: r.rows[0] });
  } catch (err) {
    console.error('Error al eliminar contacto:', err);
    res.status(500).json({ error: 'Error al eliminar contacto' });
  }
});

export default router;
