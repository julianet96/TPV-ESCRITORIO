const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// ESC p 0 25 250: pulso al conector RJ11 de la impresora que abre el cajón.
// Solo contiene el pulso: el cajón nunca imprime nada.
const DRAWER_KICK = Buffer.from([0x1b, 0x70, 0x00, 0x19, 0xfa]);
const INIT = Buffer.from([0x1b, 0x40]);
const CUT = Buffer.from([0x1d, 0x56, 0x42, 0x00]);
const WIDTH = 42;

// Las impresoras térmicas con ESC/POS suelen usar latin1/cp858; el símbolo € no existe en latin1.
function encode(text) {
  return Buffer.from(text.replace(/€/g, 'EUR'), 'latin1');
}

function eur(cents, currency) {
  return (cents / 100).toLocaleString('es-ES', { style: 'currency', currency: currency || 'EUR' });
}

// Una línea con texto a la izquierda y valor a la derecha. Si no cabe, se recorta el texto de la izquierda.
function line(left, right) {
  const maxLeft = Math.max(0, WIDTH - right.length - 1);
  const text = left.length > maxLeft ? left.slice(0, maxLeft) : left;
  const space = Math.max(1, WIDTH - text.length - right.length);
  return text + ' '.repeat(space) + right + '\n';
}

function buildTicket(sale, cfg, { reprint = false } = {}) {
  const METHOD = { cash: 'Efectivo', card: 'Tarjeta' };
  let text = '';
  text += cfg.businessName.padStart(Math.floor((WIDTH + cfg.businessName.length) / 2)) + '\n';
  text += '-'.repeat(WIDTH) + '\n';
  if (reprint) text += 'REIMPRESION\n';
  text += `Ticket: ${sale.ticketNumber}\n`;
  text += `Fecha: ${new Date(sale.date).toLocaleString('es-ES')}\n`;
  text += `Camarero: ${sale.waiter}\n`;
  text += '-'.repeat(WIDTH) + '\n';
  for (const l of sale.lines) {
    text += line(`${l.qty} x ${l.name}`, eur(l.subtotalCents, cfg.currency));
  }
  text += '-'.repeat(WIDTH) + '\n';
  text += line('TOTAL', eur(sale.totalCents, cfg.currency));
  text += line('Pago', METHOD[sale.method] || sale.method);
  text += '\n\n\n';
  return Buffer.concat([INIT, encode(text), CUT]);
}

// Envía bytes en bruto a la cola de impresión de Windows (sin driver de gráficos).
function sendRaw(printerName, buffer) {
  return new Promise((resolve, reject) => {
    const file = path.join(os.tmpdir(), `tpv-${Date.now()}-${Math.random().toString(36).slice(2)}.bin`);
    fs.writeFileSync(file, buffer);

    // En la versión empaquetada el .ps1 está fuera del asar (ver asarUnpack en package.json).
    const script = path.join(__dirname, 'print-raw.ps1').replace('app.asar', 'app.asar.unpacked');
    const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script,
      '-PrinterName', printerName, '-FilePath', file];

    execFile('powershell.exe', args, { windowsHide: true, timeout: 15000 }, (err, stdout, stderr) => {
      fs.rm(file, { force: true }, () => {});
      if (err) {
        const detail = (stderr || err.message || '').trim();
        return reject(new Error(`No se pudo imprimir en "${printerName}": ${detail}`));
      }
      resolve();
    });
  });
}

async function openDrawer(cfg) {
  if (!cfg.drawerPrinterName) throw new Error('No hay impresora del cajón configurada');
  await sendRaw(cfg.drawerPrinterName, DRAWER_KICK);
}

// Tras cada venta: abre el cajón y/o imprime el ticket según la configuración del método de pago.
// Si una de las dos cosas falla, la venta ya está guardada y se informa del problema.
async function afterSale(sale, cfg) {
  const problems = [];

  if (cfg.drawerOpensOn[sale.method]) {
    try {
      await openDrawer(cfg);
    } catch (err) {
      problems.push(err.message);
    }
  }

  if (cfg.printTickets[sale.method]) {
    try {
      if (!cfg.ticketPrinterName) throw new Error('No hay impresora de tickets configurada');
      await sendRaw(cfg.ticketPrinterName, buildTicket(sale, cfg));
    } catch (err) {
      problems.push(err.message);
    }
  }

  if (problems.length) throw new Error(problems.join('. '));
}

// Formato de los informes (día y semana), listo para imprimir con buildReport.
function fmtDate(iso) {
  return new Date(iso).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function dayReportSpec(report, cfg) {
  const money = (cents) => eur(cents, cfg.currency);
  const subtitle = [
    report.open ? 'Estado: día abierto' : 'Estado: último día cerrado',
    `Apertura: ${fmtDate(report.day.openedAt)}`,
  ];
  if (report.day.closedAt) subtitle.push(`Cierre: ${fmtDate(report.day.closedAt)}`);
  const rows = report.waiters.length
    ? report.waiters.map((w) => ({ left: `${w.name} (${w.count})`, right: money(w.totalCents) }))
    : [{ left: 'Sin ventas', right: money(0) }];
  return {
    title: 'INFORME DEL DÍA',
    subtitle,
    rows,
    totals: [
      { left: 'Efectivo', right: money(report.cashCents) },
      { left: 'Tarjeta', right: money(report.cardCents) },
      { left: `TOTAL (${report.count} tickets)`, right: money(report.totalCents) },
    ],
  };
}

function weekReportSpec(report, cfg) {
  const money = (cents) => eur(cents, cfg.currency);
  const rows = report.days.length
    ? report.days.map((d) => ({ left: `${fmtDate(d.openedAt)}${d.open ? ' *' : ''} (${d.count})`, right: money(d.totalCents) }))
    : [{ left: 'Sin días registrados', right: money(0) }];
  return {
    title: 'INFORME SEMANAL',
    subtitle: ['Últimos 7 días (* = día abierto)'],
    rows,
    totals: [{ left: `TOTAL (${report.count} tickets)`, right: money(report.totalCents) }],
  };
}

// Texto de un informe: cabecera, título, líneas y totales. Mismo formato que el ticket.
function buildReport(cfg, spec) {
  let text = '';
  text += cfg.businessName.padStart(Math.floor((WIDTH + cfg.businessName.length) / 2)) + '\n';
  text += '-'.repeat(WIDTH) + '\n';
  text += spec.title + '\n';
  for (const s of spec.subtitle) text += s + '\n';
  text += '-'.repeat(WIDTH) + '\n';
  for (const r of spec.rows) text += line(r.left, r.right);
  text += '-'.repeat(WIDTH) + '\n';
  for (const t of spec.totals) text += line(t.left, t.right);
  text += '\n\n\n';
  return Buffer.concat([INIT, encode(text), CUT]);
}

async function printReport(cfg, spec) {
  if (!cfg.ticketPrinterName) throw new Error('No hay impresora de tickets configurada');
  await sendRaw(cfg.ticketPrinterName, buildReport(cfg, spec));
}

// Imprime solo el ticket (desde el histórico de comandas). Lanza error si no hay impresora de tickets.
async function printTicket(sale, cfg, options) {
  if (!cfg.ticketPrinterName) throw new Error('No hay impresora de tickets configurada');
  await sendRaw(cfg.ticketPrinterName, buildTicket(sale, cfg, options));
}

module.exports = { openDrawer, afterSale, printTicket, buildTicket, dayReportSpec, weekReportSpec, printReport };
