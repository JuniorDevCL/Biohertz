import express from 'express';
import authRequired from '../middleware/authRequired.js';
import { revisarPalabras } from '../services/ortografia.js';

const router = express.Router();

// Revisa las palabras que el técnico va escribiendo en el informe.
router.post('/', authRequired, async (req, res) => {
  const palabras = Array.isArray(req.body?.palabras) ? req.body.palabras : null;
  if (!palabras) return res.status(400).json({ error: 'palabras requeridas' });
  const limpias = palabras
    .slice(0, 300)
    .map((p) => String(p || '').trim())
    .filter((p) => p && p.length <= 40);
  try {
    res.json({ resultados: await revisarPalabras(limpias) });
  } catch (err) {
    console.error('Error en ortografía:', err);
    res.status(500).json({ error: 'No se pudo revisar la ortografía' });
  }
});

export default router;
