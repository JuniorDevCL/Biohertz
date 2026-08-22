import { Router } from 'express';
import pool from '../db.js';
import authRequired from '../middleware/authRequired.js';
import {
  ensureMantencionesSchema,
  getProtocoloByMarca,
  checklistTemplateFromProtocolo,
  CATEGORIAS_ATENCION,
} from '../services/mantencionesSchema.js';
import { ensurePortalSchema, ensurePortalAccessFromFicha } from '../services/portalSchema.js';
import {
  FICHA_LIST_COLUMNS,
  persistFotosFromPayload,
  resolveFotoPath,
  parseFotosInput,
  deleteAllFichaFotos,
  attachFichaFotos,
  getFotosStorageStats,
} from '../services/mantencionesFotos.js';
import fs from 'fs';

const router = Router();

function mapFichaRow(row, { withFotos = true } = {}) {
  if (!row) return null;
  const ficha = {
    ...row,
    checklist: Array.isArray(row.checklist) ? row.checklist : [],
    categorias: Array.isArray(row.categorias) ? row.categorias : [],
  };
  if (withFotos) {
    ficha.fotos = Array.isArray(row.fotos) ? row.fotos : [];
  }
  return ficha;
}

async function prepareFichaFotos(ficha) {
  return attachFichaFotos(ficha, pool);
}

function parseJsonArray(value, fallback = []) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : fallback;
    } catch {
      return fallback;
    }
  }
  return fallback;
}

const CATEGORIA_IDS = new Set(CATEGORIAS_ATENCION.map((c) => c.id));

function sanitizeCategorias(value) {
  return parseJsonArray(value).filter((id) => CATEGORIA_IDS.has(String(id))).slice(0, 8);
}

async function canAccessFichaFoto(req, fichaId) {
  if (req.isAuthenticated && req.isAuthenticated()) return true;

  const portal = req.session?.portalUser;
  if (!portal?.cliente_id) return false;

  const r = await pool.query(
    `SELECT m.id
     FROM mantenciones_fichas m
     INNER JOIN equipos e ON e.id = m.equipo_id
     WHERE m.id = $1 AND e.cliente_id = $2 AND m.estado = 'firmada'`,
    [fichaId, portal.cliente_id]
  );
  return r.rowCount > 0;
}

function normalizeEmail(email) {
  const e = String(email || '').trim().toLowerCase();
  return e || null;
}

async function maybeGrantPortalAccess(ficha, firmanteNombre) {
  try {
    await ensurePortalSchema();
    const email = normalizeEmail(ficha.email_cliente);
    const clienteId = ficha.cliente_id;
    if (!email || !clienteId) return;
    const result = await ensurePortalAccessFromFicha({
      email,
      cliente_id: clienteId,
      nombre: firmanteNombre || null,
      sendEmail: true,
    });
    if (result?.credentialsSent) {
      console.log('Credenciales portal enviadas a', email);
    }
  } catch (e) {
    console.warn('No se pudo habilitar acceso portal:', e.message);
  }
}

router.get('/', authRequired, async (req, res) => {
  try {
    await ensureMantencionesSchema();
    const { q, tipo, estado, equipo_id } = req.query;
    const values = [];
    const where = [];

    if (equipo_id) {
      values.push(Number(equipo_id));
      where.push(`m.equipo_id = $${values.length}`);
    }
    if (tipo) {
      values.push(tipo);
      where.push(`m.tipo = $${values.length}`);
    }
    if (estado) {
      values.push(estado);
      where.push(`m.estado = $${values.length}`);
    }
    if (q) {
      values.push(`%${q}%`);
      where.push(`(
        e.nombre ILIKE $${values.length}
        OR e.marca ILIKE $${values.length}
        OR e.modelo ILIKE $${values.length}
        OR e.numero_serie ILIKE $${values.length}
        OR m.trabajo ILIKE $${values.length}
        OR m.realizado_por ILIKE $${values.length}
      )`);
    }

    const sql = `
      SELECT ${FICHA_LIST_COLUMNS},
             e.nombre AS equipo_nombre,
             e.marca AS equipo_marca,
             e.modelo AS equipo_modelo,
             e.numero_serie AS equipo_serie,
             e.cliente AS equipo_cliente,
             c.nombre AS cliente_nombre
      FROM mantenciones_fichas m
      LEFT JOIN equipos e ON e.id = m.equipo_id
      LEFT JOIN clientes c ON c.id = m.cliente_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY COALESCE(m.fecha, m.creado_en::date) DESC, m.id DESC
      LIMIT 200
    `;
    const result = await pool.query(sql, values);
    const fichas = result.rows.map((row) => mapFichaRow(row, { withFotos: false }));
    let fotoStorage = null;
    try {
      fotoStorage = await getFotosStorageStats();
    } catch {}

    if (req.accepts('json') && !req.accepts('html')) {
      return res.json({ fichas, total: fichas.length, fotoStorage });
    }

    res.render('mantenciones', {
      title: 'Mantenciones - BIODATA',
      user: req.user || req.session.user,
      fichas,
      fotoStorage,
      query: q || '',
      queryTipo: tipo || '',
      queryEstado: estado || '',
      equipoId: equipo_id || '',
    });
  } catch (err) {
    console.error('Error listando mantenciones:', err);
    if (req.accepts('json') && !req.accepts('html')) {
      return res.status(500).json({ error: 'Error al listar mantenciones' });
    }
    res.status(500).send('Error al listar mantenciones');
  }
});

router.get('/nueva', authRequired, async (req, res) => {
  try {
    await ensureMantencionesSchema();
    await ensurePortalSchema();
    const equiposRes = await pool.query(
      `SELECT e.id, e.nombre, e.marca, e.modelo, e.numero_serie, e.cliente, e.cliente_id, e.estado, e.ubicacion,
              c.nombre AS cliente_nombre, c.email AS cliente_email, c.telefono AS cliente_telefono,
              c.ubicacion AS cliente_direccion
       FROM equipos e
       LEFT JOIN clientes c ON c.id = e.cliente_id
       ORDER BY e.nombre ASC`
    );
    let equipo = null;
    let protocolo = null;
    let checklist = [];
    let emailClientePrefill = '';
    let clientePrefill = {};
    const equipoId = req.query.equipo_id ? Number(req.query.equipo_id) : null;
    if (equipoId) {
      const er = await pool.query(
        `SELECT e.*, c.nombre AS cliente_nombre, c.email AS cliente_email, c.telefono AS cliente_telefono,
                c.ubicacion AS cliente_direccion
         FROM equipos e
         LEFT JOIN clientes c ON c.id = e.cliente_id
         WHERE e.id = $1`,
        [equipoId]
      );
      if (er.rowCount) {
        equipo = er.rows[0];
        protocolo = await getProtocoloByMarca(equipo.marca);
        checklist = checklistTemplateFromProtocolo(protocolo);
        emailClientePrefill = equipo.cliente_email || '';
        clientePrefill = {
          senores: equipo.cliente_nombre || equipo.cliente || '',
          direccion: equipo.cliente_direccion || equipo.ubicacion || '',
          telefono_cliente: equipo.cliente_telefono || '',
          email_cliente: equipo.cliente_email || '',
        };
      }
    }

    res.render('mantencion_ficha', {
      title: 'Nueva mantención - Biohertz',
      user: req.user || req.session.user,
      ficha: null,
      equipos: equiposRes.rows,
      equipo,
      checklist,
      emailClientePrefill,
      clientePrefill,
      categoriasAtencion: CATEGORIAS_ATENCION,
      modo: 'nueva',
      readonly: false,
    });
  } catch (err) {
    console.error('Error nueva mantención:', err);
    res.status(500).send('Error al abrir ficha de mantención');
  }
});

router.get('/protocolo', authRequired, async (req, res) => {
  try {
    const marca = req.query.marca || 'generico';
    const protocolo = await getProtocoloByMarca(marca);
    res.json({
      marca: protocolo.marca,
      items: checklistTemplateFromProtocolo(protocolo),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener protocolo' });
  }
});

router.get('/storage', authRequired, async (req, res) => {
  try {
    const stats = await getFotosStorageStats();
    if (req.accepts('json') && !req.accepts('html')) {
      return res.json(stats);
    }
    res.json(stats);
  } catch (err) {
    console.error('Error leyendo almacenamiento de fotos:', err);
    res.status(500).json({ error: 'No se pudo leer el almacenamiento de fotos' });
  }
});

router.get('/fotos/:fichaId/:archivo', async (req, res) => {
  try {
    const fichaId = Number(req.params.fichaId);
    if (!fichaId) return res.status(400).end();

    const allowed = await canAccessFichaFoto(req, fichaId);
    if (!allowed) return res.status(403).end();

    const fp = resolveFotoPath(fichaId, req.params.archivo);
    if (!fp || !fs.existsSync(fp)) return res.status(404).end();

    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.sendFile(fp);
  } catch (err) {
    console.error('Error sirviendo foto mantención:', err);
    res.status(500).end();
  }
});

router.get('/:id', authRequired, async (req, res) => {
  try {
    await ensureMantencionesSchema();
    const { id } = req.params;
    const result = await pool.query(
      `SELECT m.*,
              e.nombre AS equipo_nombre,
              e.marca AS equipo_marca,
              e.modelo AS equipo_modelo,
              e.numero_serie AS equipo_serie,
              e.cliente AS equipo_cliente,
              e.cliente_id AS equipo_cliente_id
       FROM mantenciones_fichas m
       LEFT JOIN equipos e ON e.id = m.equipo_id
       WHERE m.id = $1`,
      [id]
    );
    if (result.rowCount === 0) {
      if (req.accepts('json') && !req.accepts('html')) {
        return res.status(404).json({ error: 'Ficha no encontrada' });
      }
      return res.status(404).send('Ficha no encontrada');
    }

    const ficha = mapFichaRow(result.rows[0]);
    await prepareFichaFotos(ficha);
    if (req.accepts('json') && !req.accepts('html')) {
      return res.json(ficha);
    }

    // Ficha firmada: vista tipo documento imprimible (PDF al vuelo, sin guardar archivo)
    if (ficha.estado === 'firmada') {
      return res.render('mantencion_print', {
        layout: false,
        title: `Atención a clientes Nº ${String(ficha.id).padStart(5, '0')} - Biohertz`,
        ficha,
        user: req.user || req.session.user,
        categoriasAtencion: CATEGORIAS_ATENCION,
      });
    }

    const equiposRes = await pool.query(
      `SELECT e.id, e.nombre, e.marca, e.modelo, e.numero_serie, e.cliente, e.cliente_id, e.estado, e.ubicacion,
              c.nombre AS cliente_nombre, c.email AS cliente_email, c.telefono AS cliente_telefono,
              c.ubicacion AS cliente_direccion
       FROM equipos e
       LEFT JOIN clientes c ON c.id = e.cliente_id
       ORDER BY e.nombre ASC`
    );
    const equipo = {
      id: ficha.equipo_id,
      nombre: ficha.equipo_nombre,
      marca: ficha.equipo_marca,
      modelo: ficha.equipo_modelo,
      numero_serie: ficha.equipo_serie,
      cliente: ficha.equipo_cliente,
      cliente_id: ficha.equipo_cliente_id,
    };

    res.render('mantencion_ficha', {
      title: `Mantención #${ficha.id} - Biohertz`,
      user: req.user || req.session.user,
      ficha,
      equipos: equiposRes.rows,
      equipo,
      checklist: ficha.checklist || [],
      emailClientePrefill: ficha.email_cliente || '',
      clientePrefill: {},
      categoriasAtencion: CATEGORIAS_ATENCION,
      modo: 'editar',
      readonly: false,
    });
  } catch (err) {
    console.error('Error obteniendo mantención:', err);
    res.status(500).send('Error al cargar la ficha');
  }
});

router.post('/', authRequired, async (req, res) => {
  try {
    await ensureMantencionesSchema();
    const {
      equipo_id,
      tipo,
      fecha,
      hora,
      trabajo,
      nota,
      dano_descripcion,
      realizado_por,
      firmante_cliente,
      email_cliente,
      proxima_mantencion,
      checklist,
      guardar_y_firmar,
      firma_tecnico,
      firma_cliente,
      rut_cliente,
      senores,
      direccion,
      ciudad_comuna,
      telefono_cliente,
      contacto_nombre,
      version_sw,
      motivo_atencion,
      categorias,
      fotos,
    } = req.body;

    if (!equipo_id) {
      return res.status(400).json({ error: 'Debe seleccionar un equipo' });
    }
    if (!['preventiva', 'correctiva'].includes(tipo)) {
      return res.status(400).json({ error: 'Tipo inválido' });
    }

    const eq = await pool.query('SELECT * FROM equipos WHERE id = $1', [equipo_id]);
    if (eq.rowCount === 0) return res.status(404).json({ error: 'Equipo no encontrado' });

    let checklistData = [];
    if (tipo === 'preventiva') {
      if (typeof checklist === 'string') {
        try { checklistData = JSON.parse(checklist); } catch { checklistData = []; }
      } else if (Array.isArray(checklist)) {
        checklistData = checklist;
      }
      if (!checklistData.length) {
        const protocolo = await getProtocoloByMarca(eq.rows[0].marca);
        checklistData = checklistTemplateFromProtocolo(protocolo);
      }
    }

    const firmar = String(guardar_y_firmar) === 'true' || String(guardar_y_firmar) === '1';
    if (firmar) {
      if (!firma_tecnico || !firma_cliente) {
        return res.status(400).json({ error: 'Se requieren ambas firmas para cerrar la ficha' });
      }
    }

    const emailNorm = normalizeEmail(email_cliente);
    const categoriasData = sanitizeCategorias(categorias);
    const fotosInput = parseFotosInput(fotos);
    const estado = firmar ? 'firmada' : 'borrador';
    const insert = await pool.query(
      `INSERT INTO mantenciones_fichas (
        equipo_id, cliente_id, tipo, estado, fecha, hora, trabajo, nota, dano_descripcion,
        checklist, realizado_por, tecnico_id, firma_tecnico, firma_cliente, firmante_cliente,
        email_cliente, proxima_mantencion, firmada_en,
        rut_cliente, senores, direccion, ciudad_comuna, telefono_cliente, contacto_nombre,
        version_sw, motivo_atencion, categorias, fotos
      ) VALUES (
        $1, $2, $3, $4, NULLIF($5,'')::date, NULLIF($6,'')::time, $7, $8, $9,
        $10::jsonb, $11, $12, $13, $14, $15,
        $16, NULLIF($17,'')::date, $18,
        $19, $20, $21, $22, $23, $24,
        $25, $26, $27::jsonb, '[]'::jsonb
      ) RETURNING *`,
      [
        Number(equipo_id),
        eq.rows[0].cliente_id || null,
        tipo,
        estado,
        fecha || null,
        hora || null,
        trabajo || '',
        nota || '',
        dano_descripcion || '',
        JSON.stringify(checklistData),
        realizado_por || (req.user && req.user.nombre) || null,
        req.user?.id || null,
        firmar ? firma_tecnico : null,
        firmar ? firma_cliente : null,
        firmante_cliente || null,
        emailNorm,
        proxima_mantencion || null,
        firmar ? new Date() : null,
        rut_cliente || null,
        senores || eq.rows[0].cliente || null,
        direccion || null,
        ciudad_comuna || null,
        telefono_cliente || null,
        contacto_nombre || null,
        version_sw || null,
        motivo_atencion || '',
        JSON.stringify(categoriasData),
      ]
    );

    const fichaId = insert.rows[0].id;
    const fotosStored = await persistFotosFromPayload(fichaId, fotosInput, []);
    if (fotosStored.length) {
      await pool.query('UPDATE mantenciones_fichas SET fotos = $1::jsonb WHERE id = $2', [
        JSON.stringify(fotosStored),
        fichaId,
      ]);
      insert.rows[0].fotos = fotosStored;
    }

    const ficha = mapFichaRow(insert.rows[0]);
    await prepareFichaFotos(ficha);
    if (firmar) {
      await maybeGrantPortalAccess(ficha, firmante_cliente);
    }
    if (req.accepts('json') && !req.accepts('html')) {
      return res.status(201).json(ficha);
    }
    return res.redirect(`/mantenciones/${ficha.id}`);
  } catch (err) {
    console.error('Error creando mantención:', err);
    if (err.code === 'DISK_FULL') {
      return res.status(507).json({ error: err.message });
    }
    res.status(500).json({ error: 'Error al crear mantención: ' + err.message });
  }
});

router.patch('/:id', authRequired, async (req, res) => {
  try {
    await ensureMantencionesSchema();
    const { id } = req.params;
    const current = await pool.query('SELECT * FROM mantenciones_fichas WHERE id = $1', [id]);
    if (current.rowCount === 0) return res.status(404).json({ error: 'Ficha no encontrada' });
    if (current.rows[0].estado === 'firmada') {
      return res.status(403).json({ error: 'La ficha firmada no se puede editar' });
    }

    const {
      tipo,
      fecha,
      hora,
      trabajo,
      nota,
      dano_descripcion,
      realizado_por,
      firmante_cliente,
      email_cliente,
      proxima_mantencion,
      checklist,
      firma_tecnico,
      firma_cliente,
      guardar_y_firmar,
      rut_cliente,
      senores,
      direccion,
      ciudad_comuna,
      telefono_cliente,
      contacto_nombre,
      version_sw,
      motivo_atencion,
      categorias,
      fotos,
    } = req.body;

    let checklistData = current.rows[0].checklist;
    if (checklist !== undefined) {
      if (typeof checklist === 'string') {
        try { checklistData = JSON.parse(checklist); } catch { /* keep */ }
      } else if (Array.isArray(checklist)) {
        checklistData = checklist;
      }
    }

    const firmar = String(guardar_y_firmar) === 'true' || String(guardar_y_firmar) === '1';
    const nextFirmaTecnico = firma_tecnico || current.rows[0].firma_tecnico;
    const nextFirmaCliente = firma_cliente || current.rows[0].firma_cliente;

    if (firmar && (!nextFirmaTecnico || !nextFirmaCliente)) {
      return res.status(400).json({ error: 'Se requieren ambas firmas para cerrar la ficha' });
    }

    const emailNorm = email_cliente !== undefined
      ? normalizeEmail(email_cliente)
      : current.rows[0].email_cliente;

    const categoriasData = categorias !== undefined
      ? sanitizeCategorias(categorias)
      : (current.rows[0].categorias || []);

    let fotosStored = current.rows[0].fotos || [];
    if (fotos !== undefined) {
      fotosStored = await persistFotosFromPayload(
        Number(id),
        parseFotosInput(fotos),
        current.rows[0].fotos || []
      );
    }

    const estado = firmar ? 'firmada' : 'borrador';
    const updated = await pool.query(
      `UPDATE mantenciones_fichas SET
         tipo = COALESCE($1, tipo),
         fecha = COALESCE(NULLIF($2,'')::date, fecha),
         hora = COALESCE(NULLIF($3,'')::time, hora),
         trabajo = COALESCE($4, trabajo),
         nota = COALESCE($5, nota),
         dano_descripcion = COALESCE($6, dano_descripcion),
         checklist = COALESCE($7::jsonb, checklist),
         realizado_por = COALESCE($8, realizado_por),
         firmante_cliente = COALESCE($9, firmante_cliente),
         firma_tecnico = COALESCE($10, firma_tecnico),
         firma_cliente = COALESCE($11, firma_cliente),
         email_cliente = COALESCE($12, email_cliente),
         proxima_mantencion = COALESCE(NULLIF($13,'')::date, proxima_mantencion),
         estado = $14,
         firmada_en = CASE WHEN $14 = 'firmada' THEN COALESCE(firmada_en, NOW()) ELSE firmada_en END,
         rut_cliente = COALESCE($15, rut_cliente),
         senores = COALESCE($16, senores),
         direccion = COALESCE($17, direccion),
         ciudad_comuna = COALESCE($18, ciudad_comuna),
         telefono_cliente = COALESCE($19, telefono_cliente),
         contacto_nombre = COALESCE($20, contacto_nombre),
         version_sw = COALESCE($21, version_sw),
         motivo_atencion = COALESCE($22, motivo_atencion),
         categorias = $23::jsonb,
         fotos = $24::jsonb,
         actualizado_en = NOW()
       WHERE id = $25
       RETURNING *`,
      [
        tipo || null,
        fecha || null,
        hora || null,
        trabajo ?? null,
        nota ?? null,
        dano_descripcion ?? null,
        JSON.stringify(checklistData),
        realizado_por || null,
        firmante_cliente || null,
        firmar ? nextFirmaTecnico : (firma_tecnico || null),
        firmar ? nextFirmaCliente : (firma_cliente || null),
        emailNorm,
        proxima_mantencion ?? null,
        estado,
        rut_cliente ?? null,
        senores ?? null,
        direccion ?? null,
        ciudad_comuna ?? null,
        telefono_cliente ?? null,
        contacto_nombre ?? null,
        version_sw ?? null,
        motivo_atencion ?? null,
        JSON.stringify(categoriasData),
        JSON.stringify(fotosStored),
        id,
      ]
    );

    const ficha = mapFichaRow(updated.rows[0]);
    await prepareFichaFotos(ficha);
    if (firmar) {
      await maybeGrantPortalAccess(ficha, firmante_cliente || ficha.firmante_cliente);
    }
    res.json(ficha);
  } catch (err) {
    console.error('Error actualizando mantención:', err);
    if (err.code === 'DISK_FULL') {
      return res.status(507).json({ error: err.message });
    }
    res.status(500).json({ error: 'Error al actualizar mantención' });
  }
});

router.post('/:id/firmar', authRequired, async (req, res) => {
  try {
    await ensureMantencionesSchema();
    const { id } = req.params;
    const { firma_tecnico, firma_cliente, firmante_cliente, realizado_por } = req.body;
    const current = await pool.query('SELECT * FROM mantenciones_fichas WHERE id = $1', [id]);
    if (current.rowCount === 0) return res.status(404).json({ error: 'Ficha no encontrada' });
    if (current.rows[0].estado === 'firmada') {
      return res.status(403).json({ error: 'La ficha ya está firmada' });
    }
    if (!firma_tecnico || !firma_cliente) {
      return res.status(400).json({ error: 'Se requieren ambas firmas' });
    }

    const updated = await pool.query(
      `UPDATE mantenciones_fichas SET
         firma_tecnico = $1,
         firma_cliente = $2,
         firmante_cliente = COALESCE($3, firmante_cliente),
         realizado_por = COALESCE($4, realizado_por),
         estado = 'firmada',
         firmada_en = NOW(),
         actualizado_en = NOW()
       WHERE id = $5
       RETURNING *`,
      [
        firma_tecnico,
        firma_cliente,
        firmante_cliente || null,
        realizado_por || (req.user && req.user.nombre) || null,
        id,
      ]
    );
    const ficha = mapFichaRow(updated.rows[0]);
    await prepareFichaFotos(ficha);
    await maybeGrantPortalAccess(ficha, firmante_cliente || ficha.firmante_cliente);
    res.json(ficha);
  } catch (err) {
    console.error('Error firmando mantención:', err);
    res.status(500).json({ error: 'Error al firmar mantención' });
  }
});

router.delete('/:id', authRequired, async (req, res) => {
  try {
    await ensureMantencionesSchema();
    const { id } = req.params;
    const del = await pool.query(
      'DELETE FROM mantenciones_fichas WHERE id = $1 RETURNING id',
      [id]
    );
    if (del.rowCount === 0) {
      return res.status(404).json({ error: 'Ficha no encontrada' });
    }
    await deleteAllFichaFotos(Number(id));
    res.json({ mensaje: 'Ficha eliminada', id: del.rows[0].id });
  } catch (err) {
    console.error('Error eliminando mantención:', err);
    res.status(500).json({ error: 'Error al eliminar ficha' });
  }
});

export default router;
