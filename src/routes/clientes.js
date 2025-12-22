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
  } catch {}
  ready = true;
}

router.get('/', authRequired, async (req, res) => {
  try {
    await ensureSchema();
    const { q, limit: limitStr, offset: offsetStr } = req.query;
    const where = [];
    const values = [];
    if (q) { values.push(`%${q}%`); where.push(`(nombre ILIKE $${values.length} OR empresa ILIKE $${values.length})`); }
    let limit = parseInt(limitStr); if (isNaN(limit) || limit <= 0) limit = 50; if (limit > 100) limit = 100;
    let offset = parseInt(offsetStr); if (isNaN(offset) || offset < 0) offset = 0;
    const sql = `SELECT * FROM clientes${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY actualizado_en DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`;
    const r = await pool.query(sql, [...values, limit, offset]);
    res.json(r.rows);
  } catch (err) {
    console.error('Error al listar clientes:', err);
    res.status(500).json({ error: 'Error al listar clientes' });
  }
});

router.post('/', authRequired, async (req, res) => {
  try {
    await ensureSchema();
    const { nombre, empresa } = req.body;
    console.log('Crear cliente request:', { nombre, empresa });
    const ins = await pool.query(`
      INSERT INTO clientes (nombre, empresa, creado_en, actualizado_en)
      VALUES ($1, $2, NOW(), NOW()) RETURNING *
    `, [nombre || null, empresa || null]);
    console.log('Cliente creado:', ins.rows[0]);
    res.status(201).json(ins.rows[0]);
  } catch (err) {
    console.error('Error al crear cliente:', err);
    res.status(500).json({ error: 'Error al crear cliente' });
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

export default router;