let API_URL = '';

// Detectar entorno y configurar API_URL
if (window.location.protocol === 'file:') {
  API_URL = 'http://localhost:4000'; // Default para electron/local file
  console.log('Detectado protocolo file:, API_URL seteada a', API_URL);
} else {
  console.log('Detectado protocolo http/https, usando rutas relativas');
}

// Variables globales
let token = null;
let socket = null;
let currentUser = null;
let totalTickets = 0;
let totalEquipos = 0;
let pageSize = 50;
let offset = 0;
let eqPageSize = 20;
let eqOffset = 0;
let equiposList = [];
let usersList = []; // Lista global de usuarios para asignaciones
let currentEquipo = null;

// Referencias a elementos UI (se inicializan en DOMContentLoaded)
let statusEl, loginResult, ticketsEl, equiposEl;

document.addEventListener('DOMContentLoaded', () => {
  console.log('DOM cargado, inicializando renderer.js...');
  lucide.createIcons();

  // Inicializar referencias UI
  const $ = (id) => document.getElementById(id);
  statusEl = $('status');
  loginResult = $('loginResult');
  ticketsEl = $('tickets');
  equiposEl = $('equipos');
  
  // Inicializar valores de inputs si existen
  if ($('page-size')) pageSize = Number($('page-size').value) || 50;
  if ($('eq-page-size')) eqPageSize = Number($('eq-page-size').value) || 20;

  // Mobile Menu Toggle
  $('mobile-menu-btn')?.addEventListener('click', () => {
      const menu = $('menu');
      if (menu) {
          menu.classList.toggle('-translate-x-full');
      }
  });

  // Toggle Registro
  const toggleBtn = $('toggleRegister');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', (e) => {
      e.preventDefault();
      const p = $('registerPanel');
      if (p) {
        p.classList.toggle('hidden');
      }
    });
  }

  // Login
  if ($('btnLogin')) $('btnLogin').addEventListener('click', async () => {
    console.log('Intento de login...');
    const email = String($('email').value || '').trim().toLowerCase();
    const password = String($('password').value || '').trim();

    try {
      const res = await fetch(`${API_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const data = await res.json();
      if (res.ok) {
        console.log('Login exitoso');
        handleLoginSuccess(data.token, $);
      } else {
        console.warn('Error login:', data);
        if (loginResult) loginResult.textContent = data.mensaje || data.error || 'Error de login';
      }
    } catch (err) {
      console.error('Error conexión login:', err);
      if (loginResult) loginResult.textContent = 'Error de conexión';
    }
  });

  // Registro
  if ($('btnRegister')) $('btnRegister').addEventListener('click', async () => {
    console.log('Intento de registro...');
    const nombre = String($('reg-nombre').value || '').trim();
    const email = String($('email').value || '').trim().toLowerCase();
    const password = String($('password').value || '').trim();
    const rol = 'user'; // Default

    const emailOk = /.+@.+\..+/.test(email);
    if (!nombre || !emailOk || !password) {
      $('registerResult').textContent = 'Ingresa nombre, correo y contraseña válidos';
      return;
    }

    try {
      const res = await fetch(`${API_URL}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nombre, email, password, rol })
      });
      const data = await res.json();
      if (res.ok) {
        console.log('Registro exitoso');
        $('registerResult').textContent = 'Registro correcto, ingresando...';
        // Auto-login
        const resLogin = await fetch(`${API_URL}/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password })
        });
        const dataLogin = await resLogin.json();
        if (resLogin.ok) {
          handleLoginSuccess(dataLogin.token, $);
        }
      } else {
        console.warn('Error registro:', data);
        $('registerResult').textContent = data.mensaje || data.error || 'Error de registro';
      }
    } catch (err) {
      console.error('Error conexión registro:', err);
      $('registerResult').textContent = 'Error de conexión';
    }
  });
  
  // Inicializar Google Auth
  initGoogle($);
  
  // Eventos de Navegación y UI
  bindAppEvents($);
  
  // Check login guardado
  checkAutoLogin($);
});

function handleLoginSuccess(newToken, $) {
  token = newToken;
  try {
    if ($('rememberMe')?.checked) localStorage.setItem('bioherts_token', token);
  } catch {}
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    currentUser = { id: payload.id, nombre: payload.nombre, rol: payload.rol };
    if (statusEl) statusEl.textContent = `Conectado: ${currentUser.nombre} (${currentUser.rol})`;
    if ($('btnLogout')) $('btnLogout').style.display = 'flex';
  } catch {}
  
  if (loginResult) loginResult.textContent = 'Login correcto';
  $('login').style.display = 'none';
  $('app-layout').style.display = 'flex';
  $('dashboard').style.display = 'block';
  $('menu').style.display = 'flex';
  
  const un = $('user-nombre');
  if (un && currentUser && currentUser.nombre) un.querySelector('h1').textContent = currentUser.nombre;
  
  connectSocket();
  loadUsers(); // Carga usuarios globales
  loadDashboard();
  refreshClienteSelect();
  lucide.createIcons();
}

function bindAppEvents($) {
  $('btnNewTicket')?.addEventListener('click', () => {
      let form = $('new-ticket-form-container');
      if (!form) {
          form = document.createElement('div');
          form.id = 'new-ticket-form-container';
          form.className = 'glass-panel p-6 rounded-2xl mb-8 animate-fade-in';
          form.innerHTML = `
            <h3 class="text-lg font-bold text-white mb-4">Nuevo Ticket</h3>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                <input id="nt-titulo" placeholder="Título del problema" class="bg-slate-900/50 border border-slate-700 rounded-lg px-4 py-2 text-white w-full">
                <select id="nt-equipo" class="bg-slate-900/50 border border-slate-700 rounded-lg px-4 py-2 text-white w-full">
                    <option value="">Seleccionar Equipo (Opcional)</option>
                </select>
            </div>
            <textarea id="nt-descripcion" placeholder="Descripción detallada" class="bg-slate-900/50 border border-slate-700 rounded-lg px-4 py-2 text-white w-full mb-4 h-24"></textarea>
            <div class="flex justify-end gap-3">
                <button id="nt-cancel" class="px-4 py-2 text-slate-400 hover:text-white">Cancelar</button>
                <button id="nt-save" class="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-500 shadow-lg shadow-blue-600/20">Crear Ticket</button>
            </div>
          `;
          $('tickets-section').insertBefore(form, $('tickets-section').querySelector('.glass-card'));
          
          form.querySelector('#nt-save').addEventListener('click', async () => {
              const titulo = $('nt-titulo').value;
              const descripcion = $('nt-descripcion').value;
              const equipo_id = $('nt-equipo').value;
              if(!titulo) return alert('Título requerido');
              
              try {
                  const res = await fetch(`${API_URL}/tickets`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
                    body: JSON.stringify({ titulo, descripcion, equipo_id: equipo_id || null })
                  });
                  if(res.ok) {
                      loadTickets();
                      form.remove();
                  } else {
                      alert('Error al crear');
                  }
              } catch(e) { console.error(e); }
          });
          
          form.querySelector('#nt-cancel').addEventListener('click', () => form.remove());
          
          loadEquiposForSelect('nt-equipo');
      }
  });
  
  $('btnLogout')?.addEventListener('click', () => {
    token = null; currentUser = null;
    if (statusEl) statusEl.textContent = '';
    $('app-layout').style.display = 'none';
    $('login').style.display = 'flex';
    try { localStorage.removeItem('bioherts_token'); } catch {}
  });

  $('btnIrTickets')?.addEventListener('click', () => showSection('tickets-section', $));
  $('navTickets')?.addEventListener('click', () => showSection('tickets-section', $));
  $('btnIrEquipos')?.addEventListener('click', () => showSection('equipos-list', $));
  $('navEquipos')?.addEventListener('click', () => showSection('equipos-list', $));
  $('navDashboard')?.addEventListener('click', () => showSection('dashboard', $));
  $('navClientes')?.addEventListener('click', () => showSection('clientes-section', $));
  $('navSettings')?.addEventListener('click', () => showSection('settings', $));
  $('navUsers')?.addEventListener('click', () => showSection('admin-users', $));
  $('.logo')?.addEventListener('click', () => showSection('dashboard', $));
  $('btnRefreshUsers')?.addEventListener('click', () => loadAdminUsers());

  $('cli-filtro-q')?.addEventListener('input', () => loadClientes());

  $('btnCrearCliente')?.addEventListener('click', async () => {
    const nombre = $('cli-nombre').value;
    const empresa = $('cli-empresa').value;
    try {
      const res = await fetch(`${API_URL}/clientes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
        body: JSON.stringify({ nombre: nombre || null, empresa: empresa || null })
      });
      if (res.ok) {
        $('cli-nombre').value = '';
        $('cli-empresa').value = '';
        loadClientes();
        refreshClienteSelect();
      } else {
        alert('Error al crear cliente');
      }
    } catch(e) { console.error(e); }
  });
  
  $('btnCrearEquipo')?.addEventListener('click', () => {
      const f = $('form-equipo');
      if (f) {
          f.classList.toggle('hidden');
          if(!f.classList.contains('hidden')) refreshClienteSelect();
      }
  });
  
  $('btnSaveEquipo')?.addEventListener('click', createEquipo);
  
  $('eqPrev')?.addEventListener('click', () => { eqOffset = Math.max(0, eqOffset - eqPageSize); loadEquipos(); });
  $('eqNext')?.addEventListener('click', () => { eqOffset += eqPageSize; loadEquipos(); });
  $('eq-page-size')?.addEventListener('change', (e) => { eqPageSize = Number(e.target.value) || 20; eqOffset = 0; loadEquipos(); });
  $('eq-btnLimpiar')?.addEventListener('click', () => {
      ['eq-filtro-q'].forEach(id => { if($(id)) $(id).value = ''; });
      eqOffset = 0; 
      loadEquipos();
  });
  
  $('eq-filtro-q')?.addEventListener('keydown', (e) => { if(e.key === 'Enter') { eqOffset = 0; loadEquipos(); } });
  
  $('prevPage')?.addEventListener('click', () => { offset = Math.max(0, offset - pageSize); loadTickets(); });
  $('nextPage')?.addEventListener('click', () => { offset += pageSize; loadTickets(); });
  $('page-size')?.addEventListener('change', (e) => { pageSize = Number(e.target.value) || 50; offset = 0; loadTickets(); });
  $('q')?.addEventListener('keydown', (e) => { if(e.key === 'Enter') { offset = 0; loadTickets(); } });
  $('f-estado')?.addEventListener('change', () => { offset = 0; loadTickets(); });
  $('btnLimpiar')?.addEventListener('click', () => {
     $('q').value = '';
     $('f-estado').value = '';
     offset = 0; loadTickets();
  });
}

function showSection(id, $) {
    if (!token) return;
    const sections = ['dashboard', 'tickets-section', 'equipos-list', 'clientes-section', 'settings', 'admin-users'];
    sections.forEach(s => {
       const el = $(s);
       if (el) el.style.display = 'none';
    });
    
    const target = $(id);
    if (target) {
        target.style.display = 'block';
        if (id === 'tickets-section') loadTickets();
        if (id === 'equipos-list') loadEquipos();
        if (id === 'clientes-section') loadClientes();
        if (id === 'dashboard') loadDashboard();
        if (id === 'admin-users') loadAdminUsers();
    }
    
    if (window.innerWidth < 768) {
        $('menu')?.classList.add('-translate-x-full');
    }

    const navMap = {
        'dashboard': 'navDashboard',
        'tickets-section': 'navTickets',
        'equipos-list': 'navEquipos',
        'clientes-section': 'navClientes',
        'settings': 'navSettings',
        'admin-users': 'navUsers'
    };
    
    Object.values(navMap).forEach(navId => {
        const btn = $(navId);
        if (btn) {
            btn.classList.remove('bg-blue-500/10', 'text-blue-400');
            btn.classList.add('text-slate-400');
            const icon = btn.querySelector('svg');
            if(icon) icon.classList.remove('text-blue-400');
        }
    });

    const activeNavId = navMap[id];
    if (activeNavId) {
        const activeBtn = $(activeNavId);
        if (activeBtn) {
            activeBtn.classList.remove('text-slate-400');
            activeBtn.classList.add('bg-blue-500/10', 'text-blue-400');
            const icon = activeBtn.querySelector('svg');
            if(icon) icon.classList.add('text-blue-400');
        }
    }
    
    lucide.createIcons();
}

async function checkAutoLogin($) {
  try {
    const saved = localStorage.getItem('bioherts_token');
    if (saved) {
      token = saved;
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        currentUser = { id: payload.id, nombre: payload.nombre, rol: payload.rol };
        if (statusEl) statusEl.textContent = `Conectado: ${currentUser.nombre} (${currentUser.rol})`;
        $('login').style.display = 'none';
        $('app-layout').style.display = 'flex';
        $('dashboard').style.display = 'block';
        $('menu').style.display = 'flex';
        
        const un = $('user-nombre');
        if (un && currentUser && currentUser.nombre) un.querySelector('h1').textContent = currentUser.nombre;
        
        connectSocket();
        loadUsers();
        loadDashboard();
        refreshClienteSelect();
        lucide.createIcons();
      } catch {}
    }
  } catch {}
}

async function initGoogle($) {
  try {
    const res = await fetch(`${API_URL}/auth/config`);
    const conf = await res.json();
    const cid = conf && conf.googleClientId ? conf.googleClientId : '';
    const ready = () => window.google && google.accounts && google.accounts.id;
    const start = () => {
      if (!cid || !ready()) return;
      google.accounts.id.initialize({
        client_id: cid,
        callback: async (resp) => {
          try {
            const r = await fetch(`${API_URL}/auth/google`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ id_token: resp.credential })
            });
            const data = await r.json();
            if (r.ok) {
              handleLoginSuccess(data.token, $);
            } else {
              if (loginResult) loginResult.textContent = data.mensaje || data.error || 'Error con Google';
            }
          } catch (e) {
            if (loginResult) loginResult.textContent = 'Error de conexión';
          }
        }
      });
    };
    const wait = () => { if (ready()) { start(); } else { setTimeout(wait, 200); } };
    wait();
  } catch {}
}

async function loadTickets() {
  try {
    const qs = buildQueryFromFilters();
    const extra = new URLSearchParams({ limit: String(pageSize), offset: String(offset) }).toString();
    const url = `${API_URL}/tickets${qs || extra ? `?${[qs, extra].filter(Boolean).join('&')}` : ''}`;
    const res = await fetch(url, { headers: { 'Authorization': token ? `Bearer ${token}` : '' } });
    const data = await res.json();
    if (ticketsEl) {
        if (data.length === 0) {
            ticketsEl.innerHTML = `
                <div class="col-span-full flex flex-col items-center justify-center py-12 text-slate-500 animate-fade-in">
                    <div class="w-16 h-16 bg-slate-800/50 rounded-full flex items-center justify-center mb-4 border border-white/5">
                        <i data-lucide="inbox" class="w-8 h-8 opacity-50"></i>
                    </div>
                    <p class="text-lg font-medium text-slate-400">No hay tickets</p>
                    <p class="text-sm text-slate-600">No se encontraron tickets con los filtros actuales</p>
                </div>
            `;
        } else {
            ticketsEl.innerHTML = '';
            data.forEach(t => ticketsEl.appendChild(ticketCard(t)));
            bindTicketActions();
        }
    }
    
    try {
      const resCount = await fetch(`${API_URL}/tickets/count${qs ? `?${qs}` : ''}`, { headers: { 'Authorization': token ? `Bearer ${token}` : '' } });
      const countData = await resCount.json();
      totalTickets = Number(countData.total || 0);
      const totalEl = document.getElementById('pageInfo');
      if (totalEl) totalEl.textContent = `${offset + 1}-${Math.min(offset + pageSize, totalTickets)} de ${totalTickets}`;
    } catch {}
    
    lucide.createIcons();

  } catch (err) {
    console.error(err);
  }
}

function ticketCard(t) {
  const div = document.createElement('div');
  const borderColor = t.estado === 'pendiente' ? 'border-l-blue-500' : 'border-l-green-500';
  const badgeClass = t.estado === 'pendiente' 
      ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20' 
      : 'bg-green-500/10 text-green-400 border border-green-500/20';
      
  div.className = `glass-card p-5 rounded-xl border-l-4 ${borderColor} hover:-translate-y-1 transition-transform duration-300 group relative flex flex-col h-full`;
  
  // Opciones de usuarios para el select de asignación
  const userOptions = usersList.map(u => 
      `<option value="${u.id}" ${t.asignado_a === u.id ? 'selected' : ''}>${u.nombre}</option>`
  ).join('');

  div.innerHTML = `
    <div class="flex justify-between items-start mb-3">
        <span class="px-2.5 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${badgeClass}">${t.estado}</span>
        <span class="text-xs text-slate-500 font-mono">#${t.id}</span>
    </div>
    
    <div class="mb-4 flex-1">
        <h3 class="text-lg font-bold text-white mb-2 line-clamp-2">${t.titulo}</h3>
        <p class="text-slate-400 text-sm line-clamp-3">${t.descripcion || 'Sin descripción'}</p>
        <div class="mt-2 text-xs text-slate-500 flex items-center">
            <i data-lucide="user" class="w-3 h-3 mr-1"></i> 
            ${t.asignado_a_nombre ? `Asignado a: ${t.asignado_a_nombre}` : 'Sin asignar'}
        </div>
    </div>
    
    <!-- Edit Form Container (Hidden) -->
    <div id="edit-ticket-${t.id}" class="hidden mb-4 p-3 bg-slate-900/50 rounded-lg border border-slate-700">
       <input id="et-titulo-${t.id}" value="${t.titulo}" class="w-full mb-2 bg-slate-950 border border-slate-700 rounded px-2 py-1 text-white text-sm" placeholder="Título">
       <textarea id="et-descripcion-${t.id}" class="w-full mb-2 bg-slate-950 border border-slate-700 rounded px-2 py-1 text-white text-sm" placeholder="Descripción">${t.descripcion || ''}</textarea>
       
       <label class="block text-xs text-slate-500 mb-1">Asignar a:</label>
       <select id="et-asignado-${t.id}" class="w-full mb-2 bg-slate-950 border border-slate-700 rounded px-2 py-1 text-white text-sm">
          <option value="">Sin asignar</option>
          ${userOptions}
       </select>

       <div class="flex justify-end gap-2">
           <button class="text-xs text-slate-400" data-cancel-ticket="${t.id}">Cancelar</button>
           <button class="text-xs text-blue-400 font-bold" data-save-ticket="${t.id}">Guardar</button>
       </div>
    </div>
    
    <div class="flex items-center justify-between mt-auto pt-4 border-t border-white/5">
        <div class="flex items-center space-x-2 text-xs text-slate-500">
            <i data-lucide="clock" class="w-3 h-3"></i>
            <span>${t.creado_en ? new Date(t.creado_en).toLocaleDateString() : '-'}</span>
        </div>
        
        <div class="flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
             ${t.estado !== 'hecho' && t.estado !== 'terminado' ? `
             <button class="p-1.5 hover:bg-green-500/10 rounded-lg text-green-400 transition-colors" title="Terminar" data-done="${t.id}">
                <i data-lucide="check-circle" class="w-4 h-4"></i>
             </button>` : `
             <button class="p-1.5 hover:bg-yellow-500/10 rounded-lg text-yellow-400 transition-colors" title="Reabrir" data-pendiente="${t.id}">
                <i data-lucide="rotate-ccw" class="w-4 h-4"></i>
             </button>`}
             
             <button class="p-1.5 hover:bg-blue-500/10 rounded-lg text-blue-400 transition-colors" title="Editar" data-editar="${t.id}">
                <i data-lucide="edit-2" class="w-4 h-4"></i>
             </button>
             
             <button class="p-1.5 hover:bg-white/10 rounded-lg text-slate-400 transition-colors" title="Comentarios" data-ver="${t.id}">
                <i data-lucide="message-square" class="w-4 h-4"></i>
             </button>
             
             ${currentUser && currentUser.rol === 'admin' ? `
             <button class="p-1.5 hover:bg-red-500/10 rounded-lg text-red-400 transition-colors" title="Eliminar" data-eliminar="${t.id}">
                <i data-lucide="trash-2" class="w-4 h-4"></i>
             </button>` : ''}
        </div>
    </div>
    <div id="comentarios-${t.id}" class="mt-2"></div>
  `;
  return div;
}

function bindTicketActions(container) {
    const target = container || ticketsEl;
    if (!target) return;
    
    target.querySelectorAll('button[data-done]').forEach(btn => btn.addEventListener('click', () => updateEstado(btn.dataset.done, 'terminado')));
    target.querySelectorAll('button[data-pendiente]').forEach(btn => btn.addEventListener('click', () => updateEstado(btn.dataset.pendiente, 'pendiente')));
    target.querySelectorAll('button[data-eliminar]').forEach(btn => btn.addEventListener('click', async () => {
        if(confirm('¿Seguro que deseas eliminar este ticket?')) {
            try {
                await fetch(`${API_URL}/tickets/${btn.dataset.eliminar}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } });
                loadTickets();
            } catch(e) { console.error(e); }
        }
    }));
    
    target.querySelectorAll('button[data-editar]').forEach(btn => btn.addEventListener('click', () => {
        const id = btn.dataset.editar;
        const form = document.getElementById(`edit-ticket-${id}`);
        if(form) form.classList.toggle('hidden');
    }));
    
    target.querySelectorAll('button[data-save-ticket]').forEach(btn => btn.addEventListener('click', async () => {
        const id = btn.dataset.saveTicket;
        const titulo = document.getElementById(`et-titulo-${id}`).value;
        const descripcion = document.getElementById(`et-descripcion-${id}`).value;
        const asignado_a = document.getElementById(`et-asignado-${id}`).value;
        
        try {
            await fetch(`${API_URL}/tickets/${id}`, {
                method: 'PATCH', // Changed to PATCH
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ titulo, descripcion, asignado_a: asignado_a || null })
            });
            loadTickets();
        } catch(e) { console.error(e); }
    }));
    
    target.querySelectorAll('button[data-cancel-ticket]').forEach(btn => btn.addEventListener('click', () => {
        const id = btn.dataset.cancelTicket;
        const form = document.getElementById(`edit-ticket-${id}`);
        if(form) form.classList.add('hidden');
    }));
    
    target.querySelectorAll('button[data-ver]').forEach(btn => btn.addEventListener('click', () => toggleComentarios(btn.dataset.ver)));
}

async function updateEstado(id, estado) {
  try {
    await fetch(`${API_URL}/tickets/${id}/estado`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
      body: JSON.stringify({ estado })
    });
    loadTickets();
  } catch (err) { console.error(err); }
}

async function toggleComentarios(id) {
    const c = document.getElementById(`comentarios-${id}`);
    if (!c) return;
    if (c.innerHTML !== '') {
        c.innerHTML = '';
        return;
    }
    try {
        const res = await fetch(`${API_URL}/tickets/${id}/comentarios`, { headers: { 'Authorization': `Bearer ${token}` } });
        const comments = await res.json();
        c.innerHTML = `
            <div class="mt-4 p-4 bg-slate-900/50 rounded-xl border border-white/5 animate-fade-in">
                <h4 class="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Comentarios</h4>
                <div class="space-y-3 max-h-48 overflow-y-auto custom-scrollbar mb-3">
                    ${comments.map(co => `
                        <div class="flex gap-3">
                             <div class="w-6 h-6 rounded-full bg-slate-700 flex items-center justify-center text-xs text-white font-bold shrink-0">
                                ${(co.autor_nombre || 'U')[0]}
                             </div>
                             <div>
                                <div class="bg-slate-800 rounded-lg rounded-tl-none px-3 py-2 text-sm text-slate-300">
                                    ${co.contenido}
                                </div>
                                <div class="text-[10px] text-slate-500 mt-1">${new Date(co.creado_en).toLocaleString()}</div>
                             </div>
                        </div>
                    `).join('')}
                    ${comments.length === 0 ? '<p class="text-xs text-slate-500 italic">No hay comentarios aún.</p>' : ''}
                </div>
                <div class="flex gap-2">
                    <input id="new-comment-${id}" placeholder="Escribe un comentario..." class="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white">
                    <button class="p-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg" onclick="postComment(${id})">
                        <i data-lucide="send" class="w-3 h-3"></i>
                    </button>
                </div>
            </div>
        `;
        lucide.createIcons();
    } catch(e) { console.error(e); }
}

window.postComment = async (id) => {
    const inp = document.getElementById(`new-comment-${id}`);
    const contenido = inp.value;
    if(!contenido) return;
    try {
        await fetch(`${API_URL}/tickets/${id}/comentarios`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ contenido })
        });
        inp.value = '';
        const c = document.getElementById(`comentarios-${id}`);
        c.innerHTML = ''; 
        toggleComentarios(id); 
    } catch(e) { console.error(e); }
};

async function loadEquipos() {
    try {
        const q = document.getElementById('eq-filtro-q')?.value || '';
        const url = `${API_URL}/equipos?limit=${eqPageSize}&offset=${eqOffset}&q=${encodeURIComponent(q)}`;
        const res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
        const data = await res.json();
        const tbody = document.getElementById('equipos');
        if(tbody) {
            if (data.length === 0) {
                tbody.innerHTML = `<tr><td colspan="4" class="px-6 py-8 text-center text-slate-500 italic">No se encontraron equipos</td></tr>`;
            } else {
                tbody.innerHTML = data.map(e => `
                    <tr class="hover:bg-white/5 transition-colors group border-b border-slate-800 last:border-0">
                        <td class="px-6 py-4">
                            <div class="flex items-center">
                                <div class="w-10 h-10 rounded-xl bg-slate-800/50 border border-white/5 flex items-center justify-center mr-4 text-slate-400 group-hover:text-blue-400 group-hover:border-blue-500/30 transition-all">
                                    <i data-lucide="${getDeviceIcon(e.tipo)}" class="w-5 h-5"></i>
                                </div>
                                <div>
                                    <div class="font-medium text-white">${e.tipo} ${e.marca}</div>
                                    <div class="text-xs text-slate-500 font-mono mt-0.5">${e.modelo} • <span class="tracking-wider">SN:${e.serie}</span></div>
                                </div>
                            </div>
                        </td>
                        <td class="px-6 py-4">
                            <div class="flex items-center text-slate-300">
                                <i data-lucide="user" class="w-3 h-3 mr-2 text-slate-500"></i>
                                ${e.cliente_nombre || '<span class="text-slate-600 italic">Sin asignar</span>'}
                            </div>
                        </td>
                        <td class="px-6 py-4">
                            <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${e.estado === 'activo' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-slate-700/50 text-slate-400 border-slate-600/30'}">
                                <span class="w-1.5 h-1.5 rounded-full bg-current mr-1.5"></span>
                                ${e.estado}
                            </span>
                        </td>
                        <td class="px-6 py-4 text-right">
                            <button class="p-2 text-slate-400 hover:text-blue-400 hover:bg-blue-500/10 rounded-lg transition-all" title="Editar" onclick="alert('Editar equipo no implementado en este demo')">
                                <i data-lucide="edit-2" class="w-4 h-4"></i>
                            </button>
                        </td>
                    </tr>
                `).join('');
            }
            lucide.createIcons();
        }
    } catch(e) { console.error(e); }
}

function getDeviceIcon(tipo) {
    if(!tipo) return 'monitor';
    const t = tipo.toLowerCase();
    if(t.includes('laptop') || t.includes('portatil')) return 'laptop';
    if(t.includes('impresora')) return 'printer';
    if(t.includes('servidor')) return 'server';
    if(t.includes('movil') || t.includes('celular') || t.includes('iphone')) return 'smartphone';
    if(t.includes('tablet') || t.includes('ipad')) return 'tablet';
    return 'monitor';
}

async function createEquipo() {
    const tipo = $('eq-tipo').value;
    const marca = $('eq-marca').value;
    const modelo = $('eq-modelo').value;
    const serie = $('eq-serie').value;
    const cliente_id = $('eq-cliente-id').value ? Number($('eq-cliente-id').value) : null;
    
    if(!tipo || !marca || !serie) { alert('Datos incompletos'); return; }
    
    try {
        const res = await fetch(`${API_URL}/equipos`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ tipo, marca, modelo, serie, cliente_id, estado: 'activo' })
        });
        if(res.ok) {
            alert('Equipo creado correctamente');
            $('form-equipo').classList.add('hidden');
            // Limpiar form
            ['eq-tipo','eq-marca','eq-modelo','eq-serie'].forEach(id => $(id).value = '');
            $('eq-cliente-id').value = '';
            loadEquipos();
        } else {
            alert('Error al crear equipo');
        }
    } catch(e) { console.error(e); }
}

async function loadClientes() {
    try {
        const q = document.getElementById('cli-filtro-q')?.value || '';
        const url = `${API_URL}/clientes?q=${encodeURIComponent(q)}`;
        const res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
        const data = await res.json();
        const tbody = document.getElementById('clientes-list');
        if(tbody) {
            if (data.length === 0) {
                tbody.innerHTML = `<tr><td colspan="3" class="px-6 py-8 text-center text-slate-500 italic">No se encontraron clientes</td></tr>`;
            } else {
                tbody.innerHTML = data.map(c => `
                    <tr class="hover:bg-white/5 transition-colors border-b border-slate-800 last:border-0 group">
                        <td class="px-6 py-4">
                            <div class="flex items-center">
                                <div class="w-8 h-8 rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center text-xs font-bold text-white mr-3 shadow-lg shadow-emerald-500/20">
                                    ${c.nombre ? c.nombre[0].toUpperCase() : 'C'}
                                </div>
                                <span class="font-medium text-white group-hover:text-emerald-400 transition-colors">${c.nombre}</span>
                            </div>
                        </td>
                        <td class="px-6 py-4">
                            <div class="flex items-center text-slate-400">
                                <i data-lucide="building-2" class="w-3 h-3 mr-2 opacity-50"></i>
                                ${c.empresa || '<span class="text-slate-600">-</span>'}
                            </div>
                        </td>
                        <td class="px-6 py-4 text-right">
                             <button class="p-2 text-slate-400 hover:text-emerald-400 hover:bg-emerald-500/10 rounded-lg transition-all"><i data-lucide="edit-2" class="w-4 h-4"></i></button>
                        </td>
                    </tr>
                `).join('');
            }
            lucide.createIcons();
        }
    } catch(e) { console.error(e); }
}

async function loadAdminUsers() {
    try {
        const res = await fetch(`${API_URL}/auth/users`, { headers: { 'Authorization': token ? `Bearer ${token}` : '' } });
        const users = await res.json();
        const tbody = document.getElementById('admin-users-body');
        if(tbody) {
            tbody.innerHTML = users.map(u => `
            <tr class="hover:bg-white/5 transition-colors border-b border-slate-800 last:border-0 group">
                <td class="px-6 py-4">
                    <div class="flex items-center">
                        <div class="w-9 h-9 rounded-full bg-slate-800 border border-white/5 flex items-center justify-center text-xs font-bold text-white mr-3 ring-2 ring-transparent group-hover:ring-blue-500/20 transition-all">
                            ${u.nombre ? u.nombre[0].toUpperCase() : 'U'}
                        </div>
                        <span class="text-white font-medium group-hover:text-blue-400 transition-colors">${u.nombre}</span>
                    </div>
                </td>
                <td class="px-6 py-4 text-slate-400 font-mono text-xs">${u.email}</td>
                <td class="px-6 py-4">
                    <span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${u.rol === 'admin' ? 'bg-purple-500/10 text-purple-400 border-purple-500/20' : 'bg-slate-700/50 text-slate-400 border-slate-600/30'}">
                        ${u.rol || 'user'}
                    </span>
                </td>
                <td class="px-6 py-4 text-right">
                    <button class="p-2 text-blue-400 hover:text-white hover:bg-blue-600 rounded-lg mr-1 transition-all" data-edit-user="${u.id}" data-email="${u.email}" title="Editar"><i data-lucide="edit-2" class="w-4 h-4"></i></button>
                    <button class="p-2 text-red-400 hover:text-white hover:bg-red-600 rounded-lg transition-all" data-delete-user="${u.id}" title="Borrar"><i data-lucide="trash-2" class="w-4 h-4"></i></button>
                </td>
            </tr>
            `).join('');
            bindUserActions(tbody);
            lucide.createIcons();
        }
    } catch (e) { console.error('Error loading users', e); }
}

function bindUserActions(container) {
  container.querySelectorAll('button[data-edit-user]').forEach(btn => {
    btn.addEventListener('click', () => editUser(btn.dataset.editUser, btn.dataset.email));
  });
  container.querySelectorAll('button[data-delete-user]').forEach(btn => {
    btn.addEventListener('click', () => deleteUser(btn.dataset.deleteUser));
  });
}

async function editUser(id, currentEmail) {
  const newEmail = prompt("Ingresa el nuevo email:", currentEmail);
  if (newEmail && newEmail !== currentEmail) {
    try {
      const res = await fetch(`${API_URL}/auth/users/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ email: newEmail })
      });
      const data = await res.json();
      if (res.ok) {
        alert(data.mensaje);
        loadAdminUsers();
      } else {
        alert(data.mensaje);
      }
    } catch (e) { console.error(e); }
  }
}

async function deleteUser(id) {
  if (confirm("¿Seguro que deseas eliminar este usuario?")) {
    try {
      const res = await fetch(`${API_URL}/auth/users/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      if (res.ok) {
        alert(data.mensaje);
        loadAdminUsers();
      } else {
        alert(data.mensaje);
      }
    } catch (e) { console.error(e); }
  }
}

function buildQueryFromFilters() {
    const q = document.getElementById('q')?.value;
    const estado = document.getElementById('f-estado')?.value;
    const p = new URLSearchParams();
    if(q) p.append('q', q);
    if(estado) p.append('estado', estado);
    return p.toString();
}

async function loadUsers() {
    try {
        const res = await fetch(`${API_URL}/auth/users`, { headers: { 'Authorization': token ? `Bearer ${token}` : '' } });
        if(res.ok) {
            usersList = await res.json();
        }
    } catch(e) { console.error(e); }
}

async function loadEquiposForSelect(id) {
    try {
        const select = document.getElementById(id);
        if(!select) return;
        const res = await fetch(`${API_URL}/equipos?limit=100`, { headers: { 'Authorization': token ? `Bearer ${token}` : '' } });
        const data = await res.json();
        // Keep first option
        const first = select.options[0];
        select.innerHTML = '';
        select.appendChild(first);
        data.forEach(e => {
            const opt = document.createElement('option');
            opt.value = e.id;
            opt.textContent = `${e.tipo} ${e.marca} - ${e.modelo}`;
            select.appendChild(opt);
        });
    } catch(e) { console.error(e); }
}

function renderAvatar() {} 

function connectSocket() {
    if (socket) return;
    try {
        socket = io(API_URL);
        socket.on('connect', () => console.log('Socket conectado'));
    } catch(e) {}
}

async function loadDashboard() {
    try {
        const qs = new URLSearchParams({ limit: '6', estado: 'pendiente' }).toString();
        const url = `${API_URL}/tickets?${qs}`;
        const res = await fetch(url, { headers: { 'Authorization': token ? `Bearer ${token}` : '' } });
        const data = await res.json();
        const container = document.getElementById('dash-pending-tickets');
        if (container) {
            if(data.length === 0) {
                container.innerHTML = '<p class="text-slate-500 col-span-full text-center py-4">No tienes tickets pendientes.</p>';
            } else {
                container.innerHTML = '';
                data.forEach(t => {
                    const div = document.createElement('div');
                    div.className = 'glass-card p-4 rounded-xl border-l-4 border-l-blue-500 hover:bg-white/5 transition-colors cursor-pointer';
                    div.innerHTML = `
                        <div class="flex justify-between mb-2">
                            <span class="text-xs font-bold text-blue-400 uppercase">#${t.id}</span>
                            <span class="text-xs text-slate-500">${new Date(t.creado_en).toLocaleDateString()}</span>
                        </div>
                        <h4 class="text-sm font-semibold text-white line-clamp-1 mb-1">${t.titulo}</h4>
                        <p class="text-xs text-slate-400 line-clamp-2">${t.descripcion || ''}</p>
                    `;
                    div.addEventListener('click', () => {
                        showSection('tickets-section', document.getElementById);
                    });
                    container.appendChild(div);
                });
            }
        }
        
        const r1 = await fetch(`${API_URL}/tickets/count`, { headers: { 'Authorization': `Bearer ${token}` } });
        const d1 = await r1.json();
        if(document.getElementById('tickets-total')) document.getElementById('tickets-total').textContent = d1.total;
        
        const r2 = await fetch(`${API_URL}/equipos/count`, { headers: { 'Authorization': `Bearer ${token}` } });
        const d2 = await r2.json();
        if(document.getElementById('total-equipos-count')) document.getElementById('total-equipos-count').textContent = d2.total;
        
        const r3 = await fetch(`${API_URL}/clientes/count`, { headers: { 'Authorization': `Bearer ${token}` } });
        const d3 = await r3.json();
        if(document.getElementById('total-clientes-count')) document.getElementById('total-clientes-count').textContent = d3.total;
        
    } catch(e) { console.error(e); }
}

async function refreshClienteSelect() {
    try {
        const select = document.getElementById('eq-cliente-id');
        if(!select) return;
        const res = await fetch(`${API_URL}/clientes?limit=100`, { headers: { 'Authorization': token ? `Bearer ${token}` : '' } });
        const data = await res.json();
        const first = select.options[0];
        select.innerHTML = '';
        select.appendChild(first);
        data.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c.id;
            opt.textContent = c.nombre;
            select.appendChild(opt);
        });
    } catch(e) { console.error(e); }
}
