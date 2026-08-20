import { Router } from 'express';
import pool from '../db.js';
import portalRequired from '../middleware/portalRequired.js';
import {
  ensurePortalSchema,
  touchPortalAccess,
  authenticatePortalUser,
} from '../services/portalSchema.js';
import { ensureMantencionesSchema } from '../services/mantencionesSchema.js';

const router = Router();

function mapFichaRow(row) {
  if (!row) return null;
  return {
    ...row,
    checklist: Array.isArray(row.checklist) ? row.checklist : [],
  };
}

router.get('/login', async (req, res) => {
  if (req.session?.portalUser?.cliente_id) {
    return res.redirect('/portal');
  }
  res.render('portal_login', {
    layout: false,
    error: req.query.error || null,
    email: req.query.email || '',
  });
});

router.post('/login', async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const user = await authenticatePortalUser(email, password);

    if (!user) {
      return res.render('portal_login', {
        layout: false,
        error: 'Correo o clave incorrectos',
        email,
      });
    }

    const finish = () => {
      req.session.portalUser = {
        id: user.id,
        email: user.email,
        nombre: user.nombre,
        cliente_id: user.cliente_id,
        cliente_nombre: user.cliente_nombre,
      };
      req.session.save((err) => {
        if (err) {
          console.error('Error guardando sesión portal:', err);
          return res.render('portal_login', {
            layout: false,
            error: 'Error de sesión',
            email,
          });
        }
        return res.redirect('/portal');
      });
    };

    if (req.isAuthenticated && req.isAuthenticated()) {
      return req.logout((logoutErr) => {
        if (logoutErr) console.error('Error cerrando sesión staff:', logoutErr);
        finish();
      });
    }
    finish();
  } catch (err) {
    console.error('Error login portal:', err);
    res.render('portal_login', {
      layout: false,
      error: 'Error al iniciar sesión',
      email: String(req.body.email || ''),
    });
  }
});

router.get('/logout', (req, res) => {
  if (req.session) {
    delete req.session.portalUser;
  }
  req.session.save(() => {
    res.redirect('/portal/login');
  });
});

router.get('/', portalRequired, async (req, res) => {
  try {
    await ensurePortalSchema();
    await ensureMantencionesSchema();
    const clienteId = req.portalUser.cliente_id;

    const equiposRes = await pool.query(
      `SELECT e.id, e.nombre, e.marca, e.modelo, e.numero_serie, e.ubicacion, e.estado,
              (
                SELECT m.proxima_mantencion
                FROM mantenciones_fichas m
                WHERE m.equipo_id = e.id
                  AND m.estado = 'firmada'
                  AND m.proxima_mantencion IS NOT NULL
                ORDER BY m.proxima_mantencion ASC
                LIMIT 1
              ) AS proxima_mantencion,
              (
                SELECT m.fecha
                FROM mantenciones_fichas m
                WHERE m.equipo_id = e.id AND m.estado = 'firmada'
                ORDER BY COALESCE(m.fecha, m.firmada_en::date) DESC NULLS LAST, m.id DESC
                LIMIT 1
              ) AS ultima_mantencion,
              (
                SELECT m.id
                FROM mantenciones_fichas m
                WHERE m.equipo_id = e.id AND m.estado = 'firmada'
                ORDER BY COALESCE(m.fecha, m.firmada_en::date) DESC NULLS LAST, m.id DESC
                LIMIT 1
              ) AS ultima_ficha_id
       FROM equipos e
       WHERE e.cliente_id = $1
       ORDER BY e.nombre ASC`,
      [clienteId]
    );

    if (req.portalUser.id) {
      touchPortalAccess(req.portalUser.id).catch(() => {});
    }

    res.render('portal_home', {
      layout: 'portal_layout',
      title: 'Mis equipos - Portal BIODATA',
      portalUser: req.portalUser,
      equipos: equiposRes.rows,
    });
  } catch (err) {
    console.error('Error portal home:', err);
    res.status(500).send('Error al cargar el portal');
  }
});

router.get('/equipos/:id', portalRequired, async (req, res) => {
  try {
    await ensurePortalSchema();
    await ensureMantencionesSchema();
    const clienteId = req.portalUser.cliente_id;
    const equipoId = Number(req.params.id);

    const eq = await pool.query(
      `SELECT id, nombre, marca, modelo, numero_serie, ubicacion, estado, cliente, cliente_id
       FROM equipos
       WHERE id = $1 AND cliente_id = $2`,
      [equipoId, clienteId]
    );
    if (eq.rowCount === 0) {
      return res.status(404).send('Equipo no encontrado');
    }

    const fichas = await pool.query(
      `SELECT id, tipo, estado, fecha, hora, trabajo, realizado_por, proxima_mantencion, firmada_en, email_cliente
       FROM mantenciones_fichas
       WHERE equipo_id = $1 AND estado = 'firmada'
       ORDER BY COALESCE(fecha, firmada_en::date) DESC NULLS LAST, id DESC`,
      [equipoId]
    );

    res.render('portal_equipo', {
      layout: 'portal_layout',
      title: `${eq.rows[0].nombre} - Portal BIODATA`,
      portalUser: req.portalUser,
      equipo: eq.rows[0],
      fichas: fichas.rows,
    });
  } catch (err) {
    console.error('Error portal equipo:', err);
    res.status(500).send('Error al cargar el equipo');
  }
});

router.get('/fichas/:id', portalRequired, async (req, res) => {
  try {
    await ensurePortalSchema();
    await ensureMantencionesSchema();
    const clienteId = req.portalUser.cliente_id;
    const fichaId = Number(req.params.id);

    const result = await pool.query(
      `SELECT m.*,
              e.nombre AS equipo_nombre,
              e.marca AS equipo_marca,
              e.modelo AS equipo_modelo,
              e.numero_serie AS equipo_serie,
              e.cliente AS equipo_cliente,
              e.cliente_id AS equipo_cliente_id
       FROM mantenciones_fichas m
       INNER JOIN equipos e ON e.id = m.equipo_id
       WHERE m.id = $1
         AND m.estado = 'firmada'
         AND e.cliente_id = $2`,
      [fichaId, clienteId]
    );

    if (result.rowCount === 0) {
      return res.status(404).send('Ficha no encontrada');
    }

    const ficha = mapFichaRow(result.rows[0]);
    res.render('mantencion_print', {
      layout: false,
      title: `Ficha mantención #${ficha.id} - BIODATA`,
      ficha,
      user: null,
      portalBack: '/portal/equipos/' + ficha.equipo_id,
    });
  } catch (err) {
    console.error('Error portal ficha:', err);
    res.status(500).send('Error al cargar la ficha');
  }
});

export default router;
