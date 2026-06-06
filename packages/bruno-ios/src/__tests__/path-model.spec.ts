import { stringifyRequest } from '@usebruno/filestore';
import {
  TOKEN,
  isToken,
  normalizeToken,
  tokenize,
  resolve,
  rebaseSnapshotForRead,
  rebaseSnapshotForWrite
} from '../path-model';

// Two different absolute roots model the same logical Documents directory across a
// reinstall: the container UUID rotates, but the '@documents' token stays stable.
const ROOT_A = '/var/mobile/Containers/Data/Application/AAAAAAAA-1111/Documents';
const ROOT_B = '/var/mobile/Containers/Data/Application/BBBBBBBB-2222/Documents';

describe('path-model tokenize', () => {
  it('tokenizes a nested absolute path', () => {
    expect(tokenize(`${ROOT_A}/MyCol/req.bru`, ROOT_A)).toBe('@documents/MyCol/req.bru');
  });

  it('tokenizes the root itself to the bare token', () => {
    expect(tokenize(ROOT_A, ROOT_A)).toBe('@documents');
  });
});

describe('path-model resolve', () => {
  it('resolves a nested token', () => {
    expect(resolve('@documents/MyCol/req.bru', ROOT_A)).toBe(`${ROOT_A}/MyCol/req.bru`);
  });

  it('resolves the bare root token', () => {
    expect(resolve('@documents', ROOT_A)).toBe(ROOT_A);
  });
});

describe('path-model round-trip', () => {
  it('round-trips a nested path', () => {
    const abs = `${ROOT_A}/MyCol/folder/req.bru`;
    expect(resolve(tokenize(abs, ROOT_A), ROOT_A)).toBe(abs);
  });

  it('round-trips the root path', () => {
    expect(resolve(tokenize(ROOT_A, ROOT_A), ROOT_A)).toBe(ROOT_A);
  });

  it('round-trips a single-segment path', () => {
    const abs = `${ROOT_A}/MyCol`;
    expect(resolve(tokenize(abs, ROOT_A), ROOT_A)).toBe(abs);
  });
});

describe('path-model reinstall resilience', () => {
  it('resolves a token built under rootA against a changed rootB', () => {
    const token = tokenize(`${ROOT_A}/MyCol/req.bru`, ROOT_A);
    expect(resolve(token, ROOT_B)).toBe(`${ROOT_B}/MyCol/req.bru`);
  });
});

describe('path-model outside-root passthrough', () => {
  it('returns a path outside the root unchanged', () => {
    expect(tokenize('/var/other/x', ROOT_A)).toBe('/var/other/x');
  });
});

describe('path-model isToken', () => {
  it('is true for token paths', () => {
    expect(isToken('@documents')).toBe(true);
    expect(isToken('@documents/MyCol/req.bru')).toBe(true);
  });

  it('is false for absolute and relative paths', () => {
    expect(isToken('/var/mobile/Documents/MyCol')).toBe(false);
    expect(isToken('MyCol/req.bru')).toBe(false);
  });
});

describe('path-model normalizeToken', () => {
  it('collapses duplicate slashes, "./" and trailing slash', () => {
    expect(normalizeToken('@documents/a//b/')).toBe('@documents/a/b');
    expect(normalizeToken('@documents/a/./b')).toBe('@documents/a/b');
    expect(normalizeToken('@documents/')).toBe(TOKEN);
  });
});

describe('path-model snapshot rebase', () => {
  const absoluteSnapshot = {
    activeWorkspacePath: `${ROOT_A}/ws`,
    workspaces: [
      {
        pathname: `${ROOT_A}/ws`,
        lastActiveCollectionPathname: `${ROOT_A}/MyCol`,
        collections: [`${ROOT_A}/MyCol`, `${ROOT_A}/Other`]
      }
    ],
    collections: [
      {
        pathname: `${ROOT_A}/MyCol`,
        workspacePathname: `${ROOT_A}/ws`,
        environmentPath: `${ROOT_A}/MyCol/environments`,
        environment: { collection: `${ROOT_A}/MyCol/environments/dev.bru` },
        tabs: [
          { pathname: `${ROOT_A}/MyCol/req.bru`, uid: 'tab-1' }
        ]
      }
    ]
  };

  const tokenSnapshot = {
    activeWorkspacePath: '@documents/ws',
    workspaces: [
      {
        pathname: '@documents/ws',
        lastActiveCollectionPathname: '@documents/MyCol',
        collections: ['@documents/MyCol', '@documents/Other']
      }
    ],
    collections: [
      {
        pathname: '@documents/MyCol',
        workspacePathname: '@documents/ws',
        environmentPath: '@documents/MyCol/environments',
        environment: { collection: '@documents/MyCol/environments/dev.bru' },
        tabs: [
          { pathname: '@documents/MyCol/req.bru', uid: 'tab-1' }
        ]
      }
    ]
  };

  it('rebaseForWrite tokenizes all 9 path fields including arrays', () => {
    expect(rebaseSnapshotForWrite(absoluteSnapshot, ROOT_A)).toEqual(tokenSnapshot);
  });

  it('rebaseForWrite leaves non-path fields untouched', () => {
    const result = rebaseSnapshotForWrite(absoluteSnapshot, ROOT_A);
    expect(result.collections[0].tabs[0].uid).toBe('tab-1');
  });

  it('rebaseForRead is the inverse of write (identity on a token blob)', () => {
    const resolved = rebaseSnapshotForRead(tokenSnapshot, ROOT_A);
    expect(rebaseSnapshotForWrite(resolved, ROOT_A)).toEqual(tokenSnapshot);
  });
});

describe('stringify worker-equivalence', () => {
  // Golden fixture captured from the pure (non-worker) stringifyRequest. The Electron
  // write path uses stringifyRequestViaWorker, which calls the identical underlying
  // stringifyBruRequest; locking this output guarantees byte-identical files on iOS.
  const sampleItem = {
    type: 'http-request',
    name: 'Get Users',
    seq: 1,
    request: {
      method: 'GET',
      url: 'https://api.example.com/users',
      headers: [],
      params: [],
      body: { mode: 'none' },
      auth: { mode: 'none' },
      script: {},
      vars: {},
      assertions: [],
      tests: '',
      docs: ''
    }
  };

  const golden = 'meta {\n  name: Get Users\n  type: http\n  seq: 1\n}\n\nget {\n  url: https://api.example.com/users\n  body: none\n  auth: none\n}\n';

  it('stringifyRequest matches the golden fixture', () => {
    expect(stringifyRequest(sampleItem as any, { format: 'bru' })).toBe(golden);
  });
});
