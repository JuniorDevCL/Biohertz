import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import pool from '../db.js';
import { enviarCredencialesPortal } from './mailer.js';

let ready = false;

export async function ensurePortalSchema() {
  if (ready) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS clientes (
        id SERIAL PRIMARY KEY,
        nombre VARCHAR(150),
        empresa VARCHAR(150),
        email VARCHAR(150),
        telefono VARCHAR(50),
        ubicacion VARCHAR(200),
        creado_en TIMESTAMP DEFAULT NOW(),
        actualizado_en TIMESTAMP DEFAULT NOW()
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS contactos_cliente (
        id SERIAL PRIMARY KEY,
        cliente_id INTEGER REFERENCES clientes(id) ON DELETE CASCADE,
        nombre VARCHAR(150) NOT NULL,
        cargo VARCHAR(100),
        email VARCHAR(150),
        telefono VARCHAR(50),
        creado_en TIMESTAMP DEFAULT NOW()
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS portal_usuarios (
        id SERIAL PRIMARY KEY,
        email VARCHAR(150) UNIQUE NOT NULL,
        nombre VARCHAR(150),
        google_id VARCHAR(255) UNIQUE,
        password_hash VARCHAR(200),
        cliente_id INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
        activo BOOLEAN NOT NULL DEFAULT TRUE,
        creado_en TIMESTAMPTZ DEFAULT NOW(),
        ultimo_acceso TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS idx_portal_usuarios_cliente ON portal_usuarios(cliente_id);
      CREATE INDEX IF NOT EXISTS idx_portal_usuarios_email ON portal_usuarios(email);
    `);

    await pool.query(`
      ALTER TABLE portal_usuarios
        ADD COLUMN IF NOT EXISTS password_hash VARCHAR(200);
    `);

    await pool.query(`
      ALTER TABLE mantenciones_fichas
        ADD COLUMN IF NOT EXISTS email_cliente VARCHAR(150);
      ALTER TABLE mantenciones_fichas
        ADD COLUMN IF NOT EXISTS proxima_mantencion DATE;
    `);

    ready = true;
  } catch (err) {
    console.warn('ensurePortalSchema:', err && err.message ? err.message : err);
  }
}

function normEmail(email) {
  return String(email || '').trim().toLowerCase();
}

/** Clave temporal legible (10 caracteres) */
export function generatePortalPassword() {
  return crypto.randomBytes(8).toString('base64url').replace(/[^a-zA-Z0-9]/g, '').slice(0, 10);
}

function portalBaseUrl() {
  const raw =
    process.env.APP_URL ||
    process.env.RENDER_EXTERNAL_URL ||
    process.env.PORTAL_URL ||
    '';
  return String(raw).replace(/\/$/, '');
}

async function attachClienteNombre(row) {
  if (!row) return null;
  const cliente = await pool.query('SELECT nombre FROM clientes WHERE id = $1', [row.cliente_id]);
  return {
    ...row,
    cliente_nombre: cliente.rows[0]?.nombre || null,
  };
}

/**
 * Crea o actualiza usuario portal.
 * Si es nuevo o no tiene clave (o forceReset), genera password, la guarda cifrada y envía correo.
 * Nunca persiste la clave en texto plano.
 */
export async function ensurePortalAccessFromFicha({
  email,
  cliente_id,
  nombre,
  sendEmail = true,
  forceReset = false,
} = {}) {
  await ensurePortalSchema();
  const e = normEmail(email);
  if (!e || !cliente_id) return { user: null, credentialsSent: false };

  const existing = await pool.query(
    'SELECT * FROM portal_usuarios WHERE lower(email) = $1 LIMIT 1',
    [e]
  );

  const needsPassword =
    forceReset ||
    existing.rowCount === 0 ||
    !existing.rows[0].password_hash;

  let plainPassword = null;
  let passwordHash = existing.rowCount ? existing.rows[0].password_hash : null;

  if (needsPassword) {
    plainPassword = generatePortalPassword();
    passwordHash = await bcrypt.hash(plainPassword, 10);
  }

  const updated = await pool.query(
    `INSERT INTO portal_usuarios (email, nombre, password_hash, cliente_id, activo, ultimo_acceso)
     VALUES ($1, $2, $3, $4, TRUE, NOW())
     ON CONFLICT (email) DO UPDATE SET
       nombre = COALESCE(EXCLUDED.nombre, portal_usuarios.nombre),
       password_hash = CASE
         WHEN $5::boolean THEN EXCLUDED.password_hash
         ELSE COALESCE(portal_usuarios.password_hash, EXCLUDED.password_hash)
       END,
       cliente_id = EXCLUDED.cliente_id,
       activo = TRUE
     RETURNING id, email, nombre, cliente_id, activo, creado_en, ultimo_acceso`,
    [e, nombre || null, passwordHash, Number(cliente_id), needsPassword]
  );

  const user = await attachClienteNombre(updated.rows[0]);
  let credentialsSent = false;

  if (plainPassword && sendEmail) {
    try {
      const base = portalBaseUrl();
      const loginUrl = base ? `${base}/portal/login` : '/portal/login';
      await enviarCredencialesPortal(e, {
        nombre: user.nombre || nombre || 'Cliente',
        clienteNombre: user.cliente_nombre || '',
        password: plainPassword,
        loginUrl,
      });
      credentialsSent = true;
    } catch (err) {
      console.error('Error enviando credenciales portal:', err && err.message ? err.message : err);
    }
  }

  return { user, credentialsSent, created: existing.rowCount === 0 };
}

/** Login portal: valida email + clave (bcrypt) */
export async function authenticatePortalUser(email, password) {
  await ensurePortalSchema();
  const e = normEmail(email);
  const pass = String(password || '');
  if (!e || !pass) return null;

  const result = await pool.query(
    `SELECT p.*, c.nombre AS cliente_nombre
     FROM portal_usuarios p
     JOIN clientes c ON c.id = p.cliente_id
     WHERE lower(p.email) = $1 AND p.activo = TRUE
     LIMIT 1`,
    [e]
  );
  if (result.rowCount === 0) return null;
  const row = result.rows[0];
  if (!row.password_hash) return null;

  const ok = await bcrypt.compare(pass, row.password_hash);
  if (!ok) return null;

  return {
    id: row.id,
    email: row.email,
    nombre: row.nombre,
    cliente_id: row.cliente_id,
    cliente_nombre: row.cliente_nombre,
  };
}

export async function touchPortalAccess(id) {
  try {
    await pool.query('UPDATE portal_usuarios SET ultimo_acceso = NOW() WHERE id = $1', [id]);
  } catch (_) {}
}
