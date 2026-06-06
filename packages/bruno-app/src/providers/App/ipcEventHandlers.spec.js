import subscribeIpcEvents from './ipcEventHandlers';

const makeIpc = () => {
  const listeners = {};
  const unsubscribers = {};

  const ipc = {
    invoke: jest.fn(() => Promise.resolve()),
    on: jest.fn((channel, handler) => {
      listeners[channel] = handler;
      const unsub = jest.fn();
      unsubscribers[channel] = unsub;
      return unsub;
    })
  };

  return { ipc, listeners, unsubscribers };
};

const makeStore = (stateOverrides = {}) => ({
  getState: () => ({
    workspaces: {
      activeWorkspaceUid: 'ws1',
      workspaces: [{ uid: 'ws1', pathname: '/workspace' }]
    },
    tabs: { tabs: [], activeTabUid: null },
    ...stateOverrides
  })
});

describe('subscribeIpcEvents', () => {
  it('registers all expected IPC channels', () => {
    const { ipc } = makeIpc();
    const dispatch = jest.fn();
    const store = makeStore();

    subscribeIpcEvents(ipc, { dispatch, store });

    const channels = ipc.on.mock.calls.map((call) => call[0]);

    const expected = [
      'main:collection-tree-updated',
      'main:apispec-tree-updated',
      'main:collection-opened',
      'main:workspace-opened',
      'main:workspace-config-updated',
      'main:workspace-environment-added',
      'main:workspace-environment-changed',
      'main:workspace-environment-deleted',
      'main:display-error',
      'main:script-environment-update',
      'main:persistent-env-variables-update',
      'main:global-environment-variables-update',
      'main:collection-renamed',
      'main:run-folder-event',
      'main:run-request-event',
      'main:process-env-update',
      'main:workspace-dotenv-update',
      'main:dotenv-file-update',
      'main:console-log',
      'main:filesync-system-resources',
      'main:bruno-config-update',
      'main:open-preferences',
      'main:load-preferences',
      'main:cookies-update',
      'main:load-global-environments',
      'main:hydrate-app-with-ui-state-snapshot',
      'main:credentials-update',
      'main:credentials-clear',
      'main:http-stream-new-data',
      'main:http-stream-end',
      'main:collection-loading-state-updated',
      'main:git-version'
    ];

    expected.forEach((channel) => {
      expect(channels).toContain(channel);
    });
  });

  it('teardown calls every unsubscribe function', () => {
    const { ipc, unsubscribers } = makeIpc();
    const dispatch = jest.fn();
    const store = makeStore();

    const teardown = subscribeIpcEvents(ipc, { dispatch, store });
    teardown();

    Object.values(unsubscribers).forEach((unsub) => {
      expect(unsub).toHaveBeenCalledTimes(1);
    });
  });

  it('dispatches run-request-event payload', () => {
    const { ipc, listeners } = makeIpc();
    const dispatch = jest.fn();
    const store = makeStore();

    subscribeIpcEvents(ipc, { dispatch, store });

    const payload = { requestId: 'r1', status: 'done' };
    listeners['main:run-request-event'](payload);

    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ payload }));
  });

  it('dispatches run-folder-event payload', () => {
    const { ipc, listeners } = makeIpc();
    const dispatch = jest.fn();
    const store = makeStore();

    subscribeIpcEvents(ipc, { dispatch, store });

    const payload = { folderId: 'f1', status: 'done' };
    listeners['main:run-folder-event'](payload);

    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ payload }));
  });

  it('invokes renderer:get-global-environments on workspace-environment-added', () => {
    const { ipc, listeners } = makeIpc();
    const dispatch = jest.fn();
    const store = makeStore();

    subscribeIpcEvents(ipc, { dispatch, store });

    listeners['main:workspace-environment-added']('ws1', {});

    expect(ipc.invoke).toHaveBeenCalledWith('renderer:get-global-environments', {
      workspaceUid: 'ws1',
      workspacePath: '/workspace'
    });
  });
});
