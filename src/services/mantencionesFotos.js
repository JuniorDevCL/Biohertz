import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import crypto from 'crypto';

export const MAX_FOTOS = 4;
export const MAX_FOTO_BASE64_LEN = 240000;
export const MAX_FOTO_BYTES = 180000;

function diskQuotaBytes() {
  const gb = Number(process.env.MANTENCIONES_FOTOS_QUOTA_GB || 3);
  return Math.max(0.5, gb) * 1024 * 1024 * 1024;
}

export function getFotosRoot() {
  return process.env.MANTENCIONES_FOTOS_DIR || path.join(process.cwd(), 'data', 'mantenciones-fotos');
}

export function isPersistentFotosDir() {
  const root = path.resolve(getFotosRoot());
  return root.startsWith('/var/data');
}

export function fotoUrl(fichaId, archivo) {
  return `/mantenciones/fotos/${fichaId}/${encodeURIComponent(archivo)}`;
}

export function fichaFotosDir(fichaId) {
  return path.join(getFotosRoot(), String(fichaId));
}

function safeArchivo(name) {
  return /^[a-zA-Z0-9_-]+\.(jpg|jpeg|png|webp)$/.test(String(name || '')) ? String(name) : null;
}

function extractArchivoFromUrl(url) {
  const m = String(url || '').match(/\/mantenciones\/fotos\/\d+\/([^/?#]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

function parseDataUrl(dataUrl) {
  const m = String(dataUrl).match(/^data:image\/(jpeg|jpg|png|webp);base64,(.+)$/i);
  if (!m) return null;
  let ext = m[1].toLowerCase();
  if (ext === 'jpeg') ext = 'jpg';
  try {
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > MAX_FOTO_BYTES) return null;
    return { ext: ext === 'png' || ext === 'webp' ? 'jpg' : ext, buf };
  } catch {
    return null;
  }
}

export async function ensureFotosDir(fichaId) {
  const dir = fichaFotosDir(fichaId);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

export async function getFotosStorageStats() {
  const root = getFotosRoot();
  const quotaBytes = diskQuotaBytes();
  let totalBytes = 0;
  let fileCount = 0;
  let fichaCount = 0;

  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      fichaCount += 1;
      const fichaDir = path.join(root, entry.name);
      const files = await fs.readdir(fichaDir, { withFileTypes: true });
      for (const f of files) {
        if (!f.isFile()) continue;
        try {
          const st = await fs.stat(path.join(fichaDir, f.name));
          totalBytes += st.size;
          fileCount += 1;
        } catch {}
      }
    }
  } catch {}

  const percentUsed = quotaBytes > 0 ? Math.min(100, (totalBytes / quotaBytes) * 100) : 0;
  return {
    root,
    persistent: isPersistentFotosDir(),
    quotaGb: quotaBytes / (1024 * 1024 * 1024),
    totalBytes,
    totalMb: Math.round((totalBytes / (1024 * 1024)) * 10) / 10,
    fileCount,
    fichaCount,
    percentUsed: Math.round(percentUsed * 10) / 10,
    warn: percentUsed >= 85,
    full: percentUsed >= 97,
  };
}

async function assertDiskSpaceAvailable(extraBytes = 0) {
  const stats = await getFotosStorageStats();
  if (stats.totalBytes + extraBytes > diskQuotaBytes()) {
    const err = new Error('Espacio de fotos agotado en el disco. Contacta al administrador.');
    err.code = 'DISK_FULL';
    throw err;
  }
  return stats;
}

export async function initFotosStorage() {
  const root = getFotosRoot();
  await fs.mkdir(root, { recursive: true });
  const testFile = path.join(root, '.write-test');
  await fs.writeFile(testFile, 'ok');
  await fs.unlink(testFile);
  const stats = await getFotosStorageStats();
  console.log(
    `[fotos] ${stats.persistent ? 'disco persistente' : 'disco local'}: ${root} | ` +
    `${stats.totalMb} MB usados de ${stats.quotaGb} GB (${stats.percentUsed}%) | ` +
    `${stats.fileCount} fotos en ${stats.fichaCount} fichas`
  );
  if (!stats.persistent && process.env.NODE_ENV === 'production') {
    console.warn('[fotos] AVISO: MANTENCIONES_FOTOS_DIR no apunta a /var/data — las fotos pueden perderse al redeploy');
  }
  return stats;
}

export async function migrateAllLegacyFotos(pool) {
  if (!pool) return { migrated: 0 };
  const r = await pool.query(`
    SELECT id, fotos FROM mantenciones_fichas
    WHERE fotos::text LIKE '%"data"%'
    ORDER BY id ASC
    LIMIT 100
  `);
  let migrated = 0;
  for (const row of r.rows) {
    const before = JSON.stringify(row.fotos || []);
    await attachFichaFotos({ id: row.id, fotos: row.fotos || [] }, pool);
    const afterRow = await pool.query('SELECT fotos FROM mantenciones_fichas WHERE id = $1', [row.id]);
    const after = JSON.stringify(afterRow.rows[0]?.fotos || []);
    if (before !== after) migrated += 1;
  }
  if (migrated) {
    console.log(`[fotos] migradas ${migrated} ficha(s) con fotos legacy desde Postgres al disco`);
  }
  return { migrated, pending: Math.max(0, r.rowCount - migrated) };
}

async function saveFotoFromDataUrl(fichaId, nombre, dataUrl) {
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) return null;
  await assertDiskSpaceAvailable(parsed.buf.length);
  const dir = await ensureFotosDir(fichaId);
  const archivo = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${parsed.ext}`;
  await fs.writeFile(path.join(dir, archivo), parsed.buf);
  return { nombre: String(nombre || 'foto').slice(0, 80), archivo };
}

export function parseFotosInput(value) {
  if (Array.isArray(value)) return value.slice(0, MAX_FOTOS);
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.slice(0, MAX_FOTOS) : [];
    } catch {
      return [];
    }
  }
  return [];
}

export async function persistFotosFromPayload(fichaId, incoming, previous = []) {
  const prev = Array.isArray(previous) ? previous : [];
  const prevByArchivo = new Map(
    prev.filter((p) => p && p.archivo).map((p) => [p.archivo, p])
  );

  const keptArchivos = new Set();
  const result = [];

  for (const item of parseFotosInput(incoming)) {
    if (!item || typeof item !== 'object') continue;

    const archivoRef =
      safeArchivo(item.archivo) || safeArchivo(extractArchivoFromUrl(item.url));

    if (archivoRef) {
      const fp = resolveFotoPath(fichaId, archivoRef);
      if (fp && fsSync.existsSync(fp)) {
        keptArchivos.add(archivoRef);
        const prevMeta = prevByArchivo.get(archivoRef);
        result.push({
          nombre: String(item.nombre || prevMeta?.nombre || 'foto').slice(0, 80),
          archivo: archivoRef,
        });
        continue;
      }
    }

    if (item.data && typeof item.data === 'string') {
      if (item.data.length > MAX_FOTO_BASE64_LEN) continue;
      const saved = await saveFotoFromDataUrl(fichaId, item.nombre, item.data);
      if (saved) {
        keptArchivos.add(saved.archivo);
        result.push(saved);
      }
    }
  }

  for (const p of prev) {
    if (p && p.archivo && !keptArchivos.has(p.archivo)) {
      await deleteFotoFile(fichaId, p.archivo);
    }
  }

  return result.slice(0, MAX_FOTOS);
}

export async function deleteFotoFile(fichaId, archivo) {
  const fp = resolveFotoPath(fichaId, archivo);
  if (!fp) return;
  await fs.unlink(fp).catch(() => {});
}

export async function deleteAllFichaFotos(fichaId) {
  await fs.rm(fichaFotosDir(fichaId), { recursive: true, force: true }).catch(() => {});
}

export function enrichFotosWithUrls(fichaId, fotos) {
  return (Array.isArray(fotos) ? fotos : []).map((p) => {
    if (!p || typeof p !== 'object') return p;
    if (p.archivo) {
      return {
        nombre: p.nombre || 'foto',
        archivo: p.archivo,
        url: fotoUrl(fichaId, p.archivo),
      };
    }
    if (p.data) {
      return { nombre: p.nombre || 'foto', data: p.data };
    }
    return p;
  });
}

export async function migrateLegacyFotosIfNeeded(fichaId, fotos) {
  const arr = Array.isArray(fotos) ? fotos : [];
  const legacy = arr.filter((p) => p && p.data && !p.archivo);
  if (!legacy.length) return { fotos: arr, changed: false };

  const migrated = [];
  for (const p of arr) {
    if (p.data && !p.archivo) {
      const saved = await saveFotoFromDataUrl(fichaId, p.nombre, p.data);
      if (saved) migrated.push(saved);
    } else if (p.archivo) {
      migrated.push({ nombre: p.nombre || 'foto', archivo: p.archivo });
    }
  }
  return { fotos: migrated, changed: true };
}

export function resolveFotoPath(fichaId, archivo) {
  const safe = safeArchivo(archivo);
  if (!safe) return null;
  const root = path.resolve(fichaFotosDir(fichaId));
  const fp = path.resolve(path.join(root, safe));
  if (fp !== root && !fp.startsWith(root + path.sep)) return null;
  return fp;
}

export async function attachFichaFotos(ficha, pool) {
  if (!ficha || !ficha.id) return ficha;
  const migration = await migrateLegacyFotosIfNeeded(ficha.id, ficha.fotos || []);
  if (migration.changed && pool) {
    await pool.query('UPDATE mantenciones_fichas SET fotos = $1::jsonb WHERE id = $2', [
      JSON.stringify(migration.fotos),
      ficha.id,
    ]);
  }
  ficha.fotos = enrichFotosWithUrls(ficha.id, migration.fotos);
  return ficha;
}

export const FICHA_LIST_COLUMNS = `
  m.id, m.equipo_id, m.cliente_id, m.tipo, m.estado, m.fecha, m.hora,
  m.trabajo, m.nota, m.dano_descripcion, m.checklist, m.realizado_por,
  m.tecnico_id, m.firmante_cliente, m.email_cliente, m.proxima_mantencion,
  m.firmada_en, m.creado_en, m.actualizado_en,
  m.rut_cliente, m.senores, m.direccion, m.ciudad_comuna, m.telefono_cliente,
  m.contacto_nombre, m.version_sw, m.motivo_atencion, m.categorias
`;
