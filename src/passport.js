import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import pool from './db.js';

// --- CONFIGURACIÓN DE LISTA BLANCA (Correos Permitidos) ---
const HARDCODED_ALLOWED = [
  'alexis.cruces2122@gmail.com',
  'leslie_vejares@hotmail.com',
  'israel.zamorano@gmail.com'
];

const envAllowed = (process.env.ALLOWED_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
const allowedEmails = [...new Set([...HARDCODED_ALLOWED.map(s => s.toLowerCase()), ...envAllowed])];

function isAllowed(email) {
  if (allowedEmails.length === 0) {
      console.warn('ADVERTENCIA: No hay correos permitidos configurados (ALLOWED_EMAILS). Se bloquea el acceso por defecto.');
      return false;
  }
  return allowedEmails.includes(String(email || '').toLowerCase());
}

passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: '/auth/google/callback',
      proxy: true,
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        const email = profile.emails[0].value;
        const googleId = profile.id;
        const nombre = profile.displayName;

        if (!isAllowed(email)) {
          return done(null, false, { message: 'Email no permitido en el sistema.' });
        }

        let res = await pool.query('SELECT * FROM usuarios WHERE google_id = $1', [googleId]);
        if (res.rows.length > 0) {
          return done(null, res.rows[0]);
        }

        res = await pool.query('SELECT * FROM usuarios WHERE email = $1', [email]);
        if (res.rows.length > 0) {
          const user = res.rows[0];
          await pool.query('UPDATE usuarios SET google_id = $1 WHERE id = $2', [googleId, user.id]);
          user.google_id = googleId;
          return done(null, user);
        }

        const newUserRes = await pool.query(
          'INSERT INTO usuarios (nombre, email, google_id, password, rol) VALUES ($1, $2, $3, $4, $5) RETURNING *',
          [nombre, email, googleId, null, 'user']
        );
        return done(null, newUserRes.rows[0]);
      } catch (err) {
        return done(err, null);
      }
    }
  )
);

passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  try {
    console.log('Passport deserializing user ID:', id);
    const res = await pool.query('SELECT * FROM usuarios WHERE id = $1', [id]);
    if (res.rows.length === 0) {
        console.log('Deserialization failed: User not found');
        return done(null, false);
    }
    console.log('Passport deserialized user:', res.rows[0].email);
    done(null, res.rows[0]);
  } catch (err) {
    console.error('Passport deserialization error:', err);
    done(err, null);
  }
});

export default passport;
