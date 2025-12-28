import jwt from 'jsonwebtoken';
const SECRET = process.env.JWT_SECRET || 'offline_secret';

export default function authRequired(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({ error: 'Token requerido' });
  }

  const [, token] = authHeader.split(' ');

  try {
    const decoded = jwt.verify(token, SECRET);
    req.user = decoded; // aquí vienen id, email, rol, etc.
    next();
  } catch (err) {
    console.error('Error en authRequired:', err);
    return res.status(401).json({ error: 'Token inválido' });
  }
}
