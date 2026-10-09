import pool from '../db.js';

export const MP_GARANTIA_TIPO = 'mp_garantia';
export const MP_GARANTIA_COLOR = '#f43f5e';

export function emptyToNull(value) {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed || null;
}

export function parseMonths(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(n, 120);
}

export function addMonthsYmd(dateStr, months) {
  const fecha = emptyToNull(dateStr);
  const n = parseMonths(months);
  if (!fecha || !n) return null;
  const d = new Date(`${fecha.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  d.setMonth(d.getMonth() + n);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function parseMpFechas(body) {
  if (!body) return [];
  let raw = body.mp_fechas;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed.startsWith('[')) {
      try { raw = JSON.parse(trimmed); } catch { raw = trimmed.split(/[,\n]/); }
    } else {
      raw = trimmed ? trimmed.split(/[,\n]/) : [];
    }
  }
  if (!Array.isArray(raw)) {
    raw = [];
    Object.keys(body).forEach((key) => {
      if (key === 'mp_fechas[]' || /^mp_fecha_?\d+$/i.test(key)) {
        const val = body[key];
        if (Array.isArray(val)) raw.push(...val);
        else raw.push(val);
      }
    });
  }
  const seen = new Set();
  const out = [];
  for (const item of raw) {
    const d = String(item || '').trim().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || seen.has(d)) continue;
    seen.add(d);
    out.push(d);
  }
  return out.slice(0, 24);
}

function buildEquipoNombre({ marca, modelo, numero_serie }) {
  const fromMarcaModelo = [marca, modelo]
    .map((v) => String(v || '').trim())
    .filter(Boolean)
    .join(' ');
  if (fromMarcaModelo) return fromMarcaModelo.slice(0, 150);
  const serie = String(numero_serie || '').trim();
  if (serie) return `Equipo ${serie}`.slice(0, 150);
  return 'Equipo';
}

export class EquipoLinkError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'EquipoLinkError';
    this.code = code;
  }
}

function parseOptionalId(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function belongsToOtherClient(row, clienteId) {
  if (!row || row.cliente_id == null || row.cliente_id === '') return false;
  if (clienteId == null || clienteId === '') return true;
  return Number(row.cliente_id) !== Number(clienteId);
}

async function resolveEquipoTarget({ clienteId, numeroSerie, equipoId }) {
  const bySerie = await pool.query(
    `SELECT * FROM equipos WHERE LOWER(TRIM(numero_serie)) = LOWER(TRIM($1)) LIMIT 1`,
    [numeroSerie]
  );
  const serieRow = bySerie.rows[0] || null;
  const parsedId = parseOptionalId(equipoId);

  if (parsedId) {
    const byId = await pool.query('SELECT * FROM equipos WHERE id = $1', [parsedId]);
    if (byId.rowCount === 0) {
      throw new EquipoLinkError('El equipo indicado no existe', 'EQUIPO_NOT_FOUND');
    }
    const row = byId.rows[0];
    if (belongsToOtherClient(row, clienteId)) {
      throw new EquipoLinkError('Ese equipo pertenece a otro cliente', 'EQUIPO_CLIENTE_CONFLICT');
    }
    if (serieRow && Number(serieRow.id) !== Number(row.id)) {
      throw new EquipoLinkError(
        'Ese número de serie ya está registrado en otro equipo',
        'EQUIPO_CLIENTE_CONFLICT'
      );
    }
    return row;
  }

  if (!serieRow) return null;
  if (belongsToOtherClient(serieRow, clienteId)) {
    throw new EquipoLinkError(
      'Ese número de serie ya pertenece a otro cliente',
      'EQUIPO_CLIENTE_CONFLICT'
    );
  }
  return serieRow;
}

/** Falla antes de escribir si la serie pertenece a otro cliente o choca con otro equipo. */
export async function assertEquipoLink({ clienteId, serie, equipoId }) {
  const numeroSerie = emptyToNull(serie);
  if (!numeroSerie) return;
  await resolveEquipoTarget({ clienteId, numeroSerie, equipoId });
}

export async function syncMpGarantiaEventos({ equipoId, clienteId, fechas, tituloBase, userId }) {
  if (!equipoId) return;
  await pool.query(
    `DELETE FROM eventos WHERE equipo_id = $1 AND tipo = $2`,
    [equipoId, MP_GARANTIA_TIPO]
  );
  const titulo = (tituloBase || 'MP Garantía').slice(0, 200);
  for (const fecha of fechas) {
    await pool.query(
      `INSERT INTO eventos (titulo, descripcion, fecha, fecha_inicio, fecha_fin, color, creado_por, creado_en, actualizado_en, tipo, equipo_id, cliente_id)
       VALUES ($1, $2, $3::DATE, $3::DATE, $3::DATE, $4, $5, NOW(), NOW(), $6, $7, $8)`,
      [
        titulo,
        'Mantención preventiva en garantía',
        fecha,
        MP_GARANTIA_COLOR,
        userId || null,
        MP_GARANTIA_TIPO,
        equipoId,
        clienteId || null
      ]
    );
  }
}

export async function upsertEquipoFromCliente({
  clienteId,
  clienteNombre,
  serie,
  marca,
  modelo,
  fechaInstalacion,
  plazoMeses,
  mpFechas,
  ubicacion,
  userId,
  equipoId
}) {
  const numeroSerie = emptyToNull(serie);
  if (!numeroSerie) return null;

  const cleanMarca = emptyToNull(marca);
  const cleanModelo = emptyToNull(modelo);
  const cleanFechaInst = emptyToNull(fechaInstalacion);
  const cleanPlazo = parseMonths(plazoMeses);
  const vencimiento = addMonthsYmd(cleanFechaInst, cleanPlazo);
  const fechas = Array.isArray(mpFechas) ? mpFechas : [];
  const nombre = buildEquipoNombre({ marca: cleanMarca, modelo: cleanModelo, numero_serie: numeroSerie });

  const target = await resolveEquipoTarget({ clienteId, numeroSerie, equipoId });

  let equipo;
  if (target) {
    const upd = await pool.query(
      `UPDATE equipos
       SET cliente_id = $1,
           cliente = COALESCE($2, cliente),
           marca = COALESCE($3, marca),
           modelo = COALESCE($4, modelo),
           numero_serie = COALESCE($5, numero_serie),
           fecha_instalacion = COALESCE($6, fecha_instalacion),
           plazo_garantia_meses = COALESCE($7, plazo_garantia_meses),
           fecha_vencimiento_garantia = COALESCE($8, fecha_vencimiento_garantia),
           mp_garantia_fechas = COALESCE($9::jsonb, mp_garantia_fechas),
           ubicacion = COALESCE($10, ubicacion),
           actualizado_en = NOW()
       WHERE id = $11
       RETURNING *`,
      [
        clienteId,
        clienteNombre || null,
        cleanMarca,
        cleanModelo,
        numeroSerie,
        cleanFechaInst,
        cleanPlazo,
        vencimiento,
        JSON.stringify(fechas),
        emptyToNull(ubicacion),
        target.id
      ]
    );
    equipo = upd.rows[0];
  } else {
    const ins = await pool.query(
      `INSERT INTO equipos (nombre, marca, modelo, numero_serie, numero_orden, fecha_embarque, fecha_ingreso, ubicacion, estado, aplicacion, cliente, cliente_id, anio_venta, fecha_instalacion, plazo_garantia_meses, fecha_vencimiento_garantia, mp_garantia_fechas, mantenciones, creado_en, actualizado_en)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17::jsonb, COALESCE($18::jsonb, '[]'::jsonb), NOW(), NOW())
       RETURNING *`,
      [
        nombre,
        cleanMarca,
        cleanModelo,
        numeroSerie,
        null,
        null,
        null,
        emptyToNull(ubicacion),
        'operativo',
        null,
        clienteNombre || null,
        clienteId,
        null,
        cleanFechaInst,
        cleanPlazo,
        vencimiento,
        JSON.stringify(fechas),
        null
      ]
    );
    equipo = ins.rows[0];
  }

  const serieLabel = equipo.numero_serie || numeroSerie;
  await syncMpGarantiaEventos({
    equipoId: equipo.id,
    clienteId,
    fechas,
    tituloBase: `MP Garantía · ${serieLabel}`,
    userId
  });

  return equipo;
}
