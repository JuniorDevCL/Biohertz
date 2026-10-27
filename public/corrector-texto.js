/**
 * Corrector de los textos libres del informe técnico (motivo, daño, trabajos,
 * observaciones): tildes, ñ, errores frecuentes, espacios y mayúscula inicial.
 * Mientras se escribe actúa como el teclado del celular, apoyado en el
 * diccionario del servidor (src/services/ortografia.js, ruta /ortografia).
 * Solo cambia palabras sin ambigüedad; "esta", "si", "el", "se", etc. quedan
 * como el técnico las escribió salvo en contextos claros.
 * Lo usan views/mantencion_ficha.ejs y views/mantencion_editar_textos.ejs.
 */

function fold(word) {
  return word.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase();
}

// Palabras que siempre se corrigen (minúsculas, sin tildes -> forma correcta).
const PALABRAS = {
  // adverbios y conectores
  tambien: 'también', ademas: 'además', despues: 'después', segun: 'según',
  aqui: 'aquí', alli: 'allí', ahi: 'ahí', asi: 'así', mas: 'más',
  todavia: 'todavía', quizas: 'quizás', jamas: 'jamás', detras: 'detrás',
  atras: 'atrás', traves: 'través', estan: 'están', esten: 'estén',
  dia: 'día', dias: 'días', ningun: 'ningún', algun: 'algún',
  // errores frecuentes
  atravez: 'a través', atraves: 'a través', aveces: 'a veces', osea: 'o sea',
  talvez: 'tal vez', envez: 'en vez', apesar: 'a pesar', deacuerdo: 'de acuerdo',
  porfavor: 'por favor', enbase: 'en base', exelente: 'excelente',
  exelentes: 'excelentes', nesesario: 'necesario', nesesaria: 'necesaria',
  nesesarios: 'necesarios', nesesarias: 'necesarias', nesesita: 'necesita',
  nesesitan: 'necesitan', presicion: 'precisión', funsionamiento: 'funcionamiento',
  funsiona: 'funciona', funsionando: 'funcionando', conecion: 'conexión',
  coneccion: 'conexión', conecciones: 'conexiones', coneciones: 'conexiones',
  desconeccion: 'desconexión', desconecion: 'desconexión', hechar: 'echar',
  ubo: 'hubo', rebision: 'revisión', rebisar: 'revisar', rebisado: 'revisado',
  rebisada: 'revisada', ultimamente: 'últimamente',
  // ñ
  dano: 'daño', danos: 'daños', danado: 'dañado', danada: 'dañada',
  danados: 'dañados', danadas: 'dañadas', senal: 'señal', senales: 'señales',
  ano: 'año', anos: 'años', tamano: 'tamaño', pequeno: 'pequeño',
  pequena: 'pequeña', pequenos: 'pequeños', pequenas: 'pequeñas',
  diseno: 'diseño', manana: 'mañana', companero: 'compañero', espanol: 'español',
  // sustantivos y adjetivos técnicos
  bateria: 'batería', baterias: 'baterías', garantia: 'garantía',
  energia: 'energía', tecnologia: 'tecnología', categoria: 'categoría',
  linea: 'línea', lineas: 'líneas', area: 'área', areas: 'áreas',
  valvula: 'válvula', valvulas: 'válvulas', camara: 'cámara', camaras: 'cámaras',
  modulo: 'módulo', modulos: 'módulos', codigo: 'código', codigos: 'códigos',
  numero: 'número', numeros: 'números', telefono: 'teléfono',
  pagina: 'página', paginas: 'páginas', metodo: 'método', periodo: 'período',
  parametro: 'parámetro', parametros: 'parámetros', termometro: 'termómetro',
  manometro: 'manómetro', oximetro: 'oxímetro', voltimetro: 'voltímetro',
  multimetro: 'multímetro', diametro: 'diámetro', angulo: 'ángulo',
  circulo: 'círculo', vehiculo: 'vehículo', calculo: 'cálculo',
  deposito: 'depósito', proposito: 'propósito', estandar: 'estándar',
  caracter: 'carácter', oxido: 'óxido', liquido: 'líquido', liquidos: 'líquidos',
  solido: 'sólido', humedo: 'húmedo', humeda: 'húmeda', rapido: 'rápido',
  rapida: 'rápida', rapidamente: 'rápidamente', facil: 'fácil', dificil: 'difícil',
  util: 'útil', movil: 'móvil', ultimo: 'último', ultima: 'última',
  ultimos: 'últimos', ultimas: 'últimas', minimo: 'mínimo', minima: 'mínima',
  maximo: 'máximo', maxima: 'máxima', grafico: 'gráfico',
  graficos: 'gráficos', indice: 'índice', vacio: 'vacío', vacia: 'vacía',
  // verbos en imperfecto/condicional
  habia: 'había', habian: 'habían', tenia: 'tenía', tenian: 'tenían',
  podia: 'podía', podian: 'podían', debia: 'debía', debian: 'debían',
  podria: 'podría', podrian: 'podrían', deberia: 'debería', deberian: 'deberían',
  funcionaria: 'funcionaría',
  // pretéritos que no se confunden con presente
  encontro: 'encontró', procedio: 'procedió',
};

// Esdrújulas en -ico: se generan las cuatro formas (o, a, os, as).
const ESDRUJULAS_ICO = [
  'técn', 'eléctr', 'electrón', 'electromecán', 'mecán', 'periód', 'bás',
  'práct', 'hidrául', 'neumát', 'térm', 'ópt', 'lóg', 'automát', 'magnét',
  'fís', 'quím', 'méd', 'clín', 'crít', 'ún', 'específ', 'dinám', 'estát',
  'plást', 'metál', 'acúst', 'analóg', 'electrostát', 'ergonóm', 'ultrasón',
  'diagnóst', 'típ', 'económ', 'electroquirúrg', 'cronológ', 'electrocardiográf',
];
for (const raiz of ESDRUJULAS_ICO) {
  for (const fin of ['ico', 'ica', 'icos', 'icas']) {
    PALABRAS[fold(raiz + fin)] = raiz + fin;
  }
}

// Palabras en -ion que NO llevan tilde (monosílabos por hiato, o marcas del catálogo).
const ION_SIN_TILDE = new Set(['ion', 'guion', 'prion', 'muon', 'pion', 'sion', 'alpinion']);

// Verbos que tras "se" van en pretérito: "se realizo" -> "se realizó".
const PRETERITOS_TRAS_SE = new Set([
  'realizo', 'reviso', 'cambio', 'limpio', 'verifico', 'calibro', 'ajusto',
  'reemplazo', 'instalo', 'detecto', 'constato', 'observo', 'chequeo',
  'reparo', 'desarmo', 'armo', 'conecto', 'desconecto', 'probo', 'soldo',
  'lubrico', 'configuro', 'actualizo', 'midio', 'sustituyo', 'retiro',
  'entrego', 'informo', 'encontro', 'procedio', 'dejo', 'comprobo', 'corrigio',
  'aplico', 'solicito', 'coordino', 'capacito', 'reinstalo', 'formateo',
  'reinicio', 'reseteo', 'testeo', 'fijo', 'agrego', 'diagnostico', 'calculo',
  'energizo', 'desenergizo',
]);

// Después de "esta" estas palabras indican el verbo estar: "esta operativo".
const TRAS_ESTA = new Set([
  'bien', 'mal', 'en', 'ok', 'operativo', 'operativa', 'conectado', 'conectada',
  'desconectado', 'desconectada', 'funcionando', 'apagado', 'apagada',
  'encendido', 'encendida', 'roto', 'rota', 'listo', 'lista', 'dañado',
  'dañada', 'danado', 'danada', 'fallando', 'trabajando', 'calibrado',
  'calibrada', 'descalibrado', 'descalibrada', 'suelto', 'suelta', 'sucio',
  'sucia', 'limpio', 'limpia', 'malo', 'mala', 'quemado', 'quemada',
  'defectuoso', 'defectuosa', 'vencido', 'vencida', 'inoperativo', 'inoperativa',
]);

// Terminaciones de dominio: "biohertz.cl" no es fin de oración.
const DOMINIOS = new Set(['cl', 'com', 'net', 'org', 'io', 'es', 'gob', 'gov', 'edu', 'info']);

// Extensiones de archivo: "estudio.dcm" no es el fin de una oración.
const EXTENSIONES = new Set([
  'pdf', 'jpg', 'jpeg', 'png', 'gif', 'bmp', 'tif', 'tiff', 'webp', 'heic', 'raw', 'svg',
  'dcm', 'zip', 'rar', '7z', 'bin', 'hex', 'bak', 'iso', 'img',
  'doc', 'docx', 'xls', 'xlsx', 'csv', 'txt', 'xml', 'json', 'log', 'cfg', 'dat', 'ini',
  'mp4', 'mov', 'avi', 'mp3', 'wav',
]);

// Abreviaturas tras las que el punto no cierra la oración.
const ABREVIATURAS = new Set([
  'ej', 'aprox', 'etc', 'nro', 'sr', 'sra', 'srta', 'dr', 'dra', 'vol',
  'pag', 'cap', 'ref', 'max', 'min', 'prox', 'av', 'depto', 'mod', 'esp',
]);

function aplicarMayusculas(original, corregida) {
  if (original === original.toUpperCase() && original.length > 1) return corregida.toUpperCase();
  if (original[0] === original[0].toUpperCase()) return corregida[0].toUpperCase() + corregida.slice(1);
  return corregida;
}

function corregirPalabra(word, anterior, siguiente) {
  if (/\d/.test(word)) return word;
  const lower = word.toLowerCase();
  // Si el técnico ya escribió tilde o ñ, no se toca.
  if (fold(word) !== lower) return word;

  if (anterior === 'se' && PRETERITOS_TRAS_SE.has(lower)) {
    return aplicarMayusculas(word, lower.slice(0, -1) + 'ó');
  }
  if (lower === 'esta' && siguiente && (TRAS_ESTA.has(siguiente) || /(ando|iendo)$/.test(siguiente))) {
    return aplicarMayusculas(word, 'está');
  }
  if (Object.prototype.hasOwnProperty.call(PALABRAS, lower) && PALABRAS[lower]) {
    return aplicarMayusculas(word, PALABRAS[lower]);
  }
  if (lower.length >= 5 && lower.endsWith('ion') && !ION_SIN_TILDE.has(lower)) {
    return aplicarMayusculas(word, lower.slice(0, -3) + 'ión');
  }
  return word;
}

function corregirPalabras(text) {
  let cambios = 0;
  // Separa palabras de todo lo demás, dejando correos y URLs intactos.
  const partes = text.split(/(\S*[@/]\S*|[\p{L}\p{N}_]+)/u);
  const esPalabra = (p) => /^[\p{L}]+$/u.test(p);
  const indices = [];
  partes.forEach((p, i) => { if (esPalabra(p)) indices.push(i); });
  indices.forEach((i, k) => {
    const prev = k > 0 ? partes[indices[k - 1]].toLowerCase() : '';
    const next = k + 1 < indices.length ? partes[indices[k + 1]].toLowerCase() : '';
    // Solo cuenta como contexto si entre medio hay solo espacios.
    const entrePrev = k > 0 ? partes.slice(indices[k - 1] + 1, i).join('') : '';
    const entreNext = k + 1 < indices.length ? partes.slice(i + 1, indices[k + 1]).join('') : '';
    const corregida = corregirPalabra(
      partes[i],
      /^ +$/.test(entrePrev) ? prev : '',
      /^ +$/.test(entreNext) ? next : '',
    );
    if (corregida !== partes[i]) cambios += 1;
    partes[i] = corregida;
  });
  return { texto: partes.join(''), cambios };
}

function corregirEspacios(text) {
  return text
    .split('\n')
    .map((linea) => linea
      .replace(/(\S) {2,}/g, '$1 ')
      .replace(/ +([,;:.!?)])/g, '$1')
      .replace(/([,;])(?=[\p{L}])/gu, '$1 ')
      .replace(/(^|[^\p{L}.@/])(\p{L}{2,})\.(\p{L}{2,})(?![\p{L}.@/])/gu, (m, antes, a, b) => (
        DOMINIOS.has(b.toLowerCase()) || EXTENSIONES.has(b.toLowerCase()) ? m : `${antes}${a}. ${b}`
      ))
      .replace(/([¿¡(]) +/g, '$1')
      .replace(/\s+$/, ''))
    .join('\n');
}

function mayusculaInicial(text) {
  let out = '';
  let inicio = true;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inicio && /\p{L}/u.test(ch)) {
      out += ch.toUpperCase();
      inicio = false;
      continue;
    }
    out += ch;
    if (ch === '\n') {
      inicio = true;
    } else if ((ch === '.' || ch === '!' || ch === '?') && /\s/.test(text[i + 1] || '')) {
      const previa = (out.slice(0, -1).match(/[\p{L}]+$/u) || [''])[0].toLowerCase();
      // Iniciales como "S.A." o abreviaturas como "aprox." no cierran la oración.
      if (!(ch === '.' && (previa.length === 1 || ABREVIATURAS.has(previa)))) inicio = true;
    } else if (/\p{L}|\d/u.test(ch)) {
      inicio = false;
    }
  }
  return out;
}

/** Devuelve el texto corregido y cuántas palabras cambiaron. */
export function revisarTexto(value) {
  const raw = String(value ?? '');
  if (!raw.trim()) return { texto: raw, cambios: 0 };
  const { texto, cambios } = corregirPalabras(raw.replace(/\r\n?/g, '\n'));
  return { texto: mayusculaInicial(corregirEspacios(texto)), cambios };
}

export function corregirTexto(value) {
  if (value === undefined || value === null) return value;
  return revisarTexto(value).texto;
}

/* ------------------------------------------------------------------------ */
/* Autocorrector mientras se escribe, como el teclado del celular.          */
/* ------------------------------------------------------------------------ */

const SEPARADOR = /[\s.,;:!?)]/;
const LETRA = /\p{L}/u;

/** Palabra que termina justo antes de `pos` (el separador recién escrito). */
export function palabraAntesDe(value, pos) {
  let fin = pos;
  let inicio = fin;
  while (inicio > 0 && LETRA.test(value[inicio - 1])) inicio -= 1;
  if (inicio === fin) return null;
  // Correos, URLs y palabras con números no se tocan.
  const antes = value[inicio - 1] || '';
  if (/[\p{N}_@/.\-]/u.test(antes) && !(antes === '.' && /\s/.test(value[inicio - 2] || ' '))) return null;
  return { inicio, fin, palabra: value.slice(inicio, fin) };
}

/** Palabra que contiene la posición `pos` (para tocar una palabra y corregirla). */
export function palabraEn(value, pos) {
  let inicio = pos;
  let fin = pos;
  while (inicio > 0 && LETRA.test(value[inicio - 1])) inicio -= 1;
  while (fin < value.length && LETRA.test(value[fin])) fin += 1;
  if (inicio === fin) return null;
  return { inicio, fin, palabra: value.slice(inicio, fin) };
}

/** Indica si la palabra que empieza en `inicio` abre una oración. */
export function esInicioOracion(value, inicio) {
  const antes = value.slice(0, inicio).replace(/[ \t"'¿¡(\-•*]+$/, '');
  if (!antes || antes.endsWith('\n')) return true;
  const ultimo = antes[antes.length - 1];
  if (ultimo === '!' || ultimo === '?') return true;
  if (ultimo !== '.') return false;
  const previa = (antes.slice(0, -1).match(/\p{L}+$/u) || [''])[0].toLowerCase();
  return !(previa.length === 1 || ABREVIATURAS.has(previa));
}

/** Palabra anterior si entre medio solo hay espacios (contexto para "se realizo"). */
function palabraPrevia(value, inicio) {
  const m = value.slice(0, inicio).match(/(\p{L}+) +$/u);
  return m ? m[1].toLowerCase() : '';
}

const IGNORADAS_KEY = 'corrector-ignoradas';
let ignoradas = null;

function palabrasIgnoradas() {
  if (ignoradas) return ignoradas;
  try {
    ignoradas = new Set(JSON.parse(localStorage.getItem(IGNORADAS_KEY) || '[]'));
  } catch {
    ignoradas = new Set();
  }
  return ignoradas;
}

/** Como el celular: si el técnico deshace una corrección, aprende la palabra. */
function aprender(palabra) {
  const set = palabrasIgnoradas();
  set.add(palabra.toLowerCase());
  try {
    localStorage.setItem(IGNORADAS_KEY, JSON.stringify([...set].slice(-500)));
  } catch {}
}

const remotas = new Map();

/** Pregunta al servidor por las palabras; sin conexión devuelve null y solo quedan las reglas locales. */
async function consultar(palabras) {
  const claves = [...new Set(palabras.map((p) => p.toLowerCase()))];
  const faltan = claves.filter((p) => !remotas.has(p));
  if (faltan.length) {
    const pedido = fetch('/ortografia', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ palabras: faltan }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => (d && d.resultados) || null)
      .catch(() => null);
    for (const p of faltan) {
      remotas.set(p, pedido.then((res) => {
        if (!res || !res[p]) remotas.delete(p);
        return res ? res[p] || null : null;
      }));
    }
  }
  const out = {};
  for (const p of claves) out[p] = await remotas.get(p);
  return out;
}

/** Decide la corrección automática de una palabra recién terminada. */
async function correccionPara(value, { inicio, palabra }) {
  const lower = palabra.toLowerCase();
  if (palabra.length < 2 || palabrasIgnoradas().has(lower)) return { auto: null, sugerencias: [] };
  const inicioOracion = esInicioOracion(value, inicio);

  let auto = corregirPalabra(palabra, palabraPrevia(value, inicio), '');
  let sugerencias = [];
  const sigla = palabra === palabra.toUpperCase() && palabra.length <= 5;
  // Una mayúscula a mitad de oración suele ser un nombre propio: solo se sugiere.
  const nombrePropio = !inicioOracion && /^\p{Lu}/u.test(palabra) && palabra !== palabra.toUpperCase();

  if (auto === palabra && !sigla) {
    const r = (await consultar([palabra]))[lower];
    if (r && !r.correcta) {
      sugerencias = r.sugerencias.map((s) => aplicarMayusculas(palabra, s));
      if (r.auto && !nombrePropio) auto = aplicarMayusculas(palabra, r.auto);
    }
  }
  if (inicioOracion && /^\p{Ll}/u.test(auto)) auto = auto[0].toUpperCase() + auto.slice(1);
  return { auto: auto === palabra ? null : auto, sugerencias: sugerencias.filter((s) => s !== auto) };
}

function crearChip(texto, titulo) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'px-2.5 py-1 rounded-lg bg-slate-800 border border-slate-700 text-xs text-slate-100';
  b.textContent = texto;
  if (titulo) b.title = titulo;
  // Que tocar la sugerencia no le quite el foco al campo (no dispara la revisión final).
  b.addEventListener('pointerdown', (e) => e.preventDefault());
  b.addEventListener('mousedown', (e) => e.preventDefault());
  return b;
}

/**
 * Engancha el autocorrector a un campo:
 *  - al terminar cada palabra (espacio o puntuación) corrige tildes, ñ y errores
 *    de tipeo, y pone mayúscula al inicio de la oración;
 *  - bajo el campo muestra sugerencias y la palabra original para deshacer;
 *  - al salir del campo hace una revisión completa con aviso "Deshacer".
 */
export function bindCorrector(el) {
  if (!el || el.dataset.correctorBound === '1') return;
  el.dataset.correctorBound = '1';

  const ui = document.createElement('div');
  const barra = document.createElement('div');
  barra.className = 'flex flex-wrap items-center gap-1.5 mt-1.5 hidden';
  const aviso = document.createElement('div');
  aviso.className = 'flex flex-wrap items-center gap-1.5 text-[11px] text-teal-300 mt-1 hidden';
  ui.append(barra, aviso);
  el.insertAdjacentElement('afterend', ui);

  let respetar = null;
  let turno = 0;

  const ocultarBarra = () => {
    barra.classList.add('hidden');
    barra.innerHTML = '';
  };

  const reemplazar = (inicio, fin, esperado, texto) => {
    if (el.value.slice(inicio, fin) !== esperado) return false;
    el.setRangeText(texto, inicio, fin, 'preserve');
    return true;
  };

  const mostrarBarra = ({ inicio, palabra, original, sugerencias }) => {
    barra.innerHTML = '';
    const fin = inicio + palabra.length;
    if (original) {
      const chip = crearChip(`↶ ${original}`, 'Dejar como lo escribí');
      chip.addEventListener('click', () => {
        if (reemplazar(inicio, fin, palabra, original)) aprender(original);
        ocultarBarra();
      });
      barra.append(chip);
    }
    for (const s of sugerencias.slice(0, 3)) {
      const chip = crearChip(s);
      chip.addEventListener('click', () => {
        reemplazar(inicio, fin, palabra, s);
        ocultarBarra();
      });
      barra.append(chip);
    }
    barra.classList.toggle('hidden', !barra.children.length);
  };

  const alTerminarPalabra = async (pos) => {
    const p = palabraAntesDe(el.value, pos);
    if (!p) return;
    const mio = ++turno;
    const { auto, sugerencias } = await correccionPara(el.value, p);
    if (mio !== turno) return;
    if (auto && reemplazar(p.inicio, p.fin, p.palabra, auto)) {
      // Solo la mayúscula inicial no ofrece deshacer, igual que el celular.
      const soloMayuscula = auto.toLowerCase() === p.palabra.toLowerCase();
      if (soloMayuscula && !sugerencias.length) return ocultarBarra();
      return mostrarBarra({
        inicio: p.inicio, palabra: auto, original: soloMayuscula ? null : p.palabra, sugerencias,
      });
    }
    if (sugerencias.length) return mostrarBarra({ inicio: p.inicio, palabra: p.palabra, sugerencias });
    ocultarBarra();
  };

  const alTocarPalabra = async () => {
    if (el.selectionStart !== el.selectionEnd) return;
    const p = palabraEn(el.value, el.selectionStart);
    if (!p || p.palabra.length < 3 || palabrasIgnoradas().has(p.palabra.toLowerCase())) return ocultarBarra();
    const mio = ++turno;
    const r = (await consultar([p.palabra]))[p.palabra.toLowerCase()];
    if (mio !== turno) return;
    if (!r || r.correcta || !r.sugerencias.length) return ocultarBarra();
    mostrarBarra({
      inicio: p.inicio,
      palabra: p.palabra,
      sugerencias: r.sugerencias.map((s) => aplicarMayusculas(p.palabra, s)),
    });
  };

  el.addEventListener('input', (ev) => {
    if (ev.isComposing) return;
    const pos = el.selectionStart;
    const tipo = ev.inputType || '';
    if (tipo.startsWith('delete')) return;
    if (pos > 0 && SEPARADOR.test(el.value[pos - 1])) alTerminarPalabra(pos - 1);
  });
  // Teclados Android que componen la palabra completa: se revisa al cerrarla.
  el.addEventListener('compositionend', () => {
    const pos = el.selectionStart;
    if (pos > 0 && SEPARADOR.test(el.value[pos - 1])) alTerminarPalabra(pos - 1);
  });
  el.addEventListener('click', alTocarPalabra);

  el.addEventListener('change', async () => {
    turno += 1;
    ocultarBarra();
    if (respetar !== null && el.value === respetar) return;
    const antes = el.value;
    let { texto: despues, cambios } = revisarTexto(antes);
    el.value = despues;

    // Segunda pasada con el diccionario completo del servidor.
    const dudosas = new Map();
    const partes = despues.split(/(\S*[@/]\S*|[\p{L}\p{N}_]+)/u);
    const indices = partes.map((p, i) => (/^\p{L}{2,}$/u.test(p) ? i : -1)).filter((i) => i >= 0);
    const revisables = indices.map((i) => partes[i]).filter((w) => !palabrasIgnoradas().has(w.toLowerCase())
      && !(w === w.toUpperCase() && w.length <= 5));
    if (revisables.length) {
      const res = await consultar(revisables);
      if (el.value !== despues) return;
      for (const i of indices) {
        const w = partes[i];
        const r = res[w.toLowerCase()];
        if (!r || r.correcta || palabrasIgnoradas().has(w.toLowerCase())) continue;
        const enOracion = !esInicioOracion(partes.slice(0, i).join(''), partes.slice(0, i).join('').length);
        const nombrePropio = enOracion && /^\p{Lu}/u.test(w) && w !== w.toUpperCase();
        if (r.auto && !nombrePropio) {
          partes[i] = aplicarMayusculas(w, r.auto);
          cambios += 1;
        } else if (r.sugerencias.length) {
          dudosas.set(w, r.sugerencias.map((s) => aplicarMayusculas(w, s)));
        }
      }
      despues = partes.join('');
      el.value = despues;
    }

    aviso.innerHTML = '';
    if (despues !== antes) {
      const txt = document.createElement('span');
      txt.textContent = cambios > 0
        ? `✓ ${cambios} ${cambios === 1 ? 'corrección' : 'correcciones'} de ortografía ·`
        : '✓ Formato corregido ·';
      const undo = document.createElement('button');
      undo.type = 'button';
      undo.className = 'underline font-semibold';
      undo.textContent = 'Deshacer';
      undo.addEventListener('click', () => {
        el.value = antes;
        respetar = antes;
        aviso.classList.add('hidden');
        el.focus();
      });
      aviso.append(txt, undo);
    }
    // Palabras que el diccionario no conoce y no se pudieron corregir solas.
    for (const [w, sugs] of [...dudosas].slice(0, 5)) {
      const chip = crearChip(`${w} → ${sugs[0]}`, 'Tocar para corregir');
      chip.addEventListener('click', () => {
        el.value = el.value.replace(new RegExp(`(^|[^\\p{L}])${w}(?![\\p{L}])`, 'gu'), `$1${sugs[0]}`);
        chip.remove();
      });
      aviso.append(chip);
    }
    aviso.classList.toggle('hidden', !aviso.children.length);
  });
}

export function bindCorrectores(root) {
  const scope = root && root.querySelectorAll ? root : document;
  scope.querySelectorAll('[data-corregir]').forEach(bindCorrector);
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => bindCorrectores());
  } else {
    bindCorrectores();
  }
}
