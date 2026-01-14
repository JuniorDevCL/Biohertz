import jwt from 'jsonwebtoken';
const SECRET = process.env.JWT_SECRET || 'offline_secret';

export default function authRequired(req, res, next) {
  if (process.env.NODE_ENV !== 'production') {
    console.log('Auth Middleware Check - isAuthenticated:', req.isAuthenticated && req.isAuthenticated(), 'User:', req.user ? req.user.email : 'none', 'SessionID:', req.sessionID);
  }

  // 1. Support Passport Session (SSR)
  if (req.isAuthenticated && req.isAuthenticated()) {
    return next();
  }

  // 2. Support JWT Bearer Token (API)
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    // If request expects HTML, redirect to login
    if (req.accepts('html')) {
      return res.redirect('/');
    }
    return res.status(401).json({ error: 'Token requerido' });
  }

  const [, token] = authHeader.split(' ');

  try {
    const decoded = jwt.verify(token, SECRET);
    req.user = decoded; // aquí vienen id, email, rol, etc.
    next();
  } catch (err) {
    console.error('Error en authRequired:', err);
    if (req.accepts('html')) {
      return res.redirect('/');
    }
    return res.status(401).json({ error: 'Token inválido' });
  }
}
