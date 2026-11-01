// Interfaz del TPV. Toda la lógica de precios, permisos y días está en el proceso principal.
const $ = (id) => document.getElementById(id);

const state = {
  currency: 'EUR',
  menu: null,
  day: null, // día abierto o null si está cerrado
  category: null,
  cart: new Map(), // productId -> cantidad
  busy: false,
  settingsReturn: 'login', // pantalla a la que vuelve "Volver" en configuración
  admin: null, // datos de configuración cargados
  adminTab: 'waiters',
  editingId: null,
};

const PIN_MIN = 4;
const PIN_MAX = 8;
const pins = { login: '', close: '', admin: '', drawer: '', day: '' };
const displays = { login: 'login-display', close: 'close-display', admin: 'admin-display', drawer: 'drawer-display', day: 'day-display' };
const errors = { login: 'login-error', close: 'close-error', admin: 'admin-error', drawer: 'drawer-error', day: 'day-error' };
let dayAction = 'open'; // 'open' o 'close', según lo que se esté confirmando
let toastTimer = null;

function errorText(err) {
  return String(err?.message ?? err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}

function money(cents) {
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: state.currency }).format(cents / 100);
}

function escapeHtml(text) {
  return String(text ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function showScreen(id) {
  for (const screen of document.querySelectorAll('.screen')) screen.hidden = screen.id !== id;
}

function toast(message, kind = '') {
  const el = $('toast');
  el.textContent = message;
  el.className = `toast ${kind}`;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 3500);
}

// ---------- Teclados numéricos (táctiles y físicos) ----------

function buildKeypads() {
  for (const pad of document.querySelectorAll('.keypad')) {
    const target = pad.dataset.target;
    for (const key of ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫']) {
      const btn = document.createElement('button');
      btn.textContent = key;
      if (key === 'C') btn.className = 'clear';
      const action = key === '⌫' ? 'Backspace' : key === 'C' ? 'Clear' : key;
      btn.addEventListener('click', () => pressKey(target, action));
      pad.appendChild(btn);
    }
    const ok = document.createElement('button');
    ok.textContent = '✓';
    ok.className = 'enter';
    ok.style.gridColumn = 'span 3';
    ok.addEventListener('click', () => pressKey(target, 'Enter'));
    pad.appendChild(ok);
  }
}

function pressKey(target, key) {
  let pin = pins[target];
  if (/^\d$/.test(key) && pin.length < PIN_MAX) pin += key;
  else if (key === 'Backspace') pin = pin.slice(0, -1);
  else if (key === 'Clear') pin = '';
  else if (key === 'Enter') return submitPin(target);
  pins[target] = pin;
  renderPin(target);
}

function renderPin(target) {
  $(displays[target]).textContent = '•'.repeat(pins[target].length);
}

function clearPin(target) {
  pins[target] = '';
  renderPin(target);
  $(errors[target]).textContent = '';
}

function rejectPin(target, message) {
  clearPin(target);
  $(errors[target]).textContent = message;
}

function tooShort(target) {
  if (pins[target].length >= PIN_MIN) return false;
  $(errors[target]).textContent = `El código tiene al menos ${PIN_MIN} dígitos`;
  return true;
}

function submitPin(target) {
  const submit = { login: submitLogin, close: submitClose, admin: submitAdmin, drawer: submitDrawer, day: submitDay }[target];
  return submit();
}

// Modal o pantalla que recibe las pulsaciones del teclado físico.
function activePinTarget() {
  if (!$('modal-admin').hidden) return 'admin';
  if (!$('modal-day').hidden) return 'day';
  if (!$('modal-drawer').hidden) return 'drawer';
  if (!$('modal-close').hidden) return 'close';
  if (!$('login').hidden) return 'login';
  return null;
}

document.addEventListener('keydown', (e) => {
  // No interceptar lo que se escribe en los formularios de configuración.
  if (e.target.matches('input, textarea, select')) return;
  const target = activePinTarget();
  if (!target) return;
  if (/^\d$/.test(e.key) || e.key === 'Backspace' || e.key === 'Enter') {
    e.preventDefault();
    pressKey(target, e.key);
  }
});

// ---------- Acceso de camarero ----------

function showLogin() {
  clearPin('login');
  showScreen('login');
}

async function submitLogin() {
  if (tooShort('login')) return;
  try {
    const res = await window.tpv.login(pins.login);
    if (!res.ok) return rejectPin('login', res.error);
    clearPin('login');
    await openPos(res.waiter);
  } catch (err) {
    rejectPin('login', errorText(err));
  }
}

// ---------- TPV ----------

// Iniciales para el avatar del camarero: "Camarero 1" -> "C1".
function initials(name) {
  return String(name).trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
}

// Color estable por producto (mismo nombre, mismo color) para los iconos de la carta.
function hueFor(name) {
  return [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 0);
}

async function openPos(waiter) {
  $('waiter-name').textContent = waiter.name;
  $('waiter-avatar').textContent = initials(waiter.name);
  state.cart.clear();
  await refreshMenu();
  showScreen('pos');
  renderAll();
}

// Carga el menú y el estado del día sin vaciar el ticket.
// Quita del ticket los productos que ya no están activos.
async function refreshMenu() {
  state.menu = await window.tpv.getMenu();
  state.currency = state.menu.currency;
  state.day = state.menu.day;
  $('business-name').textContent = state.menu.businessName;
  if (!state.menu.categories.some((c) => c.id === state.category)) {
    state.category = state.menu.categories[0]?.id ?? null;
  }
  const active = new Set(state.menu.products.map((p) => p.id));
  for (const id of [...state.cart.keys()]) {
    if (!active.has(id)) state.cart.delete(id);
  }
}

function renderAll() {
  renderDay();
  renderCategories();
  renderProducts();
  renderTicket();
}

function renderDay() {
  const open = Boolean(state.day);
  $('btn-day').textContent = open ? 'Cerrar día' : 'Abrir día';
  $('day-status').textContent = open ? 'Día abierto' : 'Día cerrado';
  $('day-status').className = `status ${open ? 'open' : 'closed'}`;
  $('day-banner').hidden = open;
}

function renderCategories() {
  const nav = $('categories');
  nav.innerHTML = '';
  for (const cat of state.menu.categories) {
    const btn = document.createElement('button');
    btn.textContent = cat.name;
    btn.className = cat.id === state.category ? 'active' : '';
    btn.addEventListener('click', () => {
      state.category = cat.id;
      renderAll();
    });
    nav.appendChild(btn);
  }
}

function renderProducts() {
  const grid = $('products');
  grid.innerHTML = '';
  for (const p of state.menu.products.filter((p) => p.categoryId === state.category)) {
    const btn = document.createElement('button');
    // El color va por CSSOM: el CSP no permite atributos style en el HTML.
    const icon = document.createElement('span');
    icon.className = 'tile-icon';
    icon.style.setProperty('--hue', hueFor(p.name));
    icon.textContent = p.name.charAt(0).toUpperCase();
    const name = document.createElement('span');
    name.className = 'tile-name';
    name.textContent = p.name;
    const price = document.createElement('small');
    price.textContent = money(p.priceCents);
    btn.append(icon, name, price);
    btn.disabled = !state.day;
    btn.addEventListener('click', () => {
      state.cart.set(p.id, (state.cart.get(p.id) ?? 0) + 1);
      renderTicket();
    });
    grid.appendChild(btn);
  }
}

function cartLines() {
  return [...state.cart.entries()].map(([id, qty]) => {
    const product = state.menu.products.find((p) => p.id === id);
    return { product, qty, subtotal: product.priceCents * qty };
  });
}

function renderTicket() {
  const list = $('lines');
  list.innerHTML = '';
  const lines = cartLines();
  $('ticket-count').textContent = lines.reduce((n, l) => n + l.qty, 0);

  for (const { product, qty, subtotal } of lines) {
    const li = document.createElement('li');
    li.innerHTML = `
      <div>
        <div>${escapeHtml(product.name)}</div>
        <small>${money(subtotal)}</small>
      </div>
      <div class="line-controls">
        <button data-act="minus" aria-label="Quitar uno">−</button>
        <span>${qty}</span>
        <button data-act="plus" aria-label="Añadir uno">+</button>
      </div>`;
    li.querySelector('[data-act="minus"]').addEventListener('click', () => changeQty(product.id, -1));
    li.querySelector('[data-act="plus"]').addEventListener('click', () => changeQty(product.id, +1));
    list.appendChild(li);
  }

  const total = lines.reduce((sum, l) => sum + l.subtotal, 0);
  $('total').textContent = money(total);
  const cannotPay = lines.length === 0 || state.busy || !state.day;
  $('btn-cash').disabled = cannotPay;
  $('btn-card').disabled = cannotPay;
  $('btn-clear').disabled = lines.length === 0;
}

function changeQty(productId, delta) {
  const next = (state.cart.get(productId) ?? 0) + delta;
  if (next <= 0) state.cart.delete(productId);
  else state.cart.set(productId, Math.min(next, 99));
  renderTicket();
}

async function pay(method) {
  if (state.busy || state.cart.size === 0 || !state.day) return;
  state.busy = true;
  renderTicket();
  const items = [...state.cart.entries()].map(([productId, qty]) => ({ productId, qty }));
  try {
    const res = await window.tpv.pay(items, method);
    state.cart.clear();
    toast(`Ticket ${res.sale.ticketNumber} cobrado`, res.warning ? 'warn' : '');
    if (res.warning) setTimeout(() => toast(res.warning, 'bad'), 3600);
  } catch (err) {
    toast(errorText(err), 'bad');
  } finally {
    state.busy = false;
    renderTicket();
  }
}

// ---------- Día: abrir y cerrar ----------

// Pide el código de camarero o de administración para abrir o cerrar el día.
function onDayButton() {
  if (state.day && state.cart.size > 0) {
    return toast('Hay un ticket en curso. Cóbrelo o vacíelo antes de cerrar el día.', 'warn');
  }
  dayAction = state.day ? 'close' : 'open';
  $('day-title').textContent = dayAction === 'open' ? 'Abrir día' : 'Cerrar día';
  $('day-hint').textContent = dayAction === 'open'
    ? 'Introduzca su código de camarero o el de administración.'
    : 'Introduzca su código de camarero o el de administración. Al cerrar se mostrará el resumen.';
  clearPin('day');
  $('modal-day').hidden = false;
}

async function submitDay() {
  if (tooShort('day')) return;
  try {
    if (dayAction === 'open') {
      const res = await window.tpv.openDay(pins.day);
      state.day = res.day;
      clearPin('day');
      $('modal-day').hidden = true;
      renderAll();
      toast('Día abierto');
    } else {
      const res = await window.tpv.closeDay(pins.day);
      state.day = null;
      clearPin('day');
      $('modal-day').hidden = true;
      renderAll();
      showSummary(res.summary, 'Día cerrado');
    }
  } catch (err) {
    // Si el día ya se cerró (p. ej. automáticamente), se sincroniza el estado.
    if (errorText(err).includes('ya está cerrado')) {
      state.day = null;
      $('modal-day').hidden = true;
      renderAll();
    }
    rejectPin('day', errorText(err));
  }
}

function showSummary(s, title) {
  $('summary-title').textContent = title;
  $('sum-count').textContent = s.count;
  $('sum-cash').textContent = money(s.cashCents);
  $('sum-card').textContent = money(s.cardCents);
  $('sum-total').textContent = money(s.totalCents);
  $('sum-how').textContent = s.auto ? 'Automático (tiempo máximo abierto)' : 'Manual';
  $('modal-summary').hidden = false;
}

// Con ticket en curso el cajón se abre directamente. Sin ticket, se pide el código de un camarero.
function onDrawerButton() {
  if (state.cart.size === 0) {
    clearPin('drawer');
    $('modal-drawer').hidden = false;
    return;
  }
  openDrawer(undefined);
}

async function submitDrawer() {
  if (tooShort('drawer')) return;
  try {
    await window.tpv.openDrawer(pins.drawer);
    clearPin('drawer');
    $('modal-drawer').hidden = true;
    toast('Cajón abierto');
  } catch (err) {
    rejectPin('drawer', errorText(err));
  }
}

async function openDrawer(code) {
  try {
    await window.tpv.openDrawer(code);
    toast('Cajón abierto');
  } catch (err) {
    toast(errorText(err), 'bad');
  }
}

// ---------- Histórico de comandas (últimas 5) ----------

function historyDate(iso) {
  return new Date(iso).toLocaleString('es-ES', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

async function openHistory() {
  let commands;
  try {
    commands = await window.tpv.history.list();
  } catch (err) {
    return toast(errorText(err), 'bad');
  }

  const list = $('history-list');
  list.innerHTML = '';
  if (commands.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'history-empty';
    empty.textContent = 'Todavía no hay comandas.';
    list.appendChild(empty);
  }
  for (const c of commands) {
    const li = document.createElement('li');
    const info = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = `Ticket ${c.ticketNumber} · ${money(c.totalCents)}`;
    const meta = document.createElement('small');
    meta.textContent = `${historyDate(c.date)} · ${c.waiter} · ${c.method === 'cash' ? 'Efectivo' : 'Tarjeta'}`;
    info.append(title, meta);
    const btn = document.createElement('button');
    btn.textContent = 'Imprimir ticket';
    btn.dataset.printId = c.id;
    li.append(info, btn);
    list.appendChild(li);
  }
  $('modal-history').hidden = false;
}

async function printHistoryTicket(btn) {
  btn.disabled = true;
  try {
    await window.tpv.history.print(btn.dataset.printId);
    toast('Ticket reimpreso');
  } catch (err) {
    toast(errorText(err), 'bad');
  } finally {
    btn.disabled = false;
  }
}

async function logout() {
  await window.tpv.logout();
  state.cart.clear();
  showLogin();
}

// ---------- Acceso a configuración ----------

function askAdmin(returnTo) {
  state.settingsReturn = returnTo;
  clearPin('admin');
  $('modal-admin').hidden = false;
}

async function submitAdmin() {
  if (tooShort('admin')) return;
  try {
    const res = await window.tpv.admin.login(pins.admin);
    if (!res.ok) return rejectPin('admin', res.error);
    clearPin('admin');
    $('modal-admin').hidden = true;
    await loadAdminData();
    state.editingId = null;
    showScreen('settings');
    renderSettings();
  } catch (err) {
    rejectPin('admin', errorText(err));
  }
}

async function loadAdminData() {
  state.admin = await window.tpv.admin.data();
  state.currency = state.admin.settings.currency;
  // Si no se pueden leer las impresoras, la lista queda vacía y se puede seguir usando la configuración.
  state.printers = await window.tpv.admin.printers().catch(() => []);
}

async function leaveSettings() {
  hideKeyboard();
  await window.tpv.admin.logout();
  state.editingId = null;
  if (state.settingsReturn === 'pos') {
    try {
      await refreshMenu();
      showScreen('pos');
      renderAll();
      return;
    } catch {
      // Si la sesión de camarero ya no es válida, se vuelve al acceso.
    }
  }
  showLogin();
}

// ---------- Configuración: pestañas y formularios ----------

function rowHtml(label, actions) {
  return `<li><span>${escapeHtml(label)}</span><div class="row-actions">${actions}</div></li>`;
}

function rowBtn(row, id, text, cls = '') {
  return `<button data-row="${row}" data-id="${escapeHtml(id)}" class="${cls}">${text}</button>`;
}

function hiddenInput(name, value) {
  return `<input type="hidden" name="${name}" value="${escapeHtml(value)}">`;
}

function fieldHtml(name, label, { type = 'text', value = '', placeholder = '', extra = '' } = {}) {
  return `<label>${label}<input name="${name}" type="${type}" value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder)}" autocomplete="off" ${extra}></label>`;
}

function checkHtml(name, label, checked) {
  return `<label class="check"><input type="checkbox" name="${name}" ${checked ? 'checked' : ''}> ${label}</label>`;
}

// Desplegable con las impresoras instaladas en Windows. Si la guardada ya no aparece, se mantiene marcada.
function printerSelect(name, label, value) {
  const installed = state.printers;
  const options = [
    `<option value="" ${value ? '' : 'selected'}>— Ninguna —</option>`,
    ...installed.map((n) => `<option value="${escapeHtml(n)}" ${n === value ? 'selected' : ''}>${escapeHtml(n)}</option>`),
  ];
  if (value && !installed.includes(value)) {
    options.push(`<option value="${escapeHtml(value)}" selected>${escapeHtml(value)} (no encontrada)</option>`);
  }
  return `<label>${label}<select name="${name}">${options.join('')}</select></label>`;
}

function cancelEdit(editing) {
  return editing ? '<button type="button" data-row="cancel-edit">Cancelar edición</button>' : '';
}

function formHtml(action, title, body, submitLabel, footer = '') {
  return `<form class="admin-form" data-action="${action}"><h3>${title}</h3>${body}<div class="form-actions"><button type="submit" class="pay card">${submitLabel}</button>${footer}</div></form>`;
}

function renderSettings() {
  hideKeyboard();
  for (const b of document.querySelectorAll('[data-tab]')) {
    b.classList.toggle('active', b.dataset.tab === state.adminTab);
  }
  $('settings-body').innerHTML = TABS[state.adminTab]();
}

const TABS = {
  waiters() {
    const editing = state.admin.waiters.find((w) => w.id === state.editingId);
    const list = state.admin.waiters
      .map((w) => rowHtml(w.name, rowBtn('edit-waiter', w.id, 'Editar') + rowBtn('delete-waiter', w.id, 'Eliminar', 'danger')))
      .join('');
    const body = hiddenInput('id', editing?.id ?? '') +
      fieldHtml('name', 'Nombre', { value: editing?.name ?? '' }) +
      fieldHtml('code', 'Código', {
        type: 'password',
        placeholder: editing ? 'Dejar vacío para no cambiarlo' : '4 a 8 dígitos',
        extra: 'inputmode="numeric"',
      });
    return `<ul class="rows">${list}</ul>` +
      formHtml('save-waiter', editing ? `Editar: ${escapeHtml(editing.name)}` : 'Nuevo camarero',
        body, editing ? 'Guardar cambios' : 'Añadir camarero', cancelEdit(editing));
  },

  categories() {
    const editing = state.admin.categories.find((c) => c.id === state.editingId);
    const list = state.admin.categories
      .map((c) => rowHtml(c.name, rowBtn('edit-category', c.id, 'Editar') + rowBtn('delete-category', c.id, 'Eliminar', 'danger')))
      .join('');
    const body = hiddenInput('id', editing?.id ?? '') + fieldHtml('name', 'Nombre', { value: editing?.name ?? '' });
    return `<ul class="rows">${list}</ul>` +
      formHtml('save-category', editing ? 'Editar categoría' : 'Nueva categoría',
        body, editing ? 'Guardar cambios' : 'Añadir categoría', cancelEdit(editing));
  },

  products() {
    const { products, categories } = state.admin;
    const editing = products.find((p) => p.id === state.editingId);
    const catName = (id) => categories.find((c) => c.id === id)?.name ?? '—';
    const list = products
      .map((p) => {
        const status = p.active === false ? ' (inactivo)' : '';
        return rowHtml(`${p.name} · ${catName(p.categoryId)} · ${money(p.priceCents)}${status}`, rowBtn('edit-product', p.id, 'Editar'));
      })
      .join('');
    const options = categories
      .map((c) => `<option value="${escapeHtml(c.id)}" ${editing?.categoryId === c.id ? 'selected' : ''}>${escapeHtml(c.name)}</option>`)
      .join('');
    const body = hiddenInput('id', editing?.id ?? '') +
      fieldHtml('name', 'Nombre', { value: editing?.name ?? '' }) +
      `<label>Categoría<select name="categoryId">${options}</select></label>` +
      fieldHtml('price', 'Precio (€)', { value: editing ? (editing.priceCents / 100).toFixed(2) : '', placeholder: '0.00', extra: 'inputmode="decimal"' }) +
      (editing ? checkHtml('active', 'Activo (aparece en el TPV)', editing.active !== false) : '');
    return `<p class="hint">Los cambios de precio afectan solo a los tickets nuevos. Desmarque "Activo" para retirar un producto sin perder el historial.</p>` +
      `<ul class="rows">${list}</ul>` +
      formHtml('save-product', editing ? 'Editar producto' : 'Nuevo producto',
        body, editing ? 'Guardar cambios' : 'Añadir producto', cancelEdit(editing));
  },

  codes() {
    const admin = formHtml('set-code', 'Código de administración',
      hiddenInput('kind', 'admin') + fieldHtml('code', 'Nuevo código', { type: 'password', placeholder: '4 a 8 dígitos', extra: 'inputmode="numeric"' }),
      'Cambiar código admin');
    const close = formHtml('set-code', 'Código de cierre',
      hiddenInput('kind', 'close') + fieldHtml('code', 'Nuevo código', { type: 'password', placeholder: '4 a 8 dígitos', extra: 'inputmode="numeric"' }),
      'Cambiar código de cierre');
    return `<p class="hint">Los códigos de camarero se cambian en la pestaña Camareros. Ningún código puede repetirse.</p>${admin}${close}`;
  },

  settings() {
    const s = state.admin.settings;
    const body = fieldHtml('businessName', 'Nombre del negocio', { value: s.businessName }) +
      printerSelect('ticketPrinterName', 'Impresora de tickets', s.ticketPrinterName) +
      printerSelect('drawerPrinterName', 'Impresora con el cajón', s.drawerPrinterName) +
      (state.printers.length === 0
        ? `<p class="hint">No se han encontrado impresoras instaladas en Windows.</p>`
        : '') +
      `<p class="hint">Imprimir ticket al cobrar con:</p>` +
      checkHtml('printCash', 'Efectivo', s.printCash) +
      checkHtml('printCard', 'Tarjeta', s.printCard) +
      `<p class="hint">Abrir el cajón al cobrar con:</p>` +
      checkHtml('drawerCash', 'Efectivo', s.drawerCash) +
      checkHtml('drawerCard', 'Tarjeta', s.drawerCard) +
      `<p class="hint">El cajón nunca imprime un ticket: solo recibe el pulso de apertura.</p>` +
      fieldHtml('autoCloseHours', 'Cierre automático del día (horas abierto, 1 a 48)', { type: 'number', value: s.autoCloseHours, extra: 'min="1" max="48" step="1" inputmode="numeric"' });
    return formHtml('save-settings', 'Ajustes del negocio', body, 'Guardar ajustes');
  },
};

const ACTIONS = {
  'save-waiter': (v) => window.tpv.admin.saveWaiter(v),
  'save-category': (v) => window.tpv.admin.saveCategory(v),
  'save-product': (v) => window.tpv.admin.saveProduct(v),
  'save-settings': (v) => window.tpv.admin.saveSettings(v),
  'set-code': (v) => window.tpv.admin.setCode(v),
};

async function refreshSettings(message) {
  state.editingId = null;
  await loadAdminData();
  renderSettings();
  if (message) toast(message);
}

// ---------- Cierre de la aplicación ----------

function openClose() {
  clearPin('close');
  $('modal-close').hidden = false;
}

async function submitClose() {
  if (tooShort('close')) return;
  try {
    const res = await window.tpv.requestClose(pins.close);
    if (!res.ok) rejectPin('close', res.error);
    // Si es correcto, la aplicación se cierra desde el proceso principal.
  } catch (err) {
    rejectPin('close', errorText(err));
  }
}

// ---------- Teclado virtual (para los campos de Configuración) ----------

const KB_LAYOUTS = {
  text: [
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
    ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
    ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', 'ñ'],
    ['⇧', 'z', 'x', 'c', 'v', 'b', 'n', 'm', '⌫'],
    [',', '.', '-', '_', '@', '/', ' ', '↵'],
  ],
  numeric: [
    ['1', '2', '3'],
    ['4', '5', '6'],
    ['7', '8', '9'],
    [',', '0', '⌫'],
    ['↵'],
  ],
};

const kb = { target: null, mode: 'text', shift: false };

function isTextField(el) {
  return el instanceof HTMLInputElement && !['checkbox', 'hidden', 'select-one'].includes(el.type);
}

function showKeyboard(input) {
  const numeric = input.type === 'number' || ['numeric', 'decimal'].includes(input.getAttribute('inputmode'));
  kb.target = input;
  kb.mode = numeric ? 'numeric' : 'text';
  kb.shift = false;
  renderKeyboard();
  $('vkb').hidden = false;
  document.body.classList.add('kb-open');
}

function hideKeyboard() {
  kb.target = null;
  $('vkb').hidden = true;
  document.body.classList.remove('kb-open');
}

function renderKeyboard() {
  const el = $('vkb');
  el.innerHTML = '';
  // Barra superior para cerrar el teclado.
  const bar = document.createElement('div');
  bar.className = 'vkb-row';
  bar.innerHTML = '<button type="button" data-key="close" class="wide close">Cerrar teclado ▼</button>';
  el.appendChild(bar);
  for (const row of KB_LAYOUTS[kb.mode]) {
    const div = document.createElement('div');
    div.className = 'vkb-row';
    for (const key of row) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.key = key;
      const letter = /^[a-zñ]$/.test(key);
      btn.textContent = key === ' ' ? 'Espacio' : letter && kb.shift ? key.toUpperCase() : key;
      if (key === ' ') btn.classList.add('space');
      if (key === '↵') btn.classList.add('action');
      if (key === '⇧' && kb.shift) btn.classList.add('toggled');
      if (key === '⇧' || key === '⌫' || key === '↵') btn.classList.add('wide');
      div.appendChild(btn);
    }
    el.appendChild(div);
  }
}

function keyboardPress(key) {
  const input = kb.target;
  if (!input || !document.body.contains(input)) return hideKeyboard();

  if (key === 'close') {
    hideKeyboard();
    return input.blur();
  }
  if (key === '⇧') {
    kb.shift = !kb.shift;
    return renderKeyboard();
  }
  if (key === '↵') {
    // Pasa al siguiente campo del formulario; si no hay más, cierra el teclado.
    const fields = [...input.form.querySelectorAll('input:not([type="checkbox"]):not([type="hidden"])')];
    const next = fields[fields.indexOf(input) + 1];
    if (next) next.focus();
    else {
      hideKeyboard();
      input.blur();
    }
    return;
  }
  if (key === '⌫') {
    input.value = input.value.slice(0, -1);
  } else {
    const char = kb.shift ? key.toUpperCase() : key;
    input.value += char;
    if (kb.shift) {
      kb.shift = false;
      renderKeyboard();
    }
  }
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

// ---------- Arranque ----------

function startClock() {
  const tick = () => {
    $('clock').textContent = new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  };
  tick();
  setInterval(tick, 15000);
}

function init() {
  buildKeypads();
  startClock();

  $('open-close').addEventListener('click', openClose);
  $('open-admin').addEventListener('click', () => askAdmin('login'));
  $('btn-config').addEventListener('click', () => askAdmin('pos'));
  $('btn-day').addEventListener('click', onDayButton);
  $('btn-drawer').addEventListener('click', onDrawerButton);
  $('btn-logout').addEventListener('click', logout);
  $('btn-history').addEventListener('click', openHistory);
  $('history-list').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-print-id]');
    if (btn) printHistoryTicket(btn);
  });
  $('btn-cash').addEventListener('click', () => pay('cash'));
  $('btn-card').addEventListener('click', () => pay('card'));
  $('btn-clear').addEventListener('click', () => {
    state.cart.clear();
    renderTicket();
  });

  // El día puede cerrarse automáticamente mientras la app está abierta.
  window.tpv.onDayClosed((summary) => {
    state.day = null;
    if (!$('pos').hidden) renderAll();
    showSummary(summary, 'Día cerrado automáticamente');
  });

  $('btn-settings-back').addEventListener('click', leaveSettings);
  for (const b of document.querySelectorAll('[data-tab]')) {
    b.addEventListener('click', () => {
      state.adminTab = b.dataset.tab;
      state.editingId = null;
      renderSettings();
    });
  }

  // Guardar formularios de configuración.
  $('settings-body').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const values = Object.fromEntries(new FormData(form));
    // Los checkboxes no marcados no aparecen en FormData: se leen directamente.
    for (const box of form.querySelectorAll('input[type="checkbox"]')) values[box.name] = box.checked;
    try {
      await ACTIONS[form.dataset.action](values);
      await refreshSettings('Guardado');
    } catch (err) {
      toast(errorText(err), 'bad');
    }
  });

  // Editar, cancelar y eliminar (con doble pulsación para confirmar).
  $('settings-body').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-row]');
    if (!btn) return;
    const { row, id } = btn.dataset;

    if (row.startsWith('edit-')) {
      state.editingId = id;
      return renderSettings();
    }
    if (row === 'cancel-edit') {
      state.editingId = null;
      return renderSettings();
    }
    if (row === 'delete-waiter' || row === 'delete-category') {
      if (!btn.dataset.armed) {
        btn.dataset.armed = '1';
        btn.textContent = 'Confirmar';
        return;
      }
      try {
        if (row === 'delete-waiter') await window.tpv.admin.deleteWaiter(id);
        else await window.tpv.admin.deleteCategory(id);
        await refreshSettings('Eliminado');
      } catch (err) {
        toast(errorText(err), 'bad');
        renderSettings();
      }
    }
  });

  // Teclado virtual: los toques no quitan el foco del campo.
  $('vkb').addEventListener('mousedown', (e) => e.preventDefault());
  $('vkb').addEventListener('pointerdown', (e) => {
    const btn = e.target.closest('button[data-key]');
    if (!btn) return;
    e.preventDefault();
    keyboardPress(btn.dataset.key);
  });
  $('settings-body').addEventListener('focusin', (e) => {
    if (isTextField(e.target)) showKeyboard(e.target);
  });
  // Al tocar un campo ya enfocado (tras cerrar el teclado con ↵) vuelve a abrirse.
  $('settings-body').addEventListener('click', (e) => {
    if (isTextField(e.target) && kb.target !== e.target) showKeyboard(e.target);
  });
  $('settings-body').addEventListener('focusout', () => {
    setTimeout(() => {
      if (!isTextField(document.activeElement)) hideKeyboard();
    }, 150);
  });

  for (const btn of document.querySelectorAll('[data-close]')) {
    btn.addEventListener('click', () => {
      $(btn.dataset.close).hidden = true;
    });
  }

  showLogin();
}

init();
