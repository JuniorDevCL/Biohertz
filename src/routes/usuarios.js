import express from 'express';
import pool from '../db.js';
import authRequired from '../middleware/authRequired.js';
import bcrypt from 'bcryptjs';

const router = express.Router();

// Middleware de seguridad específico para este router
// Solo permite acceso si el email es alexis.cruces2122@gmail.com
const adminOnly = (req, res, next) => {
    if (req.user && req.user.email === 'alexis.cruces2122@gmail.com') {
        return next();
    }
    return res.status(403).send('Acceso denegado. Solo el administrador principal puede ver esto.');
};

router.use(authRequired);
router.use(adminOnly);

// GET /usuarios - Listar todos los usuarios
router.get('/', async (req, res) => {
    try {
        const users = await pool.query('SELECT id, nombre, email, telefono, rol FROM usuarios ORDER BY id ASC');
        res.render('usuarios', { 
            users: users.rows,
            user: req.user,
            path: '/usuarios'
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Error al cargar usuarios');
    }
});

// GET /usuarios/:id - Obtener un usuario (JSON para modal)
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const users = await pool.query('SELECT id, nombre, email, telefono, rol FROM usuarios WHERE id = $1', [id]);
        if (users.rows.length === 0) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }
        res.json(users.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Error interno' });
    }
});

// POST /usuarios/:id - Actualizar usuario
router.post('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { nombre, email, telefono, rol, password } = req.body;

        if (!nombre || !email || !rol) {
            return res.status(400).json({ error: 'Faltan campos requeridos' });
        }

        // Si se envía password, encriptarla
        if (password && password.trim() !== '') {
            const hashedPassword = await bcrypt.hash(password, 10);
            await pool.query(
                'UPDATE usuarios SET nombre = $1, email = $2, telefono = $3, rol = $4, password = $5 WHERE id = $6',
                [nombre, email, telefono, rol, hashedPassword, id]
            );
        } else {
            // Sin actualizar password
            await pool.query(
                'UPDATE usuarios SET nombre = $1, email = $2, telefono = $3, rol = $4 WHERE id = $5',
                [nombre, email, telefono, rol, id]
            );
        }

        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Error al actualizar usuario' });
    }
});

// DELETE /usuarios/:id - Eliminar usuario
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        // Evitar auto-eliminación (o eliminación del admin principal hardcoded)
        // Primero obtener el usuario a eliminar para ver si es el mismo que está logueado
        // O simplemente comparar ID si lo tuviéramos en req.user
        
        if (String(id) === String(req.user.id)) {
            return res.status(400).json({ error: 'No puedes eliminar tu propio usuario.' });
        }

        // También podemos proteger al admin principal por email
        const targetUserRes = await pool.query('SELECT email FROM usuarios WHERE id = $1', [id]);
        if (targetUserRes.rows.length > 0) {
            const targetEmail = targetUserRes.rows[0].email;
            if (targetEmail === 'alexis.cruces2122@gmail.com') {
                return res.status(403).json({ error: 'No se puede eliminar al administrador principal.' });
            }
        }

        await pool.query('DELETE FROM usuarios WHERE id = $1', [id]);
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Error al eliminar usuario' });
    }
});

export default router;
