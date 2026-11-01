const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app } = require('electron');

// Datos persistentes en %APPDATA%\TPV. Cada cambio se escribe en disco en el momento,
// así que sobreviven a los apagados. Todo es local: no necesita internet.
let data = null;
let config = null;
let dataFile = null;
let configFile = null;

function hashCode(code) {
  return crypto.createHash('sha256').update(String(code)).digest('hex');
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// Escritura atómica: si se corta la luz a mitad, el fichero anterior sigue intacto.
function writeJsonAtomic(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

function defaultData() {
  return {
    categories: [
      { id: 'cocteles', name: 'Cócteles' },
      { id: 'copas', name: 'Copas' },
      { id: 'chupitos', name: 'Chupitos' },
      { id: 'cervezas', name: 'Cervezas' },
      { id: 'refrescos', name: 'Refrescos' },
    ],
    products: [
      { id: 'gin-tonic', categoryId: 'cocteles', name: 'Gin Tonic', priceCents: 1000 },
      { id: 'mojito', categoryId: 'cocteles', name: 'Mojito', priceCents: 1000 },
      { id: 'margarita', categoryId: 'cocteles', name: 'Margarita', priceCents: 1000 },
      { id: 'negroni', categoryId: 'cocteles', name: 'Negroni', priceCents: 1100 },
      { id: 'cuba-libre', categoryId: 'cocteles', name: 'Cuba Libre', priceCents: 900 },
      { id: 'ginebra', categoryId: 'copas', name: 'Copa de ginebra', priceCents: 900 },
      { id: 'ron', categoryId: 'copas', name: 'Copa de ron', priceCents: 800 },
      { id: 'whisky', categoryId: 'copas', name: 'Copa de whisky', priceCents: 1000 },
      { id: 'vodka', categoryId: 'copas', name: 'Copa de vodka', priceCents: 900 },
      { id: 'tequila', categoryId: 'chupitos', name: 'Tequila', priceCents: 350 },
      { id: 'jagermeister', categoryId: 'chupitos', name: 'Jägermeister', priceCents: 350 },
      { id: 'orujo', categoryId: 'chupitos', name: 'Orujo', priceCents: 300 },
      { id: 'cana', categoryId: 'cervezas', name: 'Caña', priceCents: 250 },
      { id: 'tercio', categoryId: 'cervezas', name: 'Tercio', priceCents: 300 },
      { id: 'cerveza-sin', categoryId: 'cervezas', name: 'Cerveza sin alcohol', priceCents: 300 },
      { id: 'coca-cola', categoryId: 'refrescos', name: 'Coca-Cola', priceCents: 300 },
      { id: 'tonica', categoryId: 'refrescos', name: 'Agua tónica', priceCents: 250 },
      { id: 'agua', categoryId: 'refrescos', name: 'Agua', priceCents: 150 },
    ],
    // Códigos iniciales: 1111 y 2222. Cámbielos en Configuración > Camareros.
    waiters: [
      { id: 'camarero1', name: 'Camarero 1', codeHash: hashCode('1111') },
      { id: 'camarero2', name: 'Camarero 2', codeHash: hashCode('2222') },
    ],
    sales: [],
    nextTicket: 1,
    // Día en curso ({ id, openedAt, openedBy }) o null si el día está cerrado.
    currentDay: null,
    // Resumen de cada día cerrado.
    days: [],
  };
}

function defaultConfig() {
  return {
    businessName: 'Bar de Copas',
    currency: 'EUR',
    // Impresora de tickets (nombre exacto en Windows). Vacío = sin impresora de tickets.
    ticketPrinterName: '',
    // Impresora con el cajón conectado al RJ11. Vacío = el cajón no se puede abrir.
    drawerPrinterName: '',
    // Qué métodos de pago imprimen ticket.
    printTickets: { cash: true, card: true },
    // Qué métodos de pago abren el cajón al cobrar.
    drawerOpensOn: { cash: true, card: false },
    // Horas que puede estar abierto el día antes de cerrarse solo.
    autoCloseHours: 20,
    // Código para poder cerrar la aplicación. Por defecto: 9999.
    closeCodeHash: hashCode('9999'),
    // Código de administración (configuración). Por defecto: 0000.
    adminCodeHash: hashCode('0000'),
  };
}

// Completa los campos nuevos en instalaciones anteriores.
function migrateData(d) {
  if (d.currentDay === undefined) d.currentDay = null;
  if (!d.days) d.days = [];
  // Últimas comandas (máximo 5) para el histórico y la reimpresión de tickets.
  if (!d.commands) d.commands = [];
  return d;
}

function migrateConfig(cfg) {
  // Versiones anteriores tenían una sola impresora y una opción solo para el efectivo.
  if (cfg.printerName !== undefined) {
    cfg.ticketPrinterName ??= cfg.printerName;
    cfg.drawerPrinterName ??= cfg.printerName;
    delete cfg.printerName;
  }
  if (cfg.openDrawerOnCash !== undefined) {
    cfg.drawerOpensOn ??= { cash: cfg.openDrawerOnCash, card: false };
    delete cfg.openDrawerOnCash;
  }
  const defaults = defaultConfig();
  for (const key of Object.keys(defaults)) {
    if (cfg[key] === undefined) cfg[key] = defaults[key];
  }
  return cfg;
}

function init() {
  const dir = app.getPath('userData');
  dataFile = path.join(dir, 'data.json');
  configFile = path.join(dir, 'config.json');

  data = migrateData(fs.existsSync(dataFile) ? readJson(dataFile) : defaultData());
  config = migrateConfig(fs.existsSync(configFile) ? readJson(configFile) : defaultConfig());

  // Se escriben al arrancar para que existan y sean fáciles de editar.
  saveData();
  saveConfig();
}

function getData() {
  return data;
}

function getConfig() {
  return config;
}

function saveData() {
  writeJsonAtomic(dataFile, data);
}

function saveConfig() {
  writeJsonAtomic(configFile, config);
}

module.exports = { init, getData, getConfig, saveData, saveConfig, hashCode };
