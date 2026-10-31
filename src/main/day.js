const crypto = require('crypto');
const store = require('./store');

function fail(message) {
  throw new Error(message);
}

function current() {
  return store.getData().currentDay;
}

function open(openedBy) {
  const d = store.getData();
  if (d.currentDay) fail('El día ya está abierto');
  d.currentDay = {
    id: `dia-${Date.now().toString(36)}-${crypto.randomBytes(2).toString('hex')}`,
    openedAt: new Date().toISOString(),
    openedBy,
  };
  store.saveData();
  return d.currentDay;
}

function summarize(day, closedAt, auto) {
  const sales = store.getData().sales.filter((s) => s.dayId === day.id);
  const sumBy = (method) => sales.filter((s) => s.method === method).reduce((sum, s) => sum + s.totalCents, 0);
  const cashCents = sumBy('cash');
  const cardCents = sumBy('card');
  return {
    id: day.id,
    openedAt: day.openedAt,
    openedBy: day.openedBy,
    closedAt,
    auto,
    count: sales.length,
    cashCents,
    cardCents,
    totalCents: cashCents + cardCents,
  };
}

// Cierra el día, guarda su resumen en el historial y lo devuelve.
function close({ auto = false } = {}) {
  const d = store.getData();
  if (!d.currentDay) fail('El día ya está cerrado');
  const summary = summarize(d.currentDay, new Date().toISOString(), auto);
  d.days.push(summary);
  d.currentDay = null;
  store.saveData();
  return summary;
}

// Devuelve el resumen si el día se ha cerrado automáticamente en esta llamada; si no, null.
// El tiempo máximo abierto lo fija el ajuste autoCloseHours (Configuración > Ajustes).
function autoCloseIfExpired() {
  const day = current();
  const maxOpenMs = store.getConfig().autoCloseHours * 60 * 60 * 1000;
  if (!day || Date.now() - Date.parse(day.openedAt) <= maxOpenMs) return null;
  return close({ auto: true });
}

module.exports = { current, open, close, autoCloseIfExpired };
