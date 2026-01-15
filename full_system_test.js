const API_URL = 'http://localhost:4000';

let tokenAdmin = '';
let tokenTechA = '';
let tokenTechB = '';

let adminId = null;
let techAId = null;
let techBId = null;
let clientId = null;
let equipoId = null;
let ticketAId = null;
let ticketBId = null;

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
    } catch (e) {
    }

    const res = await request('POST', '/auth/login', { email, password: 'password123' });
    if (!res.data.token) {
        throw new Error(`No token returned for ${email}`);
    }
    
    const payload = JSON.parse(Buffer.from(res.data.token.split('.')[1], 'base64').toString());
    return { token: res.data.token, id: payload.id };
}

async function run() {
    console.log(`Starting System Test on ${API_URL}`);

    await step('1. Authentication (Admin, TechA, TechB)', async () => {
        const admin = await getAuth('Admin User', 'admin@biohertz.com', 'admin');
        tokenAdmin = admin.token;
        adminId = admin.id;

        const techA = await getAuth('Tech A', 'techa@biohertz.com', 'user');
        tokenTechA = techA.token;
        techAId = techA.id;

        const techB = await getAuth('Tech B', 'techb@biohertz.com', 'user');
        tokenTechB = techB.token;
        techBId = techB.id;
    });

    await step('2. Create Client & Equipment (Admin)', async () => {
        const clientRes = await request('POST', '/clientes', {
            nombre: 'Test Client Ltd',
            email: 'contact@client.com',
            telefono: '123456789',
            direccion: '123 Test St'
        }, tokenAdmin);
        clientId = clientRes.data.id;

        const equipoRes = await request('POST', '/equipos', {
            nombre: 'Test Equipment',
            marca: 'MarcaX',
            modelo: 'ModeloY',
            numero_serie: 'SN-123',
            ubicacion: 'Bodega',
            estado: 'activo',
            cliente_id: clientId
        }, tokenAdmin);
        equipoId = equipoRes.data.equipo.id;
    });

    await step('3. Create Tickets (Admin assigns to A & B)', async () => {
        const resA = await request('POST', '/tickets', {
            titulo: 'Maintenance for Tech A',
            descripcion: 'Routine check',
            asignado_a: techAId,
            tipo: 'mantencion'
        }, tokenAdmin);
        ticketAId = resA.data.ticket.id;

        const resB = await request('POST', '/tickets', {
            titulo: 'Repair for Tech B',
            descripcion: 'Fix broken screen',
            asignado_a: techBId,
            tipo: 'visita_tecnica'
        }, tokenAdmin);
        ticketBId = resB.data.ticket.id;
    });

    await step('4. Verify Dashboard Isolation (Pending Tickets)', async () => {
        const countA = await request('GET', `/tickets/count?asignado_a=${techAId}&estado=pendiente`, null, tokenTechA);
        if (countA.data.total < 1) throw new Error(`Tech A should have at least 1 pending ticket (found ${countA.data.total})`);

        const countB = await request('GET', `/tickets/count?asignado_a=${techBId}&estado=pendiente`, null, tokenTechB);
        if (countB.data.total < 1) throw new Error(`Tech B should have at least 1 pending ticket (found ${countB.data.total})`);
    });

    await step('5. Verify Global Access', async () => {
        const res = await request('GET', `/tickets/${ticketBId}`, null, tokenTechA);
        if (res.data.id !== ticketBId) throw new Error('Tech A could not retrieve Ticket B details');
        console.log('   ✅ Tech A accessed Tech B\'s ticket details');
    });
    
    await step('6. Verify Ticket Codes', async () => {
        const ticketA = (await request('GET', `/tickets/${ticketAId}`, null, tokenAdmin)).data;
        const ticketB = (await request('GET', `/tickets/${ticketBId}`, null, tokenAdmin)).data;
        
        if (!ticketA.codigo.startsWith('M-')) throw new Error(`Ticket A (Mantencion) code should start with M-, got ${ticketA.codigo}`);
        if (!ticketB.codigo.startsWith('V-')) throw new Error(`Ticket B (Visita) code should start with V-, got ${ticketB.codigo}`);
        
        console.log(`   ✅ Codes verified: ${ticketA.codigo}, ${ticketB.codigo}`);
    });

    await step('7. Verify Global Access to Clients and Equipments', async () => {
        const cAdmin = await request('GET', '/clientes/count', null, tokenAdmin);
        const cA = await request('GET', '/clientes/count', null, tokenTechA);
        const cB = await request('GET', '/clientes/count', null, tokenTechB);

        if (cAdmin.data.total !== cA.data.total || cAdmin.data.total !== cB.data.total) {
            throw new Error('Clients count differs between users');
        }

        const eAdmin = await request('GET', '/equipos/count', null, tokenAdmin);
        const eA = await request('GET', '/equipos/count', null, tokenTechA);
        const eB = await request('GET', '/equipos/count', null, tokenTechB);

        if (eAdmin.data.total !== eA.data.total || eAdmin.data.total !== eB.data.total) {
            throw new Error('Equipments count differs between users');
        }
    });
}

run();
