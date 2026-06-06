import { registerPlugin } from '@capacitor/core';

/**
 * Collection storage format detected when scanning the workspace.
 * 'bru' = bruno.json + .bru files; 'yml' = opencollection.yml + .yml files.
 */
export type CollectionFormat = 'bru' | 'yml';

/** A single collection discovered at the top level of the Documents workspace. */
export interface ScannedCollection {
  /** '@documents' token pointing at the collection root directory. */
  token: string;
  format: CollectionFormat;
  /** Parsed bruno.json / opencollection.yml manifest for the collection. */
  brunoConfig: object;
}

/** A single entry returned by the batched directory tree scan. */
export interface DirTreeEntry {
  /** '@documents' token for this entry. */
  path: string;
  type: 'file' | 'dir';
  /** Raw file bytes as a string; present only for files. */
  content?: string;
}

/**
 * File payload carried by a synthesized main:collection-tree-updated event.
 * Mirrors the Electron renderer shape so the unchanged renderer can update Redux.
 */
export interface TreeUpdatedFile {
  meta: {
    /** Token-derived, reinstall-stable collection uid. */
    collectionUid: string;
    /** '@documents' token for the affected file/dir. */
    pathname: string;
    name: string;
    /** '@documents' token for the collection root. */
    collectionRoot?: string;
    /** '@documents' token for the containing folder root. */
    folderRoot?: string;
  };
  /** Raw file bytes as a string, when the event carries content. */
  data?: string;
  size?: number;
}

/**
 * Payload for a synthesized main:collection-tree-updated event.
 * `type` mirrors the Electron watcher event kinds (addFile, change, unlink, addDir, unlinkDir, ...).
 */
export interface TreeUpdatedEvent {
  type: string;
  file: TreeUpdatedFile;
}

/**
 * Payload for a synthesized main:collection-opened event emitted when a
 * collection is mounted from the Documents workspace.
 */
export interface CollectionOpenedEvent {
  /** '@documents' token for the collection root. */
  pathname: string;
  /** Token-derived, reinstall-stable collection uid. */
  uid: string;
  /** Parsed bruno.json / opencollection.yml manifest. */
  brunoConfig: object;
}

/**
 * Native Filesystem boundary for the iOS app. All paths are '@documents' tokens
 * (never device-absolute); the native side rebases tokens to/from absolute paths
 * at the bridge boundary so the JS/Redux layer only ever sees tokens.
 */
export interface BrunoFilesystemPlugin {
  /** Returns the absolute Documents root for the current install (tests/diagnostics only). */
  getDocumentsRoot(): Promise<{ root: string }>;

  /** Enumerates top-level collections in the Documents workspace. */
  scanWorkspace(): Promise<{ collections: ScannedCollection[] }>;

  /** Reads a single file's raw bytes as a string. */
  readFile(options: { path: string }): Promise<{ content: string }>;

  /** Batched directory scan returning entries with file contents to amortize bridge calls. */
  readDirTree(options: { path: string }): Promise<{ entries: DirTreeEntry[] }>;

  /** Writes raw bytes to a file, creating it if absent. */
  writeFile(options: { path: string; content: string }): Promise<void>;

  /** Deletes a file or directory; `recursive` deletes directory contents. */
  deleteEntry(options: { path: string; recursive?: boolean }): Promise<void>;

  /** Creates a directory (including intermediate directories). */
  mkdir(options: { path: string }): Promise<void>;

  /** Moves/renames an entry; returns the new '@documents' token. */
  rename(options: { from: string; to: string }): Promise<{ to: string }>;

  /** Recursively copies a tree; returns the destination '@documents' token. */
  copyTree(options: { from: string; to: string }): Promise<{ to: string }>;

  /** Returns existence, directory flag and size for a path. */
  stat(options: { path: string }): Promise<{ exists: boolean; isDirectory: boolean; size: number }>;

  /** existsSync-equivalent: returns whether a path exists. */
  exists(options: { path: string }): Promise<{ exists: boolean }>;

  /** Mounts a collection into a transient directory; returns its '@documents' token. */
  mountCollection(options: { token: string }): Promise<{ tempDirectoryToken: string }>;

  /** Returns the persisted UI-state snapshot with all path fields already tokenized. */
  snapshotGet(): Promise<{ snapshot: object | null }>;

  /** Persists the UI-state snapshot; path fields are tokenized by the native writer. */
  snapshotSave(options: { snapshot: object }): Promise<{ ok: boolean }>;

  /**
   * Registers a listener for a synthesized main:* event channel.
   * Returns a handle whose remove() unsubscribes.
   */
  addListener(
    channel: string,
    listenerFunc: (event: TreeUpdatedEvent | CollectionOpenedEvent | unknown) => void
  ): Promise<{ remove: () => Promise<void> }>;

  /** Removes all registered listeners for this plugin. */
  removeAllListeners(): Promise<void>;
}

export const BrunoFilesystem = registerPlugin<BrunoFilesystemPlugin>('BrunoFilesystem');
