/**
 * El formulario de edición manda cliente_id vacío ("Seleccionar Cliente") para
 * devolver el equipo a stock. COALESCE no puede escribir NULL, así que hay que
 * distinguir "no venía el campo" de "quitar el cliente".
 */

export function resolveEquipoClientePatch(body) {
  if (!body || !Object.prototype.hasOwnProperty.call(body, 'cliente_id')) {
    return { apply: false, clienteId: null };
  }
  const raw = body.cliente_id;
  if (raw === null || raw === undefined || String(raw).trim() === '' || raw === 'STOCK') {
    return { apply: true, clienteId: null };
  }
  const id = Number.parseInt(String(raw), 10);
  if (!Number.isFinite(id) || id <= 0) {
    return { apply: false, clienteId: null };
  }
  return { apply: true, clienteId: id };
}
