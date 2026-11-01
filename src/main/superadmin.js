const crypto = require('crypto');

// Código de superadministrador. Es fijo: no está en config.json ni en data.json, no se envía
// a la interfaz y no se puede cambiar desde la aplicación. Sirve como código de camarero
// (abrir/cerrar el día, cobrar) y como código de administración (Configuración).
const SUPERADMIN = { id: 'superadmin', name: 'Superadmin' };
const SUPERADMIN_HASH = crypto.createHash('sha256').update('131096').digest('hex');

function isSuperadminHash(hash) {
  return hash === SUPERADMIN_HASH;
}

module.exports = { SUPERADMIN, isSuperadminHash };
