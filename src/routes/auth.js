import { Router } from 'express';
import pool from '../db.js';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import authRequired from '../middleware/authRequired.js';
import axios from 'axios';

const router = Router();

const allowedEmails = (process.env.ALLOWED_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
const OFFLINE = String(process.env.OFFLINE || '').toLowerCase() === 'true' || !process.env.DATABASE_URL;
const SECRET = process.env.JWT_SECRET || 'offline_secret';
function isAllowed(email) {
  if (!allowedEmails.length) return true;
  return allowedEmails.includes(String(email || '').toLowerCase());
}


// REGISTER
router.post('/register', async (req, res) => {
  try {
    let { nombre, email, password, rol } = req.body;
    nombre = String(nombre || '').trim();
    email = String(email || '').trim().toLowerCase();
    password = String(password || '').trim();

    if (!nombre || !email || !password) {
      return res.status(400).json({ mensaje: 'Faltan datos' });
    }

    if (!OFFLINE) {
      if (!isAllowed(email)) {
        return res.status(403).json({ mensaje: 'Email no permitido' });
      }
    }

    const hashed = await bcrypt.hash(password, 10);
    const rolFinal = rol || 'user';

    await pool.query(
      'INSERT INTO usuarios (nombre, email, password, rol) VALUES ($1, $2, $3, $4)',
      [nombre, email, hashed, rolFinal]
    );

    return res.json({ mensaje: 'Usuario registrado correctamente' });
  } catch (error) {
    console.error('Error en /auth/register:', error);
    return res.status(500).json({ mensaje: 'Error en el servidor', error });
  }
});

// LOGIN
router.post('/login', async (req, res) => {
  try {
    let { email, password } = req.body;
    email = String(email || '').trim().toLowerCase();
    password = String(password || '').trim();

    const result = await pool.query(
      'SELECT * FROM usuarios WHERE email = $1',
      [email]
    );

    if (result.rows.length === 0) {
      if (OFFLINE) {
        const nombreAuto = String(email).split('@')[0] || 'Usuario';
        const hashed = await bcrypt.hash(password || Math.random().toString(36), 10);
        await pool.query('INSERT INTO usuarios (nombre, email, password, rol) VALUES ($1, $2, $3, $4)', [nombreAuto, email, hashed, 'user']);
        const created = await pool.query('SELECT * FROM usuarios WHERE email = $1', [email]);
        const userCreated = created.rows[0];
        const token = jwt.sign({ id: userCreated.id, email: userCreated.email, nombre: userCreated.nombre, rol: userCreated.rol }, SECRET, { expiresIn: '7d' });
        return res.json({ mensaje: 'Login correcto', token });
      }
      return res.status(400).json({ mensaje: 'Usuario no encontrado' });
    }

    const user = result.rows[0];

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) {
      return res.status(400).json({ mensaje: 'Contraseña incorrecta' });
    }

    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        nombre: user.nombre,
        rol: user.rol
      },
      SECRET,
      { expiresIn: '7d' }
    );

    return res.json({ mensaje: 'Login correcto', token });
  } catch (error) {
    console.error('Error en /auth/login:', error);
    return res.status(500).json({ mensaje: 'Error en el servidor', error });
  }
});

router.get('/config', async (req, res) => {
  try {
    res.json({ googleClientId: process.env.GOOGLE_CLIENT_ID || '' });
  } catch (error) {
    res.json({ googleClientId: '' });
  }
});

router.post('/google', async (req, res) => {
  try {
    const { id_token } = req.body;
    if (!id_token) {
      return res.status(400).json({ mensaje: 'id_token requerido' });
    }
    const ver = await axios.get(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(id_token)}`);
    const p = ver.data || {};
    const email = p.email;
    const email_verified = String(p.email_verified) === 'true';
    const nombre = (p.name || `${p.given_name || ''} ${p.family_name || ''}`.trim() || 'Usuario').trim();

    if (!email || !email_verified || !/@gmail\.com$/i.test(email)) {
      return res.status(400).json({ mensaje: 'Correo no válido' });
    }
    if (!isAllowed(email)) {
      return res.status(403).json({ mensaje: 'Email no permitido' });
    }

    const found = await pool.query('SELECT * FROM usuarios WHERE email = $1', [email]);
    let user;
    if (found.rowCount === 0) {
      const tmpPass = await bcrypt.hash(Math.random().toString(36), 10);
      const ins = await pool.query(
        'INSERT INTO usuarios (nombre, email, password, rol) VALUES ($1, $2, $3, $4) RETURNING *',
        [nombre, email, tmpPass, 'user']
      );
      user = ins.rows[0];
    } else {
      user = found.rows[0];
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, nombre: user.nombre, rol: user.rol },
      SECRET,
      { expiresIn: '7d' }
    );

    return res.json({ mensaje: 'Login Google correcto', token });
  } catch (error) {
    console.error('Error en /auth/google:', error && error.response ? error.response.data : error);
    return res.status(400).json({ mensaje: 'Token de Google inválido' });
  }
});


// Listar usuarios (id, nombre, email)
router.get('/users', authRequired, async (req, res) => {
  try {
    const result = await pool.query('SELECT id, nombre, email FROM usuarios ORDER BY nombre ASC');
    res.json(result.rows);
  } catch (error) {
    console.error('Error en /auth/users:', error);
    return res.status(500).json({ mensaje: 'Error en el servidor', error });
  }
});

export default router;
