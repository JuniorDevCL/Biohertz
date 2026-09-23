import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import { formatRutChileno, compactRut } from '../src/services/rut.js';

function clientMask() {
  const src = fs.readFileSync(new URL('../views/partials/cliente_equipo_script.ejs', import.meta.url), 'utf8');
  const start = src.indexOf('function formatRutChileno');
  const end = src.indexOf('function bindRutInput');
  const chunk = src.slice(start, end);
  return new Function(`${chunk}\nreturn { formatRutChileno, maskRutInputValue, rutDigitsFromText };`)();
}

test('formatRutChileno pone puntos y guion', () => {
  assert.equal(formatRutChileno('220671925'), '22.067.192-5');
  assert.equal(formatRutChileno('22067192-5'), '22.067.192-5');
  assert.equal(formatRutChileno('22.067.192-5'), '22.067.192-5');
  assert.equal(formatRutChileno(' 12345678k '), '12.345.678-K');
  assert.equal(formatRutChileno('76123456'), '7.612.345-6');
});

test('formatRutChileno no altera valores que no son un RUT', () => {
  assert.equal(formatRutChileno(''), '');
  assert.equal(formatRutChileno(null), null);
  assert.equal(formatRutChileno(undefined), undefined);
  assert.equal(formatRutChileno('sin rut'), 'sin rut');
  assert.equal(formatRutChileno('N/A'), 'N/A');
  assert.equal(formatRutChileno('5'), '5');
  assert.equal(formatRutChileno('1234567890'), '1234567890');
});

test('compactRut deja solo el cuerpo para buscar', () => {
  assert.equal(compactRut('22.067.192-5'), '220671925');
  assert.equal(compactRut('220671925'), '220671925');
  assert.equal(compactRut('12.345.678-K'), '12345678K');
  assert.equal(compactRut('...'), '');
});

test('la máscara del formulario coincide con el formato del servidor', () => {
  const mask = clientMask();
  assert.equal(mask.maskRutInputValue('220671925'), '22.067.192-5');
  assert.equal(mask.maskRutInputValue('22.067.192-5'), '22.067.192-5');
  assert.equal(mask.maskRutInputValue('12345678k'), '12.345.678-K');
  assert.equal(mask.maskRutInputValue('761234567'), '76.123.456-7');
  assert.equal(mask.formatRutChileno('sin rut'), 'sin rut');
  assert.equal(mask.formatRutChileno('220671925'), formatRutChileno('220671925'));
  assert.equal(mask.rutDigitsFromText('12.345.678-9extra'), '123456789');
});
