const store = require('./store');

// Informes de ventas (solo lectura). Un "día" es una jornada abierta y cerrada con día.js.
// Las ventas de los días cerrados se conservan en data.sales, así que se pueden volver a sumar.

function totalsOf(sales) {
  const sumBy = (method) => sales.filter((s) => s.method === method).reduce((sum, s) => sum + s.totalCents, 0);
  const cashCents = sumBy('cash');
  const cardCents = sumBy('card');
  return { count: sales.length, cashCents, cardCents, totalCents: cashCents + cardCents };
}

// Último día (abierto o cerrado) con el desglose por camarero.
function dayReport() {
  const d = store.getData();
  const open = d.currentDay;
  const day = open ?? d.days[d.days.length - 1] ?? null;
  if (!day) return null;

  const sales = d.sales.filter((s) => s.dayId === day.id);
  const byWaiter = new Map();
  for (const s of sales) {
    const w = byWaiter.get(s.waiter) ?? { name: s.waiter, count: 0, totalCents: 0 };
    w.count += 1;
    w.totalCents += s.totalCents;
    byWaiter.set(s.waiter, w);
  }

  return {
    open: Boolean(open),
    day: { openedAt: day.openedAt, closedAt: open ? null : day.closedAt },
    waiters: [...byWaiter.values()].sort((a, b) => b.totalCents - a.totalCents),
    ...totalsOf(sales),
  };
}

// Los últimos 7 días de trabajo (cerrados y el abierto), uno por línea.
function weekReport() {
  const d = store.getData();
  const list = [...d.days, ...(d.currentDay ? [d.currentDay] : [])].slice(-7);
  const days = list.map((day) => ({
    openedAt: day.openedAt,
    closedAt: day.closedAt ?? null,
    open: day.id === d.currentDay?.id,
    ...totalsOf(d.sales.filter((s) => s.dayId === day.id)),
  }));

  const sum = (key) => days.reduce((n, day) => n + day[key], 0);
  return {
    days,
    count: sum('count'),
    cashCents: sum('cashCents'),
    cardCents: sum('cardCents'),
    totalCents: sum('totalCents'),
  };
}

module.exports = { dayReport, weekReport };
