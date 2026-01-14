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
        fecha DATE NOT NULL,
        creado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
        creado_en TIMESTAMPTZ DEFAULT NOW(),
        actualizado_en TIMESTAMPTZ DEFAULT NOW()
      );
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
    const key = e.fecha.toISOString().slice(0, 10);
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
      `SELECT id, titulo, descripcion, fecha, creado_por, creado_en
       FROM eventos
       WHERE fecha >= $1 AND fecha < $2
       ORDER BY fecha ASC, creado_en ASC`,
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
    const { titulo, descripcion, fecha } = req.body;

    const cleanTitulo = String(titulo || '').trim();
    const cleanFecha = String(fecha || '').trim();

    if (!cleanTitulo || !cleanFecha) {
      return res.status(400).json({ error: 'Título y fecha son obligatorios' });
    }

    await pool.query(
      `INSERT INTO eventos (titulo, descripcion, fecha, creado_por, creado_en, actualizado_en)
       VALUES ($1, $2, $3, $4, NOW(), NOW())`,
      [cleanTitulo, descripcion || null, cleanFecha, user.id || null]
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

export default router;

