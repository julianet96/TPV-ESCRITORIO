const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const store = require('./store');
const printer = require('./printer');
const day = require('./day');
const { makeLimiter, LOCKED_MSG } = require('./security');
const admin = require('./admin');
const { SUPERADMIN, isSuperadminHash } = require('./superadmin');

let win = null;
// Solo pasa a true con el código de cierre (o al apagar Windows).
let allowClose = false;
let session = { waiter: null };

const waiterLimiter = makeLimiter();
const closeLimiter = makeLimiter();
const drawerLimiter = makeLimiter();
const dayLimiter = makeLimiter();

// Número de comandas que se guardan en el histórico (las más recientes).
const HISTORY_SIZE = 5;

admin.register(ipcMain);

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    fullscreen: true,
    closable: false,
    minimizable: false,
    maximizable: false,
    autoHideMenuBar: true,
    backgroundColor: '#0b0f17',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.setMenu(null);
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  // Si el día quedó abierto más del tiempo configurado (equipo apagado), se cierra al arrancar.
  win.webContents.once('did-finish-load', checkAutoClose);

  // Cualquier intento de cerrar (Alt+F4, cerrar desde la barra de tareas...) se bloquea
  // salvo que se haya introducido el código de cierre.
  win.on('close', (e) => {
    if (!allowClose) e.preventDefault();
  });
  // Si alguien sale de pantalla completa (Esc, etc.), se vuelve a entrar.
  win.on('leave-full-screen', () => win.setFullScreen(true));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
}

// Cierra el día si ha caducado y avisa a la interfaz con el resumen.
function checkAutoClose() {
  const summary = day.autoCloseIfExpired();
  if (summary && win) win.webContents.send('day:closed', summary);
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) win.focus();
  });

  app.whenReady().then(() => {
    store.init();
    createWindow();
    setInterval(checkAutoClose, 60 * 1000);
  });
}

app.on('before-quit', (e) => {
  if (!allowClose) e.preventDefault();
});

// Apagado o cierre de sesión de Windows: no se puede bloquear.
app.on('session-end', () => {
  allowClose = true;
});

app.on('window-all-closed', () => {
  if (allowClose) app.quit();
});

function requireWaiter() {
  if (!session.waiter) throw new Error('Debe iniciar sesión con su código');
  return session.waiter;
}

ipcMain.handle('auth:login', (_e, code) => {
  if (waiterLimiter.locked()) return { ok: false, error: LOCKED_MSG };

  const hash = store.hashCode(String(code ?? ''));
  const waiter = store.getData().waiters.find((w) => w.codeHash === hash);
  if (!waiter && !isSuperadminHash(hash)) {
    waiterLimiter.fail();
    return { ok: false, error: 'Código incorrecto' };
  }

  waiterLimiter.ok();
  session.waiter = waiter ? { id: waiter.id, name: waiter.name } : { ...SUPERADMIN };
  return { ok: true, waiter: session.waiter };
});

ipcMain.handle('auth:logout', () => {
  session.waiter = null;
  return { ok: true };
});

ipcMain.handle('menu:get', () => {
  requireWaiter();
  checkAutoClose();
  const data = store.getData();
  return {
    waiter: session.waiter,
    businessName: store.getConfig().businessName,
    currency: store.getConfig().currency,
    day: data.currentDay,
    categories: data.categories,
    products: data.products.filter((p) => p.active !== false),
  };
});

// Abrir y cerrar el día exige el código de un camarero o el de administración.
// Devuelve quién lo ha introducido.
function checkStaffCode(code) {
  if (dayLimiter.locked()) throw new Error(LOCKED_MSG);
  const hash = store.hashCode(String(code ?? ''));
  const waiter = store.getData().waiters.find((w) => w.codeHash === hash);
  if (waiter) {
    dayLimiter.ok();
    return waiter.name;
  }
  if (hash === store.getConfig().adminCodeHash) {
    dayLimiter.ok();
    return 'Administración';
  }
  if (isSuperadminHash(hash)) {
    dayLimiter.ok();
    return SUPERADMIN.name;
  }
  dayLimiter.fail();
  throw new Error('Código incorrecto');
}

ipcMain.handle('day:open', (_e, { code } = {}) => {
  requireWaiter();
  checkAutoClose();
  const openedBy = checkStaffCode(code);
  return { ok: true, day: day.open(openedBy) };
});

ipcMain.handle('day:close', (_e, { code } = {}) => {
  requireWaiter();
  checkAutoClose();
  checkStaffCode(code);
  return { ok: true, summary: day.close() };
});

ipcMain.handle('sale:pay', async (_e, { items, method } = {}) => {
  const waiter = requireWaiter();
  checkAutoClose();

  const data = store.getData();
  if (!data.currentDay) throw new Error('El día está cerrado. Ábralo para crear cuentas.');
  if (!['cash', 'card'].includes(method)) throw new Error('Método de pago no válido');
  if (!Array.isArray(items) || items.length === 0) throw new Error('El ticket está vacío');

  // Los precios se calculan siempre aquí, nunca con los que envía la interfaz.
  const lines = items.map(({ productId, qty }) => {
    const product = data.products.find((p) => p.id === productId && p.active !== false);
    if (!product) throw new Error('Producto no válido');
    const quantity = Math.floor(Number(qty));
    if (!(quantity > 0 && quantity <= 99)) throw new Error('Cantidad no válida');
    return {
      productId: product.id,
      name: product.name,
      unitCents: product.priceCents,
      qty: quantity,
      subtotalCents: product.priceCents * quantity,
    };
  });

  const sale = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    dayId: data.currentDay.id,
    ticketNumber: data.nextTicket++,
    date: new Date().toISOString(),
    waiter: waiter.name,
    method,
    lines,
    totalCents: lines.reduce((sum, l) => sum + l.subtotalCents, 0),
  };

  // Se guarda antes de imprimir: si la impresora falla, la venta no se pierde.
  data.sales.push(sale);
  data.commands.push(sale);
  data.commands.splice(0, Math.max(0, data.commands.length - HISTORY_SIZE));
  store.saveData();

  let warning = null;
  try {
    await printer.afterSale(sale, store.getConfig());
  } catch (err) {
    warning = err.message;
  }
  return { ok: true, sale, warning };
});

// Histórico de comandas: las más recientes primero.
ipcMain.handle('history:list', () => {
  requireWaiter();
  return store.getData().commands.slice().reverse();
});

ipcMain.handle('history:print', async (_e, id) => {
  requireWaiter();
  const sale = store.getData().commands.find((c) => c.id === id);
  if (!sale) throw new Error('Comanda no encontrada');
  await printer.printTicket(sale, store.getConfig(), { reprint: true });
  return { ok: true };
});

// Sin ticket en curso, la interfaz pide un código de camarero y lo envía aquí para comprobarlo.
ipcMain.handle('drawer:open', async (_e, { code } = {}) => {
  requireWaiter();
  if (code !== undefined) {
    if (drawerLimiter.locked()) throw new Error(LOCKED_MSG);
    const hash = store.hashCode(String(code ?? ''));
    const valid = isSuperadminHash(hash) || store.getData().waiters.some((w) => w.codeHash === hash);
    if (!valid) {
      drawerLimiter.fail();
      throw new Error('Código de camarero incorrecto');
    }
    drawerLimiter.ok();
  }
  await printer.openDrawer(store.getConfig());
  return { ok: true };
});

ipcMain.handle('app:close', (_e, code) => {
  if (closeLimiter.locked()) return { ok: false, error: LOCKED_MSG };

  const hash = store.hashCode(String(code ?? ''));
  if (hash !== store.getConfig().closeCodeHash) {
    closeLimiter.fail();
    return { ok: false, error: 'Código incorrecto' };
  }

  closeLimiter.ok();
  allowClose = true;
  // destroy() cierra la ventana sin pasar por el evento 'close' que lo bloquea.
  if (win) win.destroy();
  app.quit();
  return { ok: true };
});
