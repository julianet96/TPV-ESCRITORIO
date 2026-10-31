// Limita los intentos de código: tras 5 fallos, espera 30 segundos.
function makeLimiter(maxFails = 5, lockMs = 30000) {
  let fails = 0;
  let lockedUntil = 0;
  return {
    locked() {
      return Date.now() < lockedUntil;
    },
    fail() {
      fails++;
      if (fails >= maxFails) {
        fails = 0;
        lockedUntil = Date.now() + lockMs;
      }
    },
    ok() {
      fails = 0;
    },
  };
}

const LOCKED_MSG = 'Demasiados intentos. Espere 30 segundos.';

module.exports = { makeLimiter, LOCKED_MSG };
