import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextCodigoFromExisting } from '../src/services/ticketCodigo.js';

test('el siguiente código sigue al mayor número, no a la cantidad de filas', () => {
  // MP-002 fue eliminado. COUNT(*) + 1 devolvería MP-003, que sigue existiendo.
  assert.equal(
    nextCodigoFromExisting('MP', ['MP-001', 'MP-003']),
    'MP-004'
  );
});

test('sin tickets previos el primer código es 001', () => {
  assert.equal(nextCodigoFromExisting('VT', []), 'VT-001');
  assert.equal(nextCodigoFromExisting('MC', [null, '', 'nota']), 'MC-001');
});

test('ignora códigos de otro prefijo y no se corta en 999', () => {
  assert.equal(nextCodigoFromExisting('R', ['MP-009', 'r-2', 'R-014']), 'R-015');
  assert.equal(nextCodigoFromExisting('MC', ['MC-999']), 'MC-1000');
});
