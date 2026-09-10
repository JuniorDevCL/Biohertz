// top-level file: db.js
import pg from 'pg';
import 'dotenv/config';
import fs from 'fs';
import path from 'path';

const { Pool } = pg;

const isOffline = String(process.env.OFFLINE || '').toLowerCase() === 'true' || !process.env.DATABASE_URL;

function getStorePath() {
  try {
    return path.join(process.cwd(), 'store.json');
  } catch {
    return 'store.json';
  }
}

function loadStore() {
  const fp = getStorePath();
  try {
    const txt = fs.readFileSync(fp, 'utf-8');
    const obj = JSON.parse(txt);
    if (!obj.seq) obj.seq = {};
    if (typeof obj.seq.usuarios !== 'number') obj.seq.usuarios = 1;
    if (typeof obj.seq.tickets !== 'number') obj.seq.tickets = 1;
    if (typeof obj.seq.comentarios !== 'number') obj.seq.comentarios = 1;
    if (typeof obj.seq.equipos !== 'number') obj.seq.equipos = 1;
    if (typeof obj.seq.clientes !== 'number') obj.seq.clientes = 1;
    if (typeof obj.seq.mantenciones_fichas !== 'number') obj.seq.mantenciones_fichas = 1;
    if (typeof obj.seq.eventos !== 'number') obj.seq.eventos = 1;
    if (!Array.isArray(obj.usuarios)) obj.usuarios = [];
    if (!Array.isArray(obj.tickets)) obj.tickets = [];
    if (!Array.isArray(obj.comentarios)) obj.comentarios = [];
    if (!Array.isArray(obj.equipos)) obj.equipos = [];
    if (!Array.isArray(obj.clientes)) obj.clientes = [];
    if (!Array.isArray(obj.mantenciones_fichas)) obj.mantenciones_fichas = [];
    if (!Array.isArray(obj.eventos)) obj.eventos = [];
    return obj;
  } catch {
    return { seq: { usuarios: 1, tickets: 1, comentarios: 1, equipos: 1, clientes: 1, mantenciones_fichas: 1, eventos: 1 }, usuarios: [], tickets: [], comentarios: [], equipos: [], clientes: [], mantenciones_fichas: [], eventos: [] };
  }
}

function saveStore(store) {
  const fp = getStorePath();
  try {
    fs.writeFileSync(fp, JSON.stringify(store, null, 2));
  } catch {}
}

function nowISO() {
  return new Date().toISOString();
}

let pool;

if (isOffline) {
  const store = loadStore();
  pool = {
    async query(sql, params = []) {
      const s = String(sql || '').trim();
      if (s.includes('ALTER TABLE equipos') || s.includes('ALTER TABLE clientes')) {
        return { rows: [], rowCount: 0 };
      }

      if (s.includes('pg_database_size')) {
        const fp = getStorePath();
        let sizeBytes = 0;
        try {
          sizeBytes = fs.statSync(fp).size;
        } catch {}
        
        const i = sizeBytes === 0 ? 0 : Math.floor(Math.log(sizeBytes) / Math.log(1024));
        const sizes = ['B', 'kB', 'MB', 'GB', 'TB'];
        const sizeStr = (sizeBytes / Math.pow(1024, i)).toFixed(2) * 1 + ' ' + sizes[i];
        
        return { rows: [{ size: sizeStr }], rowCount: 1 };
      }

      if (s.startsWith('INSERT INTO usuarios')) {
        const [nombre, email, password, rol] = params;
        const id = store.seq.usuarios++;
        store.usuarios.push({ id, nombre, email, password, rol: rol || 'user' });
        saveStore(store);
        return { rows: [], rowCount: 1 };
      }
      if (s.startsWith('SELECT * FROM usuarios WHERE email =')) {
        const [email] = params;
        const u = store.usuarios.find(x => String(x.email).toLowerCase() === String(email).toLowerCase());
        return { rows: u ? [u] : [], rowCount: u ? 1 : 0 };
      }
      if (s.startsWith('SELECT * FROM usuarios WHERE google_id =')) {
        const [gid] = params;
        const u = store.usuarios.find(x => String(x.google_id) === String(gid));
        return { rows: u ? [u] : [], rowCount: u ? 1 : 0 };
      }
      if (s.startsWith('SELECT * FROM usuarios WHERE id =')) {
        const [id] = params;
        const u = store.usuarios.find(x => String(x.id) === String(id));
        return { rows: u ? [u] : [], rowCount: u ? 1 : 0 };
      }
      if (s.startsWith('SELECT id, nombre, email FROM usuarios')) {
        const rows = store.usuarios.map(u => ({ id: u.id, nombre: u.nombre, email: u.email })).sort((a, b) => String(a.nombre).localeCompare(String(b.nombre)));
        return { rows, rowCount: rows.length };
      }
      if (s.startsWith('SELECT id, nombre, email') && s.includes('FROM usuarios ORDER BY id ASC')) {
        const rows = store.usuarios.map(u => ({ id: u.id, nombre: u.nombre, email: u.email, telefono: u.telefono, rol: u.rol })).sort((a, b) => a.id - b.id);
        return { rows, rowCount: rows.length };
      }
      if (s.startsWith('SELECT id, nombre, email') && s.includes('FROM usuarios WHERE id =')) {
        const [id] = params;
        const u = store.usuarios.find(x => String(x.id) === String(id));
        return { rows: u ? [{ id: u.id, nombre: u.nombre, email: u.email, telefono: u.telefono, rol: u.rol }] : [], rowCount: u ? 1 : 0 };
      }
      if (s.startsWith('UPDATE usuarios SET')) {
        let id, nombre, email, rol, password, telefono;
        
        if (s.includes('telefono =')) {
             if (s.includes('password =')) {
                  [nombre, email, telefono, rol, password, id] = params;
             } else {
                  [nombre, email, telefono, rol, id] = params;
             }
        } else {
             if (params.length === 5) {
                  [nombre, email, rol, password, id] = params;
             } else {
                  [nombre, email, rol, id] = params;
             }
        }

        const u = store.usuarios.find(x => String(x.id) === String(id));
        if (!u) return { rows: [], rowCount: 0 };
        
        u.nombre = nombre;
        u.email = email;
        u.rol = rol;
        if (telefono !== undefined) u.telefono = telefono;
        if (password) u.password = password;
        
        saveStore(store);
         return { rows: [], rowCount: 1 };
       }
       if (s.startsWith('DELETE FROM usuarios')) {
        const [id] = params;
        const i = store.usuarios.findIndex(x => String(x.id) === String(id));
        if (i === -1) return { rows: [], rowCount: 0 };
        store.usuarios.splice(i, 1);
        saveStore(store);
        return { rows: [], rowCount: 1 };
      }
  
       if (s.startsWith('INSERT INTO tickets')) {
        const [titulo, descripcion, creado_por, asignado_a, equipo_id, cliente_id, tipo, codigo] = params;
        const id = store.seq.tickets++;
        const t = { 
          id, 
          titulo, 
          descripcion, 
          creado_por, 
          asignado_a: asignado_a ?? null, 
          equipo_id: equipo_id ?? null, 
          cliente_id: cliente_id ? Number(cliente_id) : null,
          tipo: tipo || null,
          codigo: codigo || null,
          estado: 'pendiente', 
          creado_en: nowISO(), 
          actualizado_en: nowISO(),
          terminado_en: null
        };
        store.tickets.push(t);
        saveStore(store);
        return { rows: [t], rowCount: 1 };
      }

      if (s.includes('FROM tickets t') && (s.includes('t.cliente_id = $1') || s.includes('e.cliente_id = $1')) && !s.includes('WHERE t.id =')) {
        const [id] = params;
        const list = store.tickets
          .filter(t => {
            if (String(t.cliente_id) === String(id)) return true;
            if (t.equipo_id) {
              const eq = store.equipos.find(e => String(e.id) === String(t.equipo_id));
              if (eq && String(eq.cliente_id) === String(id)) return true;
            }
            return false;
          })
          .sort((a, b) => String(b.creado_en).localeCompare(String(a.creado_en)))
          .map(t => {
            const u2 = t.asignado_a ? store.usuarios.find(u => u.id === t.asignado_a) : null;
            return { ...t, asignado_a_nombre: u2 ? u2.nombre : null };
          });
        return { rows: list, rowCount: list.length };
      }

      if (s.startsWith('SELECT t.*,') && s.includes('WHERE t.id =')) {
        const [id] = params;
        const t = store.tickets.find(x => String(x.id) === String(id));
        if (!t) return { rows: [], rowCount: 0 };
        const u1 = store.usuarios.find(u => u.id === t.creado_por);
        const u2 = t.asignado_a ? store.usuarios.find(u => u.id === t.asignado_a) : null;
        const eq = t.equipo_id ? store.equipos.find(e => e.id === t.equipo_id) : null;
        const row = { ...t, creado_por_nombre: u1 ? u1.nombre : null, asignado_a_nombre: u2 ? u2.nombre : null, equipo_nombre: eq ? eq.nombre : null };
        return { rows: [row], rowCount: 1 };
      }

      if (s.includes('FROM tickets') && (s.startsWith('SELECT') || s.startsWith('SELECT COUNT(*)'))) {
        let list = store.tickets.slice().sort((a, b) => String(b.creado_en).localeCompare(String(a.creado_en)));

        const stateMatch = s.match(/(?:t\.)?estado = \$(\d+)/);
        if (stateMatch) {
            const idx = parseInt(stateMatch[1]) - 1;
            const val = params[idx];
            list = list.filter(t => t.estado === val);
        }
        const assignMatch = s.match(/(?:t\.)?asignado_a = \$(\d+)/);
        if (assignMatch) {
            const idx = parseInt(assignMatch[1]) - 1;
            const val = params[idx];
            list = list.filter(t => Number(t.asignado_a) === Number(val));
        }
        const eqMatch = s.match(/(?:t\.)?equipo_id = \$(\d+)/);
        if (eqMatch) {
            const idx = parseInt(eqMatch[1]) - 1;
            const val = params[idx];
            list = list.filter(t => Number(t.equipo_id) === Number(val));
        }
        const tipoMatch = s.match(/(?:t\.)?tipo = \$(\d+)/);
        if (tipoMatch) {
            const idx = parseInt(tipoMatch[1]) - 1;
            const val = params[idx];
            list = list.filter(t => t.tipo === val);
        }
        const qMatch = s.match(/\((?:t\.)?titulo ILIKE \$(\d+) OR/);
        if (qMatch) {
            const idx = parseInt(qMatch[1]) - 1;
            const val = String(params[idx]).replace(/%/g, '').toLowerCase();
            list = list.filter(t => 
                (t.titulo && t.titulo.toLowerCase().includes(val)) || 
                (t.descripcion && t.descripcion.toLowerCase().includes(val))
            );
        }

        const clienteMatch = s.match(/(?:t\.)?cliente_id = \$(\d+)/);
        if (clienteMatch) {
            const idx = parseInt(clienteMatch[1]) - 1;
            const val = params[idx];
            list = list.filter(t => {
                if (Number(t.cliente_id) === Number(val)) return true;
                if (t.equipo_id) {
                    const eq = store.equipos.find(e => Number(e.id) === Number(t.equipo_id));
                    if (eq && Number(eq.cliente_id) === Number(val)) return true;
                }
                return false;
            });
        }

        if (s.startsWith('SELECT COUNT(*)')) {
            return { rows: [{ count: String(list.length) }], rowCount: 1 };
        }

        const hasLimit = /\bLIMIT\s+\$/i.test(s);
        const limit = hasLimit ? (Number(params[params.length - 2]) || 50) : list.length;
        const offset = hasLimit ? (Number(params[params.length - 1]) || 0) : 0;
        const page = list.slice(offset, offset + limit).map(t => {
          const u1 = store.usuarios.find(u => u.id === t.creado_por);
          const u2 = t.asignado_a ? store.usuarios.find(u => u.id === t.asignado_a) : null;
          return { ...t, creado_por_nombre: u1 ? u1.nombre : String(t.creado_por), asignado_a_nombre: u2 ? u2.nombre : null };
        });
        return { rows: page, rowCount: page.length };
      }

      if (s.startsWith('UPDATE tickets') && s.includes('SET estado')) {
        const [estado, id] = params;
        const t = store.tickets.find(x => String(x.id) === String(id));
        if (!t) return { rows: [], rowCount: 0 };
        t.estado = estado;
        t.actualizado_en = nowISO();
        if (estado === 'terminado' || estado === 'hecho') {
          t.terminado_en = nowISO();
        }
        saveStore(store);
        return { rows: [t], rowCount: 1 };
      }
      if (s.startsWith('UPDATE tickets') && s.includes('SET asignado_a')) {
        const [asignado_a, id] = params;
        const t = store.tickets.find(x => String(x.id) === String(id));
        if (!t) return { rows: [], rowCount: 0 };
        t.asignado_a = asignado_a ?? null;
        t.actualizado_en = nowISO();
        saveStore(store);
        return { rows: [t], rowCount: 1 };
      }
      if (s.startsWith('UPDATE tickets') && s.includes('SET titulo')) {
        const [titulo, descripcion, asignado_a, equipo_id, id] = params;
        const t = store.tickets.find(x => String(x.id) === String(id));
        if (!t) return { rows: [], rowCount: 0 };
        if (titulo !== null) t.titulo = titulo;
        if (descripcion !== null) t.descripcion = descripcion;
        if (typeof asignado_a !== 'undefined') t.asignado_a = asignado_a;
        if (typeof equipo_id !== 'undefined') t.equipo_id = equipo_id;
        t.actualizado_en = nowISO();
        saveStore(store);
        return { rows: [t], rowCount: 1 };
      }
      if (s.startsWith('DELETE FROM tickets')) {
        const [id] = params;
        const idx = store.tickets.findIndex(x => String(x.id) === String(id));
        if (idx === -1) return { rows: [], rowCount: 0 };
        store.tickets.splice(idx, 1);
        saveStore(store);
        return { rows: [], rowCount: 1 };
      }

      if (s.startsWith('INSERT INTO comentarios')) {
        const [ticket_id, autor_id, contenido] = params;
        const id = store.seq.comentarios++;
        const c = { id, ticket_id: Number(ticket_id), autor_id: Number(autor_id), contenido, creado_en: nowISO() };
        store.comentarios.push(c);
        saveStore(store);
        return { rows: [c], rowCount: 1 };
      }
      if (s.startsWith('SELECT c.*, u.nombre AS autor_nombre')) {
        const [ticket_id] = params;
        const list = store.comentarios.filter(c => String(c.ticket_id) === String(ticket_id)).sort((a, b) => String(a.creado_en).localeCompare(String(b.creado_en)));
        const rows = list.map(c => {
          const u = store.usuarios.find(x => x.id === c.autor_id);
          return { ...c, autor_nombre: u ? u.nombre : String(c.autor_id) };
        });
        return { rows, rowCount: rows.length };
      }
      if (s.startsWith('SELECT * FROM comentarios WHERE id =')) {
        const [id, ticket_id] = params;
        const c = store.comentarios.find(x => String(x.id) === String(id) && String(x.ticket_id) === String(ticket_id));
        return { rows: c ? [c] : [], rowCount: c ? 1 : 0 };
      }
      if (s.startsWith('DELETE FROM comentarios WHERE id =')) {
        const [id] = params;
        const i = store.comentarios.findIndex(c => String(c.id) === String(id));
        if (i === -1) return { rows: [], rowCount: 0 };
        store.comentarios.splice(i, 1);
        saveStore(store);
        return { rows: [], rowCount: 1 };
      }



      if (s.startsWith('SELECT * FROM equipos WHERE cliente_id =')) {
         const [id] = params;
         const list = store.equipos.filter(e => String(e.cliente_id) === String(id)).sort((a, b) => String(b.actualizado_en).localeCompare(String(a.actualizado_en)));
         return { rows: list, rowCount: list.length };
      }

      if ((/^SELECT .* FROM equipos/i.test(s) && s.includes('ORDER BY actualizado_en DESC')) || s.startsWith('SELECT COUNT(*) FROM equipos')) {
        let list = store.equipos.slice().sort((a, b) => String(b.actualizado_en).localeCompare(String(a.actualizado_en)));

        const stateMatch = s.match(/estado = \$(\d+)/);
        if (stateMatch) {
            const idx = parseInt(stateMatch[1]) - 1;
            const val = params[idx];
            list = list.filter(e => e.estado === val);
        }
        const qMatch = s.match(/\(nombre ILIKE \$(\d+) OR/);
        if (qMatch) {
            const idx = parseInt(qMatch[1]) - 1;
            const val = String(params[idx]).replace(/%/g, '').toLowerCase();
            list = list.filter(e => 
                (e.nombre && e.nombre.toLowerCase().includes(val)) ||
                (e.marca && e.marca.toLowerCase().includes(val)) ||
                (e.modelo && e.modelo.toLowerCase().includes(val)) ||
                (e.numero_serie && e.numero_serie.toLowerCase().includes(val)) ||
                (e.numero_orden && e.numero_orden.toLowerCase().includes(val)) ||
                (e.ubicacion && e.ubicacion.toLowerCase().includes(val))
             );
         }
         const fields = ['marca', 'aplicacion', 'modelo', 'numero_serie', 'cliente'];
         fields.forEach(f => {
             const regex = new RegExp(`(?:WHERE|AND)\\s+${f} ILIKE \\$(\\d+)`);
             const m = s.match(regex);
             if (m) {
                const idx = parseInt(m[1]) - 1;
                const val = String(params[idx]).replace(/%/g, '').toLowerCase();
                list = list.filter(e => e[f] && e[f].toLowerCase().includes(val));
            }
        });
        const anioMatch = s.match(/anio_venta = \$(\d+)/);
        if (anioMatch) {
            const idx = parseInt(anioMatch[1]) - 1;
            const val = params[idx];
            list = list.filter(e => Number(e.anio_venta) === Number(val));
        }

        if (s.startsWith('SELECT COUNT(*)')) {
            return { rows: [{ count: String(list.length) }], rowCount: 1 };
        }

        const limit = Number(params[params.length - 2]) || 50;
        const offset = Number(params[params.length - 1]) || 0;
        const page = list.slice(offset, offset + limit);
        return { rows: page, rowCount: page.length };
      }
      if (s.includes('FROM equipos WHERE LOWER(TRIM(numero_serie))')) {
        const [serie] = params;
        const target = String(serie || '').trim().toLowerCase();
        const e = store.equipos.find(x => String(x.numero_serie || '').trim().toLowerCase() === target);
        return { rows: e ? [e] : [], rowCount: e ? 1 : 0 };
      }
      if (s.startsWith('SELECT * FROM equipos WHERE id =') || s.startsWith('SELECT id, cliente_id FROM equipos WHERE id =')) {
        const [id] = params;
        const e = store.equipos.find(x => String(x.id) === String(id));
        return { rows: e ? [e] : [], rowCount: e ? 1 : 0 };
      }
      if (s.startsWith('INSERT INTO equipos')) {
        const id = store.seq.equipos++;
        let e;
        if (s.includes('fecha_ingreso') || s.includes('plazo_garantia')) {
          const [nombre, marca, modelo, numero_serie, numero_orden, fecha_embarque, fecha_ingreso, ubicacion, estado, aplicacion, cliente, cliente_id, anio_venta, fecha_instalacion, plazo_garantia_meses, fecha_vencimiento_garantia, mp_garantia_fechas, mantenciones] = params;
          let m = [];
          try { m = mantenciones ? JSON.parse(mantenciones) : []; } catch { m = []; }
          let mp = [];
          try { mp = mp_garantia_fechas ? (typeof mp_garantia_fechas === 'string' ? JSON.parse(mp_garantia_fechas) : mp_garantia_fechas) : []; } catch { mp = []; }
          e = { id, nombre, marca, modelo, numero_serie, numero_orden: numero_orden || null, fecha_embarque: fecha_embarque || null, fecha_ingreso: fecha_ingreso || null, ubicacion, estado: estado || 'activo', aplicacion, cliente, cliente_id: cliente_id ? Number(cliente_id) : null, anio_venta: anio_venta ? Number(anio_venta) : null, fecha_instalacion: fecha_instalacion || null, plazo_garantia_meses: plazo_garantia_meses ? Number(plazo_garantia_meses) : null, fecha_vencimiento_garantia: fecha_vencimiento_garantia || null, mp_garantia_fechas: Array.isArray(mp) ? mp : [], mantenciones: Array.isArray(m) ? m : [], creado_en: nowISO(), actualizado_en: nowISO() };
        } else if (s.includes('numero_orden')) {
          const [nombre, marca, modelo, numero_serie, numero_orden, fecha_embarque, ubicacion, estado, aplicacion, cliente, cliente_id, anio_venta, fecha_instalacion, mantenciones] = params;
          const m = mantenciones ? JSON.parse(mantenciones) : [];
          e = { id, nombre, marca, modelo, numero_serie, numero_orden: numero_orden || null, fecha_embarque: fecha_embarque || null, fecha_ingreso: null, ubicacion, estado: estado || 'activo', aplicacion, cliente, cliente_id: cliente_id ? Number(cliente_id) : null, anio_venta: anio_venta ? Number(anio_venta) : null, fecha_instalacion: fecha_instalacion || null, plazo_garantia_meses: null, fecha_vencimiento_garantia: null, mp_garantia_fechas: [], mantenciones: Array.isArray(m) ? m : [], creado_en: nowISO(), actualizado_en: nowISO() };
        } else {
          const [nombre, modelo, numero_serie, cliente_id, cliente, marca, ubicacion] = params;
          e = { id, nombre, marca: marca || null, modelo, numero_serie, numero_orden: null, fecha_embarque: null, fecha_ingreso: null, ubicacion: ubicacion || null, estado: 'activo', aplicacion: null, cliente, cliente_id: cliente_id ? Number(cliente_id) : null, anio_venta: null, fecha_instalacion: null, plazo_garantia_meses: null, fecha_vencimiento_garantia: null, mp_garantia_fechas: [], mantenciones: [], creado_en: nowISO(), actualizado_en: nowISO() };
        }
        store.equipos.push(e);
        saveStore(store);
        return { rows: [e], rowCount: 1 };
      }
      if (s.startsWith('UPDATE equipos') && s.includes('plazo_garantia_meses') && s.includes('cliente_id = $1')) {
        const [clienteId, clienteNombre, marca, modelo, fechaInst, plazo, vencimiento, mpjson, ubicacion, id] = params;
        const e = store.equipos.find(x => String(x.id) === String(id));
        if (!e) return { rows: [], rowCount: 0 };
        e.cliente_id = clienteId ?? e.cliente_id;
        if (clienteNombre) e.cliente = clienteNombre;
        if (marca) e.marca = marca;
        if (modelo) e.modelo = modelo;
        if (fechaInst) e.fecha_instalacion = fechaInst;
        if (plazo) e.plazo_garantia_meses = plazo;
        if (vencimiento) e.fecha_vencimiento_garantia = vencimiento;
        if (mpjson) {
          try { e.mp_garantia_fechas = typeof mpjson === 'string' ? JSON.parse(mpjson) : mpjson; } catch {}
        }
        if (ubicacion) e.ubicacion = ubicacion;
        e.actualizado_en = nowISO();
        saveStore(store);
        return { rows: [e], rowCount: 1 };
      }
      if (s.startsWith('UPDATE equipos') && s.includes('SET nombre')) {
        const [nombre, marca, modelo, numero_serie, numero_orden, fecha_embarque, fecha_ingreso, ubicacion, estado, aplicacion, cliente, cliente_id, anio_venta, fecha_instalacion, plazo_garantia_meses, fecha_vencimiento_garantia, mp_garantia_fechas, mantenciones, id] = params.length >= 19
          ? params
          : [...params.slice(0, 6), null, ...params.slice(6, 13), null, null, null, ...params.slice(13)];
        const e = store.equipos.find(x => String(x.id) === String(id));
        if (!e) return { rows: [], rowCount: 0 };
        if (typeof nombre !== 'undefined') e.nombre = nombre ?? e.nombre;
        if (typeof marca !== 'undefined') e.marca = marca ?? e.marca;
        if (typeof modelo !== 'undefined') e.modelo = modelo ?? e.modelo;
        if (typeof numero_serie !== 'undefined') e.numero_serie = numero_serie ?? e.numero_serie;
        if (typeof numero_orden !== 'undefined') e.numero_orden = numero_orden ?? e.numero_orden;
        if (typeof fecha_embarque !== 'undefined') e.fecha_embarque = fecha_embarque ?? e.fecha_embarque;
        if (typeof fecha_ingreso !== 'undefined') e.fecha_ingreso = fecha_ingreso ?? e.fecha_ingreso;
        if (typeof ubicacion !== 'undefined') e.ubicacion = ubicacion ?? e.ubicacion;
        if (typeof estado !== 'undefined') e.estado = estado ?? e.estado;
        if (typeof aplicacion !== 'undefined') e.aplicacion = aplicacion ?? e.aplicacion;
        if (typeof cliente !== 'undefined') e.cliente = cliente ?? e.cliente;
        if (typeof cliente_id !== 'undefined') e.cliente_id = cliente_id ?? e.cliente_id;
        if (typeof anio_venta !== 'undefined') e.anio_venta = anio_venta ?? e.anio_venta;
        if (typeof fecha_instalacion !== 'undefined') e.fecha_instalacion = fecha_instalacion ?? e.fecha_instalacion;
        if (typeof plazo_garantia_meses !== 'undefined') e.plazo_garantia_meses = plazo_garantia_meses ?? e.plazo_garantia_meses;
        if (typeof fecha_vencimiento_garantia !== 'undefined') e.fecha_vencimiento_garantia = fecha_vencimiento_garantia ?? e.fecha_vencimiento_garantia;
        if (typeof mp_garantia_fechas !== 'undefined' && mp_garantia_fechas !== null) {
          try { e.mp_garantia_fechas = typeof mp_garantia_fechas === 'string' ? JSON.parse(mp_garantia_fechas) : mp_garantia_fechas; } catch {}
        }
        if (typeof mantenciones !== 'undefined' && mantenciones !== null) {
          try { e.mantenciones = JSON.parse(mantenciones); } catch {}
        }
        e.actualizado_en = nowISO();
        saveStore(store);
        return { rows: [e], rowCount: 1 };
      }
      if (s.startsWith('DELETE FROM equipos')) {
        const [id] = params;
        const i = store.equipos.findIndex(x => String(x.id) === String(id));
        if (i === -1) return { rows: [], rowCount: 0 };
        store.equipos.splice(i, 1);
        saveStore(store);
        return { rows: [], rowCount: 1 };
      }
      if (s.startsWith('SELECT mantenciones FROM equipos WHERE id =')) {
        const [id] = params;
        const e = store.equipos.find(x => String(x.id) === String(id));
        const m = e ? e.mantenciones || [] : [];
        return { rows: [{ mantenciones: m }], rowCount: e ? 1 : 0 };
      }
      if (s.startsWith('UPDATE equipos SET mantenciones =')) {
        const [mjson, id] = params;
        const e = store.equipos.find(x => String(x.id) === String(id));
        if (!e) return { rows: [], rowCount: 0 };
        try { e.mantenciones = JSON.parse(mjson); } catch { e.mantenciones = []; }
        e.actualizado_en = nowISO();
        saveStore(store);
        return { rows: [{ mantenciones: e.mantenciones }], rowCount: 1 };
      }

      if (s.startsWith('INSERT INTO clientes')) {
        const [nombre, empresa, email, telefono, ubicacion, rut, direccion, comuna, ciudad, contacto] = params;
        const id = store.seq.clientes++;
        const c = { 
          id, 
          nombre: nombre || null, 
          empresa: empresa || null, 
          email: email || null,
          telefono: telefono || null,
          ubicacion: ubicacion || null,
          rut: rut || null,
          direccion: direccion || null,
          comuna: comuna || null,
          ciudad: ciudad || null,
          contacto: contacto || null,
          creado_en: nowISO(), 
          actualizado_en: nowISO() 
        };
        store.clientes.push(c);
        saveStore(store);
        return { rows: [c], rowCount: 1 };
      }
      if (s.startsWith('SELECT * FROM clientes') && s.includes('WHERE id =')) {
        const [id] = params;
        const c = store.clientes.find(x => String(x.id) === String(id));
        return { rows: c ? [c] : [], rowCount: c ? 1 : 0 };
      }

      if (s.startsWith('UPDATE equipos SET cliente_id = NULL')) {
        const [id] = params;
        let count = 0;
        store.equipos.forEach(e => {
            if (String(e.cliente_id) === String(id)) {
                e.cliente_id = null;
                e.cliente = null;
                count++;
            }
        });
        if (count > 0) saveStore(store);
        return { rows: [], rowCount: count };
      }
      if (s.startsWith('DELETE FROM clientes')) {
        const [id] = params;
        const idx = store.clientes.findIndex(x => String(x.id) === String(id));
        if (idx === -1) return { rows: [], rowCount: 0 };
        const deleted = store.clientes[idx];
        store.clientes.splice(idx, 1);
        saveStore(store);
        return { rows: [deleted], rowCount: 1 };
      }
      if (s.startsWith('UPDATE clientes')) {
        const [nombre, empresa, email, telefono, ubicacion, rut, direccion, comuna, ciudad, contacto, id] = params.length >= 11
          ? params
          : [...params.slice(0, 5), null, null, null, null, null, params[5]];
        const c = store.clientes.find(x => String(x.id) === String(id));
        if (!c) return { rows: [], rowCount: 0 };
        if (nombre !== undefined && nombre !== null) c.nombre = nombre;
        if (empresa !== undefined && empresa !== null) c.empresa = empresa;
        if (email !== undefined && email !== null) c.email = email;
        if (telefono !== undefined && telefono !== null) c.telefono = telefono;
        if (ubicacion !== undefined && ubicacion !== null) c.ubicacion = ubicacion;
        if (rut !== undefined && rut !== null) c.rut = rut;
        if (direccion !== undefined && direccion !== null) c.direccion = direccion;
        if (comuna !== undefined && comuna !== null) c.comuna = comuna;
        if (ciudad !== undefined && ciudad !== null) c.ciudad = ciudad;
        if (contacto !== undefined && contacto !== null) c.contacto = contacto;
        c.actualizado_en = nowISO();
        saveStore(store);
        return { rows: [c], rowCount: 1 };
      }

      // --- Mantenciones fichas (offline mínimo) ---
      if (!Array.isArray(store.mantenciones_fichas)) store.mantenciones_fichas = [];
      if (typeof store.seq.mantenciones_fichas !== 'number') store.seq.mantenciones_fichas = 1;

      if (s.includes('CREATE TABLE IF NOT EXISTS protocolos_marca') || s.includes('CREATE TABLE IF NOT EXISTS mantenciones_fichas')) {
        return { rows: [], rowCount: 0 };
      }
      if (s.includes('ALTER TABLE mantenciones_fichas')) {
        return { rows: [], rowCount: 0 };
      }
      if (s.includes('INSERT INTO protocolos_marca') || s.includes('FROM protocolos_marca')) {
        return { rows: [], rowCount: 0 };
      }

      if (s.startsWith('SELECT * FROM mantenciones_fichas WHERE id =')) {
        const [id] = params;
        const m = store.mantenciones_fichas.find(x => String(x.id) === String(id));
        return { rows: m ? [m] : [], rowCount: m ? 1 : 0 };
      }

      if (s.includes('FROM mantenciones_fichas m') && s.includes('WHERE m.id =')) {
        const [id] = params;
        const m = store.mantenciones_fichas.find(x => String(x.id) === String(id));
        if (!m) return { rows: [], rowCount: 0 };
        const e = store.equipos.find(x => String(x.id) === String(m.equipo_id));
        const row = {
          ...m,
          equipo_nombre: e?.nombre || null,
          equipo_marca: e?.marca || null,
          equipo_modelo: e?.modelo || null,
          equipo_serie: e?.numero_serie || null,
          equipo_cliente: e?.cliente || null,
          equipo_cliente_id: e?.cliente_id ?? null,
        };
        return { rows: [row], rowCount: 1 };
      }

      if (s.includes('FROM mantenciones_fichas m') && s.includes('ORDER BY')) {
        const rows = store.mantenciones_fichas.slice().sort((a, b) => Number(b.id) - Number(a.id)).map(m => {
          const e = store.equipos.find(x => String(x.id) === String(m.equipo_id));
          return {
            ...m,
            equipo_nombre: e?.nombre || null,
            equipo_marca: e?.marca || null,
            equipo_modelo: e?.modelo || null,
            equipo_serie: e?.numero_serie || null,
            equipo_cliente: e?.cliente || null,
          };
        });
        return { rows, rowCount: rows.length };
      }

      if (s.startsWith('INSERT INTO mantenciones_fichas')) {
        const parseMaybeJson = (v, fb) => {
          if (v == null) return fb;
          if (typeof v === 'object') return v;
          try { return JSON.parse(v); } catch { return fb; }
        };
        const id = store.seq.mantenciones_fichas++;
        const row = {
          id,
          equipo_id: params[0] != null ? Number(params[0]) : null,
          cliente_id: params[1] != null ? Number(params[1]) : null,
          tipo: params[2] || 'preventiva',
          estado: params[3] || 'borrador',
          fecha: params[4] || null,
          hora: params[5] || null,
          trabajo: params[6] || '',
          nota: params[7] || '',
          dano_descripcion: params[8] || '',
          checklist: parseMaybeJson(params[9], []),
          realizado_por: params[10] || null,
          tecnico_id: params[11] || null,
          firma_tecnico: params[12] || null,
          firma_cliente: params[13] || null,
          firmante_cliente: params[14] || null,
          email_cliente: params[15] || null,
          proxima_mantencion: params[16] || null,
          firmada_en: params[17] || null,
          rut_cliente: params[18] || null,
          senores: params[19] || null,
          direccion: params[20] || null,
          ciudad_comuna: params[21] || null,
          telefono_cliente: params[22] || null,
          contacto_nombre: params[23] || null,
          version_sw: params[24] || null,
          motivo_atencion: params[25] || '',
          categorias: parseMaybeJson(params[26], []),
          fotos: [],
          creado_en: nowISO(),
          actualizado_en: nowISO(),
        };
        store.mantenciones_fichas.push(row);
        saveStore(store);
        return { rows: [row], rowCount: 1 };
      }

      if (s.startsWith('UPDATE mantenciones_fichas SET fotos')) {
        const [fotos, id] = params;
        const m = store.mantenciones_fichas.find(x => String(x.id) === String(id));
        if (!m) return { rows: [], rowCount: 0 };
        try { m.fotos = typeof fotos === 'string' ? JSON.parse(fotos) : (fotos || []); } catch { m.fotos = []; }
        saveStore(store);
        return { rows: [m], rowCount: 1 };
      }

      if (s.startsWith('UPDATE mantenciones_fichas SET') && s.includes('equipo_id = $26')) {
        const id = params[24];
        const m = store.mantenciones_fichas.find(x => String(x.id) === String(id) && x.estado === 'borrador');
        if (!m) return { rows: [], rowCount: 0 };
        const parseMaybeJson = (v, fb) => {
          if (v == null) return fb;
          if (typeof v === 'object') return v;
          try { return JSON.parse(v); } catch { return fb; }
        };
        const keep = (incoming, prev) => (incoming == null || incoming === '' ? prev : incoming);
        m.tipo = params[0] || m.tipo;
        m.fecha = keep(params[1], m.fecha);
        m.hora = keep(params[2], m.hora);
        m.trabajo = params[3] ?? m.trabajo;
        m.nota = params[4] ?? m.nota;
        m.dano_descripcion = params[5] ?? m.dano_descripcion;
        m.checklist = params[6] == null ? m.checklist : parseMaybeJson(params[6], m.checklist);
        m.realizado_por = params[7] ?? m.realizado_por;
        m.firmante_cliente = params[8] ?? m.firmante_cliente;
        m.firma_tecnico = params[9];
        m.firma_cliente = params[10];
        m.email_cliente = params[11] ?? m.email_cliente;
        m.proxima_mantencion = keep(params[12], m.proxima_mantencion);
        m.estado = params[13] || m.estado;
        if (params[13] === 'firmada') m.firmada_en = m.firmada_en || nowISO();
        m.rut_cliente = params[14] ?? m.rut_cliente;
        m.senores = params[15] ?? m.senores;
        m.direccion = params[16] ?? m.direccion;
        m.ciudad_comuna = params[17] ?? m.ciudad_comuna;
        m.telefono_cliente = params[18] ?? m.telefono_cliente;
        m.contacto_nombre = params[19] ?? m.contacto_nombre;
        m.version_sw = params[20] ?? m.version_sw;
        m.motivo_atencion = params[21] ?? m.motivo_atencion;
        m.categorias = params[22] == null ? m.categorias : parseMaybeJson(params[22], m.categorias || []);
        m.fotos = params[23] == null ? m.fotos : parseMaybeJson(params[23], m.fotos || []);
        m.equipo_id = params[25] ?? m.equipo_id;
        m.cliente_id = params[26] ?? m.cliente_id;
        m.actualizado_en = nowISO();
        saveStore(store);
        return { rows: [m], rowCount: 1 };
      }

      if (s.startsWith('UPDATE mantenciones_fichas SET') && s.includes('rut_cliente = $1') && s.includes("estado = 'firmada'")) {
        const id = params[15];
        const m = store.mantenciones_fichas.find(x => String(x.id) === String(id) && x.estado === 'firmada');
        if (!m) return { rows: [], rowCount: 0 };
        const firmaT = m.firma_tecnico;
        const firmaC = m.firma_cliente;
        const estado = m.estado;
        const checklist = m.checklist;
        const fotos = m.fotos;
        const categorias = m.categorias;
        Object.assign(m, {
          rut_cliente: params[0],
          senores: params[1],
          direccion: params[2],
          ciudad_comuna: params[3],
          telefono_cliente: params[4],
          contacto_nombre: params[5],
          email_cliente: params[6],
          version_sw: params[7],
          motivo_atencion: params[8],
          dano_descripcion: params[9],
          trabajo: params[10],
          nota: params[11],
          realizado_por: params[12],
          firmante_cliente: params[13],
          proxima_mantencion: params[14],
          actualizado_en: nowISO(),
        });
        // Preservar bloqueados
        m.firma_tecnico = firmaT;
        m.firma_cliente = firmaC;
        m.estado = estado;
        m.checklist = checklist;
        m.fotos = fotos;
        m.categorias = categorias;
        saveStore(store);
        return { rows: [m], rowCount: 1 };
      }

      if (s.startsWith('DELETE FROM mantenciones_fichas')) {
        const [id] = params;
        const idx = store.mantenciones_fichas.findIndex(x => String(x.id) === String(id));
        if (idx === -1) return { rows: [], rowCount: 0 };
        const deleted = store.mantenciones_fichas[idx];
        store.mantenciones_fichas.splice(idx, 1);
        saveStore(store);
        return { rows: [deleted], rowCount: 1 };
      }


      if ((s.startsWith('SELECT * FROM clientes') && !s.includes('WHERE id =')) || s.startsWith('SELECT COUNT(*) FROM clientes')) {
        let list = store.clientes.slice().sort((a, b) => String(b.actualizado_en).localeCompare(String(a.actualizado_en)));

        const qMatch = s.match(/\(nombre ILIKE \$(\d+) OR/);
        if (qMatch) {
            const idx = parseInt(qMatch[1]) - 1;
            const val = String(params[idx]).replace(/%/g, '').toLowerCase();
            list = list.filter(c => 
                (c.nombre && c.nombre.toLowerCase().includes(val)) ||
                (c.empresa && c.empresa.toLowerCase().includes(val))
            );
        }

        if (s.startsWith('SELECT COUNT(*)')) {
            return { rows: [{ count: String(list.length) }], rowCount: 1 };
        }

        const limit = Number(params[params.length - 2]) || 50;
        const offset = Number(params[params.length - 1]) || 0;
        const page = list.slice(offset, offset + limit);
        return { rows: page, rowCount: page.length };
      }

      if (s.startsWith('DELETE FROM eventos WHERE equipo_id')) {
        const [equipoId, tipo] = params;
        if (!Array.isArray(store.eventos)) store.eventos = [];
        const before = store.eventos.length;
        store.eventos = store.eventos.filter(ev => !(String(ev.equipo_id) === String(equipoId) && (!tipo || ev.tipo === tipo)));
        if (store.eventos.length !== before) saveStore(store);
        return { rows: [], rowCount: before - store.eventos.length };
      }
      if (s.startsWith('INSERT INTO eventos')) {
        if (!Array.isArray(store.eventos)) store.eventos = [];
        if (typeof store.seq.eventos !== 'number') store.seq.eventos = 1;
        const [titulo, descripcion, fecha] = params;
        const ev = {
          id: store.seq.eventos++,
          titulo,
          descripcion,
          fecha,
          fecha_inicio: fecha,
          fecha_fin: fecha,
          color: params[3] || '#f43f5e',
          creado_por: params[4] || null,
          tipo: params[5] || 'mp_garantia',
          equipo_id: params[6] || null,
          cliente_id: params[7] || null,
          creado_en: nowISO(),
          actualizado_en: nowISO()
        };
        store.eventos.push(ev);
        saveStore(store);
        return { rows: [ev], rowCount: 1 };
      }

      return { rows: [], rowCount: 0 };
    }
  };
} else {
  const isProduction = process.env.NODE_ENV === 'production';
  const connectionConfig = {
    connectionString: process.env.DATABASE_URL,
  };

  if (isProduction || process.env.DATABASE_SSL === 'true') {
    connectionConfig.ssl = { rejectUnauthorized: false };
  }

  pool = new Pool(connectionConfig);
}

export default pool;
