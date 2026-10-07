/** Un correo de portal pertenece a un solo cliente. No mover la cuenta al firmar otra ficha. */
export function isPortalClienteConflict(existingClienteId, nextClienteId) {
  if (existingClienteId == null || nextClienteId == null) return false;
  const current = Number(existingClienteId);
  const next = Number(nextClienteId);
  if (!Number.isFinite(current) || !Number.isFinite(next)) return true;
  return current !== next;
}
