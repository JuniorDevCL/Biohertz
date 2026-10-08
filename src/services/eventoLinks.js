/**
 * El formulario de edición del calendario no envía equipo_id ni cliente_id.
 * Si el PATCH los trata como ausentes = null, se desvincula la visita del equipo
 * y un recálculo de MP garantía deja el horario editado huérfano.
 */

function parseOptionalId(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number.parseInt(String(value), 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

export function eventLinkUpdate(body) {
  const src = body && typeof body === 'object' ? body : {};
  const has = (key) => Object.prototype.hasOwnProperty.call(src, key);
  return {
    equipo_id: has('equipo_id') ? parseOptionalId(src.equipo_id) : null,
    cliente_id: has('cliente_id') ? parseOptionalId(src.cliente_id) : null,
    set_equipo_id: has('equipo_id'),
    set_cliente_id: has('cliente_id'),
  };
}
