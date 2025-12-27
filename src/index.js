// top-level file: index.js
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
dotenv.config();

import authRoutes from './routes/auth.js';
import ticketsRoutes from './routes/tickets.js';
import { createServer } from 'http';
import { Server } from 'socket.io';
import equiposRoutes from './routes/equipos.js';
import clientesRoutes from './routes/clientes.js';
import pool from './db.js';

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(process.cwd(), 'public')));

app.get('/api/health', (req, res) => {
  res.json({ mensaje: 'API OK' });
});

app.use('/auth', authRoutes);
app.use('/tickets', ticketsRoutes);
app.use('/equipos', equiposRoutes);
app.use('/clientes', clientesRoutes);

// Inicializar servidor HTTP y Socket.IO
const server = createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// Disponibilizar io para las rutas
app.set('io', io);

io.on('connection', (socket) => {
  console.log('Cliente conectado:', socket.id);
  socket.on('disconnect', () => {
    console.log('Cliente desconectado:', socket.id);
  });
});

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
