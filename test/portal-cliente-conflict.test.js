import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import { isPortalClienteConflict } from '../src/services/portalCliente.js';

test('el mismo cliente puede volver a usar su correo de portal', () => {
  assert.equal(isPortalClienteConflict(4, 4), false);
  assert.equal(isPortalClienteConflict('4', 4), false);
  assert.equal(isPortalClienteConflict(null, 4), false);
});

test('firmar una ficha de otro cliente no debe mover la cuenta', () => {
  assert.equal(isPortalClienteConflict(4, 9), true);
  assert.equal(isPortalClienteConflict('4', '9'), true);
  assert.equal(isPortalClienteConflict(4, 'no-es-id'), true);
});

test('el alta de portal sale antes de cambiar la clave o el cliente', () => {
  const src = fs.readFileSync(new URL('../src/services/portalSchema.js', import.meta.url), 'utf8');
  const guard = src.indexOf('isPortalClienteConflict(existing.rows[0].cliente_id');
  const password = src.indexOf('plainPassword = generatePortalPassword()');
  const insert = src.indexOf('INSERT INTO portal_usuarios');
  assert.ok(guard > 0 && password > guard && insert > guard);
  assert.match(src, /cliente_id = portal_usuarios\.cliente_id/);
  assert.doesNotMatch(src, /cliente_id = EXCLUDED\.cliente_id/);
});
