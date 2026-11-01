const { contextBridge, ipcRenderer } = require('electron');

// Solo estas funciones llegan a la interfaz; no hay acceso directo a Node.
contextBridge.exposeInMainWorld('tpv', {
  login: (code) => ipcRenderer.invoke('auth:login', code),
  logout: () => ipcRenderer.invoke('auth:logout'),
  getMenu: () => ipcRenderer.invoke('menu:get'),
  pay: (items, method) => ipcRenderer.invoke('sale:pay', { items, method }),
  openDrawer: (code) => ipcRenderer.invoke('drawer:open', { code }),
  openDay: (code) => ipcRenderer.invoke('day:open', { code }),
  closeDay: (code) => ipcRenderer.invoke('day:close', { code }),
  // El proceso principal avisa cuando el día se cierra automáticamente.
  onDayClosed: (callback) => ipcRenderer.on('day:closed', (_e, summary) => callback(summary)),
  requestClose: (code) => ipcRenderer.invoke('app:close', code),
  history: {
    list: () => ipcRenderer.invoke('history:list'),
    print: (id) => ipcRenderer.invoke('history:print', id),
  },
  admin: {
    login: (code) => ipcRenderer.invoke('admin:login', code),
    logout: () => ipcRenderer.invoke('admin:logout'),
    data: () => ipcRenderer.invoke('admin:data'),
    saveWaiter: (values) => ipcRenderer.invoke('admin:save-waiter', values),
    deleteWaiter: (id) => ipcRenderer.invoke('admin:delete-waiter', id),
    saveCategory: (values) => ipcRenderer.invoke('admin:save-category', values),
    deleteCategory: (id) => ipcRenderer.invoke('admin:delete-category', id),
    saveProduct: (values) => ipcRenderer.invoke('admin:save-product', values),
    saveSettings: (values) => ipcRenderer.invoke('admin:save-settings', values),
    setCode: (values) => ipcRenderer.invoke('admin:set-code', values),
    printers: () => ipcRenderer.invoke('admin:printers'),
    reportDay: () => ipcRenderer.invoke('admin:report-day'),
    reportWeek: () => ipcRenderer.invoke('admin:report-week'),
    printReport: (type) => ipcRenderer.invoke('admin:report-print', type),
  },
});
