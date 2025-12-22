-- Usuarios
CREATE TABLE IF NOT EXISTS usuarios (
  id SERIAL PRIMARY KEY,
  nombre VARCHAR(100) NOT NULL,
  email VARCHAR(150) UNIQUE NOT NULL,
  password TEXT NOT NULL,
  rol VARCHAR(50) NOT NULL DEFAULT 'user'
);

-- Equipos
CREATE TABLE IF NOT EXISTS equipos (
  id SERIAL PRIMARY KEY,
  nombre VARCHAR(150) NOT NULL,
  marca VARCHAR(100),
  modelo VARCHAR(100),
  numero_serie VARCHAR(150) UNIQUE,
  ubicacion VARCHAR(150),
  estado VARCHAR(50) NOT NULL DEFAULT 'activo',
  creado_en TIMESTAMP NOT NULL DEFAULT NOW(),
  actualizado_en TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Tickets (estilo pedido: pendiente -> hecho)
CREATE TABLE IF NOT EXISTS tickets (
  id SERIAL PRIMARY KEY,
  titulo VARCHAR(200) NOT NULL,
  descripcion TEXT,
  creado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  asignado_a INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  equipo_id INTEGER REFERENCES equipos(id) ON DELETE SET NULL,
  estado VARCHAR(50) NOT NULL DEFAULT 'pendiente',
  creado_en TIMESTAMP NOT NULL DEFAULT NOW(),
  actualizado_en TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Comentarios en tickets
CREATE TABLE IF NOT EXISTS comentarios (
  id SERIAL PRIMARY KEY,
  ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  autor_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE SET NULL,
  contenido TEXT NOT NULL,
  creado_en TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Índices útiles
CREATE INDEX IF NOT EXISTS idx_tickets_estado ON tickets(estado);
CREATE INDEX IF NOT EXISTS idx_tickets_equipo ON tickets(equipo_id);
CREATE INDEX IF NOT EXISTS idx_comentarios_ticket ON comentarios(ticket_id);
