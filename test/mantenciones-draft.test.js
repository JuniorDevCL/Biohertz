import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  toDateParam,
  toTimeParam,
  clipVarchar,
  jsonbParam,
  publicUpdateError,
  formatFechaForInput,
  santiagoDateTime,
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

test('santiagoDateTime usa la hora de Chile y no la del servidor UTC', () => {
  // 2026-10-11 02:30 UTC es 23:30 del 10 de octubre en Santiago (UTC-3)
  const noche = santiagoDateTime(new Date('2026-10-11T02:30:00.000Z'));
  assert.equal(noche.fecha, '2026-10-10');
  assert.equal(noche.hora, '23:30');

  // Medianoche en Chile no puede caer en el día UTC siguiente
  const medianoche = santiagoDateTime(new Date('2026-10-11T03:00:00.000Z'));
  assert.equal(medianoche.fecha, '2026-10-11');
  assert.equal(medianoche.hora, '00:00');

  // Invierno (UTC-4): 2026-07-15 03:30 UTC es 23:30 del 14 de julio
  const invierno = santiagoDateTime(new Date('2026-07-15T03:30:00.000Z'));
  assert.equal(invierno.fecha, '2026-07-14');
  assert.equal(invierno.hora, '23:30');
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
