
import fs from 'fs';
import { Buffer } from 'buffer';

const API_URL = 'http://localhost:4001';

let tokenAdmin = '';
let tokenTechA = '';
let adminId = null;
let techAId = null;
let clientId = null;
let equipoId = null;
let ticketId = null;

async function step(name, fn) {
    process.stdout.write(`[TEST] ${name}... `);
    try {
        await fn();
        console.log('✅ OK');
    } catch (e) {
        console.log('❌ FAIL');
        console.error('   Error:', e.message);
    }
}

async function request(method, path, body = null, token = null) {
    const opts = {
        method,
        headers: { 
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        }
    };
    if (token) opts.headers['Authorization'] = `Bearer ${token}`;
    if (body) opts.body = JSON.stringify(body);

    const res = await fetch(`${API_URL}${path}`, opts);
    
    const contentType = res.headers.get('content-type');
    if (contentType && contentType.includes('text/csv')) {
         const text = await res.text();
         if (!res.ok) throw new Error(`${method} ${path} failed: ${res.status}`);
         return { data: text, headers: res.headers, isCsv: true };
    }

    const text = await res.text();
    let data = {};
    if (text) {
        try {
            data = JSON.parse(text);
        } catch (e) {
            if (!res.ok) data = { error: text };
        }
    }

    if (!res.ok) {
        throw new Error(`${method} ${path} failed: ${res.status} - ${JSON.stringify(data).substring(0, 200)}`);
    }
    
    return { data, headers: res.headers };
}

async function getAuth(name, email, role) {
    try {
        await request('POST', '/auth/register', { nombre: name, email, password: 'password123', rol: role });
    } catch (e) {}

    const res = await request('POST', '/auth/login', { email, password: 'password123' });
    if (!res.data.token) throw new Error(`No token returned for ${email}`);
    
    const payloadPart = res.data.token.split('.')[1];
    const payload = JSON.parse(Buffer.from(payloadPart, 'base64').toString());
    
    return { token: res.data.token, id: payload.id };
}

async function run() {
    console.log(`Starting Full Functionality Test on ${API_URL}`);

    // 1. Autenticación
    await step('1. Authentication', async () => {
        const admin = await getAuth('Admin User', 'admin_full@biohertz.com', 'admin');
        tokenAdmin = admin.token;
        adminId = admin.id;

        const techA = await getAuth('Tech A', 'techa_full@biohertz.com', 'user');
        tokenTechA = techA.token;
        techAId = techA.id;
    });

    // 2. Crear Cliente y Equipo
    await step('2. Setup Client & Equipment', async () => {
        const clientRes = await request('POST', '/clientes', {
            nombre: 'Full Test Client',
            empresa: 'Full Corp',
            email: 'full@test.com'
        }, tokenAdmin);
        clientId = clientRes.data.id;

        const equipoRes = await request('POST', '/equipos', {
            nombre: 'Full Test Machine',
            cliente_id: clientId
        }, tokenAdmin);
        equipoId = equipoRes.data.id;
    });

    // 3. Crear Ticket
    await step('3. Create Ticket', async () => {
        const res = await request('POST', '/tickets', {
            titulo: 'Ticket Integral',
            descripcion: 'Probando todo',
            tipo: 'visita_tecnica',
            cliente_id: clientId,
            equipo_id: equipoId
        }, tokenAdmin);
        ticketId = res.data.ticket.id;
        console.log(`   [DEBUG] Ticket Created ID: ${ticketId}, ClientID: ${res.data.ticket.cliente_id}`);
        if (!ticketId) throw new Error('Ticket ID not returned');
    });

    // 4. Modificar Ticket (Generar Historial)
    await step('4. Generate History', async () => {
        // Asignar
        console.log(`   [DEBUG] Assigning ticket ${ticketId} to ${techAId}`);
        await request('PATCH', `/tickets/${ticketId}/asignado`, { asignado_a: techAId }, tokenAdmin);
        
        // Cambiar estado
        console.log(`   [DEBUG] Changing status of ${ticketId} to en_proceso`);
        await request('PATCH', `/tickets/${ticketId}/estado`, { estado: 'en_proceso' }, tokenTechA);
    });

    // 5. Verificar Historial
    await step('5. Check History Endpoint', async () => {
        const res = await request('GET', `/tickets/${ticketId}/historial`, null, tokenAdmin);
        const history = res.data;
        console.log('   [DEBUG] History Entries:', JSON.stringify(history, null, 2));
        
        if (!Array.isArray(history)) throw new Error('History is not an array');
        if (history.length < 2) throw new Error(`Expected at least 2 history entries, got ${history.length}`);
        
        // Verificar tipos de cambio
        const hasAsignacion = history.some(h => h.tipo_cambio === 'asignacion');
        const hasEstado = history.some(h => h.tipo_cambio === 'estado');
        
        if (!hasAsignacion) throw new Error('Missing assignment history');
        if (!hasEstado) throw new Error('Missing status history');
    });

    // 6. Comentarios
    await step('6. Comments', async () => {
        await request('POST', `/tickets/${ticketId}/comentarios`, { contenido: 'Probando comentarios' }, tokenTechA);
        const res = await request('GET', `/tickets/${ticketId}/comentarios`, null, tokenAdmin);
        if (res.data.length === 0) throw new Error('Comment not saved');
        if (res.data[0].contenido !== 'Probando comentarios') throw new Error('Comment content mismatch');
    });

    // 7. Tickets en Cliente
    await step('7. Client Tickets View', async () => {
        console.log('   [DEBUG] Fetching Client ID:', clientId);
        const res = await request('GET', `/clientes/${clientId}`, null, tokenAdmin);
        if (!res.data.tickets) throw new Error('Tickets field missing in client details');
        
        const found = res.data.tickets.find(t => t.id === ticketId);
        if (!found) {
             console.log('   [DEBUG] Tickets in client:', res.data.tickets.map(t => ({id: t.id, cliente_id: t.cliente_id})));
             console.log('   [DEBUG] Target Ticket ID:', ticketId);
             throw new Error('Created ticket not found in client ticket list');
        }
    });

    // 8. Exportar CSV
    await step('8. Export CSV', async () => {
        const res = await request('GET', '/tickets/export/csv', null, tokenAdmin);
        if (!res.isCsv) throw new Error('Response is not CSV');
        if (!res.data.includes('Codigo,Titulo,Estado')) throw new Error('CSV missing headers');
        if (!res.data.includes('Ticket Integral')) throw new Error('CSV missing ticket title');
    });

    // 9. Empty State Verification
    await step('9. Empty State Verification', async () => {
        // Create a new ticket with no history or comments
        const res = await request('POST', '/tickets', {
            titulo: 'Empty Ticket',
            descripcion: 'Nothing here',
            tipo: 'mantencion'
        }, tokenAdmin);
        const newTicketId = res.data.ticket.id;

        // Check History (should be empty array or default creation entry if logic exists)
        // My current logic returns fallback creation entry if table is empty? 
        // No, current logic: if history table empty -> check ticket table -> return fallback (asignacion null->null, estado->pendiente)
        // So it won't be empty.
        
        // Check Comments (should be empty array)
        const commentsRes = await request('GET', `/tickets/${newTicketId}/comentarios`, null, tokenAdmin);
        if (!Array.isArray(commentsRes.data)) throw new Error('Comments response is not an array');
        if (commentsRes.data.length !== 0) throw new Error('Comments should be empty for new ticket');
    });
}


run();
