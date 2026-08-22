import pool from '../db.js';

const PREVENTIVA_CHECKLIST = [
  'Revisión estado de Sistema Operativo Windows',
  'Calibración general y test de operación de acuerdo a lo establecido por el fabricante',
  'Test de funcionamiento software',
  'Revisión, ajuste y limpieza de conectores internos y externos',
  'Revisión y limpieza de fuente de poder',
  'Revisión y limpieza de filtros y ventiladores',
  'Limpieza interna y externa',
  'Revisión de estado externo de transductores y cables',
  'Revisión de imagen ecográfica (elementos transductor)',
  'Revisión de procedimientos y procesos',
  'Revisión y chequeo de periféricos y sus conexiones',
  'Verificación de espacio disponible en unidades de almacenamiento',
  'Verificación y actualización de software ALPINION',
  'Revisión estado de licencias de software',
  'Test de diagnóstico ALPINION',
  'Test de encendido y apagado',
  'Revisión de voltajes de red (entrada) y UPS (salida)',
  'Upgrade de Software Alpinion',
  'Entrega de informe digital del mantenimiento realizado',
];

export const CATEGORIAS_ATENCION = [
  { id: 'facturable', label: 'Facturable' },
  { id: 'garantia', label: 'Garantía' },
  { id: 'mantencion', label: 'Mantención' },
  { id: 'reparacion', label: 'Reparación' },
  { id: 'visita_tecnica', label: 'Visita Técnica' },
  { id: 'rep_s_tecnico', label: 'Rep. S. Técnico' },
  { id: 'rep_terreno', label: 'Rep. Terreno' },
];

const DEFAULT_PROTOCOLS = {
  generico: PREVENTIVA_CHECKLIST,
  alpinion: PREVENTIVA_CHECKLIST,
};

function normalizeMarca(marca) {
  return String(marca || 'generico').trim().toLowerCase();
}

function itemsFromLabels(labels) {
  return labels.map((label, i) => ({
    id: `p${i + 1}`,
    label,
    orden: i + 1,
  }));
}

let ready = false;

export async function ensureMantencionesSchema() {
  if (ready) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS protocolos_marca (
        id SERIAL PRIMARY KEY,
        marca VARCHAR(100) NOT NULL UNIQUE,
        items JSONB NOT NULL DEFAULT '[]'::jsonb,
        activo BOOLEAN NOT NULL DEFAULT TRUE,
        creado_en TIMESTAMPTZ DEFAULT NOW(),
        actualizado_en TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS mantenciones_fichas (
        id SERIAL PRIMARY KEY,
        equipo_id INTEGER REFERENCES equipos(id) ON DELETE CASCADE,
        cliente_id INTEGER,
        tipo VARCHAR(30) NOT NULL DEFAULT 'preventiva',
        estado VARCHAR(20) NOT NULL DEFAULT 'borrador',
        fecha DATE,
        hora TIME,
        trabajo TEXT,
        nota TEXT,
        dano_descripcion TEXT,
        checklist JSONB NOT NULL DEFAULT '[]'::jsonb,
        realizado_por VARCHAR(150),
        tecnico_id INTEGER,
        firma_tecnico TEXT,
        firma_cliente TEXT,
        firmante_cliente VARCHAR(150),
        firmada_en TIMESTAMPTZ,
        legacy_key VARCHAR(80),
        archivo_ruta VARCHAR(255),
        archivo_nombre VARCHAR(255),
        archivo_tipo VARCHAR(100),
        creado_en TIMESTAMPTZ DEFAULT NOW(),
        actualizado_en TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_mantenciones_equipo ON mantenciones_fichas(equipo_id);
      CREATE INDEX IF NOT EXISTS idx_mantenciones_estado ON mantenciones_fichas(estado);
      CREATE INDEX IF NOT EXISTS idx_mantenciones_fecha ON mantenciones_fichas(fecha DESC);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_mantenciones_legacy
        ON mantenciones_fichas(equipo_id, legacy_key)
        WHERE legacy_key IS NOT NULL;
    `);

    await pool.query(`
      ALTER TABLE mantenciones_fichas
        ADD COLUMN IF NOT EXISTS email_cliente VARCHAR(150);
      ALTER TABLE mantenciones_fichas
        ADD COLUMN IF NOT EXISTS proxima_mantencion DATE;
      ALTER TABLE mantenciones_fichas
        ADD COLUMN IF NOT EXISTS rut_cliente VARCHAR(30);
      ALTER TABLE mantenciones_fichas
        ADD COLUMN IF NOT EXISTS senores VARCHAR(200);
      ALTER TABLE mantenciones_fichas
        ADD COLUMN IF NOT EXISTS direccion VARCHAR(250);
      ALTER TABLE mantenciones_fichas
        ADD COLUMN IF NOT EXISTS ciudad_comuna VARCHAR(150);
      ALTER TABLE mantenciones_fichas
        ADD COLUMN IF NOT EXISTS telefono_cliente VARCHAR(50);
      ALTER TABLE mantenciones_fichas
        ADD COLUMN IF NOT EXISTS contacto_nombre VARCHAR(150);
      ALTER TABLE mantenciones_fichas
        ADD COLUMN IF NOT EXISTS version_sw VARCHAR(80);
      ALTER TABLE mantenciones_fichas
        ADD COLUMN IF NOT EXISTS motivo_atencion TEXT;
      ALTER TABLE mantenciones_fichas
        ADD COLUMN IF NOT EXISTS categorias JSONB NOT NULL DEFAULT '[]'::jsonb;
      ALTER TABLE mantenciones_fichas
        ADD COLUMN IF NOT EXISTS fotos JSONB NOT NULL DEFAULT '[]'::jsonb;
    `);

    await seedProtocolos();
    await migrateLegacyMantenciones();
    ready = true;
  } catch (err) {
    console.warn('ensureMantencionesSchema:', err && err.message ? err.message : err);
  }
}

async function seedProtocolos() {
  const preventivaItems = JSON.stringify(itemsFromLabels(PREVENTIVA_CHECKLIST));
  for (const [marca, labels] of Object.entries(DEFAULT_PROTOCOLS)) {
    const items = JSON.stringify(itemsFromLabels(labels));
    await pool.query(
      `INSERT INTO protocolos_marca (marca, items, activo)
       VALUES ($1, $2::jsonb, TRUE)
       ON CONFLICT (marca) DO UPDATE SET
         items = EXCLUDED.items,
         activo = TRUE,
         actualizado_en = NOW()`,
      [marca, items]
    );
  }
  // Checklist preventiva unificado (19 ítems) para protocolos previos
  await pool.query(
    `UPDATE protocolos_marca SET items = $1::jsonb, actualizado_en = NOW()`,
    [preventivaItems]
  );
}

export async function getProtocoloByMarca(marca) {
  await ensureMantencionesSchema();
  const raw = normalizeMarca(marca);
  const key = raw.includes('alpinion') ? 'alpinion' : raw;
  let r = await pool.query(
    `SELECT * FROM protocolos_marca WHERE lower(marca) = $1 AND activo = TRUE LIMIT 1`,
    [key]
  );
  if (r.rowCount === 0 && key !== 'generico') {
    r = await pool.query(
      `SELECT * FROM protocolos_marca WHERE lower(marca) = 'generico' AND activo = TRUE LIMIT 1`
    );
  }
  if (r.rowCount === 0) {
    return { marca: key, items: itemsFromLabels(DEFAULT_PROTOCOLS.generico) };
  }
  return r.rows[0];
}

export function checklistTemplateFromProtocolo(protocolo) {
  const items = Array.isArray(protocolo?.items) ? protocolo.items : [];
  return items.map((it, i) => ({
    id: it.id || `p${i + 1}`,
    label: it.label || String(it),
    checked: false,
  }));
}

async function migrateLegacyMantenciones() {
  let equipos;
  try {
    equipos = await pool.query(
      `SELECT id, cliente_id, mantenciones FROM equipos
       WHERE mantenciones IS NOT NULL AND mantenciones::text <> '[]' AND mantenciones::text <> 'null'`
    );
  } catch {
    return;
  }

  for (const eq of equipos.rows) {
    const list = Array.isArray(eq.mantenciones) ? eq.mantenciones : [];
    for (const m of list) {
      const legacyKey = `legacy-${eq.id}-${m.id ?? `${m.fecha || ''}-${m.hora || ''}-${m.trabajo || ''}`.slice(0, 60)}`;
      try {
        const exists = await pool.query(
          `SELECT id FROM mantenciones_fichas WHERE equipo_id = $1 AND legacy_key = $2`,
          [eq.id, legacyKey]
        );
        if (exists.rowCount > 0) continue;

        await pool.query(
          `INSERT INTO mantenciones_fichas (
            equipo_id, cliente_id, tipo, estado, fecha, hora, trabajo, nota,
            realizado_por, archivo_ruta, archivo_nombre, archivo_tipo, legacy_key, firmada_en
          ) VALUES (
            $1, $2, 'preventiva', 'firmada',
            NULLIF($3, '')::date, NULLIF($4, '')::time, $5, $6, $7, $8, $9, $10, $11, NOW()
          )`,
          [
            eq.id,
            eq.cliente_id || null,
            m.fecha || null,
            m.hora || null,
            m.trabajo || '',
            m.nota || '',
            m.realizado_por || null,
            m.archivo?.ruta || null,
            m.archivo?.nombre || null,
            m.archivo?.tipo || null,
            legacyKey,
          ]
        );
      } catch (err2) {
        console.warn('migrate legacy mantencion', eq.id, err2.message);
      }
    }
  }
}

export { normalizeMarca, itemsFromLabels, DEFAULT_PROTOCOLS, PREVENTIVA_CHECKLIST };
