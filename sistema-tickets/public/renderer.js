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
let currentEquipo = null;

// Referencias a elementos UI (se inicializan en DOMContentLoaded)
let statusEl, loginResult, ticketsEl, equiposEl;

document.addEventListener('DOMContentLoaded', () => {
  console.log('DOM cargado, inicializando renderer.js...');

  // Inicializar referencias UI
  const $ = (id) => document.getElementById(id);

  // Check for token in URL (Google Auth callback)
  const urlParams = new URLSearchParams(window.location.search);
  const tokenFromUrl = urlParams.get('token');
  const errorFromUrl = urlParams.get('error');

  if (tokenFromUrl) {
    console.log('Token encontrado en URL, iniciando sesión...');
    handleLoginSuccess(tokenFromUrl, $);
    // Limpiar URL
    window.history.replaceState({}, document.title, window.location.pathname);
  } else if (errorFromUrl) {
    // Mostrar error si viene en la URL
    if ($('loginResult')) $('loginResult').textContent = errorFromUrl;
    window.history.replaceState({}, document.title, window.location.pathname);
  }

  statusEl = $('status');
  loginResult = $('loginResult');
  ticketsEl = $('tickets');
  equiposEl = $('equipos');
  
  // Inicializar valores de inputs si existen
  if ($('page-size')) pageSize = Number($('page-size').value) || 50;
  if ($('eq-page-size')) eqPageSize = Number($('eq-page-size').value) || 20;

  // Toggle Registro
  const toggleBtn = $('toggleRegister');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', (e) => {
      e.preventDefault();
      const p = $('registerPanel');
      if (p) {
        p.style.display = p.style.display === 'none' ? 'block' : 'none';
        console.log('Toggle registro clickeado, display:', p.style.display);
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
    const email = String($('reg-email').value || '').trim().toLowerCase();
    const password = String($('reg-password').value || '').trim();
    const rol = $('reg-rol').value;

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
  // initGoogle($);
  
  // Eventos de Navegación y UI
  bindAppEvents($);
  
  // Check login guardado
  checkAutoLogin($);
  
  // Render Avatar
  renderAvatar();
  
  // Status check
  updateApiStatus();

  // Initialize Theme
  initTheme($);
});

function initTheme($) {
    const toggleBtn = $('themeToggle');
    if (!toggleBtn) return;
    
    // Check saved theme
    const savedTheme = localStorage.getItem('bioherts_theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    
    // Apply theme
    if (savedTheme === 'dark' || (!savedTheme && prefersDark)) {
        document.body.setAttribute('data-theme', 'dark');
        updateThemeIcon(true, toggleBtn);
    } else {
        document.body.removeAttribute('data-theme');
        updateThemeIcon(false, toggleBtn);
    }
    
    // Bind click
    toggleBtn.addEventListener('click', () => {
        const isDark = document.body.getAttribute('data-theme') === 'dark';
        if (isDark) {
            document.body.removeAttribute('data-theme');
            localStorage.setItem('bioherts_theme', 'light');
            updateThemeIcon(false, toggleBtn);
        } else {
            document.body.setAttribute('data-theme', 'dark');
            localStorage.setItem('bioherts_theme', 'dark');
            updateThemeIcon(true, toggleBtn);
        }
    });
}

function updateThemeIcon(isDark, btn) {
    if (isDark) {
        // Show Moon (meaning current is dark, or Show Sun to switch to light? Usually icon represents target state or current state. Let's make it show the CURRENT state icon)
        // Wait, usually a sun icon implies "Click to switch to light" or "It is sunny".
        // Let's use standard convention: Show Moon when in Light mode (to go to dark), Show Sun when in Dark mode (to go to light).
        btn.innerHTML = `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>`;
    } else {
        btn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>`;
    }
}

function handleLoginSuccess(newToken, $) {
  token = newToken;
  try {
    if ($('rememberMe')?.checked) localStorage.setItem('bioherts_token', token);
  } catch {}
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    currentUser = { id: payload.id, nombre: payload.nombre, rol: payload.rol };
    if (statusEl) statusEl.textContent = `Conectado: ${currentUser.nombre} (${currentUser.rol})`;
    if ($('btnLogout')) $('btnLogout').style.display = 'inline-block';
  } catch {}
  
  if (loginResult) loginResult.textContent = 'Login correcto';
  $('login').style.display = 'none';
  $('app-layout').style.display = 'grid';
  $('dashboard').style.display = 'block';
  $('menu').style.display = 'none';
  
  const un = $('user-nombre');
  if (un && currentUser && currentUser.nombre) un.querySelector('h1').textContent = currentUser.nombre;
  
  connectSocket();
  loadUsers();
  loadDashboard();
  refreshClienteSelect();
}

function bindAppEvents($) {
  // Crear ticket
  $('btnCrearTicket')?.addEventListener('click', async () => {
    const titulo = $('titulo').value;
    const descripcion = $('descripcion').value;
    const asignadoSel = $('asignado-select');
    const asignado_a = asignadoSel && asignadoSel.value ? Number(asignadoSel.value) : null;
    const equipo_id = $('equipo').value ? Number($('equipo').value) : null;

    if (!titulo || titulo.trim() === '') { alert('El título es obligatorio'); return; }
    
    try {
      const res = await fetch(`${API_URL}/tickets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
        body: JSON.stringify({ titulo, descripcion, asignado_a, equipo_id })
      });
      if (res.ok) {
        $('titulo').value = '';
        $('descripcion').value = '';
        if (asignadoSel) asignadoSel.value = '';
        $('equipo').value = '';
        loadTickets();
      } else {
        const data = await res.json();
        alert(data.error || 'Error al crear ticket');
      }
    } catch(e) { console.error(e); }
  });
  
  // Logout
  $('btnLogout')?.addEventListener('click', () => {
    token = null; currentUser = null;
    if (statusEl) statusEl.textContent = '';
    $('btnLogout').style.display = 'none';
    $('app-layout').style.display = 'none';
    $('login').style.display = 'flex';
    try { localStorage.removeItem('bioherts_token'); } catch {}
  });

  // Navegación
  $('btnIrTickets')?.addEventListener('click', () => showSection('tickets-section', $));
  $('navTickets')?.addEventListener('click', () => showSection('tickets-section', $));
  $('btnIrEquipos')?.addEventListener('click', () => showSection('equipos-list', $));
  $('navEquipos')?.addEventListener('click', () => showSection('equipos-list', $));
  $('navDashboard')?.addEventListener('click', () => showSection('dashboard', $));
  $('navClientes')?.addEventListener('click', () => showSection('clientes-section', $));
  $('navSettings')?.addEventListener('click', () => showSection('settings', $));
  $('navUsers')?.addEventListener('click', () => showSection('admin-users', $));
  $('btnRefreshUsers')?.addEventListener('click', () => loadAdminUsers());
  $('.logo')?.addEventListener('click', () => showSection('dashboard', $));

  // Clientes
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
      } else {
        alert('Error al crear cliente');
      }
    } catch(e) { console.error(e); }
  });
  
  $('toggleClienteForm')?.addEventListener('click', () => {
     const f = $('cliente-form');
     if (f) f.style.display = f.style.display === 'none' ? 'flex' : 'none';
  });

  // Avatar
  $('btnChangeAvatar')?.addEventListener('click', () => $('avatar-file')?.click());
  $('avatar-file')?.addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      try { localStorage.setItem('bioherts_avatar', reader.result); } catch {}
      renderAvatar();
    };
    reader.readAsDataURL(f);
  });
  
  // Equipos Crear
  $('btnCrearEquipo')?.addEventListener('click', createEquipo);
  $('toggleEquipoForm')?.addEventListener('click', () => {
     const f = $('nuevo-equipo');
     if (f) f.style.display = f.style.display === 'none' ? 'block' : 'none';
  });
  
  // Paginación y Filtros Equipos
  $('eq-btnPrev')?.addEventListener('click', () => { eqOffset = Math.max(0, eqOffset - eqPageSize); loadEquipos(); });
  $('eq-btnNext')?.addEventListener('click', () => { eqOffset += eqPageSize; loadEquipos(); });
  $('eq-page-size')?.addEventListener('change', (e) => { eqPageSize = Number(e.target.value) || 20; eqOffset = 0; loadEquipos(); });
  $('eq-btnFiltrar')?.addEventListener('click', () => { eqOffset = 0; loadEquipos(); });
  
  // Enter key for filters
  ['eq-filtro-q', 'eq-filtro-marca', 'eq-filtro-modelo', 'eq-filtro-serie', 'eq-filtro-cliente', 'eq-filtro-aplicacion', 'eq-filtro-anio'].forEach(id => {
      $(id)?.addEventListener('keydown', (e) => { if(e.key === 'Enter') { eqOffset = 0; loadEquipos(); } });
  });
  $('eq-filtro-estado')?.addEventListener('change', () => { eqOffset = 0; loadEquipos(); });

  $('eq-btnLimpiar')?.addEventListener('click', () => {
      ['eq-filtro-q', 'eq-filtro-marca', 'eq-filtro-modelo', 'eq-filtro-serie', 'eq-filtro-cliente', 'eq-filtro-aplicacion', 'eq-filtro-anio'].forEach(id => { if($(id)) $(id).value = ''; });
      if($('eq-filtro-estado')) $('eq-filtro-estado').value = '';
      eqOffset = 0; 
      loadEquipos();
  });
  
  // Paginación Tickets
  $('btnPrev')?.addEventListener('click', () => { offset = Math.max(0, offset - pageSize); loadTickets(); });
  $('btnNext')?.addEventListener('click', () => { offset += pageSize; loadTickets(); });
  $('page-size')?.addEventListener('change', (e) => { pageSize = Number(e.target.value) || 50; offset = 0; loadTickets(); });
  $('btnFiltrar')?.addEventListener('click', () => loadTickets());
  $('btnLimpiar')?.addEventListener('click', () => {
     // Limpiar inputs
     offset = 0; loadTickets();
  });
}

function showSection(id, $) {
    if (!token) return;
    const sections = ['dashboard', 'menu', 'nuevo-ticket', 'tickets-section', 'equipos-list', 'clientes-section', 'settings', 'admin-users'];
    sections.forEach(s => {
       const el = $(s);
       if (el) el.style.display = 'none';
    });
    
    // Reset specific displays logic
    if (id === 'tickets-section') $('nuevo-ticket').style.display = 'block';
    
    const target = $(id);
    if (target) {
        target.style.display = 'block';
        if (id === 'tickets-section') loadTickets();
        if (id === 'equipos-list') loadEquipos();
        if (id === 'clientes-section') loadClientes();
        if (id === 'dashboard') loadDashboard();
        if (id === 'admin-users') loadAdminUsers();
    }

    // Update Sidebar Active State
    const navMap = {
        'dashboard': 'navDashboard',
        'tickets-section': 'navTickets',
        'equipos-list': 'navEquipos',
        'clientes-section': 'navClientes',
        'settings': 'navSettings',
        'admin-users': 'navUsers'
    };
    
    // Remove active class from all nav buttons
    Object.values(navMap).forEach(navId => {
        const btn = $(navId);
        if (btn) btn.classList.remove('active');
    });

    // Add active class to current nav button
    const activeNavId = navMap[id];
    if (activeNavId) {
        const activeBtn = $(activeNavId);
        if (activeBtn) activeBtn.classList.add('active');
    }
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
        $('btnLogout').style.display = 'inline-block';
        $('login').style.display = 'none';
        $('app-layout').style.display = 'grid';
        $('dashboard').style.display = 'block';
        
        const un = $('user-nombre');
        if (un && currentUser && currentUser.nombre) un.querySelector('h1').textContent = currentUser.nombre;
        
        connectSocket();
        loadUsers();
        loadDashboard();
        refreshClienteSelect();
      } catch {}
    }
  } catch {}
}


async function updateApiStatus() {
  // Status indicator removed by user request
}

// =========================================================
// FUNCIONES DE LÓGICA (TICKETS, EQUIPOS, ETC)
// =========================================================

async function loadTickets() {
  try {
    const qs = buildQueryFromFilters();
    const extra = new URLSearchParams({ limit: String(pageSize), offset: String(offset) }).toString();
    const url = `${API_URL}/tickets${qs || extra ? `?${[qs, extra].filter(Boolean).join('&')}` : ''}`;
    const res = await fetch(url, { headers: { 'Authorization': token ? `Bearer ${token}` : '' } });
    const data = await res.json();
    if (ticketsEl) {
        ticketsEl.innerHTML = '';
        data.forEach(t => ticketsEl.appendChild(ticketCard(t)));
        bindTicketActions();
    }
    
    // Count logic...
    try {
      const resCount = await fetch(`${API_URL}/tickets/count${qs ? `?${qs}` : ''}`, { headers: { 'Authorization': token ? `Bearer ${token}` : '' } });
      const countData = await resCount.json();
      totalTickets = Number(countData.total || 0);
      const totalEl = document.getElementById('tickets-total');
      if (totalEl) totalEl.textContent = `Total: ${totalTickets}`;
    } catch {}

  } catch (err) {
    console.error(err);
  }
}

function ticketCard(t) {
  const div = document.createElement('div');
  div.className = `ticket-card ${t.estado}`;
  div.innerHTML = `
    <div class="ticket-header"><h3>${t.titulo}</h3><span class="badge badge-${t.estado}">${t.estado === 'hecho' ? 'terminado' : t.estado}</span></div>
    <p class="ticket-desc">${t.descripcion || ''}</p>
    <div class="ticket-meta">Creado por: ${t.creado_por_nombre || t.creado_por || ''} • Asignado a: ${t.asignado_a_nombre || t.asignado_a || '—'}</div>
    <div class="ticket-actions">
      <button class="btn btn-success btn-small" data-done="${t.id}">Marcar terminado</button>
      <button class="btn btn-warning btn-small" data-pendiente="${t.id}">Marcar pendiente</button>
      <button class="btn btn-secondary btn-small" data-asignar="${t.id}">Asignar</button>
      <button class="btn btn-secondary btn-small" data-ver="${t.id}">Comentarios</button>
      <button class="btn btn-primary btn-small" data-editar="${t.id}">Editar</button>
      ${currentUser && currentUser.rol === 'admin' ? `<button class="btn btn-danger btn-small" data-eliminar="${t.id}">Eliminar</button>` : ''}
    </div>
    <div id="edit-ticket-${t.id}" style="display:none; margin-top:8px;">
      <input class="input" id="et-titulo-${t.id}" placeholder="Título" value="${t.titulo}" />
      <input class="input" id="et-descripcion-${t.id}" placeholder="Descripción" value="${t.descripcion || ''}" />
      <input class="input" id="et-asignado-${t.id}" placeholder="Asignado (ID)" value="${t.asignado_a ?? ''}" />
      <input class="input" id="et-equipo-${t.id}" placeholder="Equipo (ID)" value="${t.equipo_id ?? ''}" />
      <button class="btn btn-primary btn-small" data-save-ticket="${t.id}">Guardar</button>
      <button class="btn btn-ghost btn-small" data-cancel-ticket="${t.id}">Cancelar</button>
    </div>
    <div id="comentarios-${t.id}"></div>
  `;
  return div;
}

function bindTicketActions(container) {
    const target = container || ticketsEl;
    if (!target) return;
    target.querySelectorAll('button[data-done]').forEach(btn => btn.addEventListener('click', () => updateEstado(btn.dataset.done, 'hecho')));
    target.querySelectorAll('button[data-pendiente]').forEach(btn => btn.addEventListener('click', () => updateEstado(btn.dataset.pendiente, 'pendiente')));
    target.querySelectorAll('button[data-asignar]').forEach(btn => btn.addEventListener('click', async () => {
      const id = btn.dataset.asignar;
      const asignado_a = prompt('ID usuario a asignar (vacío para desasignar)');
      try {
        await fetch(`${API_URL}/tickets/${id}/asignado`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
          body: JSON.stringify({ asignado_a: asignado_a ? Number(asignado_a) : null })
        });
        loadTickets();
        loadDashboard(); // Refresh dashboard too just in case
      } catch (e) { console.error(e); }
    }));
    target.querySelectorAll('button[data-ver]').forEach(btn => btn.addEventListener('click', () => loadComentarios(btn.dataset.ver)));
    target.querySelectorAll('button[data-editar]').forEach(btn => btn.addEventListener('click', () => { const el = document.getElementById(`edit-ticket-${btn.dataset.editar}`); if(el) el.style.display='block'; }));
    target.querySelectorAll('button[data-eliminar]').forEach(btn => btn.addEventListener('click', () => deleteTicket(btn.dataset.eliminar)));
    target.querySelectorAll('button[data-save-ticket]').forEach(btn => btn.addEventListener('click', () => saveEditTicket(btn.dataset.saveTicket)));
    target.querySelectorAll('button[data-cancel-ticket]').forEach(btn => btn.addEventListener('click', () => { const el = document.getElementById(`edit-ticket-${btn.dataset.cancelTicket}`); if(el) el.style.display='none'; }));
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

async function loadComentarios(ticketId) {
    // ... Implementación simplificada ...
    try {
        const res = await fetch(`${API_URL}/tickets/${ticketId}/comentarios`, { headers: { 'Authorization': token ? `Bearer ${token}` : '' } });
        const data = await res.json();
        const cont = document.getElementById(`comentarios-${ticketId}`);
        if(!cont) return;
        cont.innerHTML = `
          <h5>Comentarios</h5>
          <ul>${data.map(c => `<li><b>${c.autor_nombre || c.autor_id}:</b> ${c.contenido}</li>`).join('')}</ul>
          <input id="new-comment-${ticketId}" placeholder="Escribe un comentario" />
          <button id="btn-comment-${ticketId}">Agregar</button>
        `;
        document.getElementById(`btn-comment-${ticketId}`).addEventListener('click', async () => {
             const contenido = document.getElementById(`new-comment-${ticketId}`).value;
             await fetch(`${API_URL}/tickets/${ticketId}/comentarios`, {
                 method: 'POST',
                 headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
                 body: JSON.stringify({ contenido })
             });
             loadComentarios(ticketId);
        });
    } catch {}
}

async function deleteTicket(id) {
    if (!confirm('¿Eliminar ticket?')) return;
    await fetch(`${API_URL}/tickets/${id}`, { method: 'DELETE', headers: { 'Authorization': token ? `Bearer ${token}` : '' } });
    loadTickets();
}

async function saveEditTicket(id) {
    const titulo = document.getElementById(`et-titulo-${id}`).value;
    const descripcion = document.getElementById(`et-descripcion-${id}`).value;
    const asignadoVal = document.getElementById(`et-asignado-${id}`).value;
    const equipoVal = document.getElementById(`et-equipo-${id}`).value;
    
    const body = { titulo, descripcion };
    if (asignadoVal) body.asignado_a = Number(asignadoVal);
    if (equipoVal) body.equipo_id = Number(equipoVal);
    
    await fetch(`${API_URL}/tickets/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
        body: JSON.stringify(body)
    });
    loadTickets();
}

// Equipos
async function loadEquipos() {
    try {
        const params = new URLSearchParams({ limit: String(eqPageSize), offset: String(eqOffset) });
        
        // Filtros
        const fq = document.getElementById('eq-filtro-q')?.value;
        const fmarca = document.getElementById('eq-filtro-marca')?.value;
        const fmodelo = document.getElementById('eq-filtro-modelo')?.value;
        const fserie = document.getElementById('eq-filtro-serie')?.value;
        const fcliente = document.getElementById('eq-filtro-cliente')?.value;
        const fapp = document.getElementById('eq-filtro-aplicacion')?.value;
        const fanio = document.getElementById('eq-filtro-anio')?.value;
        const festado = document.getElementById('eq-filtro-estado')?.value;

        if(fq) params.set('q', fq);
        if(fmarca) params.set('marca', fmarca);
        if(fmodelo) params.set('modelo', fmodelo);
        if(fserie) params.set('serie', fserie);
        if(fcliente) params.set('cliente', fcliente);
        if(fapp) params.set('aplicacion', fapp);
        if(fanio) params.set('anio_venta', fanio);
        if(festado) params.set('estado', festado);
        
        params.set('t', Date.now());

        const res = await fetch(`${API_URL}/equipos?${params.toString()}`, { 
            headers: { 'Authorization': token ? `Bearer ${token}` : '', 'Cache-Control': 'no-cache' } 
        });
        const data = await res.json();
        equiposList = data; // Guardar referencia global
        
        const tbody = document.getElementById('equipos-body');
        if(tbody) {
            tbody.innerHTML = data.map(e => `
              <tr style="cursor:pointer; transition:background .2s;" onclick="selectEquipo(${e.id})" onmouseover="this.style.background='var(--bg)'" onmouseout="this.style.background='transparent'">
                <td style="font-weight:500;">${e.nombre}</td>
                <td>${e.marca || ''} ${e.modelo || ''}</td>
                <td><span style="font-family:monospace; font-size:12px; background:var(--bg); padding:2px 6px; border-radius:4px;">${e.numero_serie || 'N/A'}</span></td>
                <td><span class="badge ${e.estado === 'activo' ? 'badge-hecho' : 'badge-pendiente'}">${e.estado}</span></td>
                <td style="text-align:right;">
                   <button class="btn btn-ghost btn-small">Ver</button>
                </td>
              </tr>
            `).join('');
        }
        
        // Update Count
        try {
            const r2 = await fetch(`${API_URL}/equipos/count?${params.toString()}`, { headers: { 'Authorization': token ? `Bearer ${token}` : '' } });
            const d2 = await r2.json();
            totalEquipos = d2.total;
            const te = document.getElementById('equipos-total');
            if(te) te.textContent = `Total: ${totalEquipos}`;
        } catch {}
        
    } catch(e) { console.error('Error loading equipos:', e); }
}

function selectEquipo(id) {
    const e = equiposList.find(x => x.id === id);
    if(!e) return;
    currentEquipo = e;
    const view = document.getElementById('equipo-detalle-view');
    if(view) {
        view.style.display = 'block';
        renderEquipoReadMode();
    }
}

function renderEquipoReadMode() {
    if(!currentEquipo) return;
    const e = currentEquipo;
    const title = document.getElementById('ed-title');
    if(title) title.textContent = e.nombre;
    
    const content = document.getElementById('ed-content');
    if(content) {
        content.innerHTML = `
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
                <div><label class="label-sm" style="color:var(--mut);font-size:11px;font-weight:700;">MARCA</label><div class="val" style="font-weight:500;">${e.marca || '-'}</div></div>
                <div><label class="label-sm" style="color:var(--mut);font-size:11px;font-weight:700;">MODELO</label><div class="val" style="font-weight:500;">${e.modelo || '-'}</div></div>
                <div style="grid-column:1/-1"><label class="label-sm" style="color:var(--mut);font-size:11px;font-weight:700;">N° SERIE</label><div class="val" style="font-weight:500;">${e.numero_serie || '-'}</div></div>
                <div style="grid-column:1/-1"><label class="label-sm" style="color:var(--mut);font-size:11px;font-weight:700;">UBICACIÓN</label><div class="val" style="font-weight:500;">${e.ubicacion || '-'}</div></div>
                <div style="grid-column:1/-1"><label class="label-sm" style="color:var(--mut);font-size:11px;font-weight:700;">CLIENTE</label><div class="val" style="font-weight:500;">${e.cliente_nombre || (e.cliente_id ? 'ID: '+e.cliente_id : 'STOCK')}</div></div>
                <div><label class="label-sm" style="color:var(--mut);font-size:11px;font-weight:700;">APLICACIÓN</label><div class="val" style="font-weight:500;">${e.aplicacion || '-'}</div></div>
                <div><label class="label-sm" style="color:var(--mut);font-size:11px;font-weight:700;">AÑO</label><div class="val" style="font-weight:500;">${e.anio_venta || '-'}</div></div>
                <div><label class="label-sm" style="color:var(--mut);font-size:11px;font-weight:700;">ESTADO</label><div class="val"><span class="badge ${e.estado === 'activo' ? 'badge-hecho' : 'badge-pendiente'}">${e.estado}</span></div></div>
            </div>
            ${e.mantenciones ? `<div style="margin-top:10px; border-top:1px solid var(--brd); padding-top:10px;"><b>Mantenciones:</b><br/>${e.mantenciones}</div>` : ''}
        `;
    }
    
    const actions = document.getElementById('ed-actions');
    if(actions) {
        actions.innerHTML = `
            <button class="btn btn-primary btn-small" onclick="enableEditEquipo()">Editar</button>
            <button class="btn btn-danger btn-small" onclick="deleteEquipo('${e.id}')">Eliminar</button>
        `;
    }
}

function enableEditEquipo() {
    if(!currentEquipo) return;
    const e = currentEquipo;
    const content = document.getElementById('ed-content');
    
    // We need to load clients for the select
    const clientOptions = document.getElementById('eq-cliente-id')?.innerHTML || '<option value="">Cargando...</option>';
    
    if(content) {
        content.innerHTML = `
            <label class="label-sm" style="color:var(--mut);font-size:11px;font-weight:700;">NOMBRE</label>
            <input id="ed-nombre" class="input full" value="${e.nombre}" placeholder="Nombre" style="margin-bottom:8px;" />
            
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
                <div>
                    <label class="label-sm" style="color:var(--mut);font-size:11px;font-weight:700;">MARCA</label>
                    <input id="ed-marca" class="input full" value="${e.marca||''}" placeholder="Marca" />
                </div>
                <div>
                    <label class="label-sm" style="color:var(--mut);font-size:11px;font-weight:700;">MODELO</label>
                    <input id="ed-modelo" class="input full" value="${e.modelo||''}" placeholder="Modelo" />
                </div>
            </div>
            
            <label class="label-sm" style="color:var(--mut);font-size:11px;font-weight:700; margin-top:8px; display:block;">N° SERIE</label>
            <input id="ed-serie" class="input full" value="${e.numero_serie||''}" placeholder="Serie" />
            
            <label class="label-sm" style="color:var(--mut);font-size:11px;font-weight:700; margin-top:8px; display:block;">UBICACIÓN</label>
            <input id="ed-ubicacion" class="input full" value="${e.ubicacion||''}" placeholder="Ubicación" />
            
            <label class="label-sm" style="color:var(--mut);font-size:11px;font-weight:700; margin-top:8px; display:block;">CLIENTE</label>
            <select id="ed-cliente" class="input select full">${clientOptions}</select>
            
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-top:8px;">
                 <div>
                    <label class="label-sm" style="color:var(--mut);font-size:11px;font-weight:700;">APLICACIÓN</label>
                    <input id="ed-app" class="input full" value="${e.aplicacion||''}" placeholder="App" />
                 </div>
                 <div>
                    <label class="label-sm" style="color:var(--mut);font-size:11px;font-weight:700;">AÑO</label>
                    <input id="ed-anio" class="input full" type="number" value="${e.anio_venta||''}" placeholder="Año" />
                 </div>
            </div>
            
            <label class="label-sm" style="color:var(--mut);font-size:11px;font-weight:700; margin-top:8px; display:block;">ESTADO</label>
            <select id="ed-estado" class="input select full">
                <option value="activo" ${e.estado==='activo'?'selected':''}>Activo</option>
                <option value="inactivo" ${e.estado==='inactivo'?'selected':''}>Inactivo</option>
            </select>
        `;
        
        // Set client value
        const sel = document.getElementById('ed-cliente');
        if(sel) sel.value = e.cliente_id || (e.cliente_id === null ? 'STOCK' : '');
    }

    const actions = document.getElementById('ed-actions');
    if(actions) {
        actions.innerHTML = `
            <button class="btn btn-success btn-small" onclick="saveEditEquipo()">Guardar</button>
            <button class="btn btn-ghost btn-small" onclick="renderEquipoReadMode()">Cancelar</button>
        `;
    }
}

async function createEquipo() {
    const nombre = document.getElementById('eq-nombre').value;
    const marca = document.getElementById('eq-marca').value;
    const modelo = document.getElementById('eq-modelo').value;
    const numero_serie = document.getElementById('eq-numero_serie').value;
    const ubicacion = document.getElementById('eq-ubicacion').value;
    const estado = document.getElementById('eq-estado').value;
    const cliente_id = document.getElementById('eq-cliente-id').value;
    
    if(!nombre) { alert('Nombre obligatorio'); return; }
    
    let cid = null;
    if (cliente_id && cliente_id !== 'STOCK') {
        cid = Number(cliente_id);
    }
    
    try {
        const res = await fetch(`${API_URL}/equipos`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
            body: JSON.stringify({ 
                nombre, marca, modelo, numero_serie, ubicacion, estado, 
                cliente_id: cid
            })
        });
        
        if (res.ok) {
            alert('Equipo creado correctamente');
            // Limpiar inputs
            document.getElementById('eq-nombre').value = '';
            document.getElementById('eq-marca').value = '';
            document.getElementById('eq-modelo').value = '';
            document.getElementById('eq-numero_serie').value = '';
            document.getElementById('eq-ubicacion').value = '';
            document.getElementById('eq-cliente-id').value = '';
            loadEquipos();
        } else {
            const err = await res.json();
            alert('Error: ' + (err.error || 'No se pudo crear el equipo'));
        }
    } catch(e) {
        console.error(e);
        alert('Error de conexión al crear equipo');
    }
}

async function saveEditEquipo() {
    if(!currentEquipo) return;
    const id = currentEquipo.id;
    const nombre = document.getElementById('ed-nombre').value;
    const marca = document.getElementById('ed-marca').value;
    const modelo = document.getElementById('ed-modelo').value;
    const numero_serie = document.getElementById('ed-serie').value;
    const ubicacion = document.getElementById('ed-ubicacion').value;
    const cliente_id = document.getElementById('ed-cliente').value;
    const aplicacion = document.getElementById('ed-app').value;
    const anio_venta = document.getElementById('ed-anio').value;
    const estado = document.getElementById('ed-estado').value;

    let cid = null;
    if (cliente_id && cliente_id !== 'STOCK') cid = Number(cliente_id);

    try {
        const res = await fetch(`${API_URL}/equipos/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
            body: JSON.stringify({ nombre, marca, modelo, numero_serie, ubicacion, cliente_id: cid, aplicacion, anio_venta, estado })
        });
        
        if(res.ok) {
            // Update currentEquipo locally
            currentEquipo = { ...currentEquipo, nombre, marca, modelo, numero_serie, ubicacion, cliente_id: cid, aplicacion, anio_venta, estado };
            // Reload list
            loadEquipos();
            // Go back to read mode
            renderEquipoReadMode();
        } else {
            alert('Error al actualizar');
        }
    } catch(e) { console.error(e); }
}

async function deleteEquipo(id) {
    if(!confirm('¿Estás seguro de eliminar este equipo?')) return;
    try {
        const res = await fetch(`${API_URL}/equipos/${id}`, {
            method: 'DELETE',
            headers: { 'Authorization': token ? `Bearer ${token}` : '' }
        });
        if(res.ok) {
            document.getElementById('equipo-detalle-view').style.display = 'none';
            loadEquipos();
        } else {
            const data = await res.json();
            alert(data.error || 'Error al eliminar');
        }
    } catch(e) { console.error(e); alert('Error de conexión'); }
}

// Helpers
function buildQueryFromFilters() {
    const estado = document.getElementById('filtro-estado')?.value;
    const q = document.getElementById('filtro-q')?.value;
    const params = new URLSearchParams();
    if(estado) params.set('estado', estado);
    if(q) params.set('q', q);
    return params.toString();
}

async function loadUsers() {
    try {
        const res = await fetch(`${API_URL}/auth/users`, { headers: { 'Authorization': token ? `Bearer ${token}` : '' } });
        const users = await res.json();
        const sel = document.getElementById('asignado-select');
        if(sel) {
            // Filter valid users and remove duplicates by ID just in case
            const uniqueUsers = [];
            const seenIds = new Set();
            if(Array.isArray(users)) {
                users.forEach(u => {
                    if(u && u.id && u.nombre && !seenIds.has(u.id)) {
                        seenIds.add(u.id);
                        uniqueUsers.push(u);
                    }
                });
            }
            sel.innerHTML = `<option value="">Asignar responsable (opcional)</option>` + uniqueUsers.map(u => `<option value="${u.id}">${u.nombre}</option>`).join('');
        }
    } catch (e) { console.error('Error loading users', e); }
}

async function loadDashboard() {
    if(!token) return;
    try {
        // Total Tickets
        const r1 = await fetch(`${API_URL}/tickets/count`, { headers: { 'Authorization': `Bearer ${token}` } });
        const d1 = await r1.json();
        const tc = document.getElementById('total-tickets-count');
        if(tc) tc.textContent = d1.total;

        // Assigned Pending Tickets
        if (currentUser && currentUser.id) {
            const uid = Number(currentUser.id);

            // Count
            const r2 = await fetch(`${API_URL}/tickets/count?asignado_a=${uid}&estado=pendiente&t=${Date.now()}`, { headers: { 'Authorization': `Bearer ${token}` } });
            const d2 = await r2.json();
            const ac = document.getElementById('assigned-count');
            if(ac) ac.textContent = d2.total;

            // List for "Mis pendientes"
            const rList = await fetch(`${API_URL}/tickets?asignado_a=${uid}&estado=pendiente&limit=10&t=${Date.now()}`, { headers: { 'Authorization': `Bearer ${token}` } });
            const dList = await rList.json();
            
            const al = document.getElementById('assigned-list');
            if(al) {
                al.innerHTML = '';
                if(Array.isArray(dList) && dList.length > 0) {
                    dList.forEach(t => al.appendChild(ticketCard(t)));
                    bindTicketActions(al);
                } else {
                    al.innerHTML = '<p class="muted" style="grid-column:1/-1;text-align:center;">No tienes tickets pendientes.</p>';
                }
            }
        } else {
            // console.warn('Current user ID not found, skipping pending tickets load');
        }

        // Equipos
        const r3 = await fetch(`${API_URL}/equipos/count`, { headers: { 'Authorization': `Bearer ${token}` } });
        const d3 = await r3.json();
        const ec = document.getElementById('total-equipos-count');
        if(ec) ec.textContent = d3.total;

        // Clientes
        const r4 = await fetch(`${API_URL}/clientes/count`, { headers: { 'Authorization': `Bearer ${token}` } });
        const d4 = await r4.json();
        const cc = document.getElementById('total-clientes-count');
        if(cc) cc.textContent = d4.total;

    } catch (e) {
        console.error('Error loading dashboard stats', e);
    }
}

async function loadClientes() {
    try {
        const q = document.getElementById('cli-filtro-q')?.value || '';
        const params = new URLSearchParams();
        if (q) params.set('q', q);
        params.set('t', Date.now());

        const res = await fetch(`${API_URL}/clientes?${params.toString()}`, { 
            headers: { 
                'Authorization': token ? `Bearer ${token}` : '',
                'Cache-Control': 'no-cache'
            } 
        });
        const list = await res.json();
        const tbody = document.getElementById('clientes-body');
        const countBadge = document.getElementById('clientes-total');
        
        if (countBadge) countBadge.textContent = Array.isArray(list) ? list.length : 0;

        if(tbody && Array.isArray(list)) {
            tbody.innerHTML = list.map(c => `
              <tr id="row-${c.id}">
                <td style="font-weight:500;">
                    <div style="display:flex; flex-direction:column;">
                        <span>${c.nombre || 'Sin nombre'}</span>
                        <span style="font-size:11px; color:var(--mut);">ID: ${c.id}</span>
                    </div>
                </td>
                <td>${c.empresa || ''}</td>
                <td style="text-align:right;">
                  <div style="display:flex; gap:6px; justify-content:flex-end;">
                    <button class="btn btn-outline btn-small" onclick="showClienteEquipos(${c.id}, '${c.nombre || c.empresa}')" title="Ver Equipos">
                        Equipos
                    </button>
                    <button class="btn btn-primary btn-small" onclick="enableEditCliente(${c.id})">
                        Editar
                    </button>
                    <button class="btn btn-danger btn-small" onclick="deleteCliente('${c.id}')" title="Eliminar">
                        ✕
                    </button>
                  </div>
                </td>
              </tr>
              <tr id="edit-row-${c.id}" style="display:none; background:var(--bg2);">
                 <td colspan="3" style="padding:16px;">
                    <div style="display:flex; gap:12px; align-items:center;">
                       <div style="flex:1;">
                           <label style="font-size:11px; font-weight:700; color:var(--mut);">NOMBRE</label>
                           <input class="input full" id="ec-nombre-${c.id}" value="${c.nombre || ''}" placeholder="Nombre" />
                       </div>
                       <div style="flex:1;">
                           <label style="font-size:11px; font-weight:700; color:var(--mut);">EMPRESA</label>
                           <input class="input full" id="ec-empresa-${c.id}" value="${c.empresa || ''}" placeholder="Empresa" />
                       </div>
                       <div style="display:flex; gap:8px; align-items:flex-end;">
                           <button class="btn btn-success btn-small" onclick="saveEditCliente('${c.id}')">Guardar</button>
                           <button class="btn btn-ghost btn-small" onclick="cancelEditCliente('${c.id}')">Cancelar</button>
                       </div>
                    </div>
                 </td>
              </tr>
            `).join('');
        }
        refreshClienteSelect(list);
    } catch {}
}

function enableEditCliente(id) {
    const row = document.getElementById(`row-${id}`);
    const editRow = document.getElementById(`edit-row-${id}`);
    if(row && editRow) {
        row.style.display = 'none';
        editRow.style.display = 'table-row';
    }
}

function cancelEditCliente(id) {
    const row = document.getElementById(`row-${id}`);
    const editRow = document.getElementById(`edit-row-${id}`);
    if(row && editRow) {
        row.style.display = 'table-row';
        editRow.style.display = 'none';
    }
}

async function saveEditCliente(id) {
    const nombre = document.getElementById(`ec-nombre-${id}`).value;
    const empresa = document.getElementById(`ec-empresa-${id}`).value;
    
    try {
        const res = await fetch(`${API_URL}/clientes/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
            body: JSON.stringify({ nombre, empresa })
        });
        
        if (res.ok) {
            loadClientes();
        } else {
            alert('Error al actualizar cliente');
        }
    } catch(e) { console.error(e); }
}

async function deleteCliente(id) {
    console.log('Intentando eliminar cliente ID:', id);
    if(!confirm(`¿Estás seguro de eliminar el cliente ID: ${id}? Sus equipos quedarán sin asignar.`)) return;
    try {
        const res = await fetch(`${API_URL}/clientes/${id}`, {
            method: 'DELETE',
            headers: { 'Authorization': token ? `Bearer ${token}` : '' }
        });
        if(res.ok) {
            loadClientes();
        } else {
            if (res.status === 404) {
                alert('El cliente ya no existe (probablemente fue eliminado). La lista se actualizará.');
                loadClientes();
                return;
            }
            const data = await res.json().catch(() => ({}));
            console.error('Error delete:', data);
            alert(data.error || data.mensaje || 'Error al eliminar cliente');
        }
    } catch(e) { console.error(e); alert('Error de conexión'); }
}

async function showClienteEquipos(id, nombre) {
    const view = document.getElementById('cliente-detalle-view');
    const title = document.getElementById('cd-nombre');
    const listEl = document.getElementById('cd-equipos-list');
    if(!view || !listEl) return;
    
    view.style.display = 'block';
    if(title) title.textContent = `Equipos de: ${nombre}`;
    listEl.innerHTML = '<p>Cargando...</p>';
    
    try {
        const res = await fetch(`${API_URL}/clientes/${id}/equipos`, { headers: { 'Authorization': token ? `Bearer ${token}` : '' } });
        const equipos = await res.json();
        if (Array.isArray(equipos) && equipos.length > 0) {
            listEl.innerHTML = equipos.map(e => `
                <div class="card" style="padding:10px; margin-bottom:8px; background:var(--bg2);">
                    <h4>${e.nombre}</h4>
                    <small>${e.marca || ''} ${e.modelo || ''}</small>
                    <div><span class="badge ${e.estado === 'activo' ? 'badge-hecho' : 'badge-pendiente'}">${e.estado}</span></div>
                </div>
            `).join('');
        } else {
            listEl.innerHTML = '<p class="muted">No hay equipos asignados.</p>';
        }
    } catch {
        listEl.innerHTML = '<p class="muted">Error al cargar equipos.</p>';
    }
}

async function refreshClienteSelect(list) {
    const sel = document.getElementById('eq-cliente-id');
    if(!sel) return;
    if(!list) {
        try {
             const res = await fetch(`${API_URL}/clientes`, { headers: { 'Authorization': token ? `Bearer ${token}` : '' } });
             list = await res.json();
        } catch { list = []; }
    }
    // Agregar opción STOCK
    sel.innerHTML = `<option value="">Cliente</option><option value="STOCK">STOCK (Sin Clientes)</option>` + (list || []).map(c => `<option value="${c.id}">${c.nombre || c.empresa}</option>`).join('');
}

function connectSocket() {
    try {
        socket = io(API_URL, { transports: ['websocket'] });
        socket.on('ticket:created', () => loadTickets());
        socket.on('ticket:updated', () => loadTickets());
    } catch {}
}

function defaultAvatarSVG() {
  return '<div class="avatar-icon"><svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><circle cx="32" cy="32" r="31" fill="none" stroke="#111" stroke-width="2"/><circle cx="32" cy="24" r="10" fill="#111"/><path d="M12 54c4-10 14-14 20-14s16 4 20 14" fill="#111"/></svg></div>';
}

function renderAvatar() {
  const av = (typeof localStorage !== 'undefined') ? localStorage.getItem('bioherts_avatar') : null;
  const loginSlot = document.getElementById('login-avatar-slot');
  const sideSlot = document.getElementById('sidebar-avatar-slot');
  const settingsSlot = document.getElementById('settings-avatar-slot');
  const imgHtml = av ? `<img src="${av}" alt="avatar" style="width:120px;height:120px;border-radius:50%;object-fit:cover;background:#fff;"/>` : defaultAvatarSVG();
  if (loginSlot) loginSlot.innerHTML = imgHtml;
  if (sideSlot) sideSlot.innerHTML = av ? `<img src="${av}" alt="avatar" style="width:80px;height:80px;border-radius:50%;object-fit:cover;background:#fff;"/>` : defaultAvatarSVG();
  if (settingsSlot) settingsSlot.innerHTML = imgHtml;
}

async function loadAdminUsers() {
  try {
    const res = await fetch(`${API_URL}/auth/users`, { headers: { 'Authorization': token ? `Bearer ${token}` : '' } });
    const users = await res.json();
    const tbody = document.getElementById('admin-users-body');
    if(tbody) {
      tbody.innerHTML = users.map(u => `
        <tr>
          <td>${u.nombre}</td>
          <td>${u.email}</td>
          <td><span class="badge badge-hecho">${u.rol || 'user'}</span></td>
          <td style="text-align:right;">
             <button class="btn btn-primary btn-small" data-edit-user="${u.id}" data-email="${u.email}">Editar</button>
             <button class="btn btn-danger btn-small" data-delete-user="${u.id}">Borrar</button>
          </td>
        </tr>
      `).join('');
      bindUserActions(tbody);
    }
  } catch (e) { console.error('Error loading users', e); }
}

function bindUserActions(container) {
  container.querySelectorAll('button[data-edit-user]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.editUser;
      const currentEmail = btn.dataset.email;
      editUser(id, currentEmail);
    });
  });

  container.querySelectorAll('button[data-delete-user]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.deleteUser;
      deleteUser(id);
    });
  });
}

async function editUser(id, currentEmail) {
  const newEmail = prompt('Ingresa el nuevo correo para el usuario:', currentEmail);
  if (newEmail !== null && newEmail !== currentEmail) {
    if (!newEmail.trim() || !newEmail.includes('@')) {
      alert('Correo inválido');
      return;
    }
    try {
      const res = await fetch(`${API_URL}/auth/users/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
        body: JSON.stringify({ email: newEmail.trim() })
      });
      if (res.ok) {
        alert('Usuario actualizado');
        loadAdminUsers();
        loadUsers();
      } else {
        const data = await res.json();
        alert(data.mensaje || 'Error al actualizar');
      }
    } catch (e) { console.error(e); alert('Error de conexión'); }
  }
}

async function deleteUser(id) {
  if (confirm('¿Estás seguro de que deseas eliminar este usuario? Esta acción no se puede deshacer.')) {
    try {
      const res = await fetch(`${API_URL}/auth/users/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': token ? `Bearer ${token}` : '' }
      });
      if (res.ok) {
        alert('Usuario eliminado');
        loadAdminUsers();
        loadUsers();
      } else {
        const data = await res.json();
        alert(data.mensaje || 'Error al eliminar');
      }
    } catch (e) { console.error(e); alert('Error de conexión'); }
  }
}
