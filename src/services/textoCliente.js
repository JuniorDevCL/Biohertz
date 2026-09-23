/**
 * Razón social, contacto y dirección del cliente: mayúsculas y sin tildes.
 * No usar en correo, teléfono, RUT ni en datos de equipo.
 * La misma regla está en views/partials/cliente_equipo_script.ejs.
 */
export function textoCliente(value) {
  if (value === undefined || value === null) return value;
  const raw = String(value);
  if (!raw.trim()) return raw;
  return raw.normalize('NFD').replace(/\p{M}+/gu, '').toUpperCase();
}
