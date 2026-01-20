// router: tickets.js
import express from 'express';
import pool from '../db.js';
import authRequired from '../middleware/authRequired.js'; // <-- aquí usamos el mismo nombre del archivo
import { enviarNotificacionTicket } from '../services/mailer.js';

const router = express.Router();

let initializationPromise = null;

async function ensureSchema() {
  if (initializationPromise) return initializationPromise;

  initializationPromise = (async () => {
    try {
      console.log('Verificando esquema de base de datos...');
      
      // Crear tabla comentarios
      await pool.query(`
        CREATE TABLE IF NOT EXISTS comentarios (
          id SERIAL PRIMARY KEY,
          ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
          autor_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE SET NULL,
          contenido TEXT NOT NULL,
          creado_en TIMESTAMP NOT NULL DEFAULT NOW()
        )
      `);

      // Crear tabla historial_tickets
      await pool.query(`
        CREATE TABLE IF NOT EXISTS historial_tickets (
          id SERIAL PRIMARY KEY,
          ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
          usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
          tipo_cambio VARCHAR(50) NOT NULL,
          valor_anterior TEXT,
          valor_nuevo TEXT,
          creado_en TIMESTAMP NOT NULL DEFAULT NOW()
        )
      `);

      // Actualizar tabla tickets (columnas nuevas)
      const alters = [
        'ALTER TABLE tickets ADD COLUMN IF NOT EXISTS cliente_id INTEGER',
        'ALTER TABLE tickets ADD COLUMN IF NOT EXISTS terminado_en TIMESTAMP',
        'ALTER TABLE tickets ADD COLUMN IF NOT EXISTS tipo VARCHAR(50)',
          'ALTER TABLE tickets ADD COLUMN IF NOT EXISTS codigo VARCHAR(50)',
          'ALTER TABLE tickets ADD COLUMN IF NOT EXISTS garantia BOOLEAN DEFAULT FALSE',
          'ALTER TABLE comentarios ADD COLUMN IF NOT EXISTS fase VARCHAR(50)'
        ];

      for (const sql of alters) {
        await pool.query(sql);
      }

      console.log('Esquema verificado correctamente.');
    } catch (err) {
      console.error('Error CRÍTICO actualizando esquema:', err);
      initializationPromise = null; // Permitir reintento
      throw err;
    }
  })();

  return initializationPromise;
}

// Crear ticket
router.post('/', authRequired, async (req, res) => {
  try {
    await ensureSchema();
    const { titulo, descripcion, asignado_a, equipo_id, cliente_id, tipo, garantia, notificar_a } = req.body;

    const cleanTitulo = String(titulo || '').trim();

    if (!cleanTitulo) {
      return res.status(400).json({ error: 'El título es obligatorio' });
    }

    let rawTipo = String(tipo || '').trim().toLowerCase();
    let tipoNormalizado;
    
    // Nuevos tipos: mantencion_preventiva (MP), mantencion_correctiva (MC), visita_tecnica (VT)
    if (rawTipo === 'mp' || rawTipo === 'mantencion_preventiva') {
      tipoNormalizado = 'mantencion_preventiva';
    } else if (rawTipo === 'mc' || rawTipo === 'mantencion_correctiva') {
      tipoNormalizado = 'mantencion_correctiva';
    } else if (rawTipo === 'vt' || rawTipo === 'visita_tecnica' || rawTipo === 'visita tecnica') {
      tipoNormalizado = 'visita_tecnica';
    } else {
      // Fallback a mantención preventiva por defecto si no coincide
      tipoNormalizado = 'mantencion_preventiva';
    }

    let prefijo;
    if (tipoNormalizado === 'mantencion_preventiva') {
      prefijo = 'MP';
    } else if (tipoNormalizado === 'mantencion_correctiva') {
      prefijo = 'MC';
    } else if (tipoNormalizado === 'visita_tecnica') {
      prefijo = 'VT';
    } else {
      prefijo = 'TK';
    }

    const isGarantia = garantia === 'si' || garantia === 'on' || garantia === true || garantia === 'true';

    const countRes = await pool.query(
      'SELECT COUNT(*) FROM tickets WHERE tipo = $1',
      [tipoNormalizado]
    );
    const count = Number(countRes.rows[0]?.count || 0);
    const nextNumber = count + 1;
    const codigo = `${prefijo}-${String(nextNumber).padStart(3, '0')}`;

    const result = await pool.query(
      `INSERT INTO tickets (titulo, descripcion, creado_por, asignado_a, equipo_id, cliente_id, tipo, codigo, garantia, estado, creado_en, actualizado_en)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pendiente', NOW(), NOW())
       RETURNING *`,
      [cleanTitulo, descripcion || null, req.user.id, asignado_a || null, equipo_id || null, cliente_id || null, tipoNormalizado, codigo, isGarantia]
    );

    const io = req.app.get('io');
    io?.emit('ticket:created', result.rows[0]);

    // Manejo de notificaciones (asignado_a y notificar_a)
    const destinatarios = new Set();

    // 1. Notificar al asignado (si existe)
    if (asignado_a) {
      const ures = await pool.query('SELECT email FROM usuarios WHERE id = $1', [asignado_a]);
      if (ures.rowCount > 0) {
        destinatarios.add(ures.rows[0].email);
      }
    }

    // 2. Notificar a lista adicional
    if (notificar_a) {
      const ids = Array.isArray(notificar_a) ? notificar_a : [notificar_a];
      if (ids.length > 0) {
        // Filtrar IDs vacíos y convertir a números
        const cleanIds = ids.map(id => parseInt(id)).filter(id => !isNaN(id));
        
        if (cleanIds.length > 0) {
          const uresAdicionales = await pool.query(
            'SELECT email FROM usuarios WHERE id = ANY($1::int[])',
            [cleanIds]
          );
          uresAdicionales.rows.forEach(row => destinatarios.add(row.email));
        }
      }
    }

    if (destinatarios.size > 0) {
      const listaEmails = Array.from(destinatarios);
      console.log('Enviando notificaciones a:', listaEmails);
      enviarNotificacionTicket(listaEmails, titulo)
        .catch(e => console.error('Error enviando notificación en segundo plano:', e));
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
    const { estado, asignado_a, equipo_id, q, tipo, estado_view, limit: limitStr, offset: offsetStr } = req.query;
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
    if (tipo) {
      values.push(String(tipo).trim());
      where.push(`t.tipo = $${values.length}`);
    }
    if (estado_view === 'activos') {
      where.push(`(t.estado IS NULL OR t.estado NOT IN ('hecho','terminado'))`);
    } else if (estado_view === 'resueltos') {
      where.push(`t.estado IN ('hecho','terminado')`);
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
      query: q || '',
      queryTipo: tipo || '',
      estadoView: estado_view || '',
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
    
    // Obtener historial de cambios
    const historialRes = await pool.query(
      `SELECT h.id, h.ticket_id, h.usuario_id, h.tipo_cambio, h.valor_anterior, h.valor_nuevo, h.creado_en, u.nombre as usuario_nombre, 'cambio' as tipo_item
       FROM historial_tickets h
       LEFT JOIN usuarios u ON u.id = h.usuario_id
       WHERE h.ticket_id = $1`,
      [id]
    );

    // Obtener comentarios
    const comentariosRes = await pool.query(
      `SELECT c.id, c.ticket_id, c.autor_id as usuario_id, 'comentario' as tipo_cambio, NULL as valor_anterior, c.contenido as valor_nuevo, c.creado_en, u.nombre as usuario_nombre, 'comentario' as tipo_item, c.fase
       FROM comentarios c
       LEFT JOIN usuarios u ON u.id = c.autor_id
       WHERE c.ticket_id = $1`,
      [id]
    );

    // Combinar y ordenar
    let combinado = [...historialRes.rows, ...comentariosRes.rows];
    combinado.sort((a, b) => new Date(b.creado_en) - new Date(a.creado_en));

    if (combinado.length === 0) {
      const ticketRes = await pool.query(
        `SELECT t.*, 
                cu.nombre as creado_por_nombre,
                au.nombre as asignado_a_nombre
         FROM tickets t
         LEFT JOIN usuarios cu ON cu.id = t.creado_por
         LEFT JOIN usuarios au ON ua.id = t.asignado_a
         WHERE t.id = $1`,
        [id]
      );
      if (ticketRes.rowCount > 0) {
        const t = ticketRes.rows[0];
        const baseFecha = t.actualizado_en || t.creado_en || new Date();
        combinado = [
          {
            id: null,
            ticket_id: t.id,
            usuario_id: t.creado_por,
            usuario_nombre: t.creado_por_nombre || null,
            tipo_cambio: 'estado',
            valor_anterior: 'pendiente',
            valor_nuevo: t.estado,
            creado_en: baseFecha,
            tipo_item: 'cambio'
          }
        ];
        if (t.asignado_a) {
             combinado.push({
                id: null,
                ticket_id: t.id,
                usuario_id: t.creado_por,
                usuario_nombre: t.creado_por_nombre || null,
                tipo_cambio: 'asignacion',
                valor_anterior: 'Sin asignar',
                valor_nuevo: t.asignado_a_nombre || 'Sin asignar',
                creado_en: baseFecha,
                tipo_item: 'cambio'
             });
        }
      }
    }
    
    res.json(combinado);
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
    const { estado, comentario } = req.body;
    
    console.log(`[PATCH Estado] ID: ${id}, Estado: ${estado}, Comentario: "${comentario}"`);

    const nuevoEstado = String(estado || '').trim();

    // Lista ampliada de estados validos
    const estadosValidos = [
      'pendiente', 'hecho', 'en_proceso', // Legacy
      'ingresado', 'diagnostico', 'presupuesto', 'reparacion', 'observacion', 'terminado' // Nuevas fases
    ];

    if (!estadosValidos.includes(nuevoEstado)) {
      return res.status(400).json({ error: 'Estado inválido' });
    }

    const antes = await pool.query('SELECT estado FROM tickets WHERE id = $1', [id]);

    const result = await pool.query(
      `UPDATE tickets
       SET estado = $1, 
           actualizado_en = NOW(),
           terminado_en = CASE WHEN $1::varchar IN ('hecho', 'terminado') THEN NOW() ELSE terminado_en END
       WHERE id = $2
       RETURNING *`,
      [nuevoEstado, id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Ticket no encontrado' });
    }

    // Insertar comentario si existe
    if (comentario && String(comentario).trim()) {
        await pool.query(
          `INSERT INTO comentarios (ticket_id, autor_id, contenido, fase, creado_en)
           VALUES ($1, $2, $3, $4, NOW())`,
          [id, req.user.id, String(comentario).trim(), nuevoEstado]
        );
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
    const { contenido, fase } = req.body;

    if (!contenido) {
      return res.status(400).json({ error: 'Contenido requerido' });
    }

    if (!req.user || !req.user.id) {
      console.error('User not found in request:', req.user);
      return res.status(401).json({ error: 'Usuario no autenticado' });
    }

    const insert = await pool.query(
      `INSERT INTO comentarios (ticket_id, autor_id, contenido, fase, creado_en)
       VALUES ($1, $2, $3, $4, NOW())
       RETURNING *`,
      [id, req.user.id, contenido, fase || null]
    );

    const autorRes = await pool.query('SELECT nombre FROM usuarios WHERE id = $1', [req.user.id]);
    const comentario = {
        ...insert.rows[0],
        autor_nombre: autorRes.rows[0]?.nombre || 'Usuario'
    };

    res.status(201).json({
      mensaje: 'Comentario agregado',
      comentario: comentario,
    });

    const io = req.app.get('io');
    io?.emit('ticket:comment_added', comentario);
  } catch (err) {
    console.error('Error al agregar comentario:', err);
    res.status(500).json({ error: 'Error al agregar comentario: ' + err.message });
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
    await ensureSchema();
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
