const fs = require('fs');
const path = require('path');

const storePath = path.join(__dirname, 'store.json');

// Helper to generate random int
function rand(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Helper to get random item from array
function sample(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Load existing store
let store;
try {
  store = JSON.parse(fs.readFileSync(storePath, 'utf-8'));
} catch (e) {
  console.error("Error reading store.json", e);
  process.exit(1);
}

// Ensure sequences exist
if (!store.seq) store.seq = {};
['usuarios', 'tickets', 'equipos', 'clientes'].forEach(k => {
  if (!store.seq[k]) store.seq[k] = 0;
});

// --- GENERATE CLIENTS ---
const clientNames = [
  'TechSolutions SA', 'Innovatech Ltda', 'Servicios Globales', 'Consultora Alpha', 'Logistica Express',
  'Hospital Central', 'Clinica San Jose', 'Banco Futuro', 'Seguros Confianza', 'Constructora Muro',
  'Transportes Veloz', 'Agencia Creativa', 'Bufete Legal', 'Restaurante El Sabor', 'Hotel Plaza',
  'Universidad del Norte', 'Colegio San Andres', 'Farmacias Salud', 'Supermercado Ahorro', 'Gimnasio Power'
];

const newClients = [];
clientNames.forEach(name => {
  store.seq.clientes++;
  newClients.push({
    id: store.seq.clientes,
    nombre: name,
    empresa: name,
    email: `contacto@${name.toLowerCase().replace(/\s+/g, '')}.com`,
    telefono: `555-${rand(1000, 9999)}`,
    creado_en: new Date().toISOString()
  });
});

store.clientes = [...store.clientes, ...newClients];
console.log(`Added ${newClients.length} clients.`);

// --- GENERATE EQUIPOS ---
const deviceTypes = ['Laptop', 'Desktop', 'Impresora', 'Servidor', 'Monitor', 'Scanner', 'Tablet'];
const brands = ['Dell', 'HP', 'Lenovo', 'Apple', 'Samsung', 'Epson', 'Canon'];

const newEquipos = [];
const allClients = store.clientes; // Use all clients including new ones

// Generate 50-70 equipments
const numEquipos = rand(50, 70);
for (let i = 0; i < numEquipos; i++) {
  store.seq.equipos++;
  const client = sample(allClients);
  const type = sample(deviceTypes);
  const brand = sample(brands);
  
  newEquipos.push({
    id: store.seq.equipos,
    nombre: `${type} ${brand} - ${rand(100, 999)}`,
    tipo: type,
    marca: brand,
    modelo: `M-${rand(1000, 9999)}`,
    cliente_id: client.id,
    estado: sample(['activo', 'inactivo', 'en_reparacion']),
    creado_en: new Date().toISOString()
  });
}

store.equipos = [...store.equipos, ...newEquipos];
console.log(`Added ${newEquipos.length} equipments.`);

// --- GENERATE TICKETS ---
const ticketTitles = [
  'Falla de encendido', 'Pantalla azul', 'No conecta a internet', 'Impresora atascada', 
  'Actualización de software', 'Instalación de antivirus', 'Ruido extraño en ventilador', 
  'Cambio de disco duro', 'Ampliación de RAM', 'Configuración de correo', 'Mantenimiento preventivo',
  'Error en sistema contable', 'No reconoce USB', 'Teclado no funciona', 'Monitor parpadea'
];

const newTickets = [];
const allEquipos = store.equipos;
const adminUser = store.usuarios.find(u => u.rol === 'admin') || { id: 4 }; // Fallback to Alexis if found

// Generate 40-60 tickets
const numTickets = rand(40, 60);
for (let i = 0; i < numTickets; i++) {
  store.seq.tickets++;
  const equipo = sample(allEquipos);
  const title = sample(ticketTitles);
  
  // Assign randomly: 60% to admin, 20% to others (if any), 20% null (unassigned)
  let assignedTo = null;
  const r = Math.random();
  if (r < 0.6) assignedTo = adminUser.id;
  else if (r < 0.8) assignedTo = null;
  else assignedTo = adminUser.id; // Just assign to admin mostly to ensure "Mis pendientes" is populated
  
  const status = sample(['pendiente', 'en_proceso', 'terminado']);

  newTickets.push({
    id: store.seq.tickets,
    titulo: title,
    descripcion: `Problema reportado con el equipo ${equipo.nombre}. ${title}.`,
    creado_por: adminUser.id,
    asignado_a: assignedTo,
    equipo_id: equipo.id,
    estado: status,
    creado_en: new Date(Date.now() - rand(0, 30*24*60*60*1000)).toISOString(), // Random date in last 30 days
    actualizado_en: new Date().toISOString()
  });
}

store.tickets = [...store.tickets, ...newTickets];
console.log(`Added ${newTickets.length} tickets.`);

// Save store
fs.writeFileSync(storePath, JSON.stringify(store, null, 2));
console.log('Database seeded successfully!');
