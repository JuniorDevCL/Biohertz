import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clientePrefillFromEquipo } from '../src/services/clientePrefill.js';

test('el informe toma RUT, ciudad y contacto del cliente del equipo', () => {
  const pf = clientePrefillFromEquipo({
    cliente: 'texto viejo',
    cliente_nombre: 'CLINICA NUNOA',
    cliente_rut: '220671925',
    cliente_direccion: 'AV. IRARRAZAVAL 123',
    cliente_ubicacion: 'SANTIAGO',
    cliente_ciudad: 'SANTIAGO',
    cliente_comuna: 'NUNOA',
    cliente_telefono: '+56 9 1234 5678',
    cliente_contacto: 'JOSE PEREZ',
    cliente_email: 'contacto@clinica.cl',
  });
  assert.deepEqual(pf, {
    rut_cliente: '22.067.192-5',
    senores: 'CLINICA NUNOA',
    direccion: 'AV. IRARRAZAVAL 123',
    ciudad_comuna: 'SANTIAGO - NUNOA',
    telefono_cliente: '+56 9 1234 5678',
    contacto_nombre: 'JOSE PEREZ',
    email_cliente: 'contacto@clinica.cl',
  });
});

test('sin cliente vinculado usa los datos del equipo y deja vacío el resto', () => {
  const pf = clientePrefillFromEquipo({ cliente: 'HOSPITAL X', ubicacion: 'PISO 2' });
  assert.equal(pf.senores, 'HOSPITAL X');
  assert.equal(pf.direccion, 'PISO 2');
  assert.equal(pf.rut_cliente, '');
  assert.equal(pf.ciudad_comuna, '');
});

test('ciudad y comuna iguales no se repiten', () => {
  const pf = clientePrefillFromEquipo({ cliente_ciudad: 'Temuco', cliente_comuna: 'TEMUCO' });
  assert.equal(pf.ciudad_comuna, 'Temuco');
});

test('equipo nulo no rompe', () => {
  assert.deepEqual(clientePrefillFromEquipo(null), {});
});
