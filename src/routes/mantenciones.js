import { Router } from 'express';
import pool from '../db.js';
import authRequired from '../middleware/authRequired.js';
import {
  ensureMantencionesSchema,
  getProtocoloByMarca,
  checklistTemplateFromProtocolo,
  CATEGORIAS_ATENCION,
  resetMantencionesCompletas,
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
import {
  VARCHAR_LIMITS,
  toDateParam,
  toTimeParam,
  clipVarchar,
  jsonbParam,
  publicUpdateError,
  formatFechaForInput,
  formatHoraForInput,
} from '../services/mantencionesDraft.js';
import fs from 'fs';

const router = Router();

function mapFichaRow(row, { withFotos = true } = {}) {
  if (!row) return null;
  const ficha = {
    ...row,
    fecha: formatFechaForInput(row.fecha) || null,
    hora: formatHoraForInput(row.hora) || null,
    proxima_mantencion: formatFechaForInput(row.proxima_mantencion) || null,
    checklist: parseJsonArray(row.checklist, []),
    categorias: parseJsonArray(row.categorias, []),
  };
  if (withFotos) {
    ficha.fotos = parseJsonArray(row.fotos, []);
  }
  return ficha;
}

function clipField(value, key) {
  const max = VARCHAR_LIMITS[key];
  if (!max) return value == null ? null : String(value);
  return clipVarchar(value, max);
}

async function prepareFichaFotos(ficha) {
  return attachFichaFotos(ficha, pool);
}

function parseJsonArray(value, fallback = []) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') {
    // pg a veces entrega objetos indexados; no es array
    return fallback;
  }
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

/** Campos de texto editables en fichas firmadas (nunca firmas/fotos/checklist/estado). */
const TEXTO_EDITABLE_FIELDS = [
  'rut_cliente',
  'senores',
  'direccion',
  'ciudad_comuna',
  'telefono_cliente',
  'contacto_nombre',
  'email_cliente',
  'version_sw',
  'motivo_atencion',
  'dano_descripcion',
  'trabajo',
  'nota',
  'realizado_por',
  'firmante_cliente',
  'proxima_mantencion',
];

function sanitizeCategorias(value) {
  return parseJsonArray(value).filter((id) => CATEGORIA_IDS.has(String(id))).slice(0, 8);
}

function pickTextoEdits(body = {}) {
  const out = {};
  for (const key of TEXTO_EDITABLE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(body, key)) {
      if (key === 'proxima_mantencion') {
        out[key] = toDateParam(body[key]);
      } else if (key === 'email_cliente') {
        out[key] = clipField(body[key], 'email_cliente');
      } else if (VARCHAR_LIMITS[key]) {
        out[key] = clipField(body[key], key);
      } else {
        out[key] = body[key];
      }
    }
  }
  return out;
}

async function canAccessFichaFoto(req, fichaId) {
  if (req.isAuthenticated && req.isAuthenticated()) return true;

  const portal = req.session?.portalUser;
  if (!portal?.cliente_id) return false;

  const portalEmail = String(portal.email || '').trim().toLowerCase();
  if (!portalEmail) return false;

  const r = await pool.query(
    `SELECT m.id
     FROM mantenciones_fichas m
     INNER JOIN equipos e ON e.id = m.equipo_id
     WHERE m.id = $1
       AND e.cliente_id = $2
       AND m.estado = 'firmada'
       AND lower(trim(m.email_cliente)) = $3`,
    [fichaId, portal.cliente_id, portalEmail]
  );
  return r.rowCount > 0;
}

function normalizeEmail(email) {
  const e = String(email || '').trim().toLowerCase();
  return e || null;
}

/** Persiste firmas también en borrador; ignora pads vacíos / data URLs inválidas. */
function normalizeFirmaDataUrl(value) {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s || s === 'null' || s === 'undefined') return null;
  if (!s.startsWith('data:image/')) return null;
  // Canvas en blanco suele ser muy corto; firmas reales son más largas
  if (s.length < 80) return null;
  return s;
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
      const qIdx = values.length;
      const clauses = [
        `e.nombre ILIKE $${qIdx}`,
        `e.marca ILIKE $${qIdx}`,
        `e.modelo ILIKE $${qIdx}`,
        `e.numero_serie ILIKE $${qIdx}`,
        `e.cliente ILIKE $${qIdx}`,
        `c.nombre ILIKE $${qIdx}`,
        `m.senores ILIKE $${qIdx}`,
        `m.trabajo ILIKE $${qIdx}`,
        `m.realizado_por ILIKE $${qIdx}`,
        `CAST(m.id AS TEXT) ILIKE $${qIdx}`,
      ];
      where.push(`(${clauses.join(' OR ')})`);
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
      title: 'Informes Técnicos - BIODATA',
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
      title: 'Nuevo informe técnico - Biohertz',
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

router.post('/admin/reset', authRequired, async (req, res) => {
  try {
    const user = req.user || req.session?.user;
    if (user?.rol !== 'admin') {
      return res.status(403).json({ error: 'Solo administradores pueden reiniciar mantenciones' });
    }
    const confirm = String(req.body?.confirm || req.query?.confirm || '');
    if (confirm !== 'REINICIAR') {
      return res.status(400).json({
        error: 'Confirmación requerida',
        hint: 'POST con JSON { "confirm": "REINICIAR" }',
      });
    }
    await resetMantencionesCompletas();
    res.json({ ok: true, mensaje: 'Mantenciones reiniciadas desde cero. La próxima ficha será Nº 00001.' });
  } catch (err) {
    console.error('Error reiniciando mantenciones:', err);
    res.status(500).json({ error: 'No se pudo reiniciar mantenciones' });
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

router.get('/:id/editar-textos', authRequired, async (req, res) => {
  try {
    await ensureMantencionesSchema();
    const { id } = req.params;
    const result = await pool.query(
      `SELECT m.*,
              e.nombre AS equipo_nombre,
              e.marca AS equipo_marca,
              e.modelo AS equipo_modelo,
              e.numero_serie AS equipo_serie,
              e.cliente AS equipo_cliente
       FROM mantenciones_fichas m
       LEFT JOIN equipos e ON e.id = m.equipo_id
       WHERE m.id = $1`,
      [id]
    );
    if (result.rowCount === 0) {
      return res.status(404).send('Ficha no encontrada');
    }

    const ficha = mapFichaRow(result.rows[0], { withFotos: false });
    if (ficha.estado !== 'firmada') {
      return res.redirect('/mantenciones/' + id);
    }

    res.render('mantencion_editar_textos', {
      title: `Editar textos Nº ${String(ficha.id).padStart(5, '0')} - Biohertz`,
      user: req.user || req.session.user,
      ficha,
    });
  } catch (err) {
    console.error('Error abriendo edición de textos:', err);
    res.status(500).send('Error al abrir edición de textos');
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
        title: `Informes Técnicos Nº ${String(ficha.id).padStart(5, '0')} - Biohertz`,
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

    let checklistEdit = Array.isArray(ficha.checklist) ? ficha.checklist : [];
    // Borrador preventiva sin ítems: rehidratar protocolo para que se pueda marcar
    if (
      ficha.estado === 'borrador' &&
      ficha.tipo !== 'correctiva' &&
      (!checklistEdit.length)
    ) {
      const protocolo = await getProtocoloByMarca(equipo.marca);
      checklistEdit = checklistTemplateFromProtocolo(protocolo);
    }

    res.render('mantencion_ficha', {
      title: `Informe técnico #${ficha.id} - Biohertz`,
      user: req.user || req.session.user,
      ficha,
      equipos: equiposRes.rows,
      equipo,
      checklist: checklistEdit,
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
    const firmaTecnicoSave = normalizeFirmaDataUrl(firma_tecnico);
    const firmaClienteSave = normalizeFirmaDataUrl(firma_cliente);
    if (firmar) {
      if (!firmaTecnicoSave || !firmaClienteSave) {
        return res.status(400).json({ error: 'Se requieren ambas firmas para cerrar la ficha' });
      }
    }

    const emailNorm = clipField(normalizeEmail(email_cliente), 'email_cliente');
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
        $1, $2, $3, $4, $5::date, $6::time, $7, $8, $9,
        $10::jsonb, $11, $12, $13, $14, $15,
        $16, $17::date, $18,
        $19, $20, $21, $22, $23, $24,
        $25, $26, $27::jsonb, '[]'::jsonb
      ) RETURNING *`,
      [
        Number(equipo_id),
        eq.rows[0].cliente_id || null,
        tipo,
        estado,
        toDateParam(fecha),
        toTimeParam(hora),
        trabajo || '',
        nota || '',
        dano_descripcion || '',
        jsonbParam(checklistData, []),
        clipField(realizado_por || (req.user && req.user.nombre) || null, 'realizado_por'),
        req.user?.id || null,
        firmaTecnicoSave,
        firmaClienteSave,
        clipField(firmante_cliente, 'firmante_cliente'),
        emailNorm,
        toDateParam(proxima_mantencion),
        firmar ? new Date() : null,
        clipField(rut_cliente, 'rut_cliente'),
        clipField(senores || eq.rows[0].cliente || null, 'senores'),
        clipField(direccion, 'direccion'),
        clipField(ciudad_comuna, 'ciudad_comuna'),
        clipField(telefono_cliente, 'telefono_cliente'),
        clipField(contacto_nombre, 'contacto_nombre'),
        clipField(version_sw, 'version_sw'),
        motivo_atencion || '',
        jsonbParam(categoriasData, []),
      ]
    );

    const fichaId = insert.rows[0].id;
    let fotosStored = [];
    try {
      fotosStored = await persistFotosFromPayload(fichaId, fotosInput, []);
    } catch (fotoErr) {
      console.warn('Fotos al crear ficha:', fotoErr.message);
    }
    if (fotosStored.length) {
      await pool.query('UPDATE mantenciones_fichas SET fotos = $1::jsonb WHERE id = $2', [
        jsonbParam(fotosStored, []),
        fichaId,
      ]);
      insert.rows[0].fotos = fotosStored;
    }

    const ficha = mapFichaRow(insert.rows[0]);
    try { await prepareFichaFotos(ficha); } catch (e) { console.warn('prepareFichaFotos:', e.message); }
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
    res.status(500).json({ error: 'Error al crear mantención: ' + (err.message || 'error interno') });
  }
});

router.patch('/:id/textos', authRequired, async (req, res) => {
  try {
    await ensureMantencionesSchema();
    const { id } = req.params;
    const current = await pool.query('SELECT * FROM mantenciones_fichas WHERE id = $1', [id]);
    if (current.rowCount === 0) {
      return res.status(404).json({ error: 'Ficha no encontrada' });
    }
    if (current.rows[0].estado !== 'firmada') {
      return res.status(400).json({
        error: 'Usa la edición normal del borrador; este endpoint es solo para fichas firmadas',
      });
    }

    const edits = pickTextoEdits(req.body || {});
    if (!Object.keys(edits).length) {
      return res.status(400).json({ error: 'No hay textos para actualizar' });
    }

    const row = current.rows[0];
    const next = { ...row };
    for (const key of TEXTO_EDITABLE_FIELDS) {
      if (!Object.prototype.hasOwnProperty.call(edits, key)) continue;
      if (key === 'email_cliente') {
        next.email_cliente = normalizeEmail(edits.email_cliente);
      } else if (key === 'proxima_mantencion') {
        const raw = edits.proxima_mantencion;
        next.proxima_mantencion = raw === null || raw === undefined || String(raw).trim() === ''
          ? null
          : String(raw).slice(0, 10);
      } else {
        const val = edits[key];
        next[key] = val === null || val === undefined ? '' : String(val);
      }
    }

    const updated = await pool.query(
      `UPDATE mantenciones_fichas SET
         rut_cliente = $1,
         senores = $2,
         direccion = $3,
         ciudad_comuna = $4,
         telefono_cliente = $5,
         contacto_nombre = $6,
         email_cliente = $7,
         version_sw = $8,
         motivo_atencion = $9,
         dano_descripcion = $10,
         trabajo = $11,
         nota = $12,
         realizado_por = $13,
         firmante_cliente = $14,
         proxima_mantencion = $15::date,
         actualizado_en = NOW()
       WHERE id = $16
         AND estado = 'firmada'
       RETURNING *`,
      [
        next.rut_cliente || null,
        next.senores || null,
        next.direccion || null,
        next.ciudad_comuna || null,
        next.telefono_cliente || null,
        next.contacto_nombre || null,
        next.email_cliente || null,
        next.version_sw || null,
        next.motivo_atencion || null,
        next.dano_descripcion || null,
        next.trabajo || null,
        next.nota || null,
        next.realizado_por || null,
        next.firmante_cliente || null,
        next.proxima_mantencion || null,
        id,
      ]
    );

    if (updated.rowCount === 0) {
      return res.status(409).json({ error: 'No se pudo actualizar: la ficha ya no está firmada' });
    }

    const updatedRow = updated.rows[0];
    // Garantía: este UPDATE no toca firmas ni estado
    if (
      updatedRow.estado !== 'firmada' ||
      updatedRow.firma_tecnico !== row.firma_tecnico ||
      updatedRow.firma_cliente !== row.firma_cliente
    ) {
      console.error('[mantenciones] integridad textos: se detectó cambio inesperado en ficha', id);
      return res.status(500).json({ error: 'Error de integridad al guardar textos' });
    }

    const ficha = mapFichaRow(updatedRow);
    await prepareFichaFotos(ficha);
    res.json(ficha);
  } catch (err) {
    console.error('Error actualizando textos de mantención:', err);
    res.status(500).json({ error: 'Error al actualizar textos' });
  }
});

router.patch('/:id', authRequired, async (req, res) => {
  try {
    await ensureMantencionesSchema();
    const { id } = req.params;
    const current = await pool.query('SELECT * FROM mantenciones_fichas WHERE id = $1', [id]);
    if (current.rowCount === 0) return res.status(404).json({ error: 'Ficha no encontrada' });
    if (current.rows[0].estado === 'firmada') {
      return res.status(403).json({
        error: 'La ficha firmada no se puede editar por completo. Usa /mantenciones/' + id + '/editar-textos',
      });
    }

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

    let nextEquipoId = current.rows[0].equipo_id;
    let nextClienteId = current.rows[0].cliente_id;
    if (equipo_id !== undefined && equipo_id !== null && Number(equipo_id) !== Number(current.rows[0].equipo_id)) {
      const eq = await pool.query('SELECT id, cliente_id FROM equipos WHERE id = $1', [Number(equipo_id)]);
      if (eq.rowCount === 0) return res.status(404).json({ error: 'Equipo no encontrado' });
      nextEquipoId = eq.rows[0].id;
      nextClienteId = eq.rows[0].cliente_id || null;
    }

    let checklistData = current.rows[0].checklist;
    if (checklist !== undefined) {
      if (typeof checklist === 'string') {
        try { checklistData = JSON.parse(checklist); } catch { /* keep */ }
      } else if (Array.isArray(checklist)) {
        checklistData = checklist;
      }
    }

    const firmar = String(guardar_y_firmar) === 'true' || String(guardar_y_firmar) === '1';
    // El front siempre reenvía la firma existente al guardar; si el pad se limpió, manda null.
    const hasFirmaTecnico = Object.prototype.hasOwnProperty.call(req.body, 'firma_tecnico');
    const hasFirmaCliente = Object.prototype.hasOwnProperty.call(req.body, 'firma_cliente');
    const firmaTecnicoSave = firmar
      ? (normalizeFirmaDataUrl(firma_tecnico) || current.rows[0].firma_tecnico)
      : (hasFirmaTecnico ? normalizeFirmaDataUrl(firma_tecnico) : current.rows[0].firma_tecnico);
    const firmaClienteSave = firmar
      ? (normalizeFirmaDataUrl(firma_cliente) || current.rows[0].firma_cliente)
      : (hasFirmaCliente ? normalizeFirmaDataUrl(firma_cliente) : current.rows[0].firma_cliente);

    if (firmar && (!firmaTecnicoSave || !firmaClienteSave)) {
      return res.status(400).json({ error: 'Se requieren ambas firmas para cerrar la ficha' });
    }

    const emailNorm = email_cliente !== undefined
      ? clipField(normalizeEmail(email_cliente), 'email_cliente')
      : current.rows[0].email_cliente;

    const categoriasData = categorias !== undefined
      ? sanitizeCategorias(categorias)
      : (current.rows[0].categorias || []);

    let fotosStored = parseJsonArray(current.rows[0].fotos, []);
    let fotoWarning = null;
    if (fotos !== undefined) {
      try {
        fotosStored = await persistFotosFromPayload(
          Number(id),
          parseFotosInput(fotos),
          parseJsonArray(current.rows[0].fotos, [])
        );
      } catch (fotoErr) {
        console.warn('Fotos en borrador (se guarda el resto):', fotoErr.message);
        fotoWarning = fotoErr.code === 'DISK_FULL'
          ? fotoErr.message
          : 'No se pudieron guardar las fotos nuevas; el resto del borrador sí se guardó.';
        fotosStored = parseJsonArray(current.rows[0].fotos, []);
      }
    }

    const estado = firmar ? 'firmada' : 'borrador';
    const nextTipo = ['preventiva', 'correctiva'].includes(tipo) ? tipo : null;
    const updated = await pool.query(
      `UPDATE mantenciones_fichas SET
         equipo_id = $26,
         cliente_id = $27,
         tipo = COALESCE($1::varchar, tipo),
         fecha = COALESCE($2::date, fecha),
         hora = COALESCE($3::time, hora),
         trabajo = COALESCE($4, trabajo),
         nota = COALESCE($5, nota),
         dano_descripcion = COALESCE($6, dano_descripcion),
         checklist = COALESCE($7::jsonb, checklist),
         realizado_por = COALESCE($8, realizado_por),
         firmante_cliente = COALESCE($9, firmante_cliente),
         firma_tecnico = $10,
         firma_cliente = $11,
         email_cliente = COALESCE($12, email_cliente),
         proxima_mantencion = COALESCE($13::date, proxima_mantencion),
         estado = $14::varchar,
         firmada_en = CASE WHEN $14::varchar = 'firmada' THEN COALESCE(firmada_en, NOW()) ELSE firmada_en END,
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
         AND estado = 'borrador'
       RETURNING *`,
      [
        nextTipo,
        toDateParam(fecha),
        toTimeParam(hora),
        trabajo ?? null,
        nota ?? null,
        dano_descripcion ?? null,
        jsonbParam(checklistData, []),
        clipField(realizado_por, 'realizado_por'),
        clipField(firmante_cliente, 'firmante_cliente'),
        firmaTecnicoSave ?? null,
        firmaClienteSave ?? null,
        emailNorm,
        toDateParam(proxima_mantencion),
        estado,
        clipField(rut_cliente, 'rut_cliente'),
        clipField(senores, 'senores'),
        clipField(direccion, 'direccion'),
        clipField(ciudad_comuna, 'ciudad_comuna'),
        clipField(telefono_cliente, 'telefono_cliente'),
        clipField(contacto_nombre, 'contacto_nombre'),
        clipField(version_sw, 'version_sw'),
        motivo_atencion ?? null,
        jsonbParam(categoriasData, []),
        jsonbParam(fotosStored, []),
        id,
        nextEquipoId ?? null,
        nextClienteId ?? null,
      ]
    );

    if (updated.rowCount === 0) {
      return res.status(409).json({
        error: 'No se pudo guardar: la ficha ya no está en borrador',
      });
    }

    const ficha = mapFichaRow(updated.rows[0]);
    try { await prepareFichaFotos(ficha); } catch (e) { console.warn('prepareFichaFotos:', e.message); }
    if (firmar) {
      await maybeGrantPortalAccess(ficha, firmante_cliente || ficha.firmante_cliente);
    }
    if (fotoWarning) ficha.foto_warning = fotoWarning;
    res.json(ficha);
  } catch (err) {
    console.error('Error actualizando mantención:', err);
    if (err.code === 'DISK_FULL') {
      return res.status(507).json({ error: err.message });
    }
    res.status(500).json({ error: publicUpdateError(err) });
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
