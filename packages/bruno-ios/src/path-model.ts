/**
 * Container-relative PathModel — JS mirror of PathModel.swift.
 *
 * The iOS app sandbox Documents directory changes its absolute location on every
 * (re)install (the container UUID rotates), so no device-absolute path may ever be
 * persisted in Redux/YAML/snapshots. Instead the app speaks in '@documents' tokens:
 * a stable, install-independent logical path. Swift is the single rebasing authority
 * at the bridge boundary; this module is the testable mirror used for the Jest
 * equivalence suite, normalizeToken comparisons during snapshot hydration, and a
 * defensive rebaseSnapshotForWrite pass before a snapshot is handed to Swift.
 *
 * Every function is pure: the Documents root is always supplied as a parameter; this
 * module never touches FileManager or any native API.
 */

/** Logical root token literal. The bare root is '@documents' (no trailing slash). */
export const TOKEN = '@documents';

/** Strips a single trailing slash (never the bare root token). */
const stripTrailingSlash = (value: string): string => {
  if (value.length > 1 && value.endsWith('/')) {
    return value.replace(/\/+$/, '');
  }
  return value;
};

/** True when the path starts with the '@documents' token. */
export const isToken = (path: string): boolean => {
  return path === TOKEN || path.startsWith(`${TOKEN}/`);
};

/**
 * Collapses '//', './' and trailing slashes so two tokens that name the same
 * location compare equal as exact strings. Leaves a non-token path unchanged.
 */
export const normalizeToken = (token: string): string => {
  if (!isToken(token)) {
    return token;
  }
  const rest = token.slice(TOKEN.length);
  const segments = rest.split('/').filter((segment) => segment !== '' && segment !== '.');
  if (segments.length === 0) {
    return TOKEN;
  }
  return `${TOKEN}/${segments.join('/')}`;
};

/**
 * Maps an absolute path under documentsRoot to its '@documents/<relative>' token.
 * The bare root maps to '@documents'. A path outside documentsRoot is returned
 * unchanged (a guard, not a feature — v1 only ever operates inside Documents).
 */
export const tokenize = (absPath: string, documentsRoot: string): string => {
  const root = stripTrailingSlash(documentsRoot);
  if (absPath === root) {
    return TOKEN;
  }
  if (absPath.startsWith(`${root}/`)) {
    const relative = absPath.slice(root.length + 1);
    return normalizeToken(`${TOKEN}/${relative}`);
  }
  return absPath;
};

/**
 * Maps a '@documents/<relative>' token to an absolute path under documentsRoot.
 * The bare root token maps to documentsRoot. A non-token path is returned
 * unchanged (passthrough for already-absolute values).
 */
export const resolve = (tokenPath: string, documentsRoot: string): string => {
  if (!isToken(tokenPath)) {
    return tokenPath;
  }
  const root = stripTrailingSlash(documentsRoot);
  const normalized = normalizeToken(tokenPath);
  if (normalized === TOKEN) {
    return root;
  }
  const relative = normalized.slice(TOKEN.length + 1);
  return `${root}/${relative}`;
};

/**
 * The absolute-path fields a snapshot walk must rebase. Schema-aware (not blind)
 * so only known path-bearing fields are rewritten — names/values that merely look
 * path-like are left untouched.
 */
const rebaseSnapshot = (
  blob: any,
  mapPath: (value: string) => string
): any => {
  if (!blob || typeof blob !== 'object') {
    return blob;
  }

  const mapMaybe = (value: any): any => (typeof value === 'string' ? mapPath(value) : value);

  const next: any = { ...blob };

  if ('activeWorkspacePath' in next) {
    next.activeWorkspacePath = mapMaybe(next.activeWorkspacePath);
  }

  if (Array.isArray(next.workspaces)) {
    next.workspaces = next.workspaces.map((workspace: any) => {
      if (!workspace || typeof workspace !== 'object') {
        return workspace;
      }
      const nextWorkspace: any = { ...workspace };
      if ('pathname' in nextWorkspace) {
        nextWorkspace.pathname = mapMaybe(nextWorkspace.pathname);
      }
      if ('lastActiveCollectionPathname' in nextWorkspace) {
        nextWorkspace.lastActiveCollectionPathname = mapMaybe(nextWorkspace.lastActiveCollectionPathname);
      }
      if (Array.isArray(nextWorkspace.collections)) {
        nextWorkspace.collections = nextWorkspace.collections.map(mapMaybe);
      }
      return nextWorkspace;
    });
  }

  if (Array.isArray(next.collections)) {
    next.collections = next.collections.map((collection: any) => {
      if (!collection || typeof collection !== 'object') {
        return collection;
      }
      const nextCollection: any = { ...collection };
      if ('pathname' in nextCollection) {
        nextCollection.pathname = mapMaybe(nextCollection.pathname);
      }
      if ('workspacePathname' in nextCollection) {
        nextCollection.workspacePathname = mapMaybe(nextCollection.workspacePathname);
      }
      if ('environmentPath' in nextCollection) {
        nextCollection.environmentPath = mapMaybe(nextCollection.environmentPath);
      }
      if (nextCollection.environment && typeof nextCollection.environment === 'object') {
        const nextEnvironment: any = { ...nextCollection.environment };
        if ('collection' in nextEnvironment) {
          nextEnvironment.collection = mapMaybe(nextEnvironment.collection);
        }
        nextCollection.environment = nextEnvironment;
      }
      if (Array.isArray(nextCollection.tabs)) {
        nextCollection.tabs = nextCollection.tabs.map((tab: any) => {
          if (!tab || typeof tab !== 'object') {
            return tab;
          }
          const nextTab: any = { ...tab };
          if ('pathname' in nextTab) {
            nextTab.pathname = mapMaybe(nextTab.pathname);
          }
          return nextTab;
        });
      }
      return nextCollection;
    });
  }

  return next;
};

/** Walks the 9 snapshot path fields, mapping tokens to absolute paths. */
export const rebaseSnapshotForRead = (blob: any, documentsRoot: string): any => {
  return rebaseSnapshot(blob, (value) => resolve(value, documentsRoot));
};

/** Walks the 9 snapshot path fields, mapping absolute paths to tokens. */
export const rebaseSnapshotForWrite = (blob: any, documentsRoot: string): any => {
  return rebaseSnapshot(blob, (value) => tokenize(value, documentsRoot));
};
