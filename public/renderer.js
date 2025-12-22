let API_URL = '';

if (window.location.protocol === 'file:') {
  API_URL = 'http://localhost:4000';
  // Lógica original para Electron/Local
  try {
    const fs = typeof require !== 'undefined' ? require('fs') : null;
  const path = typeof require !== 'undefined' ? require('path') : null;
  const candidates = [];
  if (fs && path) {
    try { candidates.push(path.join(process.cwd(), 'api_port.txt')); } catch {}
    try { candidates.push(path.join(path.dirname(process.execPath || process.cwd()), 'api_port.txt')); } catch {}
    try { candidates.push(path.join(process.resourcesPath || process.cwd(), 'app', 'api_port.txt')); } catch {}
    for (const fp of candidates) {
      try {
        if (fs.existsSync(fp)) {
          const port = Number(String(fs.readFileSync(fp, 'utf-8')).trim());
          if (port) { API_URL = `http://127.0.0.1:${port}`; break; }
        }
      } catch {}
    }
  }
} catch {}

async function probeApiUrl() {
  const ports = [];
  const base = 4000;
  for (let i = 0; i <= 10; i++) ports.push(base + i);
  for (const p of ports) {
    try {
      const r = await fetch(`http://127.0.0.1:${p}/`, { method: 'GET' });
      if (r.ok) { API_URL = `http://127.0.0.1:${p}`; return; }
    } catch {}
  }
}

if (window.location.protocol === 'file:') {
  try { probeApiUrl().then(() => typeof updateApiStatus === 'function' && updateApiStatus()); } catch {}
}

let token = null;
let socket = null;
let currentUser = null;

const $ = (id) => document.getElementById(id);
const statusEl = $('status');
const loginResult = $('loginResult');
const ticketsEl = $('tickets');
const equiposEl = $('equipos');
let totalTickets = 0;
let totalEquipos = 0;
let pageSize = Number(document.getElementById('page-size')?.value) || 50;
let offset = 0;
let eqPageSize = Number(document.getElementById('eq-page-size')?.value) || 20;
let eqOffset = 0;

// Login
if ($('btnLogin')) $('btnLogin').addEventListener('click', async () => {
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
      token = data.token;
      try {
        if (document.getElementById('rememberMe')?.checked) {
          localStorage.setItem('bioherts_token', token);
        }
      } catch {}
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        currentUser = { id: payload.id, nombre: payload.nombre, rol: payload.rol };
        statusEl.textContent = `Conectado: ${currentUser.nombre} (${currentUser.rol})`;
        document.getElementById('btnLogout').style.display = 'inline-block';
      } catch {}
      loginResult.textContent = 'Login correcto';
      document.getElementById('login').style.display = 'none';
      document.getElementById('app-layout').style.display = 'grid';
      document.getElementById('dashboard').style.display = 'block';
      document.getElementById('menu').style.display = 'none';
      document.getElementById('nuevo-ticket').style.display = 'none';
      document.getElementById('tickets-section').style.display = 'none';
      document.getElementById('equipos-list').style.display = 'none';
      const un = document.getElementById('user-nombre');
      if (un && currentUser && currentUser.nombre) un.querySelector('h1').textContent = currentUser.nombre;
      connectSocket();
      loadUsers();
      loadDashboard();
      refreshClienteSelect();
    } else {
      loginResult.textContent = data.mensaje || data.error || 'Error de login';
    }
  } catch (err) {
    loginResult.textContent = 'Error de conexión';
    console.error(err);
  }
});

if ($('btnRegister')) $('btnRegister').addEventListener('click', async () => {
  const nombre = String($('reg-nombre').value || '').trim();
  const email = String($('reg-email').value || '').trim().toLowerCase();
  const password = String($('reg-password').value || '').trim();
  const rol = $('reg-rol').value;
  try {
    const emailOk = /.+@.+\..+/.test(email);
    if (!nombre || !emailOk || !password) {
      $('registerResult').textContent = 'Ingresa nombre, correo y contraseña';
      return;
    }
    const res = await fetch(`${API_URL}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nombre, email, password, rol })
    });
    const data = await res.json();
    if (res.ok) {
      $('registerResult').textContent = 'Registro correcto';
      const resLogin = await fetch(`${API_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const dataLogin = await resLogin.json();
      if (resLogin.ok) {
        token = dataLogin.token;
        try {
          const payload = JSON.parse(atob(token.split('.')[1]));
          currentUser = { id: payload.id, nombre: payload.nombre, rol: payload.rol };
          statusEl.textContent = `Conectado: ${currentUser.nombre} (${currentUser.rol})`;
          document.getElementById('btnLogout').style.display = 'inline-block';
        } catch {}
        loginResult.textContent = 'Login correcto';
        document.getElementById('login').style.display = 'none';
        document.getElementById('app-layout').style.display = 'grid';
        document.getElementById('dashboard').style.display = 'block';
        document.getElementById('menu').style.display = 'none';
        document.getElementById('nuevo-ticket').style.display = 'none';
        document.getElementById('tickets-section').style.display = 'none';
        document.getElementById('equipos-list').style.display = 'none';
        connectSocket();
        loadUsers();
        loadDashboard();
        refreshClienteSelect();
      } else {
        loginResult.textContent = dataLogin.mensaje || dataLogin.error || 'Error de login';
      }
    } else {
      $('registerResult').textContent = data.mensaje || data.error || 'Error de registro';
    }
  } catch (err) {
    $('registerResult').textContent = 'Error de conexión';
    console.error(err);
  }
});

document.getElementById('toggleRegister')?.addEventListener('click', (e) => {
  e.preventDefault();
  const p = document.getElementById('registerPanel');
  if (!p) return;
  p.style.display = p.style.display === 'none' ? 'block' : 'none';
});

async function initGoogle() {
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
              token = data.token;
              try {
                if (document.getElementById('rememberMe')?.checked) {
                  localStorage.setItem('bioherts_token', token);
                }
              } catch {}
              try {
                const payload = JSON.parse(atob(token.split('.')[1]));
                currentUser = { id: payload.id, nombre: payload.nombre, rol: payload.rol };
                statusEl.textContent = `Conectado: ${currentUser.nombre} (${currentUser.rol})`;
                document.getElementById('btnLogout').style.display = 'inline-block';
              } catch {}
              document.getElementById('login').style.display = 'none';
              document.getElementById('app-layout').style.display = 'grid';
              document.getElementById('dashboard').style.display = 'block';
              document.getElementById('menu').style.display = 'none';
              document.getElementById('nuevo-ticket').style.display = 'none';
              document.getElementById('tickets-section').style.display = 'none';
              document.getElementById('equipos-list').style.display = 'none';
              connectSocket();
              loadUsers();
              loadDashboard();
              refreshClienteSelect();
            } else {
              loginResult.textContent = data.mensaje || data.error || 'Error con Google';
            }
          } catch (e) {
            loginResult.textContent = 'Error de conexión';
          }
        }
      });
      const g1 = document.getElementById('googleSignIn');
      const g2 = document.getElementById('googleRegister');
      if (g1) google.accounts.id.renderButton(g1, { theme: 'outline', size: 'large', text: 'signin_with', shape: 'pill' });
      if (g2) google.accounts.id.renderButton(g2, { theme: 'outline', size: 'large', text: 'signup_with', shape: 'pill' });
    };
    const wait = () => { if (ready()) { start(); } else { setTimeout(wait, 200); } };
    wait();
  } catch {}
}

initGoogle();

// Crear ticket
$('btnCrearTicket').addEventListener('click', async () => {
  const titulo = $('titulo').value;
  const descripcion = $('descripcion').value;
  const asignadoSel = $('asignado-select');
  const asignado_a = asignadoSel && asignadoSel.value ? Number(asignadoSel.value) : null;
  const equipo_id = $('equipo').value ? Number($('equipo').value) : null;

  try {
    if (!titulo || titulo.trim() === '') {
      alert('El título es obligatorio');
      return;
    }
    // validación simple: select devuelve ID numérico o vacío
    if ($('equipo').value && Number.isNaN(equipo_id)) {
      alert('Equipo debe ser numérico');
      return;
    }
    const res = await fetch(`${API_URL}/tickets`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': token ? `Bearer ${token}` : ''
      },
      body: JSON.stringify({ titulo, descripcion, asignado_a, equipo_id })
    });
    const data = await res.json();
    if (res.ok) {
      $('titulo').value = '';
      $('descripcion').value = '';
      if (asignadoSel) asignadoSel.value = '';
      $('equipo').value = '';
      // El socket actualizará automáticamente, pero forzamos recarga por si no hay socket
      loadTickets();
    } else {
      alert(data.error || 'Error al crear ticket');
    }
  } catch (err) {
    console.error(err);
  }
});

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

async function loadTickets() {
  try {
    const qs = buildQueryFromFilters();
    const extra = new URLSearchParams({ limit: String(pageSize), offset: String(offset) }).toString();
    const url = `${API_URL}/tickets${qs || extra ? `?${[qs, extra].filter(Boolean).join('&')}` : ''}`;
    const res = await fetch(url, {
      headers: { 'Authorization': token ? `Bearer ${token}` : '' }
    });
    const data = await res.json();
    ticketsEl.innerHTML = '';
    data.forEach(t => ticketsEl.appendChild(ticketCard(t)));
    bindTicketActions();
    statusEl.textContent = `Tickets cargados: ${data.length} (offset ${offset}, tamaño ${pageSize})`;
    try {
      const resCount = await fetch(`${API_URL}/tickets/count${qs ? `?${qs}` : ''}`, {
        headers: { 'Authorization': token ? `Bearer ${token}` : '' }
      });
      const countData = await resCount.json();
      totalTickets = Number(countData.total || 0);
      const totalEl = document.getElementById('tickets-total');
      if (totalEl) totalEl.textContent = `Total: ${totalTickets}`;
      document.getElementById('btnNext').disabled = offset + pageSize >= totalTickets;
      document.getElementById('btnPrev').disabled = offset <= 0;
    } catch {}
    // si no hay datos y offset>0, retroceder una página
    if (data.length === 0 && offset > 0) {
      offset = Math.max(0, offset - pageSize);
      return loadTickets();
    }
  } catch (err) {
    console.error(err);
    statusEl.textContent = 'Error cargando tickets';
  }
}

function bindTicketActions() {
  ticketsEl.querySelectorAll('button[data-done]').forEach(btn => {
    btn.addEventListener('click', () => updateEstado(btn.dataset.done, 'hecho'));
  });
  ticketsEl.querySelectorAll('button[data-pendiente]').forEach(btn => {
    btn.addEventListener('click', () => updateEstado(btn.dataset.pendiente, 'pendiente'));
  });
  ticketsEl.querySelectorAll('button[data-asignar]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.asignar;
      const asignado_a = prompt('ID usuario a asignar (vacío para desasignar)');
      try {
        const res = await fetch(`${API_URL}/tickets/${id}/asignado`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': token ? `Bearer ${token}` : ''
          },
          body: JSON.stringify({ asignado_a: asignado_a ? Number(asignado_a) : null })
        });
        const data = await res.json();
        if (!res.ok) alert(data.error || 'Error al asignar');
        loadTickets();
      } catch (err) {
        console.error(err);
      }
    });
  });
  ticketsEl.querySelectorAll('button[data-ver]').forEach(btn => {
    btn.addEventListener('click', () => loadComentarios(btn.dataset.ver));
  });
  ticketsEl.querySelectorAll('button[data-editar]').forEach(btn => {
    btn.addEventListener('click', () => editTicket(btn.dataset.editar));
  });
  ticketsEl.querySelectorAll('button[data-eliminar]').forEach(btn => {
    btn.addEventListener('click', () => deleteTicket(btn.dataset.eliminar));
  });
  ticketsEl.querySelectorAll('button[data-save-ticket]').forEach(btn => {
    btn.addEventListener('click', () => saveEditTicket(btn.dataset.saveTicket));
  });
  ticketsEl.querySelectorAll('button[data-cancel-ticket]').forEach(btn => {
    btn.addEventListener('click', () => cancelEditTicket(btn.dataset.cancelTicket));
  });
}

async function updateEstado(id, estado) {
  try {
    const res = await fetch(`${API_URL}/tickets/${id}/estado`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': token ? `Bearer ${token}` : ''
      },
      body: JSON.stringify({ estado })
    });
    const data = await res.json();
    if (!res.ok) alert(data.error || 'Error al cambiar estado');
    loadTickets();
  } catch (err) {
    console.error(err);
  }
}

async function loadComentarios(ticketId) {
  try {
    const res = await fetch(`${API_URL}/tickets/${ticketId}/comentarios`, {
      headers: { 'Authorization': token ? `Bearer ${token}` : '' }
    });
    const data = await res.json();
    const cont = $(`comentarios-${ticketId}`);
    cont.innerHTML = `
      <h5>Comentarios</h5>
      <ul>${data.map(c => {
        const canDelete = currentUser && (currentUser.rol === 'admin' || currentUser.id === c.autor_id);
        return `<li><b>${c.autor_nombre || c.autor_id}:</b> ${c.contenido} ${canDelete ? `<button data-del-comment="${c.id}" data-ticket="${ticketId}">Eliminar</button>` : ''}</li>`;
      }).join('')}</ul>
      <input id="new-comment-${ticketId}" placeholder="Escribe un comentario" />
      <button id="btn-comment-${ticketId}">Agregar</button>
    `;
    document.getElementById(`btn-comment-${ticketId}`).addEventListener('click', async () => {
      const contenido = document.getElementById(`new-comment-${ticketId}`).value;
      try {
        const res2 = await fetch(`${API_URL}/tickets/${ticketId}/comentarios`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': token ? `Bearer ${token}` : ''
          },
          body: JSON.stringify({ contenido })
        });
        const data2 = await res2.json();
        if (!res2.ok) alert(data2.error || 'Error al agregar comentario');
        loadComentarios(ticketId);
      } catch (err) {
        console.error(err);
      }
    });
    cont.querySelectorAll('button[data-del-comment]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const cid = btn.getAttribute('data-del-comment');
        const tid = btn.getAttribute('data-ticket');
        if (!confirm('¿Eliminar comentario?')) return;
        try {
          const res3 = await fetch(`${API_URL}/tickets/${tid}/comentarios/${cid}`, {
            method: 'DELETE',
            headers: { 'Authorization': token ? `Bearer ${token}` : '' }
          });
          const data3 = await res3.json();
          if (!res3.ok) alert(data3.error || 'Error al eliminar comentario');
          loadComentarios(ticketId);
        } catch (err) { console.error(err); }
      });
    });
  } catch (err) {
    console.error(err);
  }
}

document.getElementById('btnLogout')?.addEventListener('click', () => {
  token = null;
  currentUser = null;
  statusEl.textContent = '';
  document.getElementById('btnLogout').style.display = 'none';
  document.getElementById('nuevo-ticket').style.display = 'none';
  document.getElementById('tickets-section').style.display = 'none';
  document.getElementById('equipos-list').style.display = 'none';
  document.getElementById('menu').style.display = 'none';
  document.getElementById('app-layout').style.display = 'none';
  document.getElementById('dashboard').style.display = 'none';
  try { localStorage.removeItem('bioherts_token'); } catch {}
  document.getElementById('login').style.display = 'flex';
});

document.getElementById('btnIrTickets')?.addEventListener('click', () => {
  document.getElementById('menu').style.display = 'none';
  document.getElementById('equipos-list').style.display = 'none';
  document.getElementById('nuevo-ticket').style.display = 'block';
  document.getElementById('tickets-section').style.display = 'block';
  offset = 0;
  loadTickets();
});

document.getElementById('btnIrEquipos')?.addEventListener('click', () => {
  document.getElementById('menu').style.display = 'none';
  document.getElementById('nuevo-ticket').style.display = 'none';
  document.getElementById('tickets-section').style.display = 'none';
  document.getElementById('equipos-list').style.display = 'block';
  eqOffset = 0;
  loadEquipos();
});

document.querySelector('.logo')?.addEventListener('click', () => {
  if (!token) return;
  document.getElementById('nuevo-ticket').style.display = 'none';
  document.getElementById('tickets-section').style.display = 'none';
  document.getElementById('equipos-list').style.display = 'none';
  document.getElementById('menu').style.display = 'none';
  document.getElementById('app-layout').style.display = 'grid';
  document.getElementById('dashboard').style.display = 'block';
  loadDashboard();
});

document.getElementById('navDashboard')?.addEventListener('click', () => {
  if (!token) return;
  document.getElementById('menu').style.display = 'none';
  document.getElementById('nuevo-ticket').style.display = 'none';
  document.getElementById('tickets-section').style.display = 'none';
  document.getElementById('equipos-list').style.display = 'none';
  document.getElementById('clientes-section').style.display = 'none';
  document.getElementById('settings').style.display = 'none';
  document.getElementById('dashboard').style.display = 'block';
  loadDashboard();
});

document.getElementById('navTickets')?.addEventListener('click', () => {
  if (!token) return;
  document.getElementById('dashboard').style.display = 'none';
  document.getElementById('settings').style.display = 'none';
  document.getElementById('clientes-section').style.display = 'none';
  document.getElementById('equipos-list').style.display = 'none';
  document.getElementById('nuevo-ticket').style.display = 'block';
  document.getElementById('tickets-section').style.display = 'block';
  offset = 0;
  loadTickets();
});

document.getElementById('navEquipos')?.addEventListener('click', () => {
  if (!token) return;
  document.getElementById('dashboard').style.display = 'none';
  document.getElementById('nuevo-ticket').style.display = 'none';
  document.getElementById('tickets-section').style.display = 'none';
  document.getElementById('settings').style.display = 'none';
  document.getElementById('clientes-section').style.display = 'none';
  document.getElementById('equipos-list').style.display = 'block';
  eqOffset = 0;
  loadEquipos();
  refreshClienteSelect();
});

document.getElementById('navClientes')?.addEventListener('click', () => {
  if (!token) return;
  document.getElementById('dashboard').style.display = 'none';
  document.getElementById('nuevo-ticket').style.display = 'none';
  document.getElementById('tickets-section').style.display = 'none';
  document.getElementById('equipos-list').style.display = 'none';
  document.getElementById('menu').style.display = 'none';
  document.getElementById('settings').style.display = 'none';
  document.getElementById('clientes-section').style.display = 'block';
  const f = document.getElementById('cliente-form'); if (f) f.style.display = 'none';
  loadClientes();
});

async function loadClientes() {
  try {
    const res = await fetch(`${API_URL}/clientes?limit=50&offset=0`, {
      headers: { 'Authorization': token ? `Bearer ${token}` : '' }
    });
    let list;
    try { list = await res.json(); } catch { list = []; }
    const cont = document.getElementById('clientes');
    if (!res.ok) {
      const ct = document.getElementById('clientes-total'); if (ct) ct.textContent = '';
      cont.innerHTML = '<div class="muted">Error al cargar clientes</div>';
      return;
    }
    if (!Array.isArray(list)) { cont.innerHTML = '<div class="muted">Sin clientes</div>'; return; }
    const html = list.map(c => {
      const nombre = c.nombre || '—';
      const empresa = c.empresa || '—';
      return `<div class="ticket-card"><div class="card-header"><h3>${nombre}</h3><span class="muted">${empresa}</span></div></div>`;
    }).join('');
    cont.innerHTML = html || '<div class="muted">Sin clientes</div>';
    const ct = document.getElementById('clientes-total'); if (ct) ct.textContent = `Total: ${list.length}`;
    await refreshClienteSelect(list);
  } catch (err) { console.error(err); }
}

async function refreshClienteSelect(list) {
  try {
    const sel = document.getElementById('eq-cliente-id');
    if (!sel) return;
    const data = Array.isArray(list) ? list : (await (await fetch(`${API_URL}/clientes?limit=200&offset=0`, { headers: { 'Authorization': token ? `Bearer ${token}` : '' } })).json());
    sel.innerHTML = `<option value="">Cliente</option>` + data.map(c => `<option value="${c.id}">${c.nombre || c.empresa || ('Cliente ' + c.id)}</option>`).join('');
  } catch (err) { console.error(err); }
}

document.getElementById('btnCrearCliente')?.addEventListener('click', async () => {
  const nombre = document.getElementById('cli-nombre').value;
  const empresa = document.getElementById('cli-empresa').value;
  try {
    console.log('BTN crear cliente click', { nombre, empresa, API_URL });
    const res = await fetch(`${API_URL}/clientes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': token ? `Bearer ${token}` : ''
      },
      body: JSON.stringify({ nombre: nombre || null, empresa: empresa || null })
    });
    let data = null;
    try { data = await res.json(); } catch {}
    console.log('POST /clientes resp', { ok: res.ok, status: res.status, data });
    if (!res.ok) { alert((data && data.error) || 'Error al crear cliente'); return; }
    document.getElementById('cli-nombre').value = '';
    document.getElementById('cli-empresa').value = '';
    loadClientes();
  } catch (err) { console.error(err); }
});

async function loadEquipos() {
  try {
    const params = new URLSearchParams({ limit: String(eqPageSize), offset: String(eqOffset) });
    const estado = document.getElementById('eq-filtro-estado')?.value || '';
    const q = document.getElementById('eq-filtro-q')?.value || '';
    const marca = document.getElementById('eq-filtro-marca')?.value || '';
    const aplicacion = document.getElementById('eq-filtro-aplicacion')?.value || '';
    const modelo = document.getElementById('eq-filtro-modelo')?.value || '';
    const anio = document.getElementById('eq-filtro-anio')?.value || '';
    const serie = document.getElementById('eq-filtro-serie')?.value || '';
    const cliente = document.getElementById('eq-filtro-cliente')?.value || '';
    if (estado) params.set('estado', estado);
    if (q) params.set('q', q);
    if (marca) params.set('marca', marca);
    if (aplicacion) params.set('aplicacion', aplicacion);
    if (modelo) params.set('modelo', modelo);
    if (anio) params.set('anio_venta', anio);
    if (serie) params.set('serie', serie);
    if (cliente) params.set('cliente', cliente);
    const res = await fetch(`${API_URL}/equipos?${params.toString()}`, {
      headers: { 'Authorization': token ? `Bearer ${token}` : '' }
    });
    const data = await res.json();
    equiposEl.innerHTML = data.map(e => `
      <div class="card">
        <h4>${e.nombre}</h4>
        <div>${e.marca || ''} ${e.modelo || ''}</div>
        <div>${e.numero_serie || ''}</div>
        <div>${e.ubicacion || ''}</div>
        <div>${e.aplicacion || ''} ${e.cliente ? '• ' + e.cliente : ''} ${e.anio_venta ? '• ' + e.anio_venta : ''}</div>
        <div><span class="badge ${e.estado === 'activo' ? 'badge-hecho' : 'badge-pendiente'}">${e.estado}</span></div>
        <div class="ticket-actions">
          <button class="btn btn-primary btn-small" data-eq-editar="${e.id}">Editar</button>
          ${currentUser && currentUser.rol === 'admin' ? `<button class="btn btn-danger btn-small" data-eq-eliminar="${e.id}">Eliminar</button>` : ''}
          <button class="btn btn-secondary btn-small" data-eq-mants="${e.id}">Mantenciones</button>
        </div>
        <div id="edit-equipo-${e.id}" style="display:none; margin-top:8px;">
          <input class="input" id="ee-nombre-${e.id}" placeholder="Nombre" value="${e.nombre || ''}" />
          <input class="input" id="ee-marca-${e.id}" placeholder="Marca" value="${e.marca || ''}" />
          <input class="input" id="ee-modelo-${e.id}" placeholder="Modelo" value="${e.modelo || ''}" />
          <input class="input" id="ee-numero-${e.id}" placeholder="N° serie" value="${e.numero_serie || ''}" />
          <input class="input" id="ee-ubicacion-${e.id}" placeholder="Ubicación" value="${e.ubicacion || ''}" />
          <select class="input select" id="ee-estado-${e.id}">
            <option value="activo" ${e.estado === 'activo' ? 'selected' : ''}>Activo</option>
            <option value="inactivo" ${e.estado === 'inactivo' ? 'selected' : ''}>Inactivo</option>
          </select>
          <input class="input" id="ee-aplicacion-${e.id}" placeholder="Aplicación" value="${e.aplicacion || ''}" />
          <input class="input" id="ee-cliente-${e.id}" placeholder="Cliente" value="${e.cliente || ''}" />
          <input class="input" id="ee-anio-${e.id}" type="number" placeholder="Año venta" value="${e.anio_venta ?? ''}" />
          <button class="btn btn-primary btn-small" data-eq-save="${e.id}">Guardar</button>
          <button class="btn btn-ghost btn-small" data-eq-cancel="${e.id}">Cancelar</button>
        </div>
        <div id="mants-equipo-${e.id}" style="display:none; margin-top:8px;">
          <div id="mants-list-${e.id}"></div>
          <div style="display:flex; gap:6px; align-items:center; margin-top:6px; flex-wrap:wrap;">
            <input class="input" id="man-fecha-${e.id}" type="date" />
            <input class="input" id="man-trabajo-${e.id}" placeholder="Trabajo" />
            <input class="input" id="man-nota-${e.id}" placeholder="Nota" />
            <button class="btn btn-success btn-small" data-man-add="${e.id}">Agregar</button>
          </div>
        </div>
      </div>
    `).join('');
    bindEquipoActions();
    statusEl.textContent = `Equipos cargados: ${data.length} (offset ${eqOffset}, tamaño ${eqPageSize})`;
    try {
      const countQuery = [];
      if (estado) countQuery.push(`estado=${encodeURIComponent(estado)}`);
      if (q) countQuery.push(`q=${encodeURIComponent(q)}`);
      const resCount = await fetch(`${API_URL}/equipos/count${countQuery.length ? `?${countQuery.join('&')}` : ''}`, {
        headers: { 'Authorization': token ? `Bearer ${token}` : '' }
      });
      const countData = await resCount.json();
      totalEquipos = Number(countData.total || 0);
      const totalEl = document.getElementById('equipos-total');
      if (totalEl) totalEl.textContent = `Total: ${totalEquipos}`;
      document.getElementById('eq-btnNext').disabled = eqOffset + eqPageSize >= totalEquipos;
      document.getElementById('eq-btnPrev').disabled = eqOffset <= 0;
    } catch {}
    if (data.length === 0 && eqOffset > 0) {
      eqOffset = Math.max(0, eqOffset - eqPageSize);
      return loadEquipos();
    }
  } catch (err) {
    console.error(err);
  }
}

async function loadDashboard() {
  if (!token || !currentUser) return;
  try {
    const rAssigned = await fetch(`${API_URL}/tickets/count?estado=pendiente&asignado_a=${currentUser.id}`, { headers: { 'Authorization': `Bearer ${token}` } });
    const dAssigned = await rAssigned.json();
    const rTickets = await fetch(`${API_URL}/tickets/count`, { headers: { 'Authorization': `Bearer ${token}` } });
    const dTickets = await rTickets.json();
    const rEquipos = await fetch(`${API_URL}/equipos/count`, { headers: { 'Authorization': `Bearer ${token}` } });
    const dEquipos = await rEquipos.json();
    const ac = document.getElementById('assigned-count');
    const tc = document.getElementById('total-tickets-count');
    const ec = document.getElementById('total-equipos-count');
    if (ac) ac.textContent = String(Number(dAssigned.total || 0));
    if (tc) tc.textContent = String(Number(dTickets.total || 0));
    if (ec) ec.textContent = String(Number(dEquipos.total || 0));
  } catch {}
  try {
    const res = await fetch(`${API_URL}/tickets?estado=pendiente&asignado_a=${currentUser.id}&limit=50&offset=0`, { headers: { 'Authorization': `Bearer ${token}` } });
    const list = await res.json();
    const cont = document.getElementById('assigned-list');
    if (cont) {
      cont.innerHTML = '';
      list.forEach(t => {
        const div = document.createElement('div');
        div.className = 'ticket-card pendiente';
        div.innerHTML = `<div class="ticket-header"><h3>${t.titulo}</h3><span class="badge badge-pendiente">pendiente</span></div><p class="ticket-desc">${t.descripcion || ''}</p><div class="ticket-meta">Creado por: ${t.creado_por_nombre || t.creado_por || ''}</div>`;
        cont.appendChild(div);
      });
    }
  } catch {}
}

function connectSocket() {
  try {
    socket = io(API_URL, { transports: ['websocket'] });
    socket.on('connect', () => {
      statusEl.textContent = 'Conectado en tiempo real';
    });
    socket.on('disconnect', () => {
      statusEl.textContent = 'Desconectado, intentando reconectar...';
    });

    socket.on('ticket:created', () => loadTickets());
    socket.on('ticket:updated', () => loadTickets());
    socket.on('ticket:comment_added', () => loadTickets());
    socket.on('ticket:deleted', () => loadTickets());
    socket.on('equipo:created', () => loadEquipos());
    socket.on('equipo:updated', () => loadEquipos());
    socket.on('equipo:deleted', () => loadEquipos());
  } catch (err) {
    console.error('No se pudo establecer socket, se usará polling');
    // Fallback: recargar periódicamente
    setInterval(loadTickets, 5000);
    setInterval(loadEquipos, 10000);
  }
}

document.getElementById('btnCrearEquipo')?.addEventListener('click', async () => {
  const nombre = document.getElementById('eq-nombre').value;
  const marca = document.getElementById('eq-marca').value;
  const modelo = document.getElementById('eq-modelo').value;
  const numero_serie = document.getElementById('eq-numero_serie').value;
  const ubicacion = document.getElementById('eq-ubicacion').value;
  const aplicacion = document.getElementById('eq-aplicacion').value;
  const cliente = null;
  const cliente_id_val = document.getElementById('eq-cliente-id')?.value || '';
  const anio_venta = document.getElementById('eq-anio_venta').value;
  const estado = document.getElementById('eq-estado').value;
  const manFecha = document.getElementById('eq-man-fecha').value;
  const manTrabajo = document.getElementById('eq-man-trabajo').value;
  const manNota = document.getElementById('eq-man-nota').value;
  try {
    if (!nombre || nombre.trim() === '') {
      alert('Nombre de equipo es obligatorio');
      return;
    }
    if (!['activo','inactivo'].includes(estado)) {
      alert('Estado inválido');
      return;
    }
    if (!cliente_id_val) {
      alert('Debes seleccionar un cliente');
      return;
    }
    const res = await fetch(`${API_URL}/equipos`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': token ? `Bearer ${token}` : ''
      },
      body: JSON.stringify({ nombre, marca, modelo, numero_serie, ubicacion, estado, aplicacion, cliente, cliente_id: cliente_id_val ? Number(cliente_id_val) : undefined, anio_venta: anio_venta ? Number(anio_venta) : undefined, mantenciones: (manFecha || manTrabajo || manNota) ? [{ id: Date.now(), fecha: manFecha || null, trabajo: manTrabajo || '', nota: manNota || '' }] : undefined })
    });
    const data = await res.json();
    if (!res.ok) alert(data.error || 'Error al crear equipo');
    document.getElementById('eq-nombre').value = '';
    document.getElementById('eq-marca').value = '';
    document.getElementById('eq-modelo').value = '';
    document.getElementById('eq-numero_serie').value = '';
    document.getElementById('eq-ubicacion').value = '';
    document.getElementById('eq-estado').value = 'activo';
  document.getElementById('eq-aplicacion').value = '';
  document.getElementById('eq-cliente-id').value = '';
    const selCli = document.getElementById('eq-cliente-id'); if (selCli) selCli.value = '';
    document.getElementById('eq-anio_venta').value = '';
    document.getElementById('eq-man-fecha').value = '';
    document.getElementById('eq-man-trabajo').value = '';
    document.getElementById('eq-man-nota').value = '';
    loadEquipos();
  } catch (err) {
    console.error(err);
  }
});

document.getElementById('eq-btnPrev')?.addEventListener('click', () => {
  eqOffset = Math.max(0, eqOffset - eqPageSize);
  loadEquipos();
});
document.getElementById('eq-btnNext')?.addEventListener('click', () => {
  eqOffset = eqOffset + eqPageSize;
  loadEquipos();
});
document.getElementById('eq-page-size')?.addEventListener('change', (e) => {
  eqPageSize = Number(e.target.value) || 20;
  eqOffset = 0;
  loadEquipos();
});
document.getElementById('eq-filtro-estado')?.addEventListener('change', () => { eqOffset = 0; loadEquipos(); });
document.getElementById('eq-filtro-q')?.addEventListener('input', () => { eqOffset = 0; loadEquipos(); });
document.getElementById('eq-filtro-marca')?.addEventListener('input', () => { eqOffset = 0; loadEquipos(); });
document.getElementById('eq-filtro-aplicacion')?.addEventListener('input', () => { eqOffset = 0; loadEquipos(); });
document.getElementById('eq-filtro-modelo')?.addEventListener('input', () => { eqOffset = 0; loadEquipos(); });
document.getElementById('eq-filtro-anio')?.addEventListener('input', () => { eqOffset = 0; loadEquipos(); });
document.getElementById('eq-filtro-serie')?.addEventListener('input', () => { eqOffset = 0; loadEquipos(); });
document.getElementById('eq-filtro-cliente')?.addEventListener('input', () => { eqOffset = 0; loadEquipos(); });
document.getElementById('eq-btnFiltrar')?.addEventListener('click', () => { eqOffset = 0; loadEquipos(); });
document.getElementById('eq-btnLimpiar')?.addEventListener('click', () => {
  ['eq-filtro-q','eq-filtro-marca','eq-filtro-aplicacion','eq-filtro-modelo','eq-filtro-anio','eq-filtro-serie','eq-filtro-cliente'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  document.getElementById('eq-filtro-estado').value = '';
  eqOffset = 0;
  loadEquipos();
});

function bindEquipoActions() {
  equiposEl.querySelectorAll('button[data-eq-editar]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.eqEditar;
      const cont = document.getElementById(`edit-equipo-${id}`);
      if (cont) cont.style.display = 'block';
    });
  });
  equiposEl.querySelectorAll('button[data-eq-eliminar]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.eqEliminar;
      if (!confirm('¿Eliminar equipo?')) return;
      try {
        const res = await fetch(`${API_URL}/equipos/${id}`, {
          method: 'DELETE',
          headers: { 'Authorization': token ? `Bearer ${token}` : '' }
        });
        const data = await res.json();
        if (!res.ok) alert(data.error || 'Error al eliminar equipo');
        loadEquipos();
      } catch (err) {
        console.error(err);
      }
    });
  });
  equiposEl.querySelectorAll('button[data-eq-save]').forEach(btn => {
    btn.addEventListener('click', () => saveEditEquipo(btn.dataset.eqSave));
  });
  equiposEl.querySelectorAll('button[data-eq-cancel]').forEach(btn => {
    btn.addEventListener('click', () => cancelEditEquipo(btn.dataset.eqCancel));
  });
  equiposEl.querySelectorAll('button[data-eq-mants]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.eqMants;
      const cont = document.getElementById(`mants-equipo-${id}`);
      if (!cont) return;
      const visible = cont.style.display !== 'none';
      cont.style.display = visible ? 'none' : 'block';
      if (!visible) await loadMantenciones(id);
    });
  });
  equiposEl.querySelectorAll('button[data-man-add]').forEach(btn => {
    btn.addEventListener('click', () => addMantencion(btn.dataset.manAdd));
  });
}

async function saveEditEquipo(id) {
  const nombre = document.getElementById(`ee-nombre-${id}`).value;
  const marca = document.getElementById(`ee-marca-${id}`).value;
  const modelo = document.getElementById(`ee-modelo-${id}`).value;
  const numero_serie = document.getElementById(`ee-numero-${id}`).value;
  const ubicacion = document.getElementById(`ee-ubicacion-${id}`).value;
  const estado = document.getElementById(`ee-estado-${id}`).value;
  const aplicacion = document.getElementById(`ee-aplicacion-${id}`).value;
  const cliente = document.getElementById(`ee-cliente-${id}`).value;
  const anio = document.getElementById(`ee-anio-${id}`).value;
  const body = {};
  if (nombre !== '') body.nombre = nombre;
  if (marca !== '') body.marca = marca;
  if (modelo !== '') body.modelo = modelo;
  if (numero_serie !== '') body.numero_serie = numero_serie;
  if (ubicacion !== '') body.ubicacion = ubicacion;
  if (estado !== '') body.estado = estado;
  if (aplicacion !== '') body.aplicacion = aplicacion;
  if (cliente !== '') body.cliente = cliente;
  if (anio !== '') body.anio_venta = Number(anio);
  try {
    const res = await fetch(`${API_URL}/equipos/${id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': token ? `Bearer ${token}` : ''
      },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok) alert(data.error || 'Error al actualizar equipo');
    cancelEditEquipo(id);
    loadEquipos();
  } catch (err) {
    console.error(err);
  }
}

async function loadMantenciones(id) {
  try {
    const res = await fetch(`${API_URL}/equipos/${id}/mantenciones`, { headers: { 'Authorization': token ? `Bearer ${token}` : '' } });
    const list = await res.json();
    const cont = document.getElementById(`mants-list-${id}`);
    cont.innerHTML = `<ul>${(list || []).map(m => `<li>${m.fecha || ''} • ${m.trabajo || ''} ${m.nota ? '— ' + m.nota : ''} <button class="btn btn-ghost btn-small" data-man-del="${m.id}" data-eq="${id}">Eliminar</button> <button class="btn btn-primary btn-small" data-man-edit="${m.id}" data-eq="${id}">Editar</button></li>`).join('')}</ul>`;
    cont.querySelectorAll('button[data-man-del]').forEach(b => {
      b.addEventListener('click', async () => {
        const mid = b.getAttribute('data-man-del');
        const eq = b.getAttribute('data-eq');
        if (!confirm('¿Eliminar mantención?')) return;
        await fetch(`${API_URL}/equipos/${eq}/mantenciones/${mid}`, { method: 'DELETE', headers: { 'Authorization': token ? `Bearer ${token}` : '' } });
        loadMantenciones(eq);
      });
    });
    cont.querySelectorAll('button[data-man-edit]').forEach(b => {
      b.addEventListener('click', async () => {
        const mid = b.getAttribute('data-man-edit');
        const eq = b.getAttribute('data-eq');
        const fecha = prompt('Fecha (YYYY-MM-DD)');
        const trabajo = prompt('Trabajo');
        const nota = prompt('Nota');
        await fetch(`${API_URL}/equipos/${eq}/mantenciones/${mid}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
          body: JSON.stringify({ fecha, trabajo, nota })
        });
        loadMantenciones(eq);
      });
    });
  } catch (err) { console.error(err); }
}

async function addMantencion(id) {
  try {
    const fecha = document.getElementById(`man-fecha-${id}`).value;
    const trabajo = document.getElementById(`man-trabajo-${id}`).value;
    const nota = document.getElementById(`man-nota-${id}`).value;
    const res = await fetch(`${API_URL}/equipos/${id}/mantenciones`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
      body: JSON.stringify({ fecha, trabajo, nota })
    });
    if (!res.ok) {
      const d = await res.json();
      alert(d.error || 'Error al agregar mantención');
      return;
    }
    document.getElementById(`man-fecha-${id}`).value = '';
    document.getElementById(`man-trabajo-${id}`).value = '';
    document.getElementById(`man-nota-${id}`).value = '';
    loadMantenciones(id);
  } catch (err) { console.error(err); }
}

function cancelEditEquipo(id) {
  const cont = document.getElementById(`edit-equipo-${id}`);
  if (cont) cont.style.display = 'none';
}

function buildQueryFromFilters() {
  const estado = document.getElementById('filtro-estado')?.value || '';
  const asignado = document.getElementById('filtro-asignado-select')?.value || '';
  const q = document.getElementById('filtro-q')?.value || '';
  const params = new URLSearchParams();
  if (estado) params.set('estado', estado);
  if (asignado) params.set('asignado_a', asignado);
  if (q) params.set('q', q);
  return params.toString();
}

document.getElementById('btnFiltrar')?.addEventListener('click', () => loadTickets());
document.getElementById('btnLimpiar')?.addEventListener('click', () => {
  document.getElementById('filtro-estado').value = '';
  const sel = document.getElementById('filtro-asignado-select');
  if (sel) sel.value = '';
  document.getElementById('filtro-q').value = '';
  offset = 0;
  loadTickets();
});

async function loadUsers() {
  try {
    const res = await fetch(`${API_URL}/auth/users`, { headers: { 'Authorization': token ? `Bearer ${token}` : '' } });
    const users = await res.json();
    const asignadoSel = document.getElementById('asignado-select');
    const filtroAsignadoSel = document.getElementById('filtro-asignado-select');
    if (asignadoSel) {
      asignadoSel.innerHTML = `<option value="">Asignar responsable (opcional)</option>` + users.map(u => `<option value="${u.id}">${u.nombre}</option>`).join('');
    }
    if (filtroAsignadoSel) {
      filtroAsignadoSel.innerHTML = `<option value="">Asignado: Todos</option>` + users.map(u => `<option value="${u.id}">${u.nombre}</option>`).join('');
    }
  } catch (err) {
    console.error('No se pudieron cargar usuarios', err);
  }
}

document.getElementById('btnPrev')?.addEventListener('click', () => {
  offset = Math.max(0, offset - pageSize);
  loadTickets();
});
document.getElementById('btnNext')?.addEventListener('click', () => {
  offset = offset + pageSize;
  loadTickets();
});
document.getElementById('page-size')?.addEventListener('change', (e) => {
  pageSize = Number(e.target.value) || 20;
  offset = 0;
  loadTickets();
});

async function editTicket(id) {
  const cont = document.getElementById(`edit-ticket-${id}`);
  if (cont) cont.style.display = 'block';
}

async function deleteTicket(id) {
  if (!confirm('¿Eliminar ticket?')) return;
  try {
    const res = await fetch(`${API_URL}/tickets/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': token ? `Bearer ${token}` : '' }
    });
    const data = await res.json();
    if (!res.ok) alert(data.error || 'Error al eliminar');
    loadTickets();
  } catch (err) {
    console.error(err);
  }
}

async function saveEditTicket(id) {
  const titulo = document.getElementById(`et-titulo-${id}`).value;
  const descripcion = document.getElementById(`et-descripcion-${id}`).value;
  const asignadoVal = document.getElementById(`et-asignado-${id}`).value;
  const equipoVal = document.getElementById(`et-equipo-${id}`).value;
  const body = {};
  if (titulo !== '') body.titulo = titulo;
  if (descripcion !== '') body.descripcion = descripcion;
  if (asignadoVal === '') {
    // mantener
  } else if (asignadoVal.toLowerCase() === 'null') {
    body.asignado_a = null;
  } else {
    body.asignado_a = Number(asignadoVal);
  }
  if (equipoVal === '') {
    // mantener
  } else if (equipoVal.toLowerCase() === 'null') {
    body.equipo_id = null;
  } else {
    body.equipo_id = Number(equipoVal);
  }
  try {
    const res = await fetch(`${API_URL}/tickets/${id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': token ? `Bearer ${token}` : ''
      },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok) alert(data.error || 'Error al actualizar');
    cancelEditTicket(id);
    loadTickets();
  } catch (err) {
    console.error(err);
  }
}

function cancelEditTicket(id) {
  const cont = document.getElementById(`edit-ticket-${id}`);
  if (cont) cont.style.display = 'none';
}

// Auto login via localStorage
try {
  const saved = localStorage.getItem('bioherts_token');
  if (saved) {
    token = saved;
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      currentUser = { id: payload.id, nombre: payload.nombre, rol: payload.rol };
      statusEl.textContent = `Conectado: ${currentUser.nombre} (${currentUser.rol})`;
      document.getElementById('btnLogout').style.display = 'inline-block';
      document.getElementById('login').style.display = 'none';
      document.getElementById('app-layout').style.display = 'grid';
      document.getElementById('dashboard').style.display = 'block';
      const un = document.getElementById('user-nombre');
      if (un && currentUser && currentUser.nombre) un.querySelector('h1').textContent = currentUser.nombre;
      connectSocket();
      loadUsers();
      refreshClienteSelect();
    } catch {}
  }
} catch {}
async function autoLogin() {
  try {
    const email = 'demo@example.com';
    const password = '123';
    const res = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (res.ok) {
      token = data.token;
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        currentUser = { id: payload.id, nombre: payload.nombre, rol: payload.rol };
        statusEl.textContent = `Conectado: ${currentUser.nombre} (${currentUser.rol})`;
        document.getElementById('btnLogout').style.display = 'inline-block';
      } catch {}
      document.getElementById('menu').style.display = 'block';
      document.getElementById('nuevo-ticket').style.display = 'none';
      document.getElementById('tickets-section').style.display = 'none';
      document.getElementById('equipos-list').style.display = 'none';
      connectSocket();
      loadUsers();
    }
  } catch {}
}
async function updateApiStatus() {
  try {
    const r = await fetch(`${API_URL}/`);
    const j = await r.json();
    if (r.ok) statusEl.textContent = `API ${API_URL} ✓`;
    else statusEl.textContent = `API ${API_URL} ×`;
  } catch {
    statusEl.textContent = `API ${API_URL} ×`;
  }
}

updateApiStatus();
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

renderAvatar();

document.getElementById('btnChangeAvatar')?.addEventListener('click', () => {
  document.getElementById('avatar-file')?.click();
});

document.getElementById('avatar-file')?.addEventListener('change', (e) => {
  const f = e.target.files && e.target.files[0];
  if (!f) return;
  const reader = new FileReader();
  reader.onload = () => {
    try { localStorage.setItem('bioherts_avatar', reader.result); } catch {}
    renderAvatar();
  };
  reader.readAsDataURL(f);
});

document.getElementById('navSettings')?.addEventListener('click', () => {
  if (!token) return;
  document.getElementById('dashboard').style.display = 'none';
  document.getElementById('nuevo-ticket').style.display = 'none';
  document.getElementById('tickets-section').style.display = 'none';
  document.getElementById('equipos-list').style.display = 'none';
  document.getElementById('clientes-section').style.display = 'none';
  document.getElementById('menu').style.display = 'none';
  document.getElementById('settings').style.display = 'block';
});
document.getElementById('toggleClienteForm')?.addEventListener('click', () => {
  const f = document.getElementById('cliente-form');
  if (!f) return;
  f.style.display = f.style.display === 'none' ? 'flex' : 'none';
});
