/** Sanitiza fechas/horas/textos del borrador para que un valor malo no tumbe el UPDATE. */

export const VARCHAR_LIMITS = {
  tipo: 30,
  rut_cliente: 30,
  senores: 200,
  direccion: 250,
  ciudad_comuna: 150,
  telefono_cliente: 50,
  contacto_nombre: 150,
  version_sw: 80,
  email_cliente: 150,
  realizado_por: 150,
  firmante_cliente: 150,
};

function pad2(n) {
  return String(n).padStart(2, '0');
}

function formatLocalYmd(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function formatFechaForInput(value) {
  const d = toDateParam(value);
  return d || '';
}

export function formatHoraForInput(value) {
  const t = toTimeParam(value);
  return t || '';
}

/**
 * Solo YYYY-MM-DD. Acepta Date, ISO, y dd/mm/aaaa (Chile).
 * Rechaza basura tipo "Mon Mar 02" que rompe `::date` en Postgres.
 */
export function toDateParam(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return formatLocalYmd(value);
  }
  const s = String(value).trim();
  if (!s || s === 'null' || s === 'undefined') return null;

  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const mo = Number(iso[2]);
    const d = Number(iso[3]);
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return `${iso[1]}-${iso[2]}-${iso[3]}`;
    return null;
  }

  const dmy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmy) {
    const day = Number(dmy[1]);
    const mo = Number(dmy[2]);
    const y = Number(dmy[3]);
    if (mo >= 1 && mo <= 12 && day >= 1 && day <= 31) {
      return `${y}-${pad2(mo)}-${pad2(day)}`;
    }
    return null;
  }

  return null;
}

/** Solo HH:MM. */
export function toTimeParam(value) {
  if (value == null || value === '') return null;
  const s = String(value).trim();
  const m = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (hh > 23 || mm > 59) return null;
  return `${pad2(hh)}:${pad2(mm)}`;
}

export function clipVarchar(value, max) {
  if (value == null) return null;
  const s = String(value);
  if (s === '') return '';
  return s.length <= max ? s : s.slice(0, max);
}

export function jsonbParam(value, fallback = []) {
  try {
    if (value == null) return JSON.stringify(fallback);
    if (typeof value === 'string') {
      const parsed = JSON.parse(value);
      return JSON.stringify(parsed);
    }
    return JSON.stringify(value);
  } catch {
    return JSON.stringify(fallback);
  }
}

export function publicUpdateError(err) {
  const msg = String(err?.message || '');
  if (err?.code === 'DISK_FULL') return err.message;
  if (/invalid input syntax for type date/i.test(msg)) {
    return 'Fecha inválida. Usa el calendario (AAAA-MM-DD). El resto del borrador no se perdió.';
  }
  if (/invalid input syntax for type time/i.test(msg)) {
    return 'Hora inválida. Usa el formato HH:MM.';
  }
  if (/value too long/i.test(msg)) {
    return 'Uno de los textos supera el largo permitido.';
  }
  if (msg) return `Error al actualizar mantención: ${msg}`;
  return 'Error al actualizar mantención';
}
