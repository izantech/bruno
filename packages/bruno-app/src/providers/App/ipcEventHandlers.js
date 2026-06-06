import {
  updateCookies,
  updatePreferences,
  setGitVersion
} from 'providers/ReduxStore/slices/app';
import {
  addTab
} from 'providers/ReduxStore/slices/tabs';
import {
  brunoConfigUpdateEvent,
  collectionAddDirectoryEvent,
  collectionAddFileEvent,
  collectionChangeFileEvent,
  collectionRenamedEvent,
  collectionUnlinkDirectoryEvent,
  collectionUnlinkEnvFileEvent,
  collectionUnlinkFileEvent,
  processEnvUpdateEvent,
  workspaceEnvUpdateEvent,
  requestCancelled,
  runFolderEvent,
  runRequestEvent,
  scriptEnvironmentUpdateEvent,
  streamDataReceived,
  setDotEnvVariables
} from 'providers/ReduxStore/slices/collections';
import { collectionAddEnvFileEvent, openCollectionEvent, hydrateCollectionWithUiStateSnapshot, mergeAndPersistEnvironment } from 'providers/ReduxStore/slices/collections/actions';
import {
  workspaceOpenedEvent,
  workspaceConfigUpdatedEvent,
  hydrateSnapshotForOpenedCollection
} from 'providers/ReduxStore/slices/workspaces/actions';
import { workspaceDotEnvUpdateEvent, setWorkspaceDotEnvVariables } from 'providers/ReduxStore/slices/workspaces';
import toast from 'react-hot-toast';
import { globalEnvironmentsUpdateEvent, updateGlobalEnvironments } from 'providers/ReduxStore/slices/global-environments';
import { collectionAddOauth2CredentialsByUrl, collectionClearOauth2CredentialsByCredentialsId, updateCollectionLoadingState } from 'providers/ReduxStore/slices/collections/index';
import { addLog } from 'providers/ReduxStore/slices/logs';
import { updateSystemResources } from 'providers/ReduxStore/slices/performance';
import { apiSpecAddFileEvent, apiSpecChangeFileEvent } from 'providers/ReduxStore/slices/apiSpec';

const subscribeIpcEvents = (ipc, { dispatch, store }) => {
  const _collectionTreeUpdated = (type, val) => {
    if (window.__IS_DEV__) {
      console.log(type);
      console.log(val);
    }
    if (type === 'addDir') {
      dispatch(
        collectionAddDirectoryEvent({
          dir: val
        })
      );
    }
    if (type === 'addFile') {
      dispatch(
        collectionAddFileEvent({
          file: val
        })
      );
    }
    if (type === 'change') {
      dispatch(
        collectionChangeFileEvent({
          file: val
        })
      );
    }
    if (type === 'unlink') {
      setTimeout(() => {
        dispatch(
          collectionUnlinkFileEvent({
            file: val
          })
        );
      }, 100);
    }
    if (type === 'unlinkDir') {
      dispatch(
        collectionUnlinkDirectoryEvent({
          directory: val
        })
      );
    }
    if (type === 'addEnvironmentFile') {
      dispatch(collectionAddEnvFileEvent(val));
    }
    if (type === 'unlinkEnvironmentFile') {
      dispatch(collectionUnlinkEnvFileEvent(val));
    }
  };

  const _apiSpecTreeUpdated = (type, val) => {
    if (window.__IS_DEV__) {
      console.log('API Spec update:', type);
      console.log(val);
    }
    if (type === 'addFile') {
      dispatch(apiSpecAddFileEvent({ data: val }));
    }
    if (type === 'changeFile') {
      dispatch(apiSpecChangeFileEvent({ data: val }));
    }
  };

  const removeCollectionTreeUpdateListener = ipc.on('main:collection-tree-updated', _collectionTreeUpdated);

  const removeApiSpecTreeUpdateListener = ipc.on('main:apispec-tree-updated', _apiSpecTreeUpdated);

  const removeOpenCollectionListener = ipc.on('main:collection-opened', async (pathname, uid, brunoConfig) => {
    try {
      await dispatch(openCollectionEvent(uid, pathname, brunoConfig));
    } finally {
      dispatch(hydrateSnapshotForOpenedCollection(pathname));
    }
  });

  const removeOpenWorkspaceListener = ipc.on('main:workspace-opened', (workspacePath, workspaceUid, workspaceConfig) => {
    dispatch(workspaceOpenedEvent(workspacePath, workspaceUid, workspaceConfig));
  });

  const removeWorkspaceConfigUpdatedListener = ipc.on('main:workspace-config-updated', (workspacePath, workspaceUid, workspaceConfig) => {
    dispatch(workspaceConfigUpdatedEvent(workspacePath, workspaceUid, workspaceConfig));
  });

  const removeWorkspaceEnvironmentAddedListener = ipc.on('main:workspace-environment-added', (workspaceUid, file) => {
    const state = store.getState();
    const activeWorkspaceUid = state.workspaces?.activeWorkspaceUid;
    if (activeWorkspaceUid === workspaceUid) {
      const workspace = state.workspaces?.workspaces?.find((w) => w.uid === workspaceUid);
      if (workspace) {
        ipc.invoke('renderer:get-global-environments', {
          workspaceUid,
          workspacePath: workspace.pathname
        }).then((result) => {
          dispatch(updateGlobalEnvironments(result));
        }).catch((error) => {
          console.error('Error refreshing global environments:', error);
        });
      }
    }
  });

  const removeWorkspaceEnvironmentChangedListener = ipc.on('main:workspace-environment-changed', (workspaceUid, file) => {
    const state = store.getState();
    const activeWorkspaceUid = state.workspaces?.activeWorkspaceUid;
    if (activeWorkspaceUid === workspaceUid) {
      const workspace = state.workspaces?.workspaces?.find((w) => w.uid === workspaceUid);
      if (workspace) {
        ipc.invoke('renderer:get-global-environments', {
          workspaceUid,
          workspacePath: workspace.pathname
        }).then((result) => {
          dispatch(updateGlobalEnvironments(result));
        }).catch((error) => {
          console.error('Error refreshing global environments:', error);
        });
      }
    }
  });

  const removeWorkspaceEnvironmentDeletedListener = ipc.on('main:workspace-environment-deleted', (workspaceUid, environmentUid) => {
    const state = store.getState();
    const activeWorkspaceUid = state.workspaces?.activeWorkspaceUid;
    if (activeWorkspaceUid === workspaceUid) {
      const workspace = state.workspaces?.workspaces?.find((w) => w.uid === workspaceUid);
      if (workspace) {
        ipc.invoke('renderer:get-global-environments', {
          workspaceUid,
          workspacePath: workspace.pathname
        }).then((result) => {
          dispatch(updateGlobalEnvironments(result));
        }).catch((error) => {
          console.error('Error refreshing global environments:', error);
        });
      }
    }
  });

  const removeDisplayErrorListener = ipc.on('main:display-error', (error) => {
    if (typeof error === 'string') {
      return toast.error(error || 'Something went wrong!');
    }
    if (typeof error === 'object') {
      return toast.error(error.message || 'Something went wrong!');
    }
  });

  const removeScriptEnvUpdateListener = ipc.on('main:script-environment-update', (val) => {
    dispatch(scriptEnvironmentUpdateEvent(val));
  });

  const removePersistentEnvVariablesUpdateListener = ipc.on('main:persistent-env-variables-update', (val) => {
    dispatch(mergeAndPersistEnvironment(val));
  });

  const removeGlobalEnvironmentVariablesUpdateListener = ipc.on('main:global-environment-variables-update', (val) => {
    dispatch(globalEnvironmentsUpdateEvent(val));
  });

  const removeCollectionRenamedListener = ipc.on('main:collection-renamed', (val) => {
    dispatch(collectionRenamedEvent(val));
  });

  const removeRunFolderEventListener = ipc.on('main:run-folder-event', (val) => {
    dispatch(runFolderEvent(val));
  });

  const removeRunRequestEventListener = ipc.on('main:run-request-event', (val) => {
    dispatch(runRequestEvent(val));
  });

  const removeProcessEnvUpdatesListener = ipc.on('main:process-env-update', (val) => {
    dispatch(processEnvUpdateEvent(val));
  });

  const removeWorkspaceDotEnvUpdatesListener = ipc.on('main:workspace-dotenv-update', (val) => {
    dispatch(workspaceDotEnvUpdateEvent(val));
    dispatch(workspaceEnvUpdateEvent({ processEnvVariables: val.processEnvVariables }));
  });

  const removeDotEnvFileUpdateListener = ipc.on('main:dotenv-file-update', (val) => {
    const { type, collectionUid, workspaceUid, filename, variables, exists, processEnvVariables } = val;

    if (type === 'collection' && collectionUid) {
      dispatch(setDotEnvVariables({
        collectionUid,
        variables,
        exists,
        filename
      }));
      if (filename === '.env') {
        dispatch(processEnvUpdateEvent({ collectionUid, processEnvVariables }));
      }
    } else if (type === 'workspace' && workspaceUid) {
      dispatch(setWorkspaceDotEnvVariables({
        workspaceUid,
        variables,
        exists,
        filename
      }));
      if (filename === '.env') {
        dispatch(workspaceDotEnvUpdateEvent(val));
        dispatch(workspaceEnvUpdateEvent({ processEnvVariables }));
      }
    }
  });

  const removeConsoleLogListener = ipc.on('main:console-log', (val) => {
    console[val.type](...val.args);
    dispatch(addLog({
      type: val.type,
      args: val.args,
      timestamp: new Date().toISOString()
    }));
  });

  const removeSystemResourcesListener = ipc.on('main:filesync-system-resources', (resourceData) => {
    dispatch(updateSystemResources(resourceData));
  });

  const removeConfigUpdatesListener = ipc.on('main:bruno-config-update', (val) =>
    dispatch(brunoConfigUpdateEvent(val))
  );

  const removeShowPreferencesListener = ipc.on('main:open-preferences', () => {
    const state = store.getState();
    const activeWorkspaceUid = state.workspaces?.activeWorkspaceUid;
    const workspaces = state.workspaces?.workspaces;
    const tabs = state.tabs?.tabs;
    const activeTabUid = state.tabs?.activeTabUid;
    const activeTab = tabs?.find((t) => t.uid === activeTabUid);

    const activeWorkspace = workspaces?.find((w) => w.uid === activeWorkspaceUid);
    const collectionUid = activeTab?.collectionUid || activeWorkspace?.scratchCollectionUid;

    dispatch(
      addTab({
        type: 'preferences',
        uid: collectionUid ? `${collectionUid}-preferences` : 'preferences',
        collectionUid
      })
    );
  });

  const removePreferencesUpdatesListener = ipc.on('main:load-preferences', (val) => {
    dispatch(updatePreferences(val));
  });

  const removeCookieUpdateListener = ipc.on('main:cookies-update', (val) => {
    dispatch(updateCookies(val));
  });

  const removeGlobalEnvironmentsUpdatesListener = ipc.on('main:load-global-environments', (val) => {
    dispatch(updateGlobalEnvironments(val));
  });

  const removeSnapshotHydrationListener = ipc.on('main:hydrate-app-with-ui-state-snapshot', (val) => {
    dispatch(hydrateCollectionWithUiStateSnapshot(val));
  });

  const removeCollectionOauth2CredentialsUpdatesListener = ipc.on('main:credentials-update', (val) => {
    const payload = {
      ...val,
      itemUid: val.itemUid || null,
      folderUid: val.folderUid || null,
      credentialsId: val.credentialsId || 'credentials'
    };
    dispatch(collectionAddOauth2CredentialsByUrl(payload));
  });

  const removeCollectionOauth2CredentialsClearListener = ipc.on('main:credentials-clear', (val) => {
    dispatch(collectionClearOauth2CredentialsByCredentialsId(val));
  });

  const removeHttpStreamNewDataListener = ipc.on('main:http-stream-new-data', (val) => {
    dispatch(streamDataReceived(val));
  });

  const removeHttpStreamEndListener = ipc.on('main:http-stream-end', (val) => {
    dispatch(requestCancelled(val));
  });

  const removeCollectionLoadingStateListener = ipc.on('main:collection-loading-state-updated', (val) => {
    dispatch(updateCollectionLoadingState(val));
  });

  const gitVersionListener = ipc.on('main:git-version', (val) => {
    dispatch(setGitVersion(val));
  });

  return () => {
    removeCollectionTreeUpdateListener();
    removeApiSpecTreeUpdateListener();
    removeOpenCollectionListener();
    removeOpenWorkspaceListener();
    removeWorkspaceConfigUpdatedListener();
    removeWorkspaceEnvironmentAddedListener();
    removeWorkspaceEnvironmentChangedListener();
    removeWorkspaceEnvironmentDeletedListener();
    removeDisplayErrorListener();
    removeScriptEnvUpdateListener();
    removeGlobalEnvironmentVariablesUpdateListener();
    removeCollectionRenamedListener();
    removeRunFolderEventListener();
    removeRunRequestEventListener();
    removeProcessEnvUpdatesListener();
    removeWorkspaceDotEnvUpdatesListener();
    removeDotEnvFileUpdateListener();
    removeConsoleLogListener();
    removeConfigUpdatesListener();
    removeShowPreferencesListener();
    removePreferencesUpdatesListener();
    removeCookieUpdateListener();
    removeGlobalEnvironmentsUpdatesListener();
    removeSnapshotHydrationListener();
    removeCollectionOauth2CredentialsUpdatesListener();
    removeCollectionOauth2CredentialsClearListener();
    removeHttpStreamNewDataListener();
    removeHttpStreamEndListener();
    removeCollectionLoadingStateListener();
    removePersistentEnvVariablesUpdateListener();
    removeSystemResourcesListener();
    gitVersionListener();
  };
};

export default subscribeIpcEvents;
