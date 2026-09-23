export const CATALOGO_EQUIPOS = [
  {
    marca: 'ALPINION',
    modelos: [
      'E-CUBE 5',
      'E-CUBE 7',
      'E-CUBE i7',
      'E-CUBE 8',
      'E-CUBE 8D',
      'E-CUBE 8LE',
      'E-CUBE 15',
      'X-CUBE 50',
      'X-CUBE 60',
      'X-CUBE 70',
      'X-CUBE i8',
      'X-CUBE i9',
      'MINISONO',
    ],
  },
  { marca: 'UNETIXS', modelos: ['2 LHS', '2 CP', 'REVO'] },
  { marca: 'IONCLINICS', modelos: ['EPTE BIPOLAR', 'EPTE SYSTEM', 'HOME TDCS'] },
  { marca: 'BIONET', modelos: ['FC1400'] },
  { marca: 'ATYS', modelos: ['BASIC 3.2', 'BASIC 3.4'] },
];

export function fold(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function rank(text, query) {
  const value = fold(text);
  if (!query) return 0;
  if (value.startsWith(query)) return 1;
  if (value.includes(query)) return 2;
  return 0;
}

export function sugerenciasMarca(query) {
  const q = fold(query);
  if (!q) return [];
  return CATALOGO_EQUIPOS
    .map((item) => ({ marca: item.marca, rank: rank(item.marca, q) }))
    .filter((item) => item.rank > 0)
    .sort((a, b) => a.rank - b.rank || a.marca.localeCompare(b.marca, 'es'))
    .map((item) => ({ tipo: 'marca', marca: item.marca, modelo: '' }));
}

export function marcaActiva(marca) {
  const q = fold(marca);
  if (!q) return null;
  const exact = CATALOGO_EQUIPOS.filter((item) => fold(item.marca) === q);
  if (exact.length === 1) return exact[0].marca;
  const prefix = CATALOGO_EQUIPOS.filter((item) => fold(item.marca).startsWith(q));
  if (prefix.length === 1) return prefix[0].marca;
  return null;
}

export function modelosVisibles(marca) {
  const activa = marcaActiva(marca);
  const brands = activa
    ? CATALOGO_EQUIPOS.filter((item) => item.marca === activa)
    : CATALOGO_EQUIPOS;
  const out = [];
  for (const brand of brands) {
    for (const modelo of brand.modelos) out.push({ marca: brand.marca, modelo });
  }
  return out;
}

export function sugerenciasModelo(query, marca) {
  const q = fold(query);
  if (!q) return [];
  return modelosVisibles(marca)
    .map((item) => ({ ...item, rank: rank(item.modelo, q) }))
    .filter((item) => item.rank > 0)
    .sort((a, b) => a.rank - b.rank || a.modelo.localeCompare(b.modelo, 'es'))
    .map((item) => ({ tipo: 'modelo', marca: item.marca, modelo: item.modelo }));
}

export function canonMarca(value) {
  const q = fold(value);
  if (!q) return null;
  const hits = CATALOGO_EQUIPOS.filter((item) => fold(item.marca) === q);
  return hits.length === 1 ? hits[0].marca : null;
}

export function canonModelo(value, marca) {
  const q = fold(value);
  if (!q) return null;
  const hits = modelosVisibles(marca).filter((item) => fold(item.modelo) === q);
  return hits.length === 1 ? hits[0] : null;
}

export function debeCompletarMarca(actual, marcaCatalogo) {
  const q = fold(actual);
  if (!q) return true;
  const target = fold(marcaCatalogo);
  if (q === target) return true;
  return target.startsWith(q);
}

export function nombreAutomatico(marca, modelo) {
  return [marca, modelo].map((value) => String(value || '').trim()).filter(Boolean).join(' ');
}

export function baselineNombre({ nombre, marca, modelo }) {
  const auto = nombreAutomatico(marca, modelo);
  const current = String(nombre || '').trim();
  if (!current || current === auto) return auto;
  return null;
}

export function siguienteNombre({ nombre, marca, modelo, lastAuto }) {
  const next = nombreAutomatico(marca, modelo);
  const current = String(nombre || '').trim();
  if (lastAuto === null) {
    if (!current) return { nombre: next, lastAuto: next };
    return { nombre: current, lastAuto: null };
  }
  if (!current || current === lastAuto) return { nombre: next, lastAuto: next };
  return { nombre: current, lastAuto: null };
}

function initCatalogoEquipos() {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;
  if (window.__catalogoEquiposInit) return;
  window.__catalogoEquiposInit = true;

  const groups = new Map();
  const menu = document.createElement('div');
  menu.className = 'hidden';
  menu.style.position = 'fixed';
  menu.style.zIndex = '400';
  menu.style.maxHeight = '13rem';
  menu.style.overflow = 'auto';
  menu.style.borderRadius = '0.5rem';
  menu.style.border = '1px solid rgb(71 85 105)';
  menu.style.background = 'rgb(2 6 23)';
  menu.style.boxShadow = '0 25px 50px -12px rgb(0 0 0 / 0.55)';
  menu.setAttribute('role', 'listbox');
  document.body.appendChild(menu);

  let openState = null;

  function closeMenu() {
    menu.classList.add('hidden');
    menu.innerHTML = '';
    openState = null;
  }

  function placeMenu(input) {
    const rect = input.getBoundingClientRect();
    menu.style.left = `${Math.max(8, rect.left)}px`;
    menu.style.top = `${rect.bottom + 4}px`;
    menu.style.width = `${Math.max(rect.width, 220)}px`;
  }

  function syncNombre(group) {
    if (!group.nombre) return;
    const next = siguienteNombre({
      nombre: group.nombre.value,
      marca: group.marca ? group.marca.value : '',
      modelo: group.modelo ? group.modelo.value : '',
      lastAuto: group.lastAuto,
    });
    group.lastAuto = next.lastAuto;
    if (group.nombre.value !== next.nombre) group.nombre.value = next.nombre;
  }

  function applySuggestion(group, item) {
    if (item.tipo === 'marca' && group.marca) {
      group.marca.value = item.marca;
    }
    if (item.tipo === 'modelo' && group.modelo) {
      group.modelo.value = item.modelo;
      if (group.marca && debeCompletarMarca(group.marca.value, item.marca)) {
        group.marca.value = item.marca;
      }
    }
    syncNombre(group);
    closeMenu();
  }

  function renderMenu(group, input, items) {
    menu.innerHTML = '';
    if (!items.length) {
      closeMenu();
      return;
    }
    items.slice(0, 12).forEach((item, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('role', 'option');
      button.style.display = 'block';
      button.style.width = '100%';
      button.style.padding = '0.5rem 0.75rem';
      button.style.textAlign = 'left';
      button.style.fontSize = '0.875rem';
      button.style.color = 'white';
      button.style.background = 'transparent';
      const title = document.createElement('span');
      title.textContent = item.tipo === 'marca' ? item.marca : item.modelo;
      button.appendChild(title);
      if (item.tipo === 'modelo' && !marcaActiva(group.marca ? group.marca.value : '')) {
        const meta = document.createElement('span');
        meta.style.marginLeft = '0.5rem';
        meta.style.fontSize = '0.75rem';
        meta.style.color = 'rgb(148 163 184)';
        meta.textContent = item.marca;
        button.appendChild(meta);
      }
      button.addEventListener('mousedown', (event) => {
        event.preventDefault();
      });
      button.addEventListener('click', () => applySuggestion(group, item));
      button.dataset.index = String(index);
      menu.appendChild(button);
    });
    placeMenu(input);
    menu.classList.remove('hidden');
    openState = { group, input, items: items.slice(0, 12), index: 0 };
    highlight(0);
  }

  function highlight(index) {
    if (!openState) return;
    const buttons = menu.querySelectorAll('button');
    openState.index = index;
    buttons.forEach((button, i) => {
      button.style.background = i === index ? 'rgb(30 41 59)' : 'transparent';
    });
  }

  function suggestionsFor(group, input) {
    if (input === group.marca) return sugerenciasMarca(input.value);
    if (input === group.modelo) return sugerenciasModelo(input.value, group.marca ? group.marca.value : '');
    return [];
  }

  function onInput(group, input) {
    renderMenu(group, input, suggestionsFor(group, input));
  }

  function canonGroup(group) {
    if (group.marca) {
      const canon = canonMarca(group.marca.value);
      if (canon) group.marca.value = canon;
    }
    if (group.modelo) {
      const canon = canonModelo(group.modelo.value, group.marca ? group.marca.value : '');
      if (canon) {
        group.modelo.value = canon.modelo;
        if (group.marca && debeCompletarMarca(group.marca.value, canon.marca)) {
          group.marca.value = canon.marca;
        }
      }
    }
    syncNombre(group);
  }

  function onBlur(group, input) {
    window.setTimeout(() => {
      if (openState && openState.input === input && document.activeElement === input) return;
      if (openState && openState.input === input) closeMenu();
      if (document.activeElement === input) return;
      canonGroup(group);
    }, 120);
  }

  function bindGroup(name, nodes) {
    const group = {
      name,
      marca: null,
      modelo: null,
      nombre: null,
      lastAuto: null,
    };
    nodes.forEach((node) => {
      const role = node.getAttribute('data-catalogo');
      if (role === 'marca') group.marca = node;
      if (role === 'modelo') group.modelo = node;
      if (role === 'nombre') group.nombre = node;
      node.setAttribute('autocomplete', 'off');
      node.setAttribute('spellcheck', 'false');
    });
    [group.marca, group.modelo].filter(Boolean).forEach((input) => {
      input.setAttribute('aria-autocomplete', 'list');
      input.addEventListener('input', () => onInput(group, input));
      input.addEventListener('focus', () => onInput(group, input));
      input.addEventListener('blur', () => onBlur(group, input));
      input.addEventListener('keydown', (event) => {
        if (!openState || openState.input !== input) return;
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          highlight((openState.index + 1) % openState.items.length);
        } else if (event.key === 'ArrowUp') {
          event.preventDefault();
          highlight((openState.index - 1 + openState.items.length) % openState.items.length);
        } else if (event.key === 'Enter') {
          event.preventDefault();
          applySuggestion(group, openState.items[openState.index]);
        } else if (event.key === 'Escape') {
          event.preventDefault();
          closeMenu();
        }
      });
    });
    if (group.nombre) {
      group.lastAuto = baselineNombre({
        nombre: group.nombre.value,
        marca: group.marca ? group.marca.value : '',
        modelo: group.modelo ? group.modelo.value : '',
      });
    }
    const form = (group.marca || group.modelo || group.nombre)?.closest('form');
    if (form) {
      form.addEventListener('submit', () => canonGroup(group), true);
    }
    groups.set(name, group);
  }

  document.querySelectorAll('[data-catalogo-group]').forEach((node) => {
    const name = node.getAttribute('data-catalogo-group');
    if (!name || groups.has(name)) return;
    bindGroup(name, document.querySelectorAll(`[data-catalogo-group="${CSS.escape(name)}"]`));
  });

  window.addEventListener('scroll', () => {
    if (openState) placeMenu(openState.input);
  }, true);
  window.addEventListener('resize', () => {
    if (openState) placeMenu(openState.input);
  });
  document.addEventListener('mousedown', (event) => {
    if (!openState) return;
    if (event.target === openState.input || menu.contains(event.target)) return;
    closeMenu();
  });

  window.catalogoNoteBaseline = function catalogoNoteBaseline(name) {
    const group = groups.get(name);
    if (!group || !group.nombre) return;
    group.lastAuto = baselineNombre({
      nombre: group.nombre.value,
      marca: group.marca ? group.marca.value : '',
      modelo: group.modelo ? group.modelo.value : '',
    });
  };
}

initCatalogoEquipos();
