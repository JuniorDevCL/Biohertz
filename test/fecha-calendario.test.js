import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatFechaCL, ymdCalendario, filaConFechasYmd } from '../src/services/fechaCalendario.js';

test('una DATE a medianoche local conserva el día de calendario', () => {
  const almacenada = new Date(2026, 9, 3);
  assert.equal(ymdCalendario(almacenada), '2026-10-03');
  assert.equal(formatFechaCL(almacenada), '03-10-2026');
  assert.equal(formatFechaCL(almacenada, { yearDigits: 2 }), '03-10-26');
});

test('medianoche UTC en Santiago es el día anterior y el formateo no la usa', () => {
  const medianocheUtc = new Date(Date.UTC(2026, 9, 3));
  const enSantiago = medianocheUtc.toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });
  assert.equal(enSantiago, '2026-10-02');

  const dateDePostgres = new Date(2026, 9, 3);
  assert.equal(formatFechaCL(dateDePostgres), '03-10-2026');
  if (dateDePostgres.toISOString() === '2026-10-03T00:00:00.000Z') {
    assert.notEqual(formatFechaCL(dateDePostgres), '02-10-2026');
  }
});

test('acepta YYYY-MM-DD y medianoche UTC serializada', () => {
  assert.equal(ymdCalendario('2026-10-03'), '2026-10-03');
  assert.equal(ymdCalendario('2026-10-03T00:00:00.000Z'), '2026-10-03');
  assert.equal(formatFechaCL('2026-10-03T00:00:00.000Z'), '03-10-2026');
  assert.equal(ymdCalendario(null), null);
  assert.equal(ymdCalendario(''), null);
});

test('filaConFechasYmd deja instantes con hora sin tocar', () => {
  const creado = new Date(2026, 9, 3, 18, 30, 0);
  const row = filaConFechasYmd({
    fecha_instalacion: new Date(2026, 9, 3),
    creado_en: creado
  });
  assert.equal(row.fecha_instalacion, '2026-10-03');
  assert.equal(row.creado_en, creado);
});
