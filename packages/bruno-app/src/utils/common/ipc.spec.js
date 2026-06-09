import ipc, { callIpc, collectionRootFor, __resetIpcForTests } from './ipc';
import { stringifyRequest } from '@usebruno/filestore/web';

jest.mock('@usebruno/filestore/web', () => ({
  stringifyRequest: jest.fn(() => 'STRINGIFIED'),
  stringifyCollection: jest.fn(),
  stringifyFolder: jest.fn(),
  stringifyEnvironment: jest.fn(),
  parseRequest: jest.fn(),
  parseCollection: jest.fn(),
  parseFolder: jest.fn(),
  parseEnvironment: jest.fn()
}));

const mockPlugin = {
  scanWorkspace: jest.fn(),
  readDirTree: jest.fn(),
  readFile: jest.fn(),
  writeFile: jest.fn(),
  deleteEntry: jest.fn(),
  mkdir: jest.fn(),
  rename: jest.fn(),
  copyTree: jest.fn(),
  stat: jest.fn(),
  exists: jest.fn(),
  mountCollection: jest.fn(),
  snapshotGet: jest.fn(),
  snapshotSave: jest.fn(),
  getDocumentsRoot: jest.fn(),
  addListener: jest.fn(() => Promise.resolve({ remove: jest.fn() })),
  removeAllListeners: jest.fn()
};

beforeEach(() => {
  __resetIpcForTests();
  delete window.ipcRenderer;
  delete window.Capacitor;
  jest.clearAllMocks();
});

const withCapacitor = () => {
  window.Capacitor = {
    isNativePlatform: () => true,
    Plugins: { BrunoFilesystem: mockPlugin }
  };
};

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
    withCapacitor();
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
    withCapacitor();
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

describe('capacitor backend — save paths', () => {
  beforeEach(() => {
    withCapacitor();
    mockPlugin.writeFile.mockResolvedValue(undefined);
  });

  const makeItem = () => ({
    type: 'http',
    name: 'foo',
    filename: 'foo.bru',
    request: {
      method: 'GET',
      url: '{{host}}/foo',
      params: [],
      headers: [],
      body: { mode: 'none' },
      vars: { req: [], res: [] },
      assertions: []
    }
  });

  it('new-request derives bru format from the path, writes the file, and emits addFile with a hydrated uid', async () => {
    const events = [];
    ipc.on('main:collection-tree-updated', (type, val) => events.push({ type, val }));

    const item = makeItem();
    await ipc.invoke('renderer:new-request', '@documents/MyCol/foo.bru', item);

    expect(stringifyRequest).toHaveBeenCalledWith(item, { format: 'bru' });
    expect(mockPlugin.writeFile).toHaveBeenCalledWith({ path: '@documents/MyCol/foo.bru', content: 'STRINGIFIED' });

    // the addFile event is deferred to a macrotask so the renderer's OPEN_REQUEST task is
    // queued first; flush it before asserting the emit
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('addFile');
    expect(events[0].val.meta.pathname).toBe('@documents/MyCol/foo.bru');
    expect(events[0].val.data).toBe(item);
    expect(typeof item.uid).toBe('string');
    expect(item.uid.length).toBeGreaterThan(0);
  });

  it('new-request derives yml format for a .yml path', async () => {
    await ipc.invoke('renderer:new-request', '@documents/MyCol/foo.yml', makeItem());
    expect(stringifyRequest).toHaveBeenCalledWith(expect.any(Object), { format: 'yml' });
  });

  it('save-request uses the passed format and emits change (existing item)', async () => {
    const events = [];
    ipc.on('main:collection-tree-updated', (type, val) => events.push({ type, val }));

    const item = makeItem();
    await ipc.invoke('renderer:save-request', '@documents/MyCol/foo.bru', item, 'bru');

    expect(stringifyRequest).toHaveBeenCalledWith(item, { format: 'bru' });
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('change');
  });

  it('mount-workspace-scratch creates the scratch dir and returns a stable token', async () => {
    mockPlugin.mkdir.mockResolvedValue(undefined);
    const token = await ipc.invoke('renderer:mount-workspace-scratch', { workspaceUid: 'w1', workspacePath: 'default' });
    expect(mockPlugin.mkdir).toHaveBeenCalledWith({ path: '@documents/tmp/scratch' });
    expect(token).toBe('@documents/tmp/scratch');
  });
});

describe('collectionRootFor', () => {
  it('returns the registered root for a nested item path', () => {
    const roots = new Set(['@documents/MyCol']);
    expect(collectionRootFor('@documents/MyCol/sub/req.bru', roots)).toBe('@documents/MyCol');
  });

  it('returns the root token itself when the item IS the root', () => {
    const roots = new Set(['@documents/MyCol']);
    expect(collectionRootFor('@documents/MyCol', roots)).toBe('@documents/MyCol');
  });

  it('picks the longest matching root for a transient deep path', () => {
    const tmpRoot = '@documents/tmp/BBBBBBBB-2222/MyCol';
    const roots = new Set(['@documents/MyCol', tmpRoot]);
    expect(collectionRootFor(`${tmpRoot}/req.bru`, roots)).toBe(tmpRoot);
  });

  it('does not match a root that is only a partial segment prefix', () => {
    const roots = new Set(['@documents/My']);
    expect(collectionRootFor('@documents/MyCol/req.bru', roots)).not.toBe('@documents/My');
  });

  it('falls back to the first @documents segment when no root is registered', () => {
    const roots = new Set();
    expect(collectionRootFor('@documents/MyCol/sub/req.bru', roots)).toBe('@documents/MyCol');
  });

  it('fallback returns correct root for a transient path with no registry', () => {
    const roots = new Set();
    expect(collectionRootFor('@documents/tmp', roots)).toBe('@documents/tmp');
  });
});
