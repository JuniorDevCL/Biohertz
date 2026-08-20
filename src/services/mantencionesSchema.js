import pool from '../db.js';

const DEFAULT_PROTOCOLS = {
  mindray: [
    'Verificar encendido y autotest',
    'Revisar sensores SpO2 / ECG / NIBP',
    'Calibrar NIBP según protocolo',
    'Limpiar pantalla y carcasa',
    'Verificar batería y carga',
    'Registrar lecturas de control',
  ],
  'dräger': [
    'Verificar encendido y alarmas',
    'Revisar circuito / sensores de flujo',
    'Comprobar fugas del sistema',
    'Limpiar filtros y conexiones',
    'Verificar batería de respaldo',
    'Probar modos ventilatorios básicos',
  ],
  philips: [
    'Verificar encendido y autotest',
    'Revisar paddles / electrodos',
    'Comprobar batería y carga',
    'Probar descarga en modo de prueba',
    'Limpiar equipo y accesorios',
    'Verificar registro de eventos',
  ],
  biosystems: [
    'Verificar encendido y estado del analizador',
    'Revisar reactivos y controles',
    'Ejecutar control de calidad',
    'Limpiar bandeja / pipeteo',
    'Verificar calibración vigente',
    'Registrar resultados de control',
  ],
  'bd alaris': [
    'Verificar encendido y pantalla',
    'Revisar módulo de infusión',
    'Probar oclusión / alarmas',
    'Verificar batería',
    'Limpiar carcasa y conectores',
    'Comprobar precisión de flujo (si aplica)',
  ],
  generico: [
    'Inspección visual general',
    'Verificar encendido y funciones básicas',
    'Revisar accesorios y cables',
    'Limpiar superficies externas',
    'Verificar alimentación / batería',
    'Registrar observaciones',
  ],
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
    `);

    await seedProtocolos();
    await migrateLegacyMantenciones();
    ready = true;
  } catch (err) {
    console.warn('ensureMantencionesSchema:', err && err.message ? err.message : err);
  }
}

async function seedProtocolos() {
  for (const [marca, labels] of Object.entries(DEFAULT_PROTOCOLS)) {
    const items = JSON.stringify(itemsFromLabels(labels));
    await pool.query(
      `INSERT INTO protocolos_marca (marca, items)
       VALUES ($1, $2::jsonb)
       ON CONFLICT (marca) DO NOTHING`,
      [marca, items]
    );
  }
}

export async function getProtocoloByMarca(marca) {
  await ensureMantencionesSchema();
  const key = normalizeMarca(marca);
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

export { normalizeMarca, itemsFromLabels, DEFAULT_PROTOCOLS };
