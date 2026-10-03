/**
 * Fechas de Postgres tipo DATE llegan como medianoche en la zona del proceso.
 * No formatearlas con timeZone America/Santiago ni con toISOString: en un
 * servidor UTC eso muestra el día anterior en Chile.
 */
import { toDateParam } from './mantencionesDraft.js';

export function ymdCalendario(value) {
  return toDateParam(value);
}

export function formatFechaCL(value, options = {}) {
  const ymd = toDateParam(value);
  if (!ymd) return null;
  const [y, m, d] = ymd.split('-');
  const year = options.yearDigits === 2 ? y.slice(-2) : y;
  return `${d}-${m}-${year}`;
}

const CAMPOS_FECHA = [
  'fecha',
  'fecha_inicio',
  'fecha_fin',
  'fecha_embarque',
  'fecha_ingreso',
  'fecha_instalacion',
  'fecha_vencimiento_garantia',
  'proxima_mantencion'
];

export function filaConFechasYmd(row) {
  if (!row || typeof row !== 'object') return row;
  const next = { ...row };
  for (const key of CAMPOS_FECHA) {
    if (next[key] == null || next[key] === '') continue;
    const ymd = toDateParam(next[key]);
    if (ymd) next[key] = ymd;
  }
  return next;
}
