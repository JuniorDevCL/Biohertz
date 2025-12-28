import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import pool from './db.js';

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

        // 1. Buscar usuario por google_id
        let res = await pool.query('SELECT * FROM usuarios WHERE google_id = $1', [googleId]);
        if (res.rows.length > 0) {
          return done(null, res.rows[0]);
        }

        // 2. Buscar usuario por email (si ya existía antes de usar Google)
        res = await pool.query('SELECT * FROM usuarios WHERE email = $1', [email]);
        if (res.rows.length > 0) {
          // Actualizar con google_id
          const user = res.rows[0];
          await pool.query('UPDATE usuarios SET google_id = $1 WHERE id = $2', [googleId, user.id]);
          user.google_id = googleId;
          return done(null, user);
        }

        // 3. Crear nuevo usuario
        // Como viene de Google, no tiene contraseña.
        // Asegurarse de que la DB acepte password NULL o insertar algo dummy.
        // Vamos a intentar insertar NULL si la DB lo permite, o un string vacío.
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
    const res = await pool.query('SELECT * FROM usuarios WHERE id = $1', [id]);
    done(null, res.rows[0]);
  } catch (err) {
    done(err, null);
  }
});

export default passport;
