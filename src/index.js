// top-level file: index.js
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import passport from 'passport';
import session from 'express-session';
import './passport.js';
dotenv.config();

import authRoutes from './routes/auth.js';
import ticketsRoutes from './routes/tickets.js';
import { createServer } from 'http';
import equiposRoutes from './routes/equipos.js';
import clientesRoutes from './routes/clientes.js';
import pool from './db.js';

const app = express();

// --- FIX: PERMITIR TAILWIND CSS --- 
app.use((req, res, next) => { 
    res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com; style-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https:;"); 
    next(); 
}); 
// ----------------------------------

console.log(`Server Build ID: ${new Date().getTime()} - Definite Fix`);

console.log('Force CSS Restore: ' + Date.now());

// Middleware para servir archivos estáticos
app.use(express.static(path.join(process.cwd(), 'public')));

app.set('view engine', 'ejs');
app.set('views', path.join(process.cwd(), 'views'));

app.use(session({
  secret: process.env.JWT_SECRET || 'secret_session_key',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false, // process.env.NODE_ENV === 'production', // Deshabilitado temporalmente para dev
    maxAge: 24 * 60 * 60 * 1000
  }
}));
app.use(passport.initialize());
app.use(passport.session());

app.get('/', (req, res) => {
  if (req.isAuthenticated && req.isAuthenticated()) {
    return res.redirect('/dashboard');
  }
  res.render('login', { error: req.query.error, layout: false });
});

import authRequired from './middleware/authRequired.js';
app.get('/dashboard', authRequired, async (req, res) => {
  try {
    // 1. Obtener Usuario (Seguro)
    const user = req.user || req.session.user || { nombre: 'Usuario', rol: 'invitado', email: 'invitado@biohertz.com' };
    
    // 2. Obtener Datos Reales (o Defaults si falla la DB)
    // Inicializamos contadores en 0
    let stats = { 
        totalTickets: 0, 
        pendingTickets: 0, 
        teams: 0, 
        clients: 0 
    };
    let recentTickets = [];

    // Intentamos cargar datos reales si la DB está disponible
    try {
        const [ticketsCount, pendingCount, teamsCount, clientsCount, recents] = await Promise.all([
            pool.query('SELECT COUNT(*) FROM tickets'),
            pool.query("SELECT COUNT(*) FROM tickets WHERE estado = 'pendiente'"),
            pool.query('SELECT COUNT(*) FROM equipos'),
            pool.query('SELECT COUNT(*) FROM clientes'),
            pool.query(`
                SELECT t.*, u.nombre as asignado_nombre 
                FROM tickets t 
                LEFT JOIN usuarios u ON t.asignado_a = u.id 
                ORDER BY t.creado_en DESC LIMIT 5
            `)
        ]);

        stats.totalTickets = parseInt(ticketsCount.rows[0].count) || 0;
        stats.pendingTickets = parseInt(pendingCount.rows[0].count) || 0;
        stats.teams = parseInt(teamsCount.rows[0].count) || 0;
        stats.clients = parseInt(clientsCount.rows[0].count) || 0;
        recentTickets = recents.rows || [];
    } catch (dbError) {
        console.error('Error fetching dashboard stats from DB:', dbError);
        // Fallback silencioso: se renderizará con 0s
    }

    // 3. Renderizar pasando TODAS las variables
    res.render('dashboard', { 
        title: 'Dashboard - BIOHERTZ', 
        user: user,       
        stats: stats,     
        tickets: recentTickets,
        token: req.session?.token || '' // Pass token if available in session
    });
  } catch (error) {
    console.error('Error renderizando dashboard:', error);
    res.status(500).send('Error cargando el dashboard: ' + error.message);
  }
});

app.get('/api/health', (req, res) => {
  res.json({ mensaje: 'API OK' });
});

app.use('/auth', authRoutes);
app.use('/tickets', ticketsRoutes);
app.use('/equipos', equiposRoutes);
app.use('/clientes', clientesRoutes);

// Inicializar servidor HTTP
const server = createServer(app);

// Disponibilizar io para las rutas (mock o null si se elimina socket)
app.set('io', null);

async function ensureBaseSchema() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS usuarios (
        id SERIAL PRIMARY KEY,
        nombre VARCHAR(150) NOT NULL,
        email VARCHAR(150) UNIQUE NOT NULL,
        password VARCHAR(200) NOT NULL,
        rol VARCHAR(20) NOT NULL DEFAULT 'user'
      );

      CREATE TABLE IF NOT EXISTS equipos (
        id SERIAL PRIMARY KEY,
        nombre VARCHAR(150) NOT NULL,
        marca VARCHAR(100),
        modelo VARCHAR(100),
        numero_serie VARCHAR(150),
        ubicacion VARCHAR(150),
        estado VARCHAR(20) NOT NULL DEFAULT 'activo',
        aplicacion VARCHAR(150),
        cliente VARCHAR(150),
        anio_venta INTEGER,
        mantenciones JSONB DEFAULT '[]'::jsonb,
        creado_en TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        actualizado_en TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS tickets (
        id SERIAL PRIMARY KEY,
        titulo VARCHAR(200) NOT NULL,
        descripcion TEXT,
        creado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
        asignado_a INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
        equipo_id INTEGER REFERENCES equipos(id) ON DELETE SET NULL,
        estado VARCHAR(20) NOT NULL DEFAULT 'pendiente',
        creado_en TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        actualizado_en TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_tickets_estado ON tickets(estado);
      CREATE INDEX IF NOT EXISTS idx_tickets_asignado ON tickets(asignado_a);
      CREATE INDEX IF NOT EXISTS idx_equipos_estado ON equipos(estado);
    `);

    // Actualizaciones de esquema para Google Auth
    try {
      await pool.query(`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS google_id VARCHAR(255) UNIQUE;`);
    } catch (e) { console.log('Columna google_id ya existe o error:', e.message); }

    try {
      await pool.query(`ALTER TABLE usuarios ALTER COLUMN password DROP NOT NULL;`);
    } catch (e) { console.log('Error al hacer password nullable:', e.message); }

  } catch (e) {
    console.warn('ensureBaseSchema error:', e && e.message ? e.message : e);
  }
}

const BASE = Number(process.env.PORT) || 4000;
function start(port, tries = 10) {
  const p = Number(port);
  server.once('listening', () => {
    try {
      fs.writeFileSync(path.join(process.cwd(), 'api_port.txt'), String(p));
    } catch {}
    try {
      const exeDir = path.dirname(process.execPath || process.cwd());
      fs.writeFileSync(path.join(exeDir, 'api_port.txt'), String(p));
    } catch {}
    try {
      const resApp = path.join(process.cwd(), 'resources', 'app');
      fs.writeFileSync(path.join(resApp, 'api_port.txt'), String(p));
    } catch {}
    console.log(`Servidor en puerto ${p}`);
  });
  server.once('error', (err) => {
    if (err && err.code === 'EADDRINUSE' && tries > 0) {
      try { server.close(); } catch {}
      start(p + 1, tries - 1);
    } else {
      console.error('Error del servidor:', err);
    }
  });
  server.listen(p, '0.0.0.0');
}
(async () => {
  try { await ensureBaseSchema(); } catch {}
  start(BASE);
})();
