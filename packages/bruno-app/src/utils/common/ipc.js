let _backend = null;

// Lazy-load @usebruno/filestore only inside the Capacitor backend (never on Electron).
// The '/web' subpath excludes the worker chain (worker-script → worker_threads/require/
// __dirname); the bare entry would pull that graph into the browser bundle and crash on
// module-eval under WKWebView. The dynamic import is cached after the first resolution.
let _filestoreModule = null;
const filestore = () => (_filestoreModule ??= import('@usebruno/filestore/web'));

const NO_NATIVE_HOST = (channel) => Promise.reject(new Error(`invoke(${channel}): no native host`));

// Channel prefixes whose features land in later batches; they must keep rejecting
// with the same 'no native host' error the Batch-0 capacitor stub produced.
const REJECTING_PREFIXES = [
  'send-http-request',
  'cancel-http-request',
  'fetch-gql-schema',
  'renderer:save-response-to-file',
  'renderer:fetch-oauth2-credentials',
  'renderer:refresh-oauth2-credentials',
  'renderer:cancel-oauth2-authorization-request',
  'renderer:is-oauth2-authorization-request-in-progress',
  'clear-oauth2-cache',
  'renderer:ws:',
  'grpc:',
  'renderer:clone-git-repository',
  'connect-collection-to-git',
  'disconnect-collection-from-git',
  'delete-cookies-for-domain',
  'delete-cookie',
  'add-cookie',
  'modify-cookie',
  'get-parsed-cookie',
  'create-cookie-string',
  'ai/',
  'terminal/',
  'notifications/'
];

// Picker channels are deferred to AppShims (Batch 4); reject for now.
const PICKER_CHANNELS = [
  'renderer:browse-directory',
  'renderer:browse-files',
  'renderer:browse-pac-file',
  'renderer:export-environment'
];

const basename = (tokenPath) => tokenPath.split('/').filter((segment) => segment !== '').pop() || '';
const dirname = (tokenPath) => {
  const segments = tokenPath.split('/');
  segments.pop();
  return segments.join('/');
};
const joinPath = (base, ...parts) => [base, ...parts].filter((part) => part !== '' && part != null).join('/');

const isCollectionRootFile = (name, format) => (format === 'yml' ? name === 'opencollection.yml' : name === 'collection.bru');
const isFolderRootFile = (name, format) => (format === 'yml' ? name === 'folder.yml' : name === 'folder.bru');
const isRequestFile = (name, format) => name.endsWith(format === 'yml' ? '.yml' : '.bru');

// djb2-style hash matching generateUidBasedOnHash in utils/common/index.js.
// Inlined here to avoid importing from the same package this file belongs to.
const simpleHash = (str) => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash &= hash;
  }
  return new Uint32Array([hash])[0].toString(36);
};

const uidFromToken = (token) => `${simpleHash(token)}`.padEnd(21, '0');

/**
 * Returns the longest registered collection-root token that is a prefix of `itemPath`.
 * Falls back to the first path segment under @documents (e.g. "@documents/MyCol") if
 * no registered root matches — this handles any path that arrives before mount is complete.
 * Exported so it can be unit-tested independently of the Capacitor bridge.
 */
export const collectionRootFor = (itemPath, roots) => {
  let best = null;
  roots.forEach((root) => {
    if ((itemPath === root || itemPath.startsWith(`${root}/`))
      && (best === null || root.length > best.length)) {
      best = root;
    }
  });
  if (best !== null) return best;
  // Fallback: first segment after @documents/
  const afterToken = itemPath.startsWith('@documents/') ? itemPath.slice('@documents/'.length) : '';
  const segment = afterToken.split('/')[0];
  return segment ? `@documents/${segment}` : '@documents';
};

const createCapacitorBackend = () => {
  // Access the plugin via the global Capacitor bridge — the canonical Capacitor pattern.
  // This avoids a static '@usebruno/ios' import in bruno-app, which would drag
  // '@capacitor/core' into the Electron renderer bundle.
  // Lazy getter: avoids caching an undefined reference when the backend is constructed
  // before the native bridge has registered the plugin (early renderer:ready timing).
  const getPlugin = () => window.Capacitor?.Plugins?.BrunoFilesystem;
  // Polls until the plugin appears or 3 s elapses; used before the first native call.
  const ensurePlugin = async () => {
    for (let i = 0; i < 60; i++) {
      const p = getPlugin();
      if (p) return p;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error('BrunoFilesystem plugin not available after 3s');
  };

  // Registry of mounted collection root tokens populated by open-collection and
  // mount-collection. Used by collectionRootFor to map any item path back to its
  // collection root so synthethized main:collection-tree-updated events carry the
  // correct collectionUid (the collection-root uid, not the item-path uid).
  const collectionRoots = new Set();

  // Local registry for the synthesized main:* events the mount flow drives in JS.
  // Native push events arrive separately via plugin.addListener.
  const listeners = new Map();

  const emit = (channel, ...args) => {
    const handlers = listeners.get(channel);
    if (!handlers) return;
    handlers.forEach((handler) => handler(...args));
  };

  const synthesizeTreeForCollection = async (token, uid, format) => {
    const { parseRequest, parseCollection, parseFolder, parseEnvironment } = await filestore();
    const { entries } = await getPlugin().readDirTree({ path: token });
    entries.forEach((entry) => {
      const name = basename(entry.path);
      if (entry.type === 'dir') {
        emit('main:collection-tree-updated', 'addDir', { meta: { collectionUid: uid, pathname: entry.path, name } });
        return;
      }
      const content = entry.content || '';
      if (isCollectionRootFile(name, format)) {
        emit('main:collection-tree-updated', 'addFile', {
          meta: { collectionUid: uid, pathname: entry.path, name, collectionRoot: true },
          data: parseCollection(content, { format })
        });
      } else if (isFolderRootFile(name, format)) {
        emit('main:collection-tree-updated', 'addFile', {
          meta: { collectionUid: uid, pathname: entry.path, name, folderRoot: true },
          data: parseFolder(content, { format })
        });
      } else if (dirname(entry.path).endsWith('/environments')) {
        emit('main:collection-tree-updated', 'addFile', {
          meta: { collectionUid: uid, pathname: entry.path, name },
          data: parseEnvironment(content, { format })
        });
      } else if (isRequestFile(name, format)) {
        emit('main:collection-tree-updated', 'addFile', {
          meta: { collectionUid: uid, pathname: entry.path, name },
          data: parseRequest(content, { format })
        });
      }
    });
  };

  const openWorkspace = async () => {
    const { parseCollection } = await filestore();
    const { collections } = await (await ensurePlugin()).scanWorkspace();
    for (const collection of collections) {
      const { token, format } = collection;
      // Swift returns brunoConfig as a parsed object for 'bru' collections and as
      // { raw: <yamlString> } for 'yml' collections (Swift does no YAML parsing).
      const brunoConfig = collection.brunoConfig && collection.brunoConfig.raw
        ? parseCollection(collection.brunoConfig.raw, { format: 'yml' })
        : collection.brunoConfig;
      collectionRoots.add(token);
      const uid = uidFromToken(token);
      emit('main:collection-opened', token, uid, brunoConfig);
      await synthesizeTreeForCollection(token, uid, format);
    }
  };

  const invoke = async (channel, ...args) => {
    if (PICKER_CHANNELS.includes(channel)) return NO_NATIVE_HOST(channel);
    if (REJECTING_PREFIXES.some((prefix) => channel.startsWith(prefix))) return NO_NATIVE_HOST(channel);

    const {
      stringifyRequest,
      stringifyCollection,
      stringifyFolder,
      stringifyEnvironment
    } = await filestore();

    switch (channel) {
      case 'renderer:ready':
        return Promise.resolve();

      case 'renderer:open-collection':
      case 'renderer:open-multiple-collections':
        return openWorkspace();

      case 'renderer:mount-collection': {
        const [{ collectionPathname }] = args;
        collectionRoots.add(collectionPathname);
        return getPlugin().mountCollection({ token: collectionPathname }).then(({ tempDirectoryToken }) => {
          collectionRoots.add(tempDirectoryToken);
          return tempDirectoryToken;
        });
      }

      case 'renderer:create-collection':
      case 'renderer:clone-collection':
      case 'renderer:rename-collection':
      case 'renderer:remove-collection':
      case 'renderer:set-collection-workspace':
      case 'renderer:add-collection-watcher':
      case 'renderer:get-collection-security-config':
      case 'renderer:save-collection-security-config':
        return Promise.resolve();

      case 'renderer:new-request':
      case 'renderer:save-request': {
        const [pathname, request, format] = args;
        return getPlugin().writeFile({ path: pathname, content: stringifyRequest(request, { format }) }).then(() => {
          emit('main:collection-tree-updated', 'change', {
            meta: { collectionUid: uidFromToken(collectionRootFor(pathname, collectionRoots)), pathname, name: basename(pathname) },
            data: request
          });
        });
      }

      case 'renderer:save-multiple-requests': {
        const [requestsToSave] = args;
        return Promise.all(
          requestsToSave.map(({ pathname, item, format }) =>
            getPlugin().writeFile({ path: pathname, content: stringifyRequest(item, { format }) }))
        ).then(() => undefined);
      }

      case 'renderer:save-transient-request':
      case 'renderer:save-scratch-request': {
        const [{ targetDirname, targetFilename, request, format }] = args;
        const newPathname = joinPath(targetDirname, targetFilename);
        return getPlugin().writeFile({ path: newPathname, content: stringifyRequest(request, { format }) }).then(() => ({ newPathname }));
      }

      case 'renderer:delete-item': {
        const [pathname, type] = args;
        const recursive = type === 'folder';
        return getPlugin().deleteEntry({ path: pathname, recursive }).then(() => {
          emit('main:collection-tree-updated', recursive ? 'unlinkDir' : 'unlink', {
            meta: { collectionUid: uidFromToken(collectionRootFor(pathname, collectionRoots)), pathname, name: basename(pathname) }
          });
        });
      }

      case 'renderer:delete-transient-requests': {
        const [filePaths] = args;
        return Promise.all(filePaths.map((path) => getPlugin().deleteEntry({ path }))).then(() => ({ deleted: filePaths, skipped: [], errors: [] }));
      }

      case 'renderer:new-folder': {
        const [{ pathname, folderData, format }] = args;
        return getPlugin().mkdir({ path: pathname }).then(() => {
          if (!folderData) return undefined;
          const folderFile = joinPath(pathname, format === 'yml' ? 'folder.yml' : 'folder.bru');
          return getPlugin().writeFile({ path: folderFile, content: stringifyFolder(folderData, { format }) });
        }).then(() => {
          emit('main:collection-tree-updated', 'addDir', {
            meta: { collectionUid: uidFromToken(collectionRootFor(pathname, collectionRoots)), pathname, name: basename(pathname) }
          });
        });
      }

      case 'renderer:save-folder-root': {
        const [folder] = args;
        const format = folder.format === 'yml' ? 'yml' : 'bru';
        const folderFile = joinPath(folder.folderPathname, format === 'yml' ? 'folder.yml' : 'folder.bru');
        return getPlugin().writeFile({ path: folderFile, content: stringifyFolder(folder.root, { format }) }).then(() => undefined);
      }

      case 'renderer:rename-item-name':
        return Promise.resolve();

      case 'renderer:rename-item-filename': {
        const [{ oldPath, newPath }] = args;
        return getPlugin().rename({ from: oldPath, to: newPath }).then(({ to }) => to);
      }

      case 'renderer:move-file-item':
      case 'renderer:move-folder-item': {
        const [itemPath, destinationPath] = args;
        return getPlugin().rename({ from: itemPath, to: destinationPath }).then(() => undefined);
      }

      case 'renderer:move-item': {
        const [{ targetDirname, sourcePathname }] = args;
        return getPlugin().rename({ from: sourcePathname, to: joinPath(targetDirname, basename(sourcePathname)) }).then(() => undefined);
      }

      case 'renderer:move-item-cross-format': {
        const [{ targetDirname, sourcePathname }] = args;
        const newPathname = joinPath(targetDirname, basename(sourcePathname));
        return getPlugin().rename({ from: sourcePathname, to: newPathname }).then(({ to }) => ({ newPathname: to }));
      }

      case 'renderer:clone-folder': {
        const [itemFolder, collectionPath] = args;
        return getPlugin().copyTree({ from: itemFolder, to: collectionPath }).then(() => undefined);
      }

      case 'renderer:save-collection-root': {
        const [collectionPathname, collectionRoot, brunoConfig] = args;
        const format = brunoConfig && brunoConfig.version ? 'bru' : 'yml';
        const rootFile = joinPath(collectionPathname, format === 'yml' ? 'opencollection.yml' : 'collection.bru');
        return getPlugin().writeFile({ path: rootFile, content: stringifyCollection(collectionRoot, brunoConfig, { format }) }).then(() => undefined);
      }

      case 'renderer:update-bruno-config': {
        const [brunoConfig, collectionPath] = args;
        const isYml = !brunoConfig || !brunoConfig.version;
        const configFile = joinPath(collectionPath, isYml ? 'opencollection.yml' : 'bruno.json');
        const content = isYml ? stringifyCollection(brunoConfig, brunoConfig, { format: 'yml' }) : JSON.stringify(brunoConfig, null, 2);
        return getPlugin().writeFile({ path: configFile, content }).then(() => undefined);
      }

      case 'renderer:get-collection-json': {
        const [collectionPath] = args;
        return getPlugin().readDirTree({ path: collectionPath }).then(({ entries }) => ({ entries }));
      }

      case 'renderer:create-environment':
      case 'renderer:save-environment': {
        const [collectionPathname, environment, format] = args;
        const envFormat = format === 'yml' ? 'yml' : 'bru';
        const env = environment && environment.name ? environment : { name: args[1], variables: args[2], color: args[3] };
        const envFile = joinPath(collectionPathname, 'environments', `${env.name}.${envFormat}`);
        return getPlugin().writeFile({ path: envFile, content: stringifyEnvironment(env, { format: envFormat }) }).then(() => undefined);
      }

      case 'renderer:rename-environment': {
        const [collectionPathname, environmentName, newName] = args;
        const from = joinPath(collectionPathname, 'environments', `${environmentName}.bru`);
        const to = joinPath(collectionPathname, 'environments', `${newName}.bru`);
        return getPlugin().rename({ from, to }).then(() => undefined);
      }

      case 'renderer:delete-environment': {
        const [collectionPathname, environmentName] = args;
        return getPlugin().deleteEntry({ path: joinPath(collectionPathname, 'environments', `${environmentName}.bru`) }).then(() => undefined);
      }

      case 'renderer:update-environment-color':
        return Promise.resolve();

      case 'renderer:save-dotenv-variables':
      case 'renderer:save-dotenv-raw': {
        const [collectionPathname, payload, filename] = args;
        const content = typeof payload === 'string'
          ? payload
          : payload.map(({ name, value }) => `${name}=${value}`).join('\n');
        return getPlugin().writeFile({ path: joinPath(collectionPathname, filename || '.env'), content }).then(() => ({ success: true }));
      }

      case 'renderer:create-dotenv-file': {
        const [collectionPathname, filename] = args;
        const name = filename || '.env';
        return getPlugin().writeFile({ path: joinPath(collectionPathname, name), content: '' }).then(() => ({ success: true, filename: name }));
      }

      case 'renderer:delete-dotenv-file': {
        const [collectionPathname, filename] = args;
        return getPlugin().deleteEntry({ path: joinPath(collectionPathname, filename) }).then(() => ({ success: true }));
      }

      case 'renderer:exists-sync': {
        const [filePath] = args;
        return getPlugin().exists({ path: filePath }).then(({ exists }) => exists);
      }

      case 'renderer:is-directory': {
        const [pathname] = args;
        return getPlugin().stat({ path: pathname }).then(({ isDirectory }) => isDirectory);
      }

      case 'renderer:resolve-path': {
        const [relativePath, basePath] = args;
        return Promise.resolve(joinPath(basePath, relativePath));
      }

      case 'renderer:find-unique-folder-name': {
        const [baseName, location] = args;
        return getPlugin().readDirTree({ path: location }).then(({ entries }) => {
          const names = new Set(entries.filter((entry) => entry.type === 'dir').map((entry) => basename(entry.path)));
          if (!names.has(baseName)) return baseName;
          let index = 1;
          while (names.has(`${baseName} ${index}`)) index += 1;
          return `${baseName} ${index}`;
        });
      }

      case 'renderer:snapshot:get':
      case 'renderer:snapshot:get-tabs':
        return getPlugin().snapshotGet().then(({ snapshot }) => snapshot);

      case 'renderer:snapshot:save':
      case 'renderer:update-ui-state-snapshot': {
        const [snapshot] = args;
        return getPlugin().snapshotSave({ snapshot }).then(({ ok }) => ok);
      }

      case 'renderer:show-in-folder':
        return Promise.resolve();

      default:
        return NO_NATIVE_HOST(channel);
    }
  };

  const on = (channel, handler) => {
    const handlers = listeners.get(channel) || new Set();
    handlers.add(handler);
    listeners.set(channel, handlers);

    let nativeHandle = null;
    // Capacitor delivers a single event object; adapt it back into the spread the
    // renderer handlers expect for the events the native side may push directly.
    const adapt = (event) => {
      if (channel === 'main:collection-tree-updated') return handler(event.type, event.file);
      if (channel === 'main:collection-opened') return handler(event.pathname, event.uid, event.brunoConfig);
      return handler(event);
    };
    getPlugin().addListener(channel, adapt).then((registration) => {
      nativeHandle = registration;
    });

    return () => {
      const set = listeners.get(channel);
      if (set) set.delete(handler);
      if (nativeHandle) nativeHandle.remove();
    };
  };

  return {
    name: 'capacitor',
    invoke,
    send: () => undefined,
    on,
    getFilePath: () => Promise.reject(new Error('getFilePath unavailable: no native host')),
    openExternal: (url) => {
      window.open(url, '_blank', 'noopener,noreferrer');
      return Promise.resolve();
    }
  };
};

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
    _backend = createCapacitorBackend();
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
