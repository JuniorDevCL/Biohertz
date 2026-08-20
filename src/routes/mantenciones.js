import { Router } from 'express';
import pool from '../db.js';
import authRequired from '../middleware/authRequired.js';
import {
  ensureMantencionesSchema,
  getProtocoloByMarca,
  checklistTemplateFromProtocolo,
} from '../services/mantencionesSchema.js';

const router = Router();

function mapFichaRow(row) {
  if (!row) return null;
  return {
    ...row,
    checklist: Array.isArray(row.checklist) ? row.checklist : [],
  };
}

router.get('/', authRequired, async (req, res) => {
  try {
    await ensureMantencionesSchema();
    const { q, tipo, estado, equipo_id } = req.query;
    const values = [];
    const where = [];

    if (equipo_id) {
      values.push(Number(equipo_id));
      where.push(`m.equipo_id = $${values.length}`);
    }
    if (tipo) {
      values.push(tipo);
      where.push(`m.tipo = $${values.length}`);
    }
    if (estado) {
      values.push(estado);
      where.push(`m.estado = $${values.length}`);
    }
    if (q) {
      values.push(`%${q}%`);
      where.push(`(
        e.nombre ILIKE $${values.length}
        OR e.marca ILIKE $${values.length}
        OR e.modelo ILIKE $${values.length}
        OR e.numero_serie ILIKE $${values.length}
        OR m.trabajo ILIKE $${values.length}
        OR m.realizado_por ILIKE $${values.length}
      )`);
    }

    const sql = `
      SELECT m.*,
             e.nombre AS equipo_nombre,
             e.marca AS equipo_marca,
             e.modelo AS equipo_modelo,
             e.numero_serie AS equipo_serie,
             e.cliente AS equipo_cliente,
             c.nombre AS cliente_nombre
      FROM mantenciones_fichas m
      LEFT JOIN equipos e ON e.id = m.equipo_id
      LEFT JOIN clientes c ON c.id = m.cliente_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY COALESCE(m.fecha, m.creado_en::date) DESC, m.id DESC
      LIMIT 200
    `;
    const result = await pool.query(sql, values);
    const fichas = result.rows.map(mapFichaRow);

    if (req.accepts('json') && !req.accepts('html')) {
      return res.json({ fichas, total: fichas.length });
    }

    res.render('mantenciones', {
      title: 'Mantenciones - BIODATA',
      user: req.user || req.session.user,
      fichas,
      query: q || '',
      queryTipo: tipo || '',
      queryEstado: estado || '',
      equipoId: equipo_id || '',
    });
  } catch (err) {
    console.error('Error listando mantenciones:', err);
    if (req.accepts('json') && !req.accepts('html')) {
      return res.status(500).json({ error: 'Error al listar mantenciones' });
    }
    res.status(500).send('Error al listar mantenciones');
  }
});

router.get('/nueva', authRequired, async (req, res) => {
  try {
    await ensureMantencionesSchema();
    const equiposRes = await pool.query(
      `SELECT id, nombre, marca, modelo, numero_serie, cliente, cliente_id, estado
       FROM equipos ORDER BY nombre ASC`
    );
    let equipo = null;
    let protocolo = null;
    let checklist = [];
    const equipoId = req.query.equipo_id ? Number(req.query.equipo_id) : null;
    if (equipoId) {
      const er = await pool.query('SELECT * FROM equipos WHERE id = $1', [equipoId]);
      if (er.rowCount) {
        equipo = er.rows[0];
        protocolo = await getProtocoloByMarca(equipo.marca);
        checklist = checklistTemplateFromProtocolo(protocolo);
      }
    }

    res.render('mantencion_ficha', {
      title: 'Nueva mantención - BIODATA',
      user: req.user || req.session.user,
      ficha: null,
      equipos: equiposRes.rows,
      equipo,
      checklist,
      modo: 'nueva',
      readonly: false,
    });
  } catch (err) {
    console.error('Error nueva mantención:', err);
    res.status(500).send('Error al abrir ficha de mantención');
  }
});

router.get('/protocolo', authRequired, async (req, res) => {
  try {
    const marca = req.query.marca || 'generico';
    const protocolo = await getProtocoloByMarca(marca);
    res.json({
      marca: protocolo.marca,
      items: checklistTemplateFromProtocolo(protocolo),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener protocolo' });
  }
});

router.get('/:id', authRequired, async (req, res) => {
  try {
    await ensureMantencionesSchema();
    const { id } = req.params;
    const result = await pool.query(
      `SELECT m.*,
              e.nombre AS equipo_nombre,
              e.marca AS equipo_marca,
              e.modelo AS equipo_modelo,
              e.numero_serie AS equipo_serie,
              e.cliente AS equipo_cliente,
              e.cliente_id AS equipo_cliente_id
       FROM mantenciones_fichas m
       LEFT JOIN equipos e ON e.id = m.equipo_id
       WHERE m.id = $1`,
      [id]
    );
    if (result.rowCount === 0) {
      if (req.accepts('json') && !req.accepts('html')) {
        return res.status(404).json({ error: 'Ficha no encontrada' });
      }
      return res.status(404).send('Ficha no encontrada');
    }

    const ficha = mapFichaRow(result.rows[0]);
    if (req.accepts('json') && !req.accepts('html')) {
      return res.json(ficha);
    }

    // Ficha firmada: vista tipo documento imprimible (PDF al vuelo, sin guardar archivo)
    if (ficha.estado === 'firmada') {
      return res.render('mantencion_print', {
        layout: false,
        title: `Ficha mantención #${ficha.id} - BIODATA`,
        ficha,
        user: req.user || req.session.user,
      });
    }

    const equiposRes = await pool.query(
      `SELECT id, nombre, marca, modelo, numero_serie, cliente, cliente_id, estado
       FROM equipos ORDER BY nombre ASC`
    );
    const equipo = {
      id: ficha.equipo_id,
      nombre: ficha.equipo_nombre,
      marca: ficha.equipo_marca,
      modelo: ficha.equipo_modelo,
      numero_serie: ficha.equipo_serie,
      cliente: ficha.equipo_cliente,
      cliente_id: ficha.equipo_cliente_id,
    };

    res.render('mantencion_ficha', {
      title: `Mantención #${ficha.id} - BIODATA`,
      user: req.user || req.session.user,
      ficha,
      equipos: equiposRes.rows,
      equipo,
      checklist: ficha.checklist || [],
      modo: 'editar',
      readonly: false,
    });
  } catch (err) {
    console.error('Error obteniendo mantención:', err);
    res.status(500).send('Error al cargar la ficha');
  }
});

router.post('/', authRequired, async (req, res) => {
  try {
    await ensureMantencionesSchema();
    const {
      equipo_id,
      tipo,
      fecha,
      hora,
      trabajo,
      nota,
      dano_descripcion,
      realizado_por,
      firmante_cliente,
      checklist,
      guardar_y_firmar,
      firma_tecnico,
      firma_cliente,
    } = req.body;

    if (!equipo_id) {
      return res.status(400).json({ error: 'Debe seleccionar un equipo' });
    }
    if (!['preventiva', 'correctiva'].includes(tipo)) {
      return res.status(400).json({ error: 'Tipo inválido' });
    }

    const eq = await pool.query('SELECT * FROM equipos WHERE id = $1', [equipo_id]);
    if (eq.rowCount === 0) return res.status(404).json({ error: 'Equipo no encontrado' });

    let checklistData = [];
    if (tipo === 'preventiva') {
      if (typeof checklist === 'string') {
        try { checklistData = JSON.parse(checklist); } catch { checklistData = []; }
      } else if (Array.isArray(checklist)) {
        checklistData = checklist;
      }
      if (!checklistData.length) {
        const protocolo = await getProtocoloByMarca(eq.rows[0].marca);
        checklistData = checklistTemplateFromProtocolo(protocolo);
      }
    }

    const firmar = String(guardar_y_firmar) === 'true' || String(guardar_y_firmar) === '1';
    if (firmar) {
      if (!firma_tecnico || !firma_cliente) {
        return res.status(400).json({ error: 'Se requieren ambas firmas para cerrar la ficha' });
      }
    }

    const estado = firmar ? 'firmada' : 'borrador';
    const insert = await pool.query(
      `INSERT INTO mantenciones_fichas (
        equipo_id, cliente_id, tipo, estado, fecha, hora, trabajo, nota, dano_descripcion,
        checklist, realizado_por, tecnico_id, firma_tecnico, firma_cliente, firmante_cliente, firmada_en
      ) VALUES (
        $1, $2, $3, $4, NULLIF($5,'')::date, NULLIF($6,'')::time, $7, $8, $9,
        $10::jsonb, $11, $12, $13, $14, $15, $16
      ) RETURNING *`,
      [
        Number(equipo_id),
        eq.rows[0].cliente_id || null,
        tipo,
        estado,
        fecha || null,
        hora || null,
        trabajo || '',
        nota || '',
        dano_descripcion || '',
        JSON.stringify(checklistData),
        realizado_por || (req.user && req.user.nombre) || null,
        req.user?.id || null,
        firmar ? firma_tecnico : null,
        firmar ? firma_cliente : null,
        firmante_cliente || null,
        firmar ? new Date() : null,
      ]
    );

    const ficha = mapFichaRow(insert.rows[0]);
    if (req.accepts('json') && !req.accepts('html')) {
      return res.status(201).json(ficha);
    }
    return res.redirect(`/mantenciones/${ficha.id}`);
  } catch (err) {
    console.error('Error creando mantención:', err);
    res.status(500).json({ error: 'Error al crear mantención: ' + err.message });
  }
});

router.patch('/:id', authRequired, async (req, res) => {
  try {
    await ensureMantencionesSchema();
    const { id } = req.params;
    const current = await pool.query('SELECT * FROM mantenciones_fichas WHERE id = $1', [id]);
    if (current.rowCount === 0) return res.status(404).json({ error: 'Ficha no encontrada' });
    if (current.rows[0].estado === 'firmada') {
      return res.status(403).json({ error: 'La ficha firmada no se puede editar' });
    }

    const {
      tipo,
      fecha,
      hora,
      trabajo,
      nota,
      dano_descripcion,
      realizado_por,
      firmante_cliente,
      checklist,
      firma_tecnico,
      firma_cliente,
      guardar_y_firmar,
    } = req.body;

    let checklistData = current.rows[0].checklist;
    if (checklist !== undefined) {
      if (typeof checklist === 'string') {
        try { checklistData = JSON.parse(checklist); } catch { /* keep */ }
      } else if (Array.isArray(checklist)) {
        checklistData = checklist;
      }
    }

    const firmar = String(guardar_y_firmar) === 'true' || String(guardar_y_firmar) === '1';
    const nextFirmaTecnico = firma_tecnico || current.rows[0].firma_tecnico;
    const nextFirmaCliente = firma_cliente || current.rows[0].firma_cliente;

    if (firmar && (!nextFirmaTecnico || !nextFirmaCliente)) {
      return res.status(400).json({ error: 'Se requieren ambas firmas para cerrar la ficha' });
    }

    const estado = firmar ? 'firmada' : 'borrador';
    const updated = await pool.query(
      `UPDATE mantenciones_fichas SET
         tipo = COALESCE($1, tipo),
         fecha = COALESCE(NULLIF($2,'')::date, fecha),
         hora = COALESCE(NULLIF($3,'')::time, hora),
         trabajo = COALESCE($4, trabajo),
         nota = COALESCE($5, nota),
         dano_descripcion = COALESCE($6, dano_descripcion),
         checklist = COALESCE($7::jsonb, checklist),
         realizado_por = COALESCE($8, realizado_por),
         firmante_cliente = COALESCE($9, firmante_cliente),
         firma_tecnico = COALESCE($10, firma_tecnico),
         firma_cliente = COALESCE($11, firma_cliente),
         estado = $12,
         firmada_en = CASE WHEN $12 = 'firmada' THEN COALESCE(firmada_en, NOW()) ELSE firmada_en END,
         actualizado_en = NOW()
       WHERE id = $13
       RETURNING *`,
      [
        tipo || null,
        fecha || null,
        hora || null,
        trabajo ?? null,
        nota ?? null,
        dano_descripcion ?? null,
        JSON.stringify(checklistData),
        realizado_por || null,
        firmante_cliente || null,
        firmar ? nextFirmaTecnico : (firma_tecnico || null),
        firmar ? nextFirmaCliente : (firma_cliente || null),
        estado,
        id,
      ]
    );

    res.json(mapFichaRow(updated.rows[0]));
  } catch (err) {
    console.error('Error actualizando mantención:', err);
    res.status(500).json({ error: 'Error al actualizar mantención' });
  }
});

router.post('/:id/firmar', authRequired, async (req, res) => {
  try {
    await ensureMantencionesSchema();
    const { id } = req.params;
    const { firma_tecnico, firma_cliente, firmante_cliente, realizado_por } = req.body;
    const current = await pool.query('SELECT * FROM mantenciones_fichas WHERE id = $1', [id]);
    if (current.rowCount === 0) return res.status(404).json({ error: 'Ficha no encontrada' });
    if (current.rows[0].estado === 'firmada') {
      return res.status(403).json({ error: 'La ficha ya está firmada' });
    }
    if (!firma_tecnico || !firma_cliente) {
      return res.status(400).json({ error: 'Se requieren ambas firmas' });
    }

    const updated = await pool.query(
      `UPDATE mantenciones_fichas SET
         firma_tecnico = $1,
         firma_cliente = $2,
         firmante_cliente = COALESCE($3, firmante_cliente),
         realizado_por = COALESCE($4, realizado_por),
         estado = 'firmada',
         firmada_en = NOW(),
         actualizado_en = NOW()
       WHERE id = $5
       RETURNING *`,
      [
        firma_tecnico,
        firma_cliente,
        firmante_cliente || null,
        realizado_por || (req.user && req.user.nombre) || null,
        id,
      ]
    );
    res.json(mapFichaRow(updated.rows[0]));
  } catch (err) {
    console.error('Error firmando mantención:', err);
    res.status(500).json({ error: 'Error al firmar mantención' });
  }
});

export default router;
