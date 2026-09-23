import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import { textoCliente } from '../src/services/textoCliente.js';

function clientMask() {
  const src = fs.readFileSync(new URL('../views/partials/cliente_equipo_script.ejs', import.meta.url), 'utf8');
  const start = src.indexOf('function textoCliente');
  const end = src.indexOf('function bindTextoCliente');
  return new Function(`${src.slice(start, end)}\nreturn textoCliente;`)();
}

test('textoCliente pone mayúsculas y quita tildes', () => {
  assert.equal(textoCliente('Clínica Ñuñoa'), 'CLINICA NUNOA');
  assert.equal(textoCliente('josé pérez'), 'JOSE PEREZ');
  assert.equal(textoCliente('ÁÉÍÓÚ ü'), 'AEIOU U');
  assert.equal(textoCliente("O'Higgins"), "O'HIGGINS");
  assert.equal(textoCliente('  clínica  '), '  CLINICA  ');
});

test('textoCliente deja vacío lo que no trae texto', () => {
  assert.equal(textoCliente(''), '');
  assert.equal(textoCliente('   '), '   ');
  assert.equal(textoCliente(null), null);
  assert.equal(textoCliente(undefined), undefined);
});

test('la máscara del formulario usa la misma regla', () => {
  const mask = clientMask();
  assert.equal(mask('Clínica Ñuñoa'), textoCliente('Clínica Ñuñoa'));
  assert.equal(mask('contacto ávila'), 'CONTACTO AVILA');
});
