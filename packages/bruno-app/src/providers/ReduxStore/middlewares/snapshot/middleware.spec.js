const { describe, it, expect, jest } = require('@jest/globals');

jest.mock('utils/common/ipc', () => ({
  __esModule: true,
  default: {
    invoke: jest.fn()
  }
}));

jest.mock('utils/snapshot', () => ({
  SAVE_TRIGGERS: new Set(),
  shouldExcludeTab: jest.fn(() => false),
  serializeTab: jest.fn((t) => t),
  serializeActiveTab: jest.fn(() => null),
  getCollectionEnvironmentPath: jest.fn(() => ''),
  hydrateSnapshotLookups: jest.fn(() => ({
    workspacesByPath: {},
    collectionsByPath: {},
    collectionsByWorkspaceAndPath: {},
    tabsByCollectionPath: {},
    tabsByWorkspaceAndCollectionPath: {},
    hasWorkspaceScopedTabs: false
  }))
}));

jest.mock('utils/common/path', () => ({
  normalizePath: jest.fn((p) => (p || '').replace(/\\/g, '/'))
}));

jest.mock('providers/ReduxStore/slices/logs', () => ({
  TAB_IDENFIERS: ['terminal', 'console', 'network']
}));

const ipc = require('utils/common/ipc').default;
const { serializeSnapshot } = require('./middleware');

const makeState = (overrides = {}) => ({
  workspaces: {
    workspaces: [],
    activeWorkspaceUid: null,
    ...((overrides.workspaces) || {})
  },
  collections: {
    collections: [],
    collectionSortOrder: 'default',
    tempDirectories: {},
    ...((overrides.collections) || {})
  },
  tabs: {
    tabs: [],
    activeTabUid: null,
    ...((overrides.tabs) || {})
  },
  logs: {
    isConsoleOpen: false,
    activeTab: 'terminal',
    ...((overrides.logs) || {})
  },
  globalEnvironments: {
    activeGlobalEnvironmentUid: '',
    ...((overrides.globalEnvironments) || {})
  },
  app: {
    snapshotHydration: null,
    ...((overrides.app) || {})
  }
});

describe('serializeSnapshot', () => {
  it('does not throw when renderer:snapshot:get resolves null (first-boot Capacitor case)', async () => {
    ipc.invoke.mockResolvedValue(null);

    const state = makeState();
    let snapshot;
    await expect(
      serializeSnapshot(state).then((s) => { snapshot = s; })
    ).resolves.not.toThrow();

    expect(snapshot.extras.devTools.tabs).toEqual(expect.any(Object));
    expect(Object.prototype.hasOwnProperty.call(snapshot.extras.devTools.tabs, 'terminal')).toBe(true);
  });

  it('merges existing devTools tabs and does not mutate the original object', async () => {
    const existingTabsObj = { network: {} };
    const existingSnapshot = {
      extras: {
        devTools: {
          activeTab: 'network',
          tabs: existingTabsObj
        }
      }
    };
    ipc.invoke.mockResolvedValue(existingSnapshot);

    const state = makeState({
      logs: { isConsoleOpen: false, activeTab: 'terminal' }
    });

    const snapshot = await serializeSnapshot(state);

    // Result must contain both keys
    expect(Object.prototype.hasOwnProperty.call(snapshot.extras.devTools.tabs, 'network')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(snapshot.extras.devTools.tabs, 'terminal')).toBe(true);

    // Original object must NOT be mutated
    expect(Object.prototype.hasOwnProperty.call(existingTabsObj, 'terminal')).toBe(false);
  });
});
