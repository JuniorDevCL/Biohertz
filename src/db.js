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
    if (!Array.isArray(obj.usuarios)) obj.usuarios = [];
    if (!Array.isArray(obj.tickets)) obj.tickets = [];
    if (!Array.isArray(obj.comentarios)) obj.comentarios = [];
    if (!Array.isArray(obj.equipos)) obj.equipos = [];
    if (!Array.isArray(obj.clientes)) obj.clientes = [];
    return obj;
  } catch {
    return { seq: { usuarios: 1, tickets: 1, comentarios: 1, equipos: 1, clientes: 1 }, usuarios: [], tickets: [], comentarios: [], equipos: [], clientes: [] };
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
      if (s.includes('ALTER TABLE equipos')) {
        return { rows: [], rowCount: 0 };
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
      if (s.startsWith('SELECT id, nombre, email FROM usuarios')) {
        const rows = store.usuarios.map(u => ({ id: u.id, nombre: u.nombre, email: u.email })).sort((a, b) => String(a.nombre).localeCompare(String(b.nombre)));
        return { rows, rowCount: rows.length };
      }
      if (s.startsWith('SELECT id, nombre, email, rol FROM usuarios ORDER BY id ASC')) {
        const rows = store.usuarios.map(u => ({ id: u.id, nombre: u.nombre, email: u.email, rol: u.rol })).sort((a, b) => a.id - b.id);
        return { rows, rowCount: rows.length };
      }
      if (s.startsWith('SELECT id, nombre, email, rol FROM usuarios WHERE id =')) {
        const [id] = params;
        const u = store.usuarios.find(x => String(x.id) === String(id));
        return { rows: u ? [{ id: u.id, nombre: u.nombre, email: u.email, rol: u.rol }] : [], rowCount: u ? 1 : 0 };
      }
      if (s.startsWith('UPDATE usuarios SET')) {
        // Handle UPDATE usuarios SET nombre = $1, email = $2, rol = $3 [, password = $4] WHERE id = $N
        // Params could be 4 or 5 depending on password update
        // We need to parse params carefully or assume order from route
        // Route 1: nombre, email, rol, hashedPassword, id
        // Route 2: nombre, email, rol, id
        
        let id, nombre, email, rol, password;
        
        if (params.length === 5) {
             [nombre, email, rol, password, id] = params;
        } else {
             [nombre, email, rol, id] = params;
        }

        const u = store.usuarios.find(x => String(x.id) === String(id));
        if (!u) return { rows: [], rowCount: 0 };
        
        u.nombre = nombre;
        u.email = email;
        u.rol = rol;
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

        if (s.startsWith('SELECT COUNT(*)')) {
            return { rows: [{ count: String(list.length) }], rowCount: 1 };
        }

        const limit = Number(params[params.length - 2]) || 50;
        const offset = Number(params[params.length - 1]) || 0;
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

      if ((s.startsWith('SELECT * FROM equipos') && s.includes('ORDER BY actualizado_en DESC')) || s.startsWith('SELECT COUNT(*) FROM equipos')) {
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
      if (s.startsWith('SELECT * FROM equipos WHERE id =')) {
        const [id] = params;
        const e = store.equipos.find(x => String(x.id) === String(id));
        return { rows: e ? [e] : [], rowCount: e ? 1 : 0 };
      }
      if (s.startsWith('INSERT INTO equipos')) {
        const [nombre, marca, modelo, numero_serie, ubicacion, estado, aplicacion, cliente, cliente_id, anio_venta, mantenciones] = params;
        // if (!cliente_id) return { rows: [], rowCount: 0 }; // Permitir nulos (STOCK)
        const id = store.seq.equipos++;
        const m = mantenciones ? JSON.parse(mantenciones) : [];
        const e = { id, nombre, marca, modelo, numero_serie, ubicacion, estado: estado || 'activo', aplicacion, cliente, cliente_id: cliente_id ? Number(cliente_id) : null, anio_venta: anio_venta ? Number(anio_venta) : null, mantenciones: Array.isArray(m) ? m : [], creado_en: nowISO(), actualizado_en: nowISO() };
        store.equipos.push(e);
        saveStore(store);
        return { rows: [e], rowCount: 1 };
      }
      if (s.startsWith('UPDATE equipos') && s.includes('SET nombre')) {
        const [nombre, marca, modelo, numero_serie, ubicacion, estado, aplicacion, cliente, cliente_id, anio_venta, mantenciones, id] = params;
        const e = store.equipos.find(x => String(x.id) === String(id));
        if (!e) return { rows: [], rowCount: 0 };
        if (typeof nombre !== 'undefined') e.nombre = nombre ?? e.nombre;
        if (typeof marca !== 'undefined') e.marca = marca ?? e.marca;
        if (typeof modelo !== 'undefined') e.modelo = modelo ?? e.modelo;
        if (typeof numero_serie !== 'undefined') e.numero_serie = numero_serie ?? e.numero_serie;
        if (typeof ubicacion !== 'undefined') e.ubicacion = ubicacion ?? e.ubicacion;
        if (typeof estado !== 'undefined') e.estado = estado ?? e.estado;
        if (typeof aplicacion !== 'undefined') e.aplicacion = aplicacion ?? e.aplicacion;
        if (typeof cliente !== 'undefined') e.cliente = cliente ?? e.cliente;
        if (typeof cliente_id !== 'undefined') e.cliente_id = cliente_id ?? e.cliente_id;
        if (typeof anio_venta !== 'undefined') e.anio_venta = anio_venta ?? e.anio_venta;
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
        const [nombre, empresa, email, telefono, ubicacion] = params;
        const id = store.seq.clientes++;
        const c = { 
          id, 
          nombre: nombre || null, 
          empresa: empresa || null, 
          email: email || null,
          telefono: telefono || null,
          ubicacion: ubicacion || null,
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
        const [nombre, empresa, email, telefono, ubicacion, id] = params;
        const c = store.clientes.find(x => String(x.id) === String(id));
        if (!c) return { rows: [], rowCount: 0 };
        if (nombre !== undefined && nombre !== null) c.nombre = nombre;
        if (empresa !== undefined && empresa !== null) c.empresa = empresa;
        if (email !== undefined && email !== null) c.email = email;
        if (telefono !== undefined && telefono !== null) c.telefono = telefono;
        if (ubicacion !== undefined && ubicacion !== null) c.ubicacion = ubicacion;
        c.actualizado_en = nowISO();
        saveStore(store);
        return { rows: [c], rowCount: 1 };
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
