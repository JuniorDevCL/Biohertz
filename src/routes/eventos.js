import { Router } from 'express';
import pool from '../db.js';
import authRequired from '../middleware/authRequired.js';

const router = Router();

let ready = false;
async function ensureSchema() {
  if (ready) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS eventos (
        id SERIAL PRIMARY KEY,
        titulo VARCHAR(200) NOT NULL,
        descripcion TEXT,
        fecha_inicio TIMESTAMP NOT NULL,
        fecha_fin TIMESTAMP NOT NULL,
        color VARCHAR(50) DEFAULT '#3b82f6',
        creado_por INTEGER,
        creado_en TIMESTAMP DEFAULT NOW()
      );
    `);
  } catch (err) {
    console.error('Error ensuring eventos schema:', err);
  }
  ready = true;
}

// GET /eventos?start=YYYY-MM-DD&end=YYYY-MM-DD
router.get('/', authRequired, async (req, res) => {
  try {
    await ensureSchema();
    const { start, end } = req.query;
    
    let sql = 'SELECT * FROM eventos';
    const values = [];
    const where = [];

    if (start) {
      values.push(start);
      where.push(`fecha_inicio >= $${values.length}`);
    }
    if (end) {
      values.push(end);
      where.push(`fecha_inicio <= $${values.length}`);
    }

    if (where.length > 0) {
      sql += ' WHERE ' + where.join(' AND ');
    }
    
    sql += ' ORDER BY fecha_inicio ASC';

    const r = await pool.query(sql, values);
    res.json(r.rows);
  } catch (err) {
    console.error('Error getting eventos:', err);
    res.status(500).json({ error: 'Error al obtener eventos' });
  }
});

// POST /eventos
router.post('/', authRequired, async (req, res) => {
  try {
    await ensureSchema();
    const { titulo, descripcion, fecha_inicio, fecha_fin, color } = req.body;
    
    if (!titulo || !fecha_inicio || !fecha_fin) {
      return res.status(400).json({ error: 'Faltan campos obligatorios' });
    }

    // TODO: Obtener ID de usuario si está disponible en req.user
    const creado_por = req.user ? req.user.id : null;

    const ins = await pool.query(`
      INSERT INTO eventos (titulo, descripcion, fecha_inicio, fecha_fin, color, creado_por, creado_en)
      VALUES ($1, $2, $3, $4, $5, $6, NOW())
      RETURNING *
    `, [titulo, descripcion, fecha_inicio, fecha_fin, color, creado_por]);

    const nuevoEvento = ins.rows[0];

    // Emitir evento socket
    const io = req.app.get('io');
    if (io) {
      io.emit('evento:creado', nuevoEvento);
    }

    res.status(201).json(nuevoEvento);
  } catch (err) {
    console.error('Error creating evento:', err);
    res.status(500).json({ error: 'Error al crear evento' });
  }
});

// DELETE /eventos/:id
router.delete('/:id', authRequired, async (req, res) => {
  try {
    await ensureSchema();
    const { id } = req.params;
    
    const del = await pool.query('DELETE FROM eventos WHERE id = $1 RETURNING *', [id]);
    
    if (del.rowCount === 0) {
      return res.status(404).json({ error: 'Evento no encontrado' });
    }

    // Emitir evento socket
    const io = req.app.get('io');
    if (io) {
      io.emit('evento:eliminado', id);
    }

    res.json({ message: 'Evento eliminado', id });
  } catch (err) {
    console.error('Error deleting evento:', err);
    res.status(500).json({ error: 'Error al eliminar evento' });
  }
});

export default router;
