
const API_URL = 'http://localhost:4000';
let token = '';
let headers = {};
let state = {
    userId: null,
    clientId: null,
    equipoId: null,
    ticketId: null,
    initialCounts: {}
};

async function step(name, fn) {
    process.stdout.write(`[TEST] ${name}... `);
    try {
        await fn();
        console.log('✅ OK');
    } catch (e) {
        console.log('❌ FAIL');
        console.error('   Error:', e.message);
        // Don't exit, try to continue to see other failures
    }
}

async function request(method, path, body = null) {
    const opts = {
        method,
        headers: { 'Content-Type': 'application/json', ...headers }
    };
    if (body) opts.body = JSON.stringify(body);
    
    const res = await fetch(`${API_URL}${path}`, opts);
    const data = await res.json().catch(() => ({}));
    
    if (!res.ok) {
        throw new Error(`${method} ${path} failed: ${res.status} - ${JSON.stringify(data)}`);
    }
    return data;
}

(async () => {
    console.log('🚀 Starting Full System Test for BIOHERTS TICKETS (6-Person Team Scale)\n');

    await step('1. Authentication (Register & Login)', async () => {
        // Register a new user to ensure we have valid credentials
        const email = `testuser_${Date.now()}@test.com`;
        const password = 'password123';
        
        await request('POST', '/auth/register', {
            nombre: 'Test User',
            email,
            password,
            rol: 'admin'
        });

        const data = await request('POST', '/auth/login', { email, password });
        token = data.token;
        headers = { 'Authorization': `Bearer ${token}` };
        
        // Decode token to get user ID
        const payload = JSON.parse(atob(token.split('.')[1]));
        state.userId = payload.id;
        if (!state.userId) throw new Error('User ID not found in token');
    });

    await step('2. Get Initial Dashboard Counts & Config', async () => {
        const t = await request('GET', '/tickets/count');
        const e = await request('GET', '/equipos/count');
        const c = await request('GET', '/clientes/count');
        state.initialCounts = {
            tickets: t.total,
            equipos: e.total,
            clientes: c.total
        };

        // Test Config
        await request('GET', '/auth/config');
        
        // Test Users List (for dropdowns)
        const users = await request('GET', '/auth/users');
        if (!users.find(u => u.id === state.userId)) throw new Error('Current user not found in user list');
    });

    await step('3. Create Client (Customer)', async () => {
        const data = await request('POST', '/clientes', { 
            nombre: 'Empresa Test S.A.', 
            empresa: 'Test Corp' 
        });
        state.clientId = data.id;
        if (!state.clientId) throw new Error('Client ID not returned');
        
        // Verify in list
        const list = await request('GET', '/clientes?q=Empresa Test');
        if (!list.find(c => c.id === state.clientId)) throw new Error('Client not found in list');
    });

    await step('4. Create Equipment (Inventory)', async () => {
        const data = await request('POST', '/equipos', {
            nombre: 'Monitor Cardíaco X1',
            marca: 'BioBrand',
            modelo: 'X1000',
            numero_serie: `SN-${Date.now()}`,
            ubicacion: 'Sala 1',
            estado: 'activo',
            cliente_id: state.clientId
        });
        state.equipoId = data.equipo ? data.equipo.id : data.id;
        if (!state.equipoId) throw new Error('Equipment ID not returned');

        // Verify in list
        const list = await request('GET', `/equipos?q=Monitor`);
        const found = list.find(e => String(e.id) === String(state.equipoId));
        if (!found) {
            console.error('List IDs:', list.map(e => e.id), 'Expected:', state.equipoId);
            throw new Error('Equipment not found in list');
        }
    });

    await step('5. Test Equipment Filters', async () => {
        // Filter by Marca
        const byMarca = await request('GET', '/equipos?marca=BioBrand');
        if (byMarca.length === 0) throw new Error('Filter by Marca failed');
        
        // Filter by Client (Name)
        // Need to get client name first
        const client = await request('GET', `/clientes/${state.clientId}`);
        const clientName = client.nombre.split(' ')[0]; // Use first word to avoid encoding issues/exact match complexity
        const byClient = await request('GET', `/equipos?cliente=${clientName}`);
        
        // Note: Equipment created via API might not have 'cliente' string field populated automatically unless backend does lookup
        // In current db.js implementation, it is NOT populated automatically.
        // So this filter might correctly return empty if 'cliente' field is null.
        if (byClient.length === 0) {
            console.warn('   ⚠️ Warning: Filter by Client returned 0 results (Expected if "cliente" field is not populated by backend on Create)');
        }
    });

    await step('6. Update Client Details', async () => {
        const newName = 'Empresa Test Updated S.A.';
        const data = await request('PATCH', `/clientes/${state.clientId}`, { 
            nombre: newName
        });
        if (data.nombre !== newName) throw new Error('Client name not updated');
        
        // Verify in list
        const list = await request('GET', '/clientes?q=Updated');
        if (!list.find(c => c.id === state.clientId)) throw new Error('Updated client not found in list');

        // Verify Client Equipment List
        const clientEquipments = await request('GET', `/clientes/${state.clientId}/equipos`);
        if (!clientEquipments.find(e => e.id === state.equipoId)) throw new Error('Equipment not found in client equipment list');
    });

    await step('7. Create Ticket (Workflow)', async () => {
        const data = await request('POST', '/tickets', {
            titulo: 'Falla en Monitor',
            descripcion: 'No enciende correctamente',
            asignado_a: state.userId,
            equipo_id: state.equipoId,
            prioridad: 'alta'
        });
        state.ticketId = data.ticket ? data.ticket.id : data.id;
        if (!state.ticketId) throw new Error('Ticket ID not returned');

        // Verify in Dashboard (My Assigned)
        const myTickets = await request('GET', `/tickets?asignado_a=${state.userId}&estado=pendiente`);
        if (!myTickets.find(t => t.id === state.ticketId)) throw new Error('Ticket not found in "My Pending" list');
        
        // Verify Search
        const searchResults = await request('GET', '/tickets?q=Monitor');
        if (!searchResults.find(t => t.id === state.ticketId)) throw new Error('Ticket search failed');
    });

    await step('8. Update Ticket Status & Assignment', async () => {
        // Update Status
        await request('PATCH', `/tickets/${state.ticketId}/estado`, { estado: 'hecho' });
        
        // Update Assignment (Reassign to self or another admin)
        // Since we only created one user in this session, we'll just reassign to same user to test endpoint
        await request('PATCH', `/tickets/${state.ticketId}/asignado`, { asignado_a: state.userId });

        const ticket = await request('GET', `/tickets/${state.ticketId}`);
        if (ticket.estado !== 'hecho') throw new Error('Status update failed');
        if (Number(ticket.asignado_a) !== Number(state.userId)) throw new Error('Assignment update failed');
    });

    await step('9. Add Comment to Ticket', async () => {
        const comment = await request('POST', `/tickets/${state.ticketId}/comentarios`, { contenido: 'Revisión completada.' });
        
        if (comment.comentario.contenido !== 'Revisión completada.') throw new Error('Comment content mismatch');
        state.commentId = comment.comentario.id;

        // Verify comment list
        const comments = await request('GET', `/tickets/${state.ticketId}/comentarios`);
        if (!comments.find(c => c.id === state.commentId)) throw new Error('Comment not found in list');
    });

    await step('9b. Delete Comment', async () => {
        await request('DELETE', `/tickets/${state.ticketId}/comentarios/${state.commentId}`);
        const comments = await request('GET', `/tickets/${state.ticketId}/comentarios`);
        if (comments.find(c => c.id === state.commentId)) throw new Error('Comment was not deleted');
    });

    await step('10. Update Equipment Details & Maintenance', async () => {
        // Update Details
        const newLoc = 'Sala 2';
        await request('PATCH', `/equipos/${state.equipoId}`, { ubicacion: newLoc });
        
        const eq = await request('GET', `/equipos/${state.equipoId}`);
        if (eq.ubicacion !== newLoc) throw new Error('Equipment location update failed');

        // Add Maintenance
        await request('POST', `/equipos/${state.equipoId}/mantenciones`, { 
            fecha: new Date().toISOString(),
            trabajo: 'Limpieza preventiva',
            nota: 'Todo OK'
        });

        const mants = await request('GET', `/equipos/${state.equipoId}/mantenciones`);
        if (!mants.find(m => m.trabajo === 'Limpieza preventiva')) throw new Error('Maintenance record not saved');
    });

    await step('11. Delete Ticket', async () => {
        await request('DELETE', `/tickets/${state.ticketId}`);
        const all = await request('GET', '/tickets');
        if (all.find(x => x.id === state.ticketId)) throw new Error('Ticket not deleted');
    });

    await step('12. Delete Equipment', async () => {
        await request('DELETE', `/equipos/${state.equipoId}`);
        const list = await request('GET', '/equipos');
        if (list.find(x => x.id === state.equipoId)) throw new Error('Equipment not deleted');
    });

    await step('13. Delete Client', async () => {
        await request('DELETE', `/clientes/${state.clientId}`);
        const list = await request('GET', '/clientes');
        if (list.find(x => x.id === state.clientId)) throw new Error('Client not deleted');
    });

    console.log('\n✅ System Test Complete.');

})();
