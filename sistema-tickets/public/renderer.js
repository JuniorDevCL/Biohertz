
// =========================================================
// ADMINISTRACIÓN DE USUARIOS
// =========================================================

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
        loadUsers(); // Recargar dropdown de tickets también
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
        loadUsers(); // Recargar dropdown de tickets también
      } else {
        const data = await res.json();
        alert(data.mensaje || 'Error al eliminar');
      }
    } catch (e) { console.error(e); alert('Error de conexión'); }
  }
}
