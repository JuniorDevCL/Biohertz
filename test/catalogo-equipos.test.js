import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  baselineNombre,
  canonMarca,
  canonModelo,
  debeCompletarMarca,
  marcaActiva,
  nombreAutomatico,
  siguienteNombre,
  sugerenciasMarca,
  sugerenciasModelo,
} from '../public/catalogo-equipos.js';

test('sugiere la marca oficial al escribir un prefijo', () => {
  const marcas = sugerenciasMarca('alp').map((item) => item.marca);
  assert.deepEqual(marcas, ['ALPINION']);
  assert.equal(canonMarca('alpinion'), 'ALPINION');
  assert.equal(canonMarca('otra'), null);
});

test('filtra modelos por la marca y conserva el texto exacto', () => {
  const modelos = sugerenciasModelo('cube', 'ALPINION').map((item) => item.modelo);
  assert.ok(modelos.includes('E-CUBE 8'));
  assert.ok(modelos.includes('X-CUBE 60'));
  assert.equal(modelos.includes('REVO'), false);
  assert.equal(canonModelo('e-cube i7', 'alpinion').modelo, 'E-CUBE i7');
  assert.equal(marcaActiva('unet'), 'UNETIXS');
  assert.equal(marcaActiva('a'), null);
});

test('un modelo único completa la marca solo si está vacía o es prefijo', () => {
  const canon = canonModelo('revo', '');
  assert.equal(canon.marca, 'UNETIXS');
  assert.equal(canon.modelo, 'REVO');
  assert.equal(debeCompletarMarca('', 'UNETIXS'), true);
  assert.equal(debeCompletarMarca('une', 'UNETIXS'), true);
  assert.equal(debeCompletarMarca('ALPINION', 'UNETIXS'), false);
});

test('el nombre automático no pisa un nombre escrito a mano', () => {
  assert.equal(nombreAutomatico('ALPINION', 'E-CUBE 8'), 'ALPINION E-CUBE 8');
  assert.equal(baselineNombre({
    nombre: 'Ecógrafo sala 2',
    marca: 'ALPINION',
    modelo: 'E-CUBE 8',
  }), null);

  const custom = siguienteNombre({
    nombre: 'Ecógrafo sala 2',
    marca: 'ALPINION',
    modelo: 'E-CUBE 15',
    lastAuto: null,
  });
  assert.equal(custom.nombre, 'Ecógrafo sala 2');

  const auto = siguienteNombre({
    nombre: 'ALPINION E-CUBE 8',
    marca: 'ALPINION',
    modelo: 'E-CUBE 15',
    lastAuto: 'ALPINION E-CUBE 8',
  });
  assert.equal(auto.nombre, 'ALPINION E-CUBE 15');
});
