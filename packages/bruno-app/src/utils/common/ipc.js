let _backend = null;

const getBackend = () => {
  if (_backend) return _backend;

  if (window && window.ipcRenderer) {
    _backend = {
      name: 'electron',
      invoke: (c, ...a) => window.ipcRenderer.invoke(c, ...a),
      send: (c, ...a) => window.ipcRenderer.send(c, ...a),
      on: (c, h) => window.ipcRenderer.on(c, h),
      getFilePath: (file) => Promise.resolve(window.ipcRenderer.getFilePath(file)),
      openExternal: (url) => window.ipcRenderer.openExternal(url)
    };
    return _backend;
  }

  if (window && window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform()) {
    _backend = {
      name: 'capacitor',
      invoke: (channel) => Promise.reject(new Error(`invoke(${channel}): no native host`)),
      send: () => undefined,
      on: () => () => {},
      getFilePath: () => Promise.reject(new Error('getFilePath unavailable: no native host')),
      openExternal: (url) => {
        window.open(url, '_blank', 'noopener,noreferrer');
        return Promise.resolve();
      }
    };
    return _backend;
  }

  _backend = {
    name: 'stub',
    invoke: (channel) => Promise.reject(new Error(`invoke(${channel}): no native host`)),
    send: () => undefined,
    on: () => () => {},
    getFilePath: () => Promise.reject(new Error('getFilePath unavailable: no native host')),
    openExternal: (url) => {
      window.open(url, '_blank', 'noopener,noreferrer');
      return Promise.resolve();
    }
  };
  return _backend;
};

const ipc = {
  invoke: (c, ...a) => getBackend().invoke(c, ...a),
  send: (c, ...a) => getBackend().send(c, ...a),
  on: (c, h) => getBackend().on(c, h),
  getFilePath: (file) => getBackend().getFilePath(file),
  openExternal: (url) => getBackend().openExternal(url),
  get platform() { return getBackend().name; }
};

export const __resetIpcForTests = () => {
  _backend = null;
};

export const callIpc = (channel, ...args) => ipc.invoke(channel, ...args);

export default ipc;
