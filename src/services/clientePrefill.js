import { formatRutChileno } from './rut.js';

// Columnas de clientes que se cruzan con el equipo para precargar el informe técnico.
export const CLIENTE_PREFILL_SQL = `c.nombre AS cliente_nombre, c.email AS cliente_email, c.telefono AS cliente_telefono,
              c.ubicacion AS cliente_ubicacion, c.direccion AS cliente_direccion, c.rut AS cliente_rut,
              c.comuna AS cliente_comuna, c.ciudad AS cliente_ciudad, c.contacto AS cliente_contacto`;

function ciudadComuna(ciudad, comuna) {
  const parts = [ciudad, comuna].map(v => String(v || '').trim()).filter(Boolean);
  if (parts.length === 2 && parts[0].toLowerCase() === parts[1].toLowerCase()) return parts[0];
  return parts.join(' - ');
}

// Datos del cliente con los nombres de campo de mantenciones_fichas.
export function clientePrefillFromEquipo(eq) {
  if (!eq) return {};
  return {
    rut_cliente: eq.cliente_rut ? formatRutChileno(eq.cliente_rut) : '',
    senores: eq.cliente_nombre || eq.cliente || '',
    direccion: eq.cliente_direccion || eq.cliente_ubicacion || eq.ubicacion || '',
    ciudad_comuna: ciudadComuna(eq.cliente_ciudad, eq.cliente_comuna),
    telefono_cliente: eq.cliente_telefono || '',
    contacto_nombre: eq.cliente_contacto || '',
    email_cliente: eq.cliente_email || '',
  };
}
