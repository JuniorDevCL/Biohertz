import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-fotos-'));
process.env.MANTENCIONES_FOTOS_DIR = tmp;

const {
  migrateLegacyFotosIfNeeded,
  persistFotosFromPayload,
  resolveFotoPath,
} = await import('../src/services/mantencionesFotos.js');

function jpegDataUrl(bytes) {
  return 'data:image/jpeg;base64,' + Buffer.from(bytes).toString('base64');
}

test('una foto legacy demasiado grande no se borra al migrar otra de la misma ficha', async () => {
  const small = jpegDataUrl('foto-chica');
  const huge = jpegDataUrl(Buffer.alloc(200000, 7));
  const result = await migrateLegacyFotosIfNeeded(42, [
    { nombre: 'chica', data: small },
    { nombre: 'grande', data: huge },
  ]);

  assert.equal(result.changed, true);
  assert.equal(result.fotos.length, 2);
  assert.equal(result.fotos[0].nombre, 'chica');
  assert.ok(result.fotos[0].archivo);
  assert.equal(result.fotos[0].data, undefined);
  assert.equal(fs.existsSync(resolveFotoPath(42, result.fotos[0].archivo)), true);
  assert.equal(result.fotos[1].nombre, 'grande');
  assert.equal(result.fotos[1].data, huge);
  assert.equal(result.fotos[1].archivo, undefined);
});

test('si ninguna foto legacy cabe en disco, el JSON no se reescribe', async () => {
  const huge = jpegDataUrl(Buffer.alloc(200000, 3));
  const original = [{ nombre: 'solo-grande', data: huge }];
  const result = await migrateLegacyFotosIfNeeded(43, original);
  assert.equal(result.changed, false);
  assert.equal(result.fotos, original);
});

test('guardar el borrador conserva la foto que no se pudo copiar al disco', async () => {
  const fichaId = 44;
  const dir = path.dirname(resolveFotoPath(fichaId, 'keep-me.jpg'));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'keep-me.jpg'), 'jpeg');

  const huge = jpegDataUrl(Buffer.alloc(200000, 9));
  const stored = await persistFotosFromPayload(
    fichaId,
    [
      { nombre: 'en disco', archivo: 'keep-me.jpg' },
      { nombre: 'legacy', data: huge },
    ],
    [
      { nombre: 'en disco', archivo: 'keep-me.jpg' },
      { nombre: 'legacy', data: huge },
    ]
  );

  assert.equal(stored.length, 2);
  assert.deepEqual(stored[0], { nombre: 'en disco', archivo: 'keep-me.jpg' });
  assert.equal(stored[1].data, huge);
  assert.equal(fs.existsSync(path.join(dir, 'keep-me.jpg')), true);
});
