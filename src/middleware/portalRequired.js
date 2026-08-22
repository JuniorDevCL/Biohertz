export default function portalRequired(req, res, next) {
  const portal = req.session && req.session.portalUser;
  if (portal && portal.cliente_id) {
    req.portalUser = portal;
    return next();
  }

  if (req.accepts('html') && !req.accepts('json')) {
    return res.redirect('/portal/login');
  }
  return res.status(401).json({ error: 'Debes iniciar sesión en el portal de clientes' });
}

/** Bloquea sesiones de portal en rutas del staff / APIs internas */
export function blockPortalFromStaff(req, res, next) {
  const portal = req.session && req.session.portalUser;
  const staffOk = req.isAuthenticated && req.isAuthenticated();

  // Solo portal (sin sesión staff): no puede tocar rutas internas
  if (portal && !staffOk) {
    const p = req.path || '';
    const allowed =
      p === '/' ||
      p.startsWith('/portal') ||
      p === '/auth/logout' ||
      p.startsWith('/img') ||
      p.startsWith('/mantenciones/fotos/') ||
      p.startsWith('/theme') ||
      p === '/favicon.ico' ||
      p === '/api/health' ||
      p.startsWith('/socket.io');

    if (!allowed) {
      const wantsJson =
        String(req.headers.accept || '').includes('application/json') ||
        req.xhr ||
        p.startsWith('/api') ||
        p.startsWith('/tickets') ||
        p.startsWith('/equipos') ||
        p.startsWith('/clientes') ||
        p.startsWith('/mantenciones') ||
        p.startsWith('/usuarios') ||
        p.startsWith('/calendario') ||
        p.startsWith('/auth/');

      if (wantsJson) {
        return res.status(403).json({ error: 'Acceso denegado' });
      }
      return res.redirect('/portal');
    }
  }

  return next();
}
