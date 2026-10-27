import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import jwt from 'jsonwebtoken';
import { revisarPalabras } from '../src/services/ortografia.js';
import ortografiaRoutes from '../src/routes/ortografia.js';
import { esInicioOracion, palabraAntesDe, palabraEn } from '../public/corrector-texto.js';

test('corrige solo los errores típicos de tipeo, tildes y ñ', async () => {
  const r = await revisarPalabras([
    'mantencion', 'bateria', 'dano', 'coneccion', 'vateria', 'pantaya', 'tanbien', 'equpo', 'ecografo',
  ]);
  assert.equal(r.mantencion.auto, 'mantención');
  assert.equal(r.bateria.auto, 'batería');
  assert.equal(r.dano.auto, 'daño');
  assert.equal(r.coneccion.auto, 'conexión');
  assert.equal(r.vateria.auto, 'batería');
  assert.equal(r.pantaya.auto, 'pantalla');
  assert.equal(r.tanbien.auto, 'también');
  assert.equal(r.equpo.auto, 'equipo');
  assert.equal(r.ecografo.auto, 'ecógrafo');
});

test('no toca palabras correctas, vocabulario técnico ni marcas del catálogo', async () => {
  const r = await revisarPalabras(['equipo', 'esta', 'realizo', 'firmware', 'ok', 'alpinion', 'santiago']);
  for (const v of Object.values(r)) assert.equal(v.correcta, true);
});

test('en palabras cortas solo sugiere', async () => {
  const r = await revisarPalabras(['ise']);
  assert.equal(r.ise.auto, null);
});

test('no reescribe términos del informe que ya significan otra cosa', async () => {
  const r = await revisarPalabras([
    'preset', 'probe', 'leads', 'upgrade', 'siemens', 'esaote', 'sonosite',
    'driver', 'reboot', 'encoder', 'phase', 'photo', 'cardiac', 'liver', 'echo', 'android',
    'mamografo', 'aliasing', 'depth',
  ]);
  assert.equal(r.preset.correcta, true);
  assert.equal(r.probe.correcta, true);
  assert.equal(r.leads.correcta, true);
  assert.equal(r.phase.correcta, true);
  assert.equal(r.photo.correcta, true);
  assert.equal(r.cardiac.correcta, true);
  assert.equal(r.liver.correcta, true);
  assert.equal(r.echo.correcta, true);
  assert.equal(r.android.correcta, true);
  for (const [palabra, res] of Object.entries(r)) {
    assert.equal(res.auto, null, palabra);
  }
});

test('prefiere el vocabulario técnico ante un error de tipeo', async () => {
  const r = await revisarPalabras(['trasductor', 'desfibrilado']);
  assert.equal(r.trasductor.auto, 'transductor');
});

test('la ruta /ortografia responde con el resultado de cada palabra', async () => {
  const app = express();
  app.use(express.json());
  app.use('/ortografia', ortografiaRoutes);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const token = jwt.sign({ id: 1, email: 'test@test.cl' }, process.env.JWT_SECRET || 'offline_secret');
    const res = await fetch(`http://127.0.0.1:${port}/ortografia`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ palabras: ['Calibracion', 'equipo'] }),
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.resultados.calibracion.auto, 'calibración');
    assert.equal(data.resultados.equipo.correcta, true);

    const sinToken = await fetch(`http://127.0.0.1:${port}/ortografia`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ palabras: ['hola'] }),
    });
    assert.equal(sinToken.status, 401);
  } finally {
    server.close();
  }
});

test('el teclado detecta la palabra recién terminada y el inicio de oración', () => {
  assert.deepEqual(palabraAntesDe('se realizo ', 10), { inicio: 3, fin: 10, palabra: 'realizo' });
  assert.equal(palabraAntesDe('tecnico@bio ', 11), null);
  assert.equal(palabraAntesDe('ver 220v ', 8), null);
  assert.deepEqual(palabraEn('el ecuipo funciona', 5), { inicio: 3, fin: 9, palabra: 'ecuipo' });
  assert.equal(esInicioOracion('', 0), true);
  assert.equal(esInicioOracion('listo. ', 7), true);
  assert.equal(esInicioOracion('linea uno\n', 10), true);
  assert.equal(esInicioOracion('aprox. ', 7), false);
  assert.equal(esInicioOracion('S.A. ', 5), false);
  assert.equal(esInicioOracion('el ', 3), false);
});
