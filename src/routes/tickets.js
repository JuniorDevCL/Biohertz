// router: tickets.js
import express from 'express';
import pool from '../db.js';
import authRequired from '../middleware/authRequired.js'; // <-- aquí usamos el mismo nombre del archivo
import nodemailer from 'nodemailer';

const transporter = (process.env.SMTP_HOST ? nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: String(process.env.SMTP_PORT || '587') === '465',
  auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined
}) : null);

async function sendAssignmentEmail(user, ticket) {
  try {
    if (!transporter || !user?.email) return;
    const from = process.env.SMTP_FROM || process.env.SMTP_USER;
    await transporter.sendMail({
      from,
      to: user.email,
      subject: `Ticket asignado: ${ticket.titulo}`,
      text: `Hola ${user.nombre},\n\nSe te asignó el ticket #${ticket.id}: "${ticket.titulo}".\nEstado: ${ticket.estado}.\nDescripción: ${ticket.descripcion || ''}.\n\nSaludos, BIOHERTS Tickets`,
    });
  } catch (e) {
    console.warn('No se pudo enviar correo:', e && e.message ? e.message : e);
  }
}

const router = express.Router();

// Crear ticket
router.post('/', authRequired, async (req, res) => {
  try {
    const { titulo, descripcion, asignado_a, equipo_id } = req.body;

    if (!titulo) {
      return res.status(400).json({ error: 'El título es obligatorio' });
    }

    const result = await pool.query(
      `INSERT INTO tickets (titulo, descripcion, creado_por, asignado_a, equipo_id, estado, creado_en, actualizado_en)
       VALUES ($1, $2, $3, $4, $5, 'pendiente', NOW(), NOW())
       RETURNING *`,
      [titulo, descripcion || null, req.user.id, asignado_a || null, equipo_id || null]
    );

    res.status(201).json({
      mensaje: 'Ticket creado',
      ticket: result.rows[0],
    });

    const io = req.app.get('io');
    io?.emit('ticket:created', result.rows[0]);

    if (asignado_a) {
      const ures = await pool.query('SELECT nombre, email FROM usuarios WHERE id = $1', [asignado_a]);
      if (ures.rowCount) await sendAssignmentEmail(ures.rows[0], result.rows[0]);
    }
  } catch (err) {
    console.error('Error al crear ticket:', err);
    res.status(500).json({ error: 'Error al crear ticket' });
  }
});

// Listar todos los tickets
router.get('/', authRequired, async (req, res) => {
  try {
    const { estado, asignado_a, equipo_id, q, limit: limitStr, offset: offsetStr } = req.query;
    const where = [];
    const values = [];

    if (estado) {
      values.push(estado);
      where.push(`t.estado = $${values.length}`);
    }
    if (asignado_a) {
      values.push(Number(asignado_a));
      where.push(`t.asignado_a = $${values.length}`);
    }
    if (equipo_id) {
      values.push(Number(equipo_id));
      where.push(`t.equipo_id = $${values.length}`);
    }
    if (q) {
      values.push(`%${q}%`);
      where.push(`(t.titulo ILIKE $${values.length} OR t.descripcion ILIKE $${values.length})`);
    }

    let limit = parseInt(limitStr);
    let offset = parseInt(offsetStr);
    if (isNaN(limit) || limit <= 0) limit = 50;
    if (limit > 100) limit = 100;
    if (isNaN(offset) || offset < 0) offset = 0;

    const sql = `SELECT t.*, u.nombre AS creado_por_nombre, ua.nombre AS asignado_a_nombre
                 FROM tickets t
                 LEFT JOIN usuarios u ON u.id = t.creado_por
                 LEFT JOIN usuarios ua ON ua.id = t.asignado_a
                 ${where.length ? ' WHERE ' + where.join(' AND ') : ''}
                 ORDER BY t.creado_en DESC
                 LIMIT $${values.length + 1} OFFSET $${values.length + 2}`;
    const result = await pool.query(sql, [...values, limit, offset]);
    res.json(result.rows);
  } catch (err) {
    console.error('Error al obtener tickets:', err);
    res.status(500).json({ error: 'Error al obtener tickets' });
  }
});

router.get('/count', authRequired, async (req, res) => {
  try {
    const { estado, asignado_a, equipo_id, q } = req.query;
    const where = [];
    const values = [];
    if (estado) { values.push(estado); where.push(`estado = $${values.length}`); }
    if (asignado_a) { values.push(Number(asignado_a)); where.push(`asignado_a = $${values.length}`); }
    if (equipo_id) { values.push(Number(equipo_id)); where.push(`equipo_id = $${values.length}`); }
    if (q) { values.push(`%${q}%`); where.push(`(titulo ILIKE $${values.length} OR descripcion ILIKE $${values.length})`); }
    const sql = `SELECT COUNT(*) FROM tickets${where.length ? ' WHERE ' + where.join(' AND ') : ''}`;
    const result = await pool.query(sql, values);
    res.json({ total: Number(result.rows[0].count) });
  } catch (err) {
    console.error('Error en /tickets/count:', err);
    res.status(500).json({ error: 'Error al contar tickets' });
  }
});

// Obtener detalle de un ticket
router.get('/:id', authRequired, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT t.*, 
              u.nombre AS creado_por_nombre, 
              ua.nombre AS asignado_a_nombre,
              e.nombre AS equipo_nombre
       FROM tickets t
       LEFT JOIN usuarios u ON u.id = t.creado_por
       LEFT JOIN usuarios ua ON ua.id = t.asignado_a
       LEFT JOIN equipos e ON e.id = t.equipo_id
       WHERE t.id = $1`,
      [id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Ticket no encontrado' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error al obtener ticket:', err);
    res.status(500).json({ error: 'Error al obtener ticket' });
  }
});

// Cambiar estado (pendiente / hecho)
router.patch('/:id/estado', authRequired, async (req, res) => {
  try {
    const { id } = req.params;
    const { estado } = req.body;

    if (!['pendiente', 'hecho'].includes(estado)) {
      return res.status(400).json({ error: 'Estado inválido' });
    }

    const result = await pool.query(
      `UPDATE tickets
       SET estado = $1, actualizado_en = NOW()
       WHERE id = $2
       RETURNING *`,
      [estado, id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Ticket no encontrado' });
    }

    res.json({
      mensaje: 'Estado actualizado',
      ticket: result.rows[0],
    });

    const io = req.app.get('io');
    io?.emit('ticket:updated', result.rows[0]);
  } catch (err) {
    console.error('Error al actualizar estado:', err);
    res.status(500).json({ error: 'Error al actualizar estado' });
  }
});

// Asignar / cambiar usuario asignado
router.patch('/:id/asignado', authRequired, async (req, res) => {
  try {
    const { id } = req.params;
    const { asignado_a } = req.body;

    const result = await pool.query(
      `UPDATE tickets
       SET asignado_a = $1, actualizado_en = NOW()
       WHERE id = $2
       RETURNING *`,
      [asignado_a || null, id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Ticket no encontrado' });
    }

    res.json({
      mensaje: 'Asignación actualizada',
      ticket: result.rows[0],
    });

    const io = req.app.get('io');
    io?.emit('ticket:updated', result.rows[0]);

    if (asignado_a) {
      const ures = await pool.query('SELECT nombre, email FROM usuarios WHERE id = $1', [asignado_a]);
      if (ures.rowCount) await sendAssignmentEmail(ures.rows[0], result.rows[0]);
    }
  } catch (err) {
    console.error('Error al actualizar asignación:', err);
    res.status(500).json({ error: 'Error al actualizar asignación' });
  }
});

router.patch('/:id', authRequired, async (req, res) => {
  try {
    const { id } = req.params;
    const { titulo, descripcion, asignado_a, equipo_id } = req.body;

    const result = await pool.query(
      `UPDATE tickets
       SET titulo = COALESCE($1, titulo),
           descripcion = COALESCE($2, descripcion),
           asignado_a = COALESCE($3, asignado_a),
           equipo_id = COALESCE($4, equipo_id),
           actualizado_en = NOW()
       WHERE id = $5
       RETURNING *`,
      [titulo || null, descripcion || null, asignado_a ?? null, equipo_id ?? null, id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Ticket no encontrado' });
    }

    res.json({
      mensaje: 'Ticket actualizado',
      ticket: result.rows[0],
    });

    const io = req.app.get('io');
    io?.emit('ticket:updated', result.rows[0]);
  } catch (err) {
    console.error('Error al actualizar ticket:', err);
    res.status(500).json({ error: 'Error al actualizar ticket' });
  }
});

// Comentarios: agregar
router.post('/:id/comentarios', authRequired, async (req, res) => {
  try {
    const { id } = req.params;
    const { contenido } = req.body;

    if (!contenido) {
      return res.status(400).json({ error: 'Contenido requerido' });
    }

    const insert = await pool.query(
      `INSERT INTO comentarios (ticket_id, autor_id, contenido, creado_en)
       VALUES ($1, $2, $3, NOW())
       RETURNING *`,
      [id, req.user.id, contenido]
    );

    res.status(201).json({
      mensaje: 'Comentario agregado',
      comentario: insert.rows[0],
    });

    const io = req.app.get('io');
    io?.emit('ticket:comment_added', insert.rows[0]);
  } catch (err) {
    console.error('Error al agregar comentario:', err);
    res.status(500).json({ error: 'Error al agregar comentario' });
  }
});

// Comentarios: listar
router.get('/:id/comentarios', authRequired, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT c.*, u.nombre AS autor_nombre
       FROM comentarios c
       JOIN usuarios u ON u.id = c.autor_id
       WHERE c.ticket_id = $1
       ORDER BY c.creado_en ASC`,
      [id]
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Error al listar comentarios:', err);
    res.status(500).json({ error: 'Error al listar comentarios' });
  }
});

// Comentarios: eliminar (autor o admin)
router.delete('/:ticketId/comentarios/:id', authRequired, async (req, res) => {
  try {
    const { ticketId, id } = req.params;
    const buscar = await pool.query(`SELECT * FROM comentarios WHERE id = $1 AND ticket_id = $2`, [id, ticketId]);
    if (buscar.rowCount === 0) {
      return res.status(404).json({ error: 'Comentario no encontrado' });
    }

    const comentario = buscar.rows[0];
    if (comentario.autor_id !== req.user.id && req.user.rol !== 'admin') {
      return res.status(403).json({ error: 'No autorizado para eliminar comentario' });
    }

    await pool.query(`DELETE FROM comentarios WHERE id = $1`, [id]);
    res.json({ mensaje: 'Comentario eliminado' });
    const io = req.app.get('io');
    io?.emit('ticket:comment_deleted', { id: Number(id), ticket_id: Number(ticketId) });
  } catch (err) {
    console.error('Error al eliminar comentario:', err);
    res.status(500).json({ error: 'Error al eliminar comentario' });
  }
});

router.delete('/:id', authRequired, async (req, res) => {
  try {
    if (req.user?.rol !== 'admin') {
      return res.status(403).json({ error: 'Solo admin puede eliminar tickets' });
    }
    const { id } = req.params;
    const del = await pool.query(`DELETE FROM tickets WHERE id = $1`, [id]);
    if (del.rowCount === 0) {
      return res.status(404).json({ error: 'Ticket no encontrado' });
    }

    res.json({ mensaje: 'Ticket eliminado' });

    const io = req.app.get('io');
    io?.emit('ticket:deleted', { id: Number(id) });
  } catch (err) {
    console.error('Error al eliminar ticket:', err);
    res.status(500).json({ error: 'Error al eliminar ticket' });
  }
});

export default router;
