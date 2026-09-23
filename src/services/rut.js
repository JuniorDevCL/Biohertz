/**
 * Formato visible del RUT chileno: 220671925 -> 22.067.192-5.
 * El mismo criterio vive en views/partials/cliente_equipo_script.ejs (máscara del input).
 * Si el texto no es un RUT (vacío, letras, largo distinto), se devuelve tal cual.
 */
export function formatRutChileno(value) {
  if (value === undefined || value === null) return value;
  const raw = String(value);
  const trimmed = raw.trim();
  if (!trimmed) return raw;
  const compact = trimmed.toUpperCase().replace(/[.\-\s]/g, '');
  if (!/^\d{1,8}[0-9K]$/.test(compact)) return raw;
  const dv = compact.slice(-1);
  const body = compact.slice(0, -1);
  const formattedBody = body.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${formattedBody}-${dv}`;
}

/** Quita puntos, guion y espacios para buscar el mismo RUT escrito de las dos formas. */
export function compactRut(value) {
  return String(value || '').replace(/[.\-\s]/g, '');
}
