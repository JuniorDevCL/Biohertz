import { test } from 'node:test';
import assert from 'node:assert/strict';
import { corregirTexto, revisarTexto } from '../public/corrector-texto.js';

test('pone tildes y ñ en palabras técnicas frecuentes', () => {
  assert.equal(
    corregirTexto('se realizo mantencion preventiva, se reviso bateria y conexion electrica'),
    'Se realizó mantención preventiva, se revisó batería y conexión eléctrica',
  );
  assert.equal(corregirTexto('dano en el modulo de la camara'), 'Daño en el módulo de la cámara');
  assert.equal(corregirTexto('la presion hidraulica es correcta'), 'La presión hidráulica es correcta');
  assert.equal(corregirTexto('el diagnostico tecnico'), 'El diagnóstico técnico');
});

test('corrige errores comunes de escritura', () => {
  assert.equal(corregirTexto('revisado atravez del panel'), 'Revisado a través del panel');
  assert.equal(corregirTexto('es nesesario cambiar la valvula'), 'Es necesario cambiar la válvula');
  assert.equal(corregirTexto('falla de coneccion'), 'Falla de conexión');
});

test('solo cambia palabras ambiguas cuando el contexto es claro', () => {
  assert.equal(corregirTexto('el equipo esta operativo'), 'El equipo está operativo');
  assert.equal(corregirTexto('el equipo esta funcionando'), 'El equipo está funcionando');
  assert.equal(corregirTexto('esta unidad presenta falla'), 'Esta unidad presenta falla');
  assert.equal(corregirTexto('el cambio de filtro'), 'El cambio de filtro');
  assert.equal(corregirTexto('se cambio el filtro'), 'Se cambió el filtro');
  assert.equal(corregirTexto('el guion y el ion'), 'El guion y el ion');
});

test('respeta mayúsculas, tildes ya puestas, correos, URLs y números', () => {
  assert.equal(corregirTexto('REVISION TECNICA'), 'REVISIÓN TÉCNICA');
  assert.equal(corregirTexto('Se realizó la revisión'), 'Se realizó la revisión');
  assert.equal(corregirTexto('ver biohertz.cl/soporte o tecnico@biohertz.cl'), 'Ver biohertz.cl/soporte o tecnico@biohertz.cl');
  assert.equal(corregirTexto('voltaje de 3,5 v'), 'Voltaje de 3,5 v');
});

test('ordena espacios, puntuación y mayúscula al inicio de cada oración', () => {
  assert.equal(corregirTexto('equipo ok , sin falla.se limpio'), 'Equipo ok, sin falla. Se limpió');
  assert.equal(corregirTexto('uno  dos ,tres'), 'Uno dos, tres');
  assert.equal(corregirTexto('primera linea\nsegunda linea'), 'Primera línea\nSegunda línea');
  assert.equal(corregirTexto('aprox. tres horas. listo'), 'Aprox. tres horas. Listo');
  assert.equal(corregirTexto('empresa S.A. y otra'), 'Empresa S.A. y otra');
});

test('cuenta las palabras corregidas y deja vacío lo vacío', () => {
  assert.equal(revisarTexto('se realizo mantencion').cambios, 2);
  assert.equal(revisarTexto('Todo correcto').cambios, 0);
  assert.equal(corregirTexto(''), '');
  assert.equal(corregirTexto('   '), '   ');
  assert.equal(corregirTexto(null), null);
  assert.equal(corregirTexto(undefined), undefined);
});
