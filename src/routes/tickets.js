// router: tickets.js
import express from 'express';
import pool from '../db.js';
import authRequired from '../middleware/authRequired.js'; // <-- aquí usamos el mismo nombre del archivo
import { enviarNotificacionTicket } from '../services/mailer.js';

const router = express.Router();

let ready = false;
async function ensureSchema() {
  if (ready) return;
  try {
    await pool.query(`
      ALTER TABLE tickets ADD COLUMN IF NOT EXISTS cliente_id INTEGER;
      ALTER TABLE tickets ADD COLUMN IF NOT EXISTS terminado_en TIMESTAMP;
      ALTER TABLE tickets ADD COLUMN IF NOT EXISTS tipo VARCHAR(50);
      ALTER TABLE tickets ADD COLUMN IF NOT EXISTS codigo VARCHAR(50);
    `);
  } catch (err) {
    console.error('Error al actualizar esquema de tickets:', err);
  }
  ready = true;
}

// Crear ticket
router.post('/', authRequired, async (req, res) => {
  try {
    await ensureSchema();
    const { titulo, descripcion, asignado_a, equipo_id, cliente_id, tipo } = req.body;

    const cleanTitulo = String(titulo || '').trim();

    if (!cleanTitulo) {
      return res.status(400).json({ error: 'El título es obligatorio' });
    }

    let rawTipo = String(tipo || '').trim().toLowerCase();
    let tipoNormalizado;
    if (rawTipo === 'mantencion' || rawTipo === 'm') {
      tipoNormalizado = 'mantencion';
    } else if (rawTipo === 'visita_tecnica' || rawTipo === 'visita tecnica' || rawTipo === 'v') {
      tipoNormalizado = 'visita_tecnica';
    } else if (rawTipo === 'garantia' || rawTipo === 'g') {
      tipoNormalizado = 'garantia';
    } else {
      tipoNormalizado = 'mantencion';
    }

    let prefijo;
    if (tipoNormalizado === 'mantencion') {
      prefijo = 'M';
    } else if (tipoNormalizado === 'visita_tecnica') {
      prefijo = 'V';
    } else if (tipoNormalizado === 'garantia') {
      prefijo = 'G';
    } else {
      prefijo = 'T';
    }

    const countRes = await pool.query(
      'SELECT COUNT(*) FROM tickets WHERE tipo = $1',
      [tipoNormalizado]
    );
    const count = Number(countRes.rows[0]?.count || 0);
    const nextNumber = count + 1;
    const codigo = `${prefijo}-${String(nextNumber).padStart(3, '0')}`;

    const result = await pool.query(
      `INSERT INTO tickets (titulo, descripcion, creado_por, asignado_a, equipo_id, cliente_id, tipo, codigo, estado, creado_en, actualizado_en)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pendiente', NOW(), NOW())
       RETURNING *`,
      [cleanTitulo, descripcion || null, req.user.id, asignado_a || null, equipo_id || null, cliente_id || null, tipoNormalizado, codigo]
    );

    const io = req.app.get('io');
    io?.emit('ticket:created', result.rows[0]);

    if (asignado_a) {
      const ures = await pool.query('SELECT nombre, email FROM usuarios WHERE id = $1', [asignado_a]);
      if (ures.rowCount > 0) {
        console.log('Ticket asignado a:', ures.rows[0].email);
        enviarNotificacionTicket(ures.rows[0].email, titulo)
          .catch(e => console.error('Error enviando notificación en segundo plano:', e));
      }
    }

    const accept = String(req.headers.accept || '');
    if (accept.includes('application/json')) {
      return res.status(201).json({
        mensaje: 'Ticket creado',
        ticket: result.rows[0],
      });
    }

    return res.redirect('/tickets');
  } catch (err) {
    console.error('Error al crear ticket:', err);
    res.status(500).json({ error: 'Error al crear ticket' });
  }
});

router.patch('/:id/status', authRequired, async (req, res) => {
  try {
    await ensureSchema();
    const { id } = req.params;
    const { estado } = req.body;
    const nuevoEstado = String(estado || '').trim();
    const result = await pool.query(
      `UPDATE tickets 
       SET estado = $1, 
           actualizado_en = NOW(),
           terminado_en = CASE WHEN $1::varchar IN ('terminado','hecho') THEN NOW() ELSE terminado_en END
       WHERE id = $2 RETURNING *`,
      [nuevoEstado, id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Ticket no encontrado' });
    
    const io = req.app.get('io');
    io?.emit('ticket:updated', result.rows[0]);
    
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error actualizando estado:', err);
    res.status(500).json({ error: 'Error actualizando estado' });
  }
});

// Listar todos los tickets
router.get('/', authRequired, async (req, res) => {
  try {
    await ensureSchema();
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

    const sql = `SELECT t.*, 
                        u.nombre AS creado_por_nombre, 
                        ua.nombre AS asignado_a_nombre,
                        c.nombre AS cliente_nombre,
                        e.nombre AS equipo_nombre
                 FROM tickets t
                 LEFT JOIN usuarios u ON u.id = t.creado_por
                 LEFT JOIN usuarios ua ON ua.id = t.asignado_a
                 LEFT JOIN clientes c ON c.id = t.cliente_id
                 LEFT JOIN equipos e ON e.id = t.equipo_id
                 ${where.length ? ' WHERE ' + where.join(' AND ') : ''}
                 ORDER BY t.creado_en DESC
                 LIMIT $${values.length + 1} OFFSET $${values.length + 2}`;
    
    const [result, clientesRes, usuariosRes, ticketsCountRes] = await Promise.all([
      pool.query(sql, [...values, limit, offset]),
      pool.query('SELECT id, nombre FROM clientes ORDER BY nombre'),
      pool.query('SELECT id, nombre, email FROM usuarios ORDER BY nombre'),
      pool.query('SELECT COUNT(*) FROM tickets')
    ]);

    const totalTickets = Number(ticketsCountRes.rows[0].count) || 0;

    res.render('tickets', { 
      tickets: result.rows,
      clientes: clientesRes.rows,
      usuarios: usuariosRes.rows,
      totalTickets,
      title: 'Tickets - BIOHERTS',
      user: req.user || req.session.user || { nombre: 'Usuario' }
    });
  } catch (err) {
    console.error('Error al obtener tickets:', err);
    res.status(500).json({ error: 'Error al obtener tickets' });
  }
});

router.get('/count', authRequired, async (req, res) => {
  try {
    await ensureSchema();
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

router.get('/export/csv', authRequired, async (req, res) => {
  try {
    await ensureSchema();
    const { estado, asignado_a, equipo_id, q } = req.query;
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

    const sql = `SELECT t.codigo, t.titulo, t.estado, t.tipo,
                        u.nombre as creado_por,
                        ua.nombre as asignado_a,
                        c.nombre as cliente,
                        e.nombre as equipo,
                        t.creado_en, t.terminado_en
                 FROM tickets t
                 LEFT JOIN usuarios u ON u.id = t.creado_por
                 LEFT JOIN usuarios ua ON ua.id = t.asignado_a
                 LEFT JOIN clientes c ON c.id = t.cliente_id
                 LEFT JOIN equipos e ON e.id = t.equipo_id
                 ${where.length ? ' WHERE ' + where.join(' AND ') : ''}
                 ORDER BY t.creado_en DESC`;

    const result = await pool.query(sql, values);

    const headers = [
      'Codigo',
      'Titulo',
      'Estado',
      'Tipo',
      'Creado Por',
      'Asignado A',
      'Cliente',
      'Equipo',
      'Fecha Creacion',
      'Fecha Termino'
    ];

    const rows = result.rows.map(row => [
      row.codigo || '',
      `"${String(row.titulo || '').replace(/"/g, '""')}"`,
      row.estado || '',
      row.tipo || '',
      row.creado_por || '',
      row.asignado_a || '',
      `"${String(row.cliente || '').replace(/"/g, '""')}"`,
      `"${String(row.equipo || '').replace(/"/g, '""')}"`,
      row.creado_en ? new Date(row.creado_en).toISOString().split('T')[0] : '',
      row.terminado_en ? new Date(row.terminado_en).toISOString().split('T')[0] : ''
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(r => r.join(','))
    ].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="tickets_reporte.csv"');
    res.send(csvContent);
  } catch (err) {
    console.error('Error exportando CSV:', err);
    res.status(500).send('Error al generar el reporte');
  }
});

router.get('/:id/historial', authRequired, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT h.*, u.nombre as usuario_nombre
       FROM historial_tickets h
       LEFT JOIN usuarios u ON u.id = h.usuario_id
       WHERE h.ticket_id = $1
       ORDER BY h.creado_en DESC`,
      [id]
    );
    if (result.rowCount === 0) {
      const ticketRes = await pool.query(
        `SELECT t.*, 
                cu.nombre as creado_por_nombre,
                au.nombre as asignado_a_nombre
         FROM tickets t
         LEFT JOIN usuarios cu ON cu.id = t.creado_por
         LEFT JOIN usuarios au ON au.id = t.asignado_a
         WHERE t.id = $1`,
        [id]
      );
      if (ticketRes.rowCount > 0) {
        const t = ticketRes.rows[0];
        const baseFecha = t.actualizado_en || t.creado_en || new Date();
        const fallback = [
          {
            id: null,
            ticket_id: t.id,
            usuario_id: t.creado_por,
            usuario_nombre: t.creado_por_nombre || null,
            tipo_cambio: 'asignacion',
            valor_anterior: 'Sin asignar',
            valor_nuevo: t.asignado_a_nombre || 'Sin asignar',
            creado_en: baseFecha
          },
          {
            id: null,
            ticket_id: t.id,
            usuario_id: t.creado_por,
            usuario_nombre: t.creado_por_nombre || null,
            tipo_cambio: 'estado',
            valor_anterior: 'pendiente',
            valor_nuevo: t.estado,
            creado_en: baseFecha
          }
        ];
        return res.json(fallback);
      }
    }
    res.json(result.rows);
  } catch (err) {
    console.error('Error al obtener historial:', err);
    res.status(500).json({ error: 'Error al obtener historial' });
  }
});

router.get('/:id', authRequired, async (req, res) => {
  try {
    await ensureSchema();
    const { id } = req.params;
    const result = await pool.query(
      `SELECT t.*, 
              u.nombre AS creado_por_nombre, 
              ua.nombre AS asignado_a_nombre,
              e.nombre AS equipo_nombre,
              c.nombre AS cliente_nombre
       FROM tickets t
       LEFT JOIN usuarios u ON u.id = t.creado_por
       LEFT JOIN usuarios ua ON ua.id = t.asignado_a
       LEFT JOIN equipos e ON e.id = t.equipo_id
       LEFT JOIN clientes c ON c.id = t.cliente_id
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
    await ensureSchema();
    const { id } = req.params;
    const { estado } = req.body;
    const nuevoEstado = String(estado || '').trim();

    if (!['pendiente', 'hecho', 'en_proceso'].includes(nuevoEstado)) {
      return res.status(400).json({ error: 'Estado inválido' });
    }

    const antes = await pool.query('SELECT estado FROM tickets WHERE id = $1', [id]);

    const result = await pool.query(
      `UPDATE tickets
       SET estado = $1, 
           actualizado_en = NOW(),
           terminado_en = CASE WHEN $1::varchar = 'hecho' THEN NOW() ELSE terminado_en END
       WHERE id = $2
       RETURNING *`,
      [nuevoEstado, id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Ticket no encontrado' });
    }

    // Historial
    if (antes.rowCount > 0 && antes.rows[0].estado !== nuevoEstado) {
      await pool.query(
        `INSERT INTO historial_tickets (ticket_id, usuario_id, tipo_cambio, valor_anterior, valor_nuevo, creado_en)
         VALUES ($1, $2, $3, $4, $5, NOW())`,
        [id, req.user.id, 'estado', antes.rows[0].estado, nuevoEstado]
      );
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
    await ensureSchema();
    const { id } = req.params;
    const { asignado_a } = req.body;

    const antes = await pool.query(`
      SELECT t.asignado_a, u.nombre as nombre_usuario 
      FROM tickets t 
      LEFT JOIN usuarios u ON u.id = t.asignado_a 
      WHERE t.id = $1`, [id]);

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

    // Historial
    if (antes.rowCount > 0) {
       const valorAntes = antes.rows[0].nombre_usuario || 'Sin asignar';
       let valorNuevo = 'Sin asignar';
       if (asignado_a) {
         const uRes = await pool.query('SELECT nombre FROM usuarios WHERE id = $1', [asignado_a]);
         if (uRes.rowCount > 0) valorNuevo = uRes.rows[0].nombre;
       }
       
       if (String(antes.rows[0].asignado_a) !== String(asignado_a || '')) {
          await pool.query(
            `INSERT INTO historial_tickets (ticket_id, usuario_id, tipo_cambio, valor_anterior, valor_nuevo, creado_en)
             VALUES ($1, $2, $3, $4, $5, NOW())`,
            [id, req.user.id, 'asignacion', valorAntes, valorNuevo]
          );
       }
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
