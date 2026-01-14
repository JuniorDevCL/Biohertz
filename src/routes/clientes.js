import { Router } from 'express';
import pool from '../db.js';
import authRequired from '../middleware/authRequired.js';

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
      ALTER TABLE clientes ADD COLUMN IF NOT EXISTS ubicacion VARCHAR(200);
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
    res.render('clientes', {
      clientes: r.rows,
      query: q || '',
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
    // res.status(201).json(ins.rows[0]);
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
    // Evitar conflicto con 'count' si express no lo maneja bien (aunque el orden importa)
    if (id === 'count') return; 
    
    const [clientRes, equiposRes] = await Promise.all([
      pool.query('SELECT * FROM clientes WHERE id = $1', [id]),
      pool.query('SELECT * FROM equipos WHERE cliente_id = $1 ORDER BY actualizado_en DESC', [id])
    ]);
    
    if (clientRes.rows.length === 0) return res.status(404).json({ error: 'Cliente no encontrado' });
    
    res.render('cliente_detalle', {
      cliente: clientRes.rows[0],
      equipos: equiposRes.rows,
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
    res.json({ message: 'Cliente eliminado', deleted: d.rows[0] });
  } catch (err) {
    console.error('Error al eliminar cliente:', err);
    res.status(500).json({ error: 'Error al eliminar cliente: ' + err.message });
  }
});

export default router;
