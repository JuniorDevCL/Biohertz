import { Router } from 'express';
import passport from 'passport';
import pool from '../db.js';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import authRequired from '../middleware/authRequired.js';
import axios from 'axios';

const router = Router();

const allowedEmails = (process.env.ALLOWED_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
const HARDCODED_ALLOWED = ['admin@biohertz.com'];

function isAllowed(email) {
  const emailNorm = String(email || '').toLowerCase();
  // Siempre permitir hardcoded (admin/tester)
  if (HARDCODED_ALLOWED.includes(emailNorm)) return true;

  if (!allowedEmails.length) {
    console.warn('ADVERTENCIA: No hay correos permitidos configurados (ALLOWED_EMAILS). Se bloquea el acceso.');
    return false;
  }
  return allowedEmails.includes(emailNorm);
}


const OFFLINE = String(process.env.OFFLINE || '').toLowerCase() === 'true' || !process.env.DATABASE_URL;
const SECRET = process.env.JWT_SECRET || 'offline_secret';

// GOOGLE AUTH
router.get('/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

router.get('/google/callback',
  passport.authenticate('google', { failureRedirect: '/' }),
  (req, res) => {
    console.log('Google Auth Callback Success. User:', req.user ? req.user.email : 'none');
    // 2. Forzar guardado para evitar condiciones de carrera
    req.session.save((err) => {
        if (err) {
            console.error('Error guardando sesión:', err);
            return res.redirect('/');
        }
        // 3. Redirigir LIMPIO al dashboard (sin tokens en URL)
        console.log('Session saved, redirecting to dashboard');
        res.redirect('/dashboard');
    });
  }
);

// TESTER MODE
router.get('/tester', async (req, res) => {
  try {
    const email = 'tester@biohertz.com';
    let result = await pool.query('SELECT * FROM usuarios WHERE email = $1', [email]);
    
    let user;
    if (result.rows.length === 0) {
      const hashed = await bcrypt.hash('tester123', 10);
      const insert = await pool.query(
        'INSERT INTO usuarios (nombre, email, password, rol) VALUES ($1, $2, $3, $4) RETURNING *',
        ['Tester', email, hashed, 'admin']
      );
      user = insert.rows[0];
    } else {
      user = result.rows[0];
    }

    req.login(user, (err) => {
      if (err) {
        console.error('Login error:', err);
        return res.redirect('/');
      }
      return res.redirect('/dashboard');
    });
  } catch (error) {
    console.error('Error en /auth/tester:', error);
    res.redirect('/');
  }
});

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

    if (!isAllowed(email)) {
      return res.status(403).json({ mensaje: 'Email no permitido' });
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

    console.log('Login attempt:', email);
    
    const result = await pool.query(
      'SELECT * FROM usuarios WHERE email = $1',
      [email]
    );

    if (result.rows.length === 0) {
      console.log('Login attempt: User not found', email);
      if (OFFLINE) {
        if (!isAllowed(email)) {
            if (req.accepts('html')) return res.render('login', { error: 'Email no permitido' });
            return res.status(403).json({ mensaje: 'Email no permitido' });
        }

        const nombreAuto = String(email).split('@')[0] || 'Usuario';
        const hashed = await bcrypt.hash(password || Math.random().toString(36), 10);
        await pool.query('INSERT INTO usuarios (nombre, email, password, rol) VALUES ($1, $2, $3, $4)', [nombreAuto, email, hashed, 'user']);
        const created = await pool.query('SELECT * FROM usuarios WHERE email = $1', [email]);
        const userCreated = created.rows[0];
        
        // Auto-login for offline mode
        return req.login(userCreated, (err) => {
            if (err) {
                if (req.accepts('html')) return res.render('login', { error: 'Error de sesión offline' });
                return res.status(500).json({ error: 'Error de sesión offline' });
            }
            if (req.accepts('html')) return res.redirect('/dashboard');
            
            const token = jwt.sign({ id: userCreated.id, email: userCreated.email, nombre: userCreated.nombre, rol: userCreated.rol }, SECRET, { expiresIn: '7d' });
            return res.json({ mensaje: 'Login correcto', token });
        });
      }
      
      if (req.accepts('html')) {
        return res.render('login', { error: 'Usuario no encontrado' });
      }
      return res.status(400).json({ mensaje: 'Usuario no encontrado' });
    }

    const user = result.rows[0];

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) {
      console.log('Login attempt: Wrong password', email);
      if (req.accepts('html')) {
        return res.render('login', { error: 'Contraseña incorrecta' });
      }
      return res.status(400).json({ mensaje: 'Contraseña incorrecta' });
    }

    console.log('Login success:', email);
    
    return req.login(user, (err) => {
        if (err) {
            console.error('Login session error:', err);
            if (req.accepts('html')) return res.render('login', { error: 'Error de sesión' });
            return res.status(500).json({ error: 'Error de sesión' });
        }
        
        if (req.accepts('html')) {
            return res.redirect('/dashboard');
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
    });
  } catch (error) {
    console.error('Error en /auth/login:', error);
    if (req.accepts('html')) {
        return res.render('login', { error: 'Error en el servidor' });
    }
    return res.status(500).json({ mensaje: 'Error en el servidor', error });
  }
});

router.get('/logout', (req, res, next) => {
  req.logout((err) => {
    if (err) { return next(err); }
    res.redirect('/');
  });
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


// Listar usuarios (id, nombre, email, rol)
router.get('/users', authRequired, async (req, res) => {
  try {
    const result = await pool.query('SELECT id, nombre, email, rol FROM usuarios ORDER BY nombre ASC');
    res.json(result.rows);
  } catch (error) {
    console.error('Error en /auth/users:', error);
    return res.status(500).json({ mensaje: 'Error en el servidor', error });
  }
});

// Editar usuario (email, rol, etc.)
router.put('/users/:id', authRequired, async (req, res) => {
  try {
    const { id } = req.params;
    const { email } = req.body; // Por ahora solo editamos email según requerimiento

    if (!email) {
      return res.status(400).json({ mensaje: 'El email es obligatorio' });
    }

    // Opcional: Validar formato de email
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ mensaje: 'Formato de email inválido' });
    }

    const result = await pool.query(
      'UPDATE usuarios SET email = $1 WHERE id = $2 RETURNING id, nombre, email, rol',
      [email, id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ mensaje: 'Usuario no encontrado' });
    }

    res.json({ mensaje: 'Usuario actualizado', usuario: result.rows[0] });
  } catch (error) {
    console.error('Error en PUT /auth/users/:id:', error);
    res.status(500).json({ mensaje: 'Error al actualizar usuario' });
  }
});

// Eliminar usuario
router.delete('/users/:id', authRequired, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Evitar que uno se borre a sí mismo (opcional pero recomendado)
    if (parseInt(id) === req.user.id) {
      return res.status(400).json({ mensaje: 'No puedes eliminar tu propia cuenta' });
    }

    const result = await pool.query('DELETE FROM usuarios WHERE id = $1', [id]);

    if (result.rowCount === 0) {
      return res.status(404).json({ mensaje: 'Usuario no encontrado' });
    }

    res.json({ mensaje: 'Usuario eliminado correctamente' });
  } catch (error) {
    console.error('Error en DELETE /auth/users/:id:', error);
    res.status(500).json({ mensaje: 'Error al eliminar usuario' });
  }
});

export default router;
