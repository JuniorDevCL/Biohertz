import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveEquipoClientePatch } from '../src/services/equipoCliente.js';

test('el select vacío del formulario quita el cliente', () => {
  assert.deepEqual(resolveEquipoClientePatch({ cliente_id: '' }), {
    apply: true,
    clienteId: null,
  });
  assert.deepEqual(resolveEquipoClientePatch({ cliente_id: 'STOCK' }), {
    apply: true,
    clienteId: null,
  });
  assert.deepEqual(resolveEquipoClientePatch({ cliente_id: null }), {
    apply: true,
    clienteId: null,
  });
});

test('un id numérico asigna ese cliente', () => {
  assert.deepEqual(resolveEquipoClientePatch({ cliente_id: '15' }), {
    apply: true,
    clienteId: 15,
  });
  assert.deepEqual(resolveEquipoClientePatch({ cliente_id: 4 }), {
    apply: true,
    clienteId: 4,
  });
});

test('si el cuerpo no trae cliente_id no se toca el vínculo', () => {
  assert.deepEqual(resolveEquipoClientePatch({ nombre: 'Monitor' }), {
    apply: false,
    clienteId: null,
  });
  assert.deepEqual(resolveEquipoClientePatch({ cliente_id: 'abc' }), {
    apply: false,
    clienteId: null,
  });
});
