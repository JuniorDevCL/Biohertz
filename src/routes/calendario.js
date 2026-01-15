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
        id SERIAL PRIMARY KEY
      );
    `);
    await pool.query(`
      ALTER TABLE eventos ADD COLUMN IF NOT EXISTS titulo VARCHAR(200);
      ALTER TABLE eventos ADD COLUMN IF NOT EXISTS descripcion TEXT;
      ALTER TABLE eventos ADD COLUMN IF NOT EXISTS fecha DATE;
      ALTER TABLE eventos ADD COLUMN IF NOT EXISTS fecha_inicio DATE;
      ALTER TABLE eventos ADD COLUMN IF NOT EXISTS fecha_fin DATE;
      ALTER TABLE eventos ADD COLUMN IF NOT EXISTS hora_inicio TIME;
      ALTER TABLE eventos ADD COLUMN IF NOT EXISTS hora_fin TIME;
      ALTER TABLE eventos ADD COLUMN IF NOT EXISTS color VARCHAR(20) DEFAULT '#3b82f6';
      ALTER TABLE eventos ADD COLUMN IF NOT EXISTS creado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL;
      ALTER TABLE eventos ADD COLUMN IF NOT EXISTS creado_en TIMESTAMPTZ DEFAULT NOW();
      ALTER TABLE eventos ADD COLUMN IF NOT EXISTS actualizado_en TIMESTAMPTZ DEFAULT NOW();
      ALTER TABLE eventos ADD COLUMN IF NOT EXISTS tipo VARCHAR(50);
      ALTER TABLE eventos ADD COLUMN IF NOT EXISTS ticket_id INTEGER;
      ALTER TABLE eventos ADD COLUMN IF NOT EXISTS equipo_id INTEGER;
      ALTER TABLE eventos ADD COLUMN IF NOT EXISTS cliente_id INTEGER;
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_eventos_fecha ON eventos(fecha);
    `);
  } catch (e) {
    console.error('Error al asegurar esquema de eventos:', e);
  }
  ready = true;
}

function getMonthInfo(year, month) {
  const first = new Date(year, month - 1, 1);
  const daysInMonth = new Date(year, month, 0).getDate();
  const startWeekDay = first.getDay();
  return { first, daysInMonth, startWeekDay };
}

function buildCalendarWeeks(year, month, events) {
  const eventsByDate = {};
  const todayKey = new Date().toISOString().slice(0, 10);

  events.forEach(e => {
    const rawFecha = e.fecha;
    if (!rawFecha) return;
    const key = typeof rawFecha === 'string'
      ? rawFecha.slice(0, 10)
      : rawFecha.toISOString().slice(0, 10);
    if (!eventsByDate[key]) eventsByDate[key] = [];
    eventsByDate[key].push(e);
  });

  const { daysInMonth, startWeekDay } = getMonthInfo(year, month);
  const weeks = [];
  let currentDay = 1;
  let done = false;

  while (!done) {
    const week = [];
    for (let i = 0; i < 7; i++) {
      if (weeks.length === 0 && i < startWeekDay) {
        week.push(null);
      } else if (currentDay > daysInMonth) {
        week.push(null);
        done = true;
      } else {
        const dateObj = new Date(year, month - 1, currentDay);
        const key = dateObj.toISOString().slice(0, 10);
        week.push({
          day: currentDay,
          dateKey: key,
          isToday: key === todayKey,
          events: eventsByDate[key] || []
        });
        currentDay++;
      }
    }
    weeks.push(week);
    if (currentDay > daysInMonth) {
      done = true;
    }
  }

  return weeks;
}

router.get('/', authRequired, async (req, res) => {
  try {
    await ensureSchema();

    const user = req.user || req.session.user || { nombre: 'Usuario' };

    const now = new Date();
    const year = parseInt(req.query.year || now.getFullYear(), 10);
    const month = parseInt(req.query.month || now.getMonth() + 1, 10);

    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 1);

    const eventsRes = await pool.query(
      `SELECT id, titulo, descripcion, fecha, fecha_inicio, hora_inicio, hora_fin, color, creado_por, creado_en, tipo, ticket_id, equipo_id, cliente_id
       FROM eventos
       WHERE (fecha >= $1 AND fecha < $2) 
          OR (fecha_inicio >= $1 AND fecha_inicio < $2)
       ORDER BY COALESCE(fecha_inicio, fecha) ASC, hora_inicio ASC, creado_en ASC`,
      [startDate, endDate]
    );

    const events = eventsRes.rows;
    const weeks = buildCalendarWeeks(year, month, events);

    const monthNames = [
      'Enero',
      'Febrero',
      'Marzo',
      'Abril',
      'Mayo',
      'Junio',
      'Julio',
      'Agosto',
      'Septiembre',
      'Octubre',
      'Noviembre',
      'Diciembre'
    ];

    const weekDaysShort = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

    const prevMonth = month === 1 ? 12 : month - 1;
    const prevYear = month === 1 ? year - 1 : year;
    const nextMonth = month === 12 ? 1 : month + 1;
    const nextYear = month === 12 ? year + 1 : year;

    res.render('calendario', {
      title: 'Calendario - BIOHERTS',
      user,
      year,
      month,
      monthName: monthNames[month - 1],
      weeks,
      weekDaysShort,
      prevMonth,
      prevYear,
      nextMonth,
      nextYear
    });
  } catch (err) {
    console.error('Error al renderizar calendario:', err);
    res.status(500).json({ error: 'Error al cargar el calendario' });
  }
});

router.post('/eventos', authRequired, async (req, res) => {
  try {
    await ensureSchema();

    const user = req.user || req.session.user || { id: null };
    const { titulo, descripcion, fecha, hora_inicio, hora_fin, tipo, ticket_id, equipo_id, cliente_id } = req.body;

    const cleanTitulo = String(titulo || '').trim();
    const cleanFecha = String(fecha || '').trim();
    const cleanTipo = String(tipo || '').trim() || null;
    const parsedTicketId = ticket_id ? parseInt(ticket_id, 10) : null;
    const parsedEquipoId = equipo_id ? parseInt(equipo_id, 10) : null;
    const parsedClienteId = cliente_id ? parseInt(cliente_id, 10) : null;

    if (!cleanTitulo || !cleanFecha) {
      return res.status(400).json({ error: 'Título y fecha son obligatorios' });
    }

    await pool.query(
      `INSERT INTO eventos (titulo, descripcion, fecha, fecha_inicio, fecha_fin, hora_inicio, hora_fin, color, creado_por, creado_en, actualizado_en, tipo, ticket_id, equipo_id, cliente_id)
       VALUES ($1, $2, $3::DATE, $3::DATE, $3::DATE, $4, $5, '#3b82f6', $6, NOW(), NOW(), $7, $8, $9, $10)`,
      [
        cleanTitulo,
        descripcion || null,
        cleanFecha,
        hora_inicio || null,
        hora_fin || null,
        user.id || null,
        cleanTipo,
        parsedTicketId,
        parsedEquipoId,
        parsedClienteId
      ]
    );

    const redirectMonth = req.body.month || '';
    const redirectYear = req.body.year || '';
    const queryParts = [];
    if (redirectMonth) queryParts.push(`month=${encodeURIComponent(redirectMonth)}`);
    if (redirectYear) queryParts.push(`year=${encodeURIComponent(redirectYear)}`);
    const queryString = queryParts.length ? `?${queryParts.join('&')}` : '';

    res.redirect('/calendario' + queryString);
  } catch (err) {
    console.error('Error al crear evento:', err);
    res.status(500).json({ error: 'Error al crear evento' });
  }
});

router.patch('/eventos/:id', authRequired, async (req, res) => {
  try {
    await ensureSchema();

    const { id } = req.params;
    const { titulo, descripcion, fecha, hora_inicio, hora_fin, tipo, ticket_id, equipo_id, cliente_id } = req.body;

    const cleanTitulo = String(titulo || '').trim();
    const cleanFecha = String(fecha || '').trim();
    const cleanTipo = String(tipo || '').trim() || null;
    const parsedTicketId = ticket_id ? parseInt(ticket_id, 10) : null;
    const parsedEquipoId = equipo_id ? parseInt(equipo_id, 10) : null;
    const parsedClienteId = cliente_id ? parseInt(cliente_id, 10) : null;

    if (!cleanTitulo || !cleanFecha) {
      return res.status(400).json({ error: 'Título y fecha son obligatorios' });
    }

    const updated = await pool.query(
      `UPDATE eventos
       SET titulo = $1,
           descripcion = $2,
           fecha = $3::DATE,
           fecha_inicio = $3::DATE,
           fecha_fin = $3::DATE,
           hora_inicio = $4,
           hora_fin = $5,
           tipo = $6,
           ticket_id = $7,
           equipo_id = $8,
           cliente_id = $9,
           actualizado_en = NOW()
       WHERE id = $10
       RETURNING id, titulo, descripcion, fecha, fecha_inicio, fecha_fin, hora_inicio, hora_fin, color, creado_por, creado_en, actualizado_en, tipo, ticket_id, equipo_id, cliente_id`,
      [
        cleanTitulo,
        descripcion || null,
        cleanFecha,
        hora_inicio || null,
        hora_fin || null,
        cleanTipo,
        parsedTicketId,
        parsedEquipoId,
        parsedClienteId,
        id
      ]
    );

    if (updated.rowCount === 0) {
      return res.status(404).json({ error: 'Evento no encontrado' });
    }

    res.json(updated.rows[0]);
  } catch (err) {
    console.error('Error al actualizar evento:', err);
    res.status(500).json({ error: 'Error al actualizar evento' });
  }
});

router.delete('/eventos/:id', authRequired, async (req, res) => {
  try {
    await ensureSchema();

    const { id } = req.params;
    const deleted = await pool.query(
      'DELETE FROM eventos WHERE id = $1 RETURNING id',
      [id]
    );

    if (deleted.rowCount === 0) {
      return res.status(404).json({ error: 'Evento no encontrado' });
    }

    res.json({ mensaje: 'Evento eliminado' });
  } catch (err) {
    console.error('Error al eliminar evento:', err);
    res.status(500).json({ error: 'Error al eliminar evento' });
  }
});

export default router;
