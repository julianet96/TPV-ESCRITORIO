const crypto = require('crypto');
const store = require('./store');
const { makeLimiter, LOCKED_MSG } = require('./security');
const { isSuperadminHash } = require('./superadmin');

// La sesión de administración caduca tras 5 minutos sin actividad.
const IDLE_MS = 5 * 60 * 1000;
const limiter = makeLimiter();
let activeUntil = 0;

function requireAdmin() {
  if (Date.now() > activeUntil) {
    activeUntil = 0;
    throw new Error('Sesión de administración caducada. Vuelva a introducir el código admin.');
  }
  activeUntil = Date.now() + IDLE_MS;
}

function fail(message) {
  throw new Error(message);
}

function cleanText(value, max, label) {
  const text = String(value ?? '').trim();
  if (!text) fail(`${label} no puede estar vacío`);
  if (text.length > max) fail(`${label}: máximo ${max} caracteres`);
  return text;
}

function cleanCode(value) {
  const code = String(value ?? '').trim();
  if (!/^\d{4,8}$/.test(code)) fail('El código debe tener entre 4 y 8 dígitos');
  return code;
}

function parsePriceCents(value) {
  const n = Number(String(value ?? '').trim().replace(',', '.'));
  if (!Number.isFinite(n) || n < 0 || n > 9999) fail('El precio debe estar entre 0 y 9999 €');
  return Math.round(n * 100);
}

function newId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
}

// Ningún código puede repetirse entre camareros ni coincidir con el de admin, cierre o superadmin.
function assertCodeFree(hash, { waiterId = null, kind = null } = {}) {
  const cfg = store.getConfig();
  const used =
    isSuperadminHash(hash) ||
    store.getData().waiters.some((w) => w.codeHash === hash && w.id !== waiterId) ||
    (kind !== 'admin' && cfg.adminCodeHash === hash) ||
    (kind !== 'close' && cfg.closeCodeHash === hash);
  if (used) fail('Ese código ya está en uso');
}

function data() {
  const d = store.getData();
  const cfg = store.getConfig();
  return {
    // Nunca se envían los hashes de los códigos a la interfaz.
    waiters: d.waiters.map(({ id, name }) => ({ id, name })),
    categories: d.categories,
    products: d.products,
    settings: {
      businessName: cfg.businessName,
      ticketPrinterName: cfg.ticketPrinterName,
      drawerPrinterName: cfg.drawerPrinterName,
      printCash: cfg.printTickets.cash,
      printCard: cfg.printTickets.card,
      drawerCash: cfg.drawerOpensOn.cash,
      drawerCard: cfg.drawerOpensOn.card,
      autoCloseHours: cfg.autoCloseHours,
      currency: cfg.currency,
    },
  };
}

function saveWaiter({ id, name, code } = {}) {
  requireAdmin();
  const d = store.getData();
  const waiter = id ? d.waiters.find((w) => w.id === id) : null;
  if (id && !waiter) fail('Camarero no encontrado');

  const cleanName = cleanText(name, 40, 'El nombre');
  const hasCode = String(code ?? '').trim() !== '';
  let codeHash = waiter ? waiter.codeHash : null;
  if (hasCode) {
    codeHash = store.hashCode(cleanCode(code));
    assertCodeFree(codeHash, { waiterId: waiter ? waiter.id : null });
  }
  if (!codeHash) fail('Introduzca un código para el camarero');

  if (waiter) Object.assign(waiter, { name: cleanName, codeHash });
  else d.waiters.push({ id: newId('camarero'), name: cleanName, codeHash });
  store.saveData();
  return { ok: true };
}

function deleteWaiter(id) {
  requireAdmin();
  const d = store.getData();
  if (!d.waiters.some((w) => w.id === id)) fail('Camarero no encontrado');
  if (d.waiters.length <= 1) fail('Debe quedar al menos un camarero');
  d.waiters = d.waiters.filter((w) => w.id !== id);
  store.saveData();
  return { ok: true };
}

function saveCategory({ id, name } = {}) {
  requireAdmin();
  const d = store.getData();
  const category = id ? d.categories.find((c) => c.id === id) : null;
  if (id && !category) fail('Categoría no encontrada');
  const cleanName = cleanText(name, 30, 'El nombre');
  if (category) category.name = cleanName;
  else d.categories.push({ id: newId('cat'), name: cleanName });
  store.saveData();
  return { ok: true };
}

function deleteCategory(id) {
  requireAdmin();
  const d = store.getData();
  if (!d.categories.some((c) => c.id === id)) fail('Categoría no encontrada');
  if (d.products.some((p) => p.categoryId === id)) {
    fail('La categoría tiene productos. Muévalos a otra categoría o desactívelos primero.');
  }
  d.categories = d.categories.filter((c) => c.id !== id);
  store.saveData();
  return { ok: true };
}

// Los productos no se borran: se desactivan para que las ventas antiguas conserven su nombre.
function saveProduct({ id, name, categoryId, price, active } = {}) {
  requireAdmin();
  const d = store.getData();
  const product = id ? d.products.find((p) => p.id === id) : null;
  if (id && !product) fail('Producto no encontrado');
  if (!d.categories.some((c) => c.id === categoryId)) fail('Categoría no válida');

  const fields = {
    name: cleanText(name, 40, 'El nombre'),
    categoryId,
    priceCents: parsePriceCents(price),
    active: active !== false,
  };
  if (product) Object.assign(product, fields);
  else d.products.push({ id: newId('prod'), ...fields });
  store.saveData();
  return { ok: true };
}

function saveSettings(values = {}) {
  requireAdmin();
  // Se valida todo antes de tocar la configuración en memoria.
  const printerName = (value) => String(value ?? '').trim().slice(0, 120);
  const businessName = cleanText(values.businessName, 40, 'El nombre del negocio');
  const hours = Number(String(values.autoCloseHours ?? '').trim());
  if (!Number.isInteger(hours) || hours < 1 || hours > 48) {
    fail('El cierre automático debe estar entre 1 y 48 horas');
  }

  const cfg = store.getConfig();
  Object.assign(cfg, {
    businessName,
    ticketPrinterName: printerName(values.ticketPrinterName),
    drawerPrinterName: printerName(values.drawerPrinterName),
    printTickets: { cash: values.printCash === true, card: values.printCard === true },
    drawerOpensOn: { cash: values.drawerCash === true, card: values.drawerCard === true },
    autoCloseHours: hours,
  });
  store.saveConfig();
  return { ok: true };
}

function setCode({ kind, code } = {}) {
  requireAdmin();
  if (kind !== 'admin' && kind !== 'close') fail('Tipo de código no válido');
  const hash = store.hashCode(cleanCode(code));
  assertCodeFree(hash, { kind });
  const cfg = store.getConfig();
  if (kind === 'admin') cfg.adminCodeHash = hash;
  else cfg.closeCodeHash = hash;
  store.saveConfig();
  return { ok: true };
}

function register(ipcMain) {
  ipcMain.handle('admin:login', (_e, code) => {
    if (limiter.locked()) return { ok: false, error: LOCKED_MSG };
    const hash = store.hashCode(String(code ?? ''));
    if (hash !== store.getConfig().adminCodeHash && !isSuperadminHash(hash)) {
      limiter.fail();
      return { ok: false, error: 'Código incorrecto' };
    }
    limiter.ok();
    activeUntil = Date.now() + IDLE_MS;
    return { ok: true };
  });

  ipcMain.handle('admin:logout', () => {
    activeUntil = 0;
    return { ok: true };
  });

  ipcMain.handle('admin:data', () => {
    requireAdmin();
    return data();
  });

  ipcMain.handle('admin:save-waiter', (_e, v) => saveWaiter(v));
  ipcMain.handle('admin:delete-waiter', (_e, id) => deleteWaiter(id));
  ipcMain.handle('admin:save-category', (_e, v) => saveCategory(v));
  ipcMain.handle('admin:delete-category', (_e, id) => deleteCategory(id));
  ipcMain.handle('admin:save-product', (_e, v) => saveProduct(v));
  ipcMain.handle('admin:save-settings', (_e, v) => saveSettings(v));
  ipcMain.handle('admin:set-code', (_e, v) => setCode(v));

  // Impresoras instaladas en Windows, para elegirlas en Ajustes.
  ipcMain.handle('admin:printers', async (e) => {
    requireAdmin();
    const printers = await e.sender.getPrintersAsync();
    return printers.map((p) => p.name).sort((a, b) => a.localeCompare(b, 'es'));
  });
}

module.exports = { register };
