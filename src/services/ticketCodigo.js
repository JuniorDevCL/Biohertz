/**
 * Siguiente código de ticket (MP-004, VT-012, …).
 * Usa el mayor número ya emitido. Contar filas reutiliza un código vivo
 * en cuanto se borra cualquier ticket de ese tipo.
 */
export function nextCodigoFromExisting(prefijo, codigos) {
  const prefix = String(prefijo || 'TK');
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`^${escaped}-(\\d+)$`, 'i');
  let max = 0;
  for (const codigo of codigos || []) {
    const match = String(codigo || '').trim().match(re);
    if (!match) continue;
    const n = Number(match[1]);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `${prefix}-${String(max + 1).padStart(3, '0')}`;
}
