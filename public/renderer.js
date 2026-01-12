
// Global State
const API_URL = '';
let token = localStorage.getItem('token');
let currentUser = null;
let socket = null;
let currentCalendarDate = new Date();

// =========================================================
// INITIALIZATION
// =========================================================

document.addEventListener('DOMContentLoaded', async () => {
    // In SSR, we are already authenticated if we are on this page.
    // However, we might need the token for API calls if we use Bearer auth.
    // dashboard.ejs injects API_TOKEN into localStorage, so 'token' should be set.
    
    if (token) {
        // Optional: verify token or just connect socket
        connectSocket();
        
        // Load initial data
        loadTickets(); // Load tickets by default
    }

    setupEventListeners();
});

function setupEventListeners() {
    // Navigation
    const navDashboard = document.getElementById('navDashboard');
    if(navDashboard) navDashboard.onclick = () => showSection('dashboard-section');
    
    const navTickets = document.getElementById('navTickets');
    if(navTickets) navTickets.onclick = () => { showSection('tickets-section'); loadTickets(); };
    
    const navClientes = document.getElementById('navClientes');
    if(navClientes) navClientes.onclick = () => { showSection('clientes-section'); loadClientes(); };
    
    const navAgenda = document.getElementById('navAgenda');
    if(navAgenda) navAgenda.onclick = () => { showSection('agenda-section'); loadAgenda(); setTimeout(loadAgenda, 100); };

    // Tickets
    const btnCrearTicket = document.getElementById('btnCrearTicket');
    if(btnCrearTicket) btnCrearTicket.onclick = createTicket;
    
    // Clients
    const btnCrearCliente = document.getElementById('btnCrearCliente');
    if(btnCrearCliente) btnCrearCliente.onclick = createCliente;
    
    const btnRefreshClientes = document.getElementById('btnRefreshClientes');
    if(btnRefreshClientes) btnRefreshClientes.onclick = loadClientes;
    
    const cliFiltro = document.getElementById('cli-filtro-q');
    if(cliFiltro) cliFiltro.oninput = debounce(loadClientes, 500);

    // Agenda
    const calPrev = document.getElementById('cal-prev');
    if(calPrev) calPrev.onclick = () => changeMonth(-1);
    
    const calNext = document.getElementById('cal-next');
    if(calNext) calNext.onclick = () => changeMonth(1);
    
    const calToday = document.getElementById('cal-today');
    if(calToday) calToday.onclick = () => { currentCalendarDate = new Date(); loadAgenda(); };
    
    const btnSaveEvent = document.getElementById('btnSaveEvent');
    if(btnSaveEvent) btnSaveEvent.onclick = saveEvent;
    
    const btnCancelEvent = document.getElementById('btnCancelEvent');
    if(btnCancelEvent) btnCancelEvent.onclick = () => document.getElementById('event-modal').style.display = 'none';
    
    const btnCancelEventX = document.getElementById('btnCancelEventX');
    if(btnCancelEventX) btnCancelEventX.onclick = () => document.getElementById('event-modal').style.display = 'none';
}

function debounce(func, wait) {
    let timeout;
    return function(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

// =========================================================
// NAVIGATION
// =========================================================

function showSection(id) {
    console.log('Switching to section:', id);
    
    const sections = ['dashboard-section', 'tickets-section', 'clientes-section', 'agenda-section', 'admin-users', 'settings', 'nuevo-ticket', 'equipos-list'];
    
    sections.forEach(sec => {
        const el = document.getElementById(sec);
        if (el) {
            if (sec === id) el.classList.remove('hidden');
            else el.classList.add('hidden');
        }
    });
}

function connectSocket() {
    if (socket) return;
    socket = io();
    
    socket.on('ticket:created', (ticket) => {
        if (!document.getElementById('tickets-section').classList.contains('hidden')) {
            loadTickets();
        }
    });
    
    socket.on('evento:creado', () => loadAgenda());
    socket.on('evento:eliminado', () => loadAgenda());
}


// =========================================================
// TICKETS LOGIC
// =========================================================

async function loadTickets() {
    try {
        const res = await fetch(`${API_URL}/tickets`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const tickets = await res.json();
        
        const tbody = document.getElementById('tickets-body');
        tbody.innerHTML = '';
        document.getElementById('tickets-total').textContent = tickets.length || 0;
        
        tickets.forEach(t => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>#${t.id}</td>
                <td><div class="font-medium text-white">${t.titulo}</div><div class="text-xs text-slate-500">${t.descripcion || ''}</div></td>
                <td><span class="badge ${getStatusClass(t.estado)}">${t.estado}</span></td>
                <td>${t.asignado_a_nombre || '-'}</td>
                <td>${new Date(t.creado_en).toLocaleDateString()}</td>
                <td class="text-right">
                    <button class="btn btn-ghost btn-small">Ver</button>
                </td>
            `;
            tbody.appendChild(tr);
        });
        
        loadUsersForSelect();
    } catch (e) {
        console.error(e);
    }
}

function getStatusClass(status) {
    switch(status) {
        case 'abierto': return 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20';
        case 'pendiente': return 'bg-amber-500/10 text-amber-500 border-amber-500/20';
        case 'cerrado': return 'bg-slate-500/10 text-slate-500 border-slate-500/20';
        default: return 'bg-blue-500/10 text-blue-500 border-blue-500/20';
    }
}

async function loadUsersForSelect() {
    const sel = document.getElementById('asignado-select');
    if (sel.children.length > 1) return;
    
    try {
        const res = await fetch(`${API_URL}/auth/users`, {
             headers: { 'Authorization': `Bearer ${token}` }
        });
        const users = await res.json();
        users.forEach(u => {
            const opt = document.createElement('option');
            opt.value = u.id;
            opt.textContent = u.nombre;
            sel.appendChild(opt);
        });
    } catch (e) {}
}

async function createTicket() {
    const titulo = document.getElementById('titulo').value;
    const descripcion = document.getElementById('descripcion').value;
    const asignado_a = document.getElementById('asignado-select').value;
    const equipo_id = document.getElementById('equipo').value;
    
    if (!titulo) return alert('El título es obligatorio');
    
    try {
        const res = await fetch(`${API_URL}/tickets`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ titulo, descripcion, asignado_a, equipo_id })
        });
        
        if (res.ok) {
            alert('Ticket creado');
            loadTickets();
            document.getElementById('titulo').value = '';
            document.getElementById('descripcion').value = '';
        } else {
            alert('Error al crear ticket');
        }
    } catch (e) {
        console.error(e);
    }
}

// =========================================================
// CLIENTES LOGIC
// =========================================================

async function loadClientes() {
    const q = document.getElementById('cli-filtro-q').value;
    try {
        const res = await fetch(`${API_URL}/clientes?q=${encodeURIComponent(q)}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const clientes = await res.json();
        
        const tbody = document.getElementById('clientes-body');
        tbody.innerHTML = '';
        document.getElementById('clientes-total').textContent = clientes.length || 0;
        
        clientes.forEach(c => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td class="font-medium text-white">${c.nombre || '-'}</td>
                <td>${c.empresa || '-'}</td>
                <td class="text-slate-400">${c.email || '-'}</td>
                <td class="text-slate-400">${c.telefono || '-'}</td>
                <td class="text-right">
                    <button class="btn btn-ghost btn-small text-red-400 hover:text-red-300" onclick="deleteCliente(${c.id})">Eliminar</button>
                </td>
            `;
            tbody.appendChild(tr);
        });
    } catch (e) {
        console.error(e);
    }
}

async function createCliente() {
    const nombre = document.getElementById('cli-nombre').value;
    const empresa = document.getElementById('cli-empresa').value;
    const email = document.getElementById('cli-email').value;
    const telefono = document.getElementById('cli-telefono').value;
    
    if (!nombre) return alert('Nombre es obligatorio');
    
    try {
        const res = await fetch(`${API_URL}/clientes`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ nombre, empresa, email, telefono })
        });
        
        if (res.ok) {
            loadClientes();
            document.getElementById('cli-nombre').value = '';
            document.getElementById('cli-empresa').value = '';
            document.getElementById('cli-email').value = '';
            document.getElementById('cli-telefono').value = '';
        } else {
            alert('Error al crear cliente');
        }
    } catch (e) {
        console.error(e);
    }
}

async function deleteCliente(id) {
    if(!confirm('¿Eliminar cliente?')) return;
    try {
        const res = await fetch(`${API_URL}/clientes/${id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) loadClientes();
        else alert('No se pudo eliminar');
    } catch (e) { console.error(e); }
}

// =========================================================
// AGENDA LOGIC
// =========================================================

function changeMonth(delta) {
    currentCalendarDate.setMonth(currentCalendarDate.getMonth() + delta);
    loadAgenda();
}

async function loadAgenda() {
    const grid = document.getElementById('calendar-grid');
    if (!grid) return;

    const year = currentCalendarDate.getFullYear();
    const month = currentCalendarDate.getMonth();
    
    // Update Header
    const monthNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
    const title = document.getElementById('cal-month-year');
    if (title) title.textContent = `${monthNames[month]} ${year}`;

    // Calculate Grid Range
    const firstDayOfMonth = new Date(year, month, 1);
    
    // 1 (Mon) - 7 (Sun)
    let startDayOfWeek = firstDayOfMonth.getDay();
    if (startDayOfWeek === 0) startDayOfWeek = 7; 
    
    const startDate = new Date(firstDayOfMonth);
    startDate.setDate(startDate.getDate() - (startDayOfWeek - 1));
    
    // 42 cells (6 weeks)
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + 41);

    // Fetch Events
    let events = [];
    try {
        const startStr = startDate.toISOString();
        const endStr = endDate.toISOString();
        const res = await fetch(`${API_URL}/eventos?start=${startStr}&end=${endStr}`, {
            headers: { 'Authorization': token ? `Bearer ${token}` : '' }
        });
        if (res.ok) {
            events = await res.json();
        }
    } catch (e) {
        console.error('Error fetching events:', e);
    }

    // Render Grid
    grid.innerHTML = '';
    
    const today = new Date();
    today.setHours(0,0,0,0);

    let loopDate = new Date(startDate);

    for (let i = 0; i < 42; i++) {
        const isCurrentMonth = loopDate.getMonth() === month;
        const isToday = loopDate.toDateString() === today.toDateString();
        
        const cell = document.createElement('div');
        cell.className = `min-h-[100px] border border-white/5 p-2 relative group transition-colors hover:bg-white/5 flex flex-col gap-1 ${isCurrentMonth ? 'bg-transparent' : 'bg-black/20 opacity-50'}`;
        if (isToday) cell.classList.add('bg-blue-500/10', 'border-blue-500/30');

        // Date Number
        const dateNum = document.createElement('span');
        dateNum.className = `text-sm font-medium w-6 h-6 flex items-center justify-center rounded-full mb-1 ${isToday ? 'bg-blue-500 text-white' : 'text-slate-400'}`;
        dateNum.textContent = loopDate.getDate();
        cell.appendChild(dateNum);

        // Find events for this day
        const dayStart = new Date(loopDate); dayStart.setHours(0,0,0,0);
        const dayEnd = new Date(loopDate); dayEnd.setHours(23,59,59,999);

        const dayEvents = events.filter(evt => {
            const eStart = new Date(evt.fecha_inicio);
            const eEnd = new Date(evt.fecha_fin);
            return (eStart <= dayEnd && eEnd >= dayStart);
        });

        dayEvents.forEach(evt => {
            const evtEl = document.createElement('div');
            evtEl.className = 'text-[10px] px-1.5 py-0.5 rounded truncate cursor-pointer hover:opacity-80 text-white shadow-sm mb-0.5';
            evtEl.style.backgroundColor = evt.color || '#3b82f6';
            evtEl.textContent = evt.titulo;
            evtEl.title = `${evt.titulo}\n${evt.descripcion || ''}`;
            
            evtEl.onclick = (e) => {
                e.stopPropagation();
                if(confirm(`¿Eliminar evento "${evt.titulo}"?`)) {
                    deleteEvent(evt.id);
                }
            };
            cell.appendChild(evtEl);
        });

        // Click to add event
        const cellDateStr = loopDate.toISOString();
        cell.onclick = () => {
             openEventModal(cellDateStr);
        };

        grid.appendChild(cell);

        // Next day
        loopDate.setDate(loopDate.getDate() + 1);
    }
}

function openEventModal(defaultDateIso) {
    const modal = document.getElementById('event-modal');
    if (!modal) return;
    
    // Reset inputs
    document.getElementById('evt-titulo').value = '';
    document.getElementById('evt-descripcion').value = '';
    
    // Color picker
    document.querySelectorAll('.color-select').forEach(b => b.classList.remove('ring-white'));
    document.querySelector('.selected-color').classList.add('ring-white');
    document.getElementById('evt-color').value = document.querySelector('.selected-color').dataset.color;

    document.querySelectorAll('.color-select').forEach(btn => {
        btn.onclick = () => {
             document.querySelectorAll('.color-select').forEach(b => b.classList.remove('ring-white'));
             btn.classList.add('ring-white');
             document.getElementById('evt-color').value = btn.dataset.color;
        };
    });
    
    const startInput = document.getElementById('evt-inicio');
    const endInput = document.getElementById('evt-fin');
    
    let startDate = new Date();
    if (defaultDateIso) {
        startDate = new Date(defaultDateIso);
        if (startDate.getHours() === 0 && startDate.getMinutes() === 0) {
            startDate.setHours(9, 0, 0, 0);
        }
    }
    
    const endDate = new Date(startDate);
    endDate.setHours(endDate.getHours() + 1);
    
    const toLocalISO = (d) => {
        const offset = d.getTimezoneOffset() * 60000;
        return new Date(d.getTime() - offset).toISOString().slice(0, 16);
    };

    startInput.value = toLocalISO(startDate);
    endInput.value = toLocalISO(endDate);

    modal.style.display = 'flex';
}

async function saveEvent() {
    const titulo = document.getElementById('evt-titulo').value;
    const descripcion = document.getElementById('evt-descripcion').value;
    const inicio = document.getElementById('evt-inicio').value;
    const fin = document.getElementById('evt-fin').value;
    const color = document.getElementById('evt-color').value;

    if (!titulo || !inicio || !fin) {
        alert('Completa el título y las fechas');
        return;
    }

    try {
        const res = await fetch(`${API_URL}/eventos`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': token ? `Bearer ${token}` : '' 
            },
            body: JSON.stringify({
                titulo,
                descripcion,
                fecha_inicio: inicio,
                fecha_fin: fin,
                color
            })
        });

        if (res.ok) {
            document.getElementById('event-modal').style.display = 'none';
            loadAgenda();
        } else {
            alert('Error al guardar evento');
        }
    } catch (e) {
        console.error(e);
        alert('Error de conexión');
    }
}

async function deleteEvent(id) {
    try {
        const res = await fetch(`${API_URL}/eventos/${id}`, {
            method: 'DELETE',
            headers: { 'Authorization': token ? `Bearer ${token}` : '' }
        });
        if (res.ok) {
            loadAgenda();
        } else {
            alert('Error al eliminar');
        }
    } catch (e) {
        console.error(e);
    }
}
