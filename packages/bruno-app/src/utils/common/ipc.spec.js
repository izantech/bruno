import ipc, { callIpc, __resetIpcForTests } from './ipc';

beforeEach(() => {
  __resetIpcForTests();
  delete window.ipcRenderer;
  delete window.Capacitor;
});

describe('backend selection', () => {
  it('selects electron when window.ipcRenderer is present', () => {
    window.ipcRenderer = {
      invoke: jest.fn(),
      send: jest.fn(),
      on: jest.fn(() => () => {}),
      getFilePath: jest.fn(() => '/some/path'),
      openExternal: jest.fn()
    };
    expect(ipc.platform).toBe('electron');
  });

  it('selects capacitor when Capacitor.isNativePlatform() is true', () => {
    window.Capacitor = { isNativePlatform: () => true };
    expect(ipc.platform).toBe('capacitor');
  });

  it('selects stub when neither ipcRenderer nor Capacitor is present', () => {
    expect(ipc.platform).toBe('stub');
  });

  it('prefers electron over capacitor when both are present', () => {
    window.ipcRenderer = {
      invoke: jest.fn(),
      send: jest.fn(),
      on: jest.fn(() => () => {}),
      getFilePath: jest.fn(),
      openExternal: jest.fn()
    };
    window.Capacitor = { isNativePlatform: () => true };
    expect(ipc.platform).toBe('electron');
  });
});

describe('electron backend', () => {
  beforeEach(() => {
    window.ipcRenderer = {
      invoke: jest.fn((channel, ...args) => Promise.resolve({ channel, args })),
      send: jest.fn(),
      on: jest.fn((channel, handler) => () => { /* unsubscribe */ }),
      getFilePath: jest.fn(() => '/resolved/path'),
      openExternal: jest.fn()
    };
  });

  it('delegates invoke to ipcRenderer.invoke', async () => {
    await ipc.invoke('some:channel', 'arg1');
    expect(window.ipcRenderer.invoke).toHaveBeenCalledWith('some:channel', 'arg1');
  });

  it('delegates send to ipcRenderer.send', () => {
    ipc.send('renderer:theme-change', 'dark', '#000');
    expect(window.ipcRenderer.send).toHaveBeenCalledWith('renderer:theme-change', 'dark', '#000');
  });

  it('delegates on to ipcRenderer.on and returns unsubscribe fn', () => {
    const handler = jest.fn();
    const unsub = ipc.on('main:collection-opened', handler);
    expect(window.ipcRenderer.on).toHaveBeenCalledWith('main:collection-opened', handler);
    expect(typeof unsub).toBe('function');
  });

  it('wraps getFilePath result in a Promise', async () => {
    const result = await ipc.getFilePath({ name: 'file.txt' });
    expect(result).toBe('/resolved/path');
  });

  it('delegates openExternal to ipcRenderer.openExternal', () => {
    ipc.openExternal('https://example.com');
    expect(window.ipcRenderer.openExternal).toHaveBeenCalledWith('https://example.com');
  });
});

describe('stub backend', () => {
  it('invoke rejects with a message containing the channel name', async () => {
    await expect(ipc.invoke('some:channel')).rejects.toThrow('some:channel');
  });

  it('send is a no-op returning undefined', () => {
    expect(ipc.send('any:channel')).toBeUndefined();
  });

  it('on returns a no-op unsubscribe function', () => {
    const unsub = ipc.on('main:event', jest.fn());
    expect(typeof unsub).toBe('function');
    expect(() => unsub()).not.toThrow();
  });

  it('getFilePath rejects', async () => {
    await expect(ipc.getFilePath({})).rejects.toThrow('getFilePath unavailable: no native host');
  });

  it('openExternal calls window.open and returns a resolved Promise', async () => {
    const openSpy = jest.spyOn(window, 'open').mockImplementation(() => null);
    await expect(ipc.openExternal('https://example.com')).resolves.toBeUndefined();
    expect(openSpy).toHaveBeenCalledWith('https://example.com', '_blank', 'noopener,noreferrer');
    openSpy.mockRestore();
  });
});

describe('callIpc', () => {
  it('delegates to ipc.invoke', async () => {
    window.ipcRenderer = {
      invoke: jest.fn(() => Promise.resolve('result')),
      send: jest.fn(),
      on: jest.fn(() => () => {}),
      getFilePath: jest.fn(),
      openExternal: jest.fn()
    };
    const result = await callIpc('some:channel', 'arg');
    expect(window.ipcRenderer.invoke).toHaveBeenCalledWith('some:channel', 'arg');
    expect(result).toBe('result');
  });
});
