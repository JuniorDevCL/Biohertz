import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(__dirname, '../public/drive-fotos.js'), 'utf8');

test('Drive solo acepta el mismo correo del login', () => {
  const sandbox = { window: {}, document: { querySelector: () => null, head: { appendChild() {} }, createElement() { return {}; } }, fetch() {} };
  sandbox.window = sandbox;
  vm.runInNewContext(source, sandbox);
  const { normalizeEmail, emailsMatch } = sandbox.window.__driveFotosHelpers;
  assert.equal(normalizeEmail('  Alexis@Empresa.CL '), 'alexis@empresa.cl');
  assert.equal(emailsMatch('Alexis@Empresa.CL', 'alexis@empresa.cl'), true);
  assert.equal(emailsMatch('alexis@empresa.cl', 'otro@empresa.cl'), false);
  assert.equal(emailsMatch('', 'alexis@empresa.cl'), false);
});
