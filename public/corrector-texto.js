/**
 * Corrector de los textos libres del informe técnico (motivo, daño, trabajos,
 * observaciones): tildes, ñ, errores frecuentes, espacios y mayúscula inicial.
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

// Palabras en -ion que NO llevan tilde (monosílabos por hiato).
const ION_SIN_TILDE = new Set(['ion', 'guion', 'prion', 'muon', 'pion', 'sion']);

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
        DOMINIOS.has(b.toLowerCase()) ? m : `${antes}${a}. ${b}`
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

/**
 * Corrige el campo al terminar de escribir (evento change) y muestra
 * "N correcciones · Deshacer". Si el técnico deshace, ese texto se respeta.
 */
export function bindCorrector(el) {
  if (!el || el.dataset.correctorBound === '1') return;
  el.dataset.correctorBound = '1';

  const aviso = document.createElement('p');
  aviso.className = 'text-[11px] text-teal-300 mt-1 hidden';
  el.insertAdjacentElement('afterend', aviso);
  let respetar = null;

  el.addEventListener('change', () => {
    if (respetar !== null && el.value === respetar) return;
    const antes = el.value;
    const { texto: despues, cambios: n } = revisarTexto(antes);
    if (despues === antes) {
      aviso.classList.add('hidden');
      return;
    }
    el.value = despues;
    aviso.innerHTML = '';
    const txt = document.createElement('span');
    txt.textContent = n > 0
      ? `✓ ${n} ${n === 1 ? 'corrección' : 'correcciones'} de ortografía · `
      : '✓ Formato corregido · ';
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
    aviso.classList.remove('hidden');
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
