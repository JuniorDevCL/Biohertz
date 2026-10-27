/**
 * Revisión ortográfica estilo teclado de celular para los textos del informe.
 * Usa el diccionario Hunspell de español de Chile y ordena las sugerencias
 * dando prioridad a los errores típicos al escribir rápido: tildes, ñ y
 * confusiones de sonido (s/c/z, b/v, ll/y, h muda, cc/x...).
 */
import nspell from 'nspell';
import { CATALOGO_EQUIPOS } from '../../public/catalogo-equipos.js';

// Vocabulario del rubro que no trae el diccionario general.
const VOCABULARIO = [
  'mantención', 'mantenciones', 'ecógrafo', 'ecógrafos', 'ecografía', 'ecografías',
  'firmware', 'software', 'hardware', 'ok', 'backup', 'reset', 'resetear', 'reseteo',
  'reseteó', 'testear', 'testeo', 'testeó', 'chequeo', 'chequeos', 'chequear', 'chequeó',
  'setup', 'display', 'touch', 'mouse', 'led', 'leds', 'usb', 'wifi', 'bluetooth',
  // Términos de ecografía que el diccionario general convierte en otra palabra.
  'preset', 'presets', 'probe', 'probes', 'leads', 'open', 'restore', 'broken',
  'photo', 'phase', 'cardiac', 'liver', 'echo', 'android',
  'transductor', 'transductores', 'electrodo', 'electrodos', 'termocupla', 'termocuplas',
  'ultrasonido', 'doppler', 'cardiotocógrafo', 'desfibrilador', 'electrobisturí',
  'autoclave', 'oxímetro', 'saturómetro', 'multímetro', 'tester', 'cooler', 'coolers',
  'fusible', 'fusibles', 'conector', 'conectores', 'trackball', 'teclado', 'pedal',
  'electroestimulador', 'electroterapia', 'tens', 'bipolar', 'monopolar', 'transformador',
  'placa', 'placas', 'pcb', 'mainboard', 'periférico', 'periféricos', 'calibrable',
  'reinstalación', 'reinstaló', 'configuración', 'operatividad', 'funcionalidad',
];

const VOCALES_TILDE = { a: 'á', e: 'é', i: 'í', o: 'ó', u: 'ú' };

// Reemplazos "de sonido": [buscar, poner, costo].
const FONETICOS = [
  ['s', 'c', 0.3], ['s', 'z', 0.3], ['c', 's', 0.3], ['z', 's', 0.3], ['z', 'c', 0.3],
  ['c', 'z', 0.3], ['b', 'v', 0.3], ['v', 'b', 0.3], ['y', 'll', 0.3], ['ll', 'y', 0.3],
  ['j', 'g', 0.3], ['g', 'j', 0.3], ['cc', 'x', 0.3], ['x', 'cc', 0.3], ['cs', 'x', 0.3],
  ['x', 's', 0.35], ['s', 'x', 0.35], ['k', 'c', 0.3], ['k', 'qu', 0.3], ['qu', 'c', 0.3],
  ['cu', 'qu', 0.3], ['c', 'qu', 0.35], ['nb', 'mb', 0.2], ['np', 'mp', 0.2],
  ['r', 'rr', 0.35], ['rr', 'r', 0.35], ['gu', 'g', 0.35], ['g', 'gu', 0.35],
  ['i', 'y', 0.35], ['y', 'i', 0.35],
];

// Una sugerencia con costo <= a este umbral se aplica sola (como el celular).
const UMBRAL_AUTO = 0.45;
const MAX_CACHE = 5000;

let speller = null;
let cargando = null;
const cache = new Map();

export function palabrasVocabulario() {
  const extras = new Set(VOCABULARIO);
  for (const { marca, modelos } of CATALOGO_EQUIPOS) {
    for (const texto of [marca, ...modelos]) {
      for (const w of texto.toLowerCase().match(/\p{L}{2,}/gu) || []) extras.add(w);
    }
  }
  return [...extras];
}

export async function cargarOrtografia() {
  if (speller) return speller;
  if (!cargando) {
    cargando = import('dictionary-es-cl').then(({ default: dic }) => {
      const sp = nspell(dic);
      for (const w of palabrasVocabulario()) sp.add(w);
      speller = sp;
      return sp;
    });
  }
  return cargando;
}

function variantesTilde(word) {
  const out = [];
  for (let i = 0; i < word.length; i += 1) {
    const t = VOCALES_TILDE[word[i]];
    if (t) out.push(word.slice(0, i) + t + word.slice(i + 1));
    if (word[i] === 'n') out.push(word.slice(0, i) + 'ñ' + word.slice(i + 1));
    if (word[i] === 'u' && 'gq'.includes(word[i - 1] || '')) {
      out.push(word.slice(0, i) + 'ü' + word.slice(i + 1));
    }
  }
  return out;
}

function variantesFoneticas(word) {
  const out = [];
  for (const [de, a, costo] of FONETICOS) {
    let idx = word.indexOf(de);
    while (idx !== -1) {
      out.push([word.slice(0, idx) + a + word.slice(idx + de.length), costo]);
      idx = word.indexOf(de, idx + 1);
    }
  }
  // h muda que falta o sobra: al inicio o entre vocales (ubo -> hubo, ahhora -> ahora).
  // No se toca la h de "ph"/"th" ("photo", "phase"), porque no es la h muda del español.
  out.push(['h' + word, 0.3]);
  if (word.startsWith('h')) out.push([word.slice(1), 0.3]);
  for (let i = 1; i < word.length; i += 1) {
    if (/[aeiou]/.test(word[i - 1]) && /[aeiou]/.test(word[i])) {
      out.push([word.slice(0, i) + 'h' + word.slice(i), 0.35]);
    }
    if (word[i] === 'h' && /[aeiou]/.test(word[i - 1]) && /[aeiou]/.test(word[i + 1] || '')) {
      out.push([word.slice(0, i) + word.slice(i + 1), 0.3]);
    }
  }
  return out;
}

const VOCALES = new Set(['a', 'e', 'i', 'o', 'u']);

/** true si la sugerencia solo agrega o quita una vocal (equpo -> equipo). */
function cambiaSoloUnaVocal(typed, suggestion) {
  const a = sinMarcas(typed);
  const b = sinMarcas(suggestion);
  if (!a || !b || Math.abs(a.length - b.length) !== 1) return false;
  const [shorter, longer] = a.length < b.length ? [a, b] : [b, a];
  let i = 0;
  let j = 0;
  let extra = '';
  while (i < shorter.length && j < longer.length) {
    if (shorter[i] === longer[j]) {
      i += 1;
      j += 1;
    } else if (!extra) {
      extra = longer[j];
      j += 1;
    } else {
      return false;
    }
  }
  if (!extra) extra = longer.slice(j);
  return extra.length === 1 && VOCALES.has(extra);
}

/**
 * Busca correcciones baratas: hasta dos cambios de tilde/ñ y un cambio de sonido.
 * Devuelve Map palabra -> costo.
 */
function candidatosBaratos(sp, word) {
  const encontrados = new Map();
  const anotar = (w, costo) => {
    if (w === word) return;
    const previo = encontrados.get(w);
    if ((previo === undefined || costo < previo) && sp.correct(w)) encontrados.set(w, costo);
  };
  const conTildes = (base, costoBase) => {
    const nivel1 = variantesTilde(base);
    for (const v of nivel1) {
      anotar(v, costoBase + 0.1);
      for (const v2 of variantesTilde(v)) anotar(v2, costoBase + 0.2);
    }
  };

  conTildes(word, 0);
  for (const [v, costo] of variantesFoneticas(word)) {
    anotar(v, costo);
    conTildes(v, costo);
  }
  return encontrados;
}

function distancia(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 3;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const cur = [i];
    for (let j = 1; j <= b.length; j += 1) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/** Vocabulario del rubro a un error de tipeo: pesa más que el diccionario general. */
function candidatosVocabulario(word) {
  if (word.length < 5) return [];
  return VOCABULARIO
    .filter((v) => distancia(word, v.normalize('NFD').replace(/\p{M}+/gu, '')) === 1)
    .map((w) => ({ w, costo: 0.4 }));
}

function preferencia(w) {
  // Vocabulario técnico primero; luego palabras sin mayúscula obligatoria.
  if (VOCABULARIO.includes(w)) return 0;
  return /^\p{Lu}/u.test(w) ? 2 : 1;
}

function sinMarcas(word) {
  return String(word || '').normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase();
}

// "preset" contiene "reset": la palabra más corta ya está escrita dentro y no es un typo.
function sugerenciaIncrustada(original, sugerida) {
  const a = sinMarcas(original);
  const b = sinMarcas(sugerida);
  return Boolean(a && b && a !== b && a.includes(b));
}

/**
 * Revisa una palabra (en minúsculas o no). Devuelve
 * { correcta, sugerencias: [hasta 3], auto: palabra a aplicar sola | null }.
 */
export function revisarPalabra(sp, palabra) {
  const original = String(palabra || '');
  const word = original.toLowerCase();
  if (word.length < 2 || /[^\p{L}]/u.test(word)) return { correcta: true, sugerencias: [], auto: null };
  if (cache.has(word)) return cache.get(word);

  let resultado;
  const capital = word[0].toUpperCase() + word.slice(1);
  if (sp.correct(word) || sp.correct(original) || sp.correct(capital)) {
    resultado = { correcta: true, sugerencias: [], auto: null };
  } else {
    const baratos = candidatosBaratos(sp, word);
    let lista = [...baratos.entries()].map(([w, costo]) => ({ w, costo }));
    if (!lista.length) lista = candidatosVocabulario(word);
    if (!lista.length) {
      lista = sp.suggest(word).slice(0, 5).map((w, i) => ({ w, costo: 1 + i * 0.01 }));
    }
    lista.sort((a, b) => (a.costo - b.costo)
      || (preferencia(a.w) - preferencia(b.w))
      || (Math.abs(a.w.length - word.length) - Math.abs(b.w.length - word.length)));

    const sugerencias = [];
    for (const { w } of lista) {
      const lower = w.toLowerCase();
      if (!sugerencias.includes(lower)) sugerencias.push(lower);
      if (sugerencias.length === 3) break;
    }

    let auto = null;
    const [primera, segunda] = lista;
    if (primera) {
      const clara = !segunda || segunda.costo > primera.costo
        || preferencia(primera.w) < preferencia(segunda.w);
      // En palabras cortas solo se aplican solas las tildes y la ñ.
      // Las sugerencias del diccionario (costo >= 1) no se aplican solas: Hunspell
      // a menudo propone una única palabra distinta (upgrade → degrade, siemens → sienes).
      const umbral = word.length >= 4 ? UMBRAL_AUTO : 0.2;
      if (primera.costo <= umbral && clara && !sugerenciaIncrustada(word, primera.w)) {
        auto = primera.w.toLowerCase();
      }
      // Un typo de una vocal (equpo -> equipo) sí se aplica. Una sugerencia lejana
      // del diccionario (upgrade -> degrade, siemens -> sienes) no.
      if (
        !auto
        && lista.length === 1
        && word.length >= 5
        && primera.costo > umbral
        && primera.costo < 1.5
        && cambiaSoloUnaVocal(word, primera.w)
        && !sugerenciaIncrustada(word, primera.w)
      ) {
        auto = primera.w.toLowerCase();
      }
    }
    resultado = { correcta: false, sugerencias, auto };
  }

  if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value);
  cache.set(word, resultado);
  return resultado;
}

export async function revisarPalabras(palabras) {
  const sp = await cargarOrtografia();
  const out = {};
  for (const p of palabras) {
    const key = String(p || '').toLowerCase();
    if (key && !(key in out)) out[key] = revisarPalabra(sp, key);
  }
  return out;
}

