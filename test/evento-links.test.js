import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eventLinkUpdate } from '../src/services/eventoLinks.js';

test('editar hora o nota no borra el equipo ni el cliente de la visita', () => {
  const links = eventLinkUpdate({
    titulo: 'MP Garantía · SN-1',
    fecha: '2026-11-01',
    hora_inicio: '10:00',
    descripcion: 'confirmar con cliente',
    tipo: 'mp_garantia',
    ticket_id: '',
  });
  assert.equal(links.set_equipo_id, false);
  assert.equal(links.set_cliente_id, false);
});

test('un cuerpo explícito sí puede cambiar o quitar el vínculo', () => {
  const changed = eventLinkUpdate({ equipo_id: '15', cliente_id: 4 });
  assert.deepEqual(
    { equipo_id: changed.equipo_id, cliente_id: changed.cliente_id, set_equipo_id: changed.set_equipo_id, set_cliente_id: changed.set_cliente_id },
    { equipo_id: 15, cliente_id: 4, set_equipo_id: true, set_cliente_id: true }
  );

  const cleared = eventLinkUpdate({ equipo_id: '', cliente_id: null });
  assert.equal(cleared.set_equipo_id, true);
  assert.equal(cleared.equipo_id, null);
  assert.equal(cleared.set_cliente_id, true);
  assert.equal(cleared.cliente_id, null);
});

test('ids inválidos no se escriben como número', () => {
  const links = eventLinkUpdate({ equipo_id: 'abc', cliente_id: '0' });
  assert.equal(links.set_equipo_id, true);
  assert.equal(links.equipo_id, null);
  assert.equal(links.cliente_id, null);
});
