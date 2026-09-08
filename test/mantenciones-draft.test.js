import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  toDateParam,
  toTimeParam,
  clipVarchar,
  jsonbParam,
  publicUpdateError,
  formatFechaForInput,
} from '../src/services/mantencionesDraft.js';

test('toDateParam acepta YYYY-MM-DD e ISO', () => {
  assert.equal(toDateParam('2020-03-02'), '2020-03-02');
  assert.equal(toDateParam('2020-03-02T00:00:00.000Z'), '2020-03-02');
});

test('toDateParam acepta Date local y dd/mm/aaaa', () => {
  assert.equal(toDateParam(new Date(2020, 2, 2)), '2020-03-02');
  assert.equal(toDateParam('02/03/2020'), '2020-03-02');
  assert.equal(toDateParam('2-3-2020'), '2020-03-02');
});

test('toDateParam rechaza basura que rompe Postgres ::date', () => {
  assert.equal(toDateParam('Mon Mar 02'), null);
  assert.equal(toDateParam('Tue Mar 03 2020'), null);
  assert.equal(toDateParam(''), null);
  assert.equal(toDateParam(null), null);
  assert.equal(toDateParam('no-es-fecha'), null);
});

test('toTimeParam normaliza HH:MM y rechaza inválidos', () => {
  assert.equal(toTimeParam('20:37'), '20:37');
  assert.equal(toTimeParam('20:37:00'), '20:37');
  assert.equal(toTimeParam('8:05'), '08:05');
  assert.equal(toTimeParam('[object Object]'), null);
  assert.equal(toTimeParam('25:00'), null);
});

test('clipVarchar y jsonbParam no lanzan', () => {
  assert.equal(clipVarchar('abc', 2), 'ab');
  assert.equal(clipVarchar(null, 10), null);
  assert.equal(jsonbParam(['a']), '["a"]');
  assert.equal(jsonbParam('no-json', []), '[]');
  assert.equal(jsonbParam(undefined, [1]), '[1]');
});

test('formatFechaForInput no deja Mon Mar 02 en el input date', () => {
  assert.equal(formatFechaForInput(new Date(2020, 2, 2)), '2020-03-02');
  assert.equal(formatFechaForInput('Mon Mar 02'), '');
});

test('publicUpdateError traduce errores de Postgres', () => {
  assert.match(
    publicUpdateError({ message: 'invalid input syntax for type date: "Mon Mar 02"' }),
    /Fecha inválida/
  );
  assert.match(
    publicUpdateError({ message: 'value too long for type character varying(30)' }),
    /largo permitido/
  );
});
