# TPV para bar de copas (Windows)

Aplicación de escritorio que funciona sin internet.

## Uso

- Al arrancar pide el **código de camarero** (mínimo 4 dígitos). Por defecto: `1111` y `2222`.
- La app no se puede cerrar con Alt+F4 ni con el botón X. Para cerrarla, pulse **Apagar TPV** e introduzca el **código de cierre**. Por defecto: `9999`.

### Día

- Para crear cuentas el día tiene que estar **abierto**. Pulse **Abrir día** e introduzca un código de camarero o de administración.
- Para **cerrar el día** (y ver su resumen) también hace falta un código de camarero o de administración. No se puede cerrar con un ticket en curso.
- Si el día lleva **más de X horas abierto**, se cierra solo. X es el ajuste "Cierre automático del día" (por defecto 20, entre 1 y 48). Esto también ocurre al arrancar el equipo si estuvo apagado más de ese tiempo.

### Cajón

- Con un ticket en curso, **Abrir cajón** lo abre directamente.
- Sin ticket, pide el **código de un camarero**.
- El cajón nunca imprime nada: solo recibe el pulso de apertura.

## Configuración

Pulse **Configuración** (en la pantalla de acceso o en el TPV) e introduzca el **código de administración**. Por defecto: `0000`. Cámbielo en cuanto instale la app.

- **Camareros**: añadir, editar (nombre y código) o eliminar.
- **Productos**: añadir, editar nombre, categoría y precio, o retirarlo del TPV desmarcando "Activo". Los cambios de precio solo afectan a tickets nuevos.
- **Categorías**: añadir, renombrar o eliminar (solo si no tienen productos).
- **Códigos**: cambiar el código de administración y el de cierre.
- **Ajustes**:
  - Nombre del negocio.
  - Impresora de tickets.
  - Impresora con el cajón conectado.
  - Qué métodos de pago (efectivo, tarjeta) imprimen ticket.
  - Qué métodos de pago abren el cajón.

Ningún código puede repetirse entre camareros, administración y cierre. La sesión de administración caduca tras 5 minutos sin actividad.

## Instalación

- `dist\TPV Setup 2.0.0.exe`: instalador.
- `dist\TPV 2.0.0.exe`: versión portable, no necesita instalación.

La versión 1.0.0 se conserva en `releases\1.0.0\` (no se versiona en git).

## Datos

Están en `%APPDATA%\TPV\` y se escriben en disco en cada cambio, así que se conservan al apagar el equipo:

- `config.json`: nombre del negocio, impresoras, opciones de tickets y cajón, y códigos de cierre y administración (como hash).
- `data.json`: productos, categorías, camareros (con su código en hash), ventas, día en curso e historial de días cerrados.

Para editarlos a mano, cierre la app antes. Para generar el hash de un código nuevo, ejecute en PowerShell:

```
node -e "console.log(require('crypto').createHash('sha256').update('SU_CODIGO').digest('hex'))"
```

Lo normal es usar la pantalla de Configuración, que no requiere tocar ficheros.

## Impresoras

1. Conecte el cajón al conector RJ11 de la impresora térmica.
2. En Windows, anote el nombre exacto de la impresora (Configuración > Impresoras).
3. En **Configuración > Ajustes**, introdúzcalo en "Impresora con el cajón". Si quiere tickets, ponga también la impresora en "Impresora de tickets".

El cajón se abre enviando un pulso a la impresora que tiene conectado, así que necesita una impresora configurada. Lo que no hace falta es que esa impresora imprima tickets: puede tener la impresión de tickets desactivada.

## Limitaciones conocidas

- Ctrl+Alt+Supr y el Administrador de tareas no se pueden bloquear desde la aplicación. Para un bloqueo total del equipo hace falta configurar Windows con "Acceso asignado" (Assigned Access / kiosco).
- Los tickets se imprimen con codificación latin1 (el símbolo € se escribe como EUR). Si sale texto raro, revise la página de códigos de la impresora.
- Las cuentas abiertas por mesa (cobrar al final) no están implementadas todavía.
- La comprobación del código de camarero para el cajón se hace en la interfaz y en el proceso principal, que no sabe si hay ticket en curso. Protege el uso normal del TPV, pero no es una barrera frente a alguien que manipule la aplicación.
