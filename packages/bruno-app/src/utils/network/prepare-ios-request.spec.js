import { prepareIosRequest } from './prepare-ios-request';

// Minimal collection fixture with all the fields getAllVariables and mergeHeaders need.
const makeCollection = (overrides = {}) => ({
  uid: 'col-1',
  name: 'TestCol',
  activeEnvironmentUid: 'env-1',
  environments: [
    {
      uid: 'env-1',
      name: 'Dev',
      variables: [
        { name: 'host', value: 'https://api.example.com', enabled: true },
        { name: 'token', value: 'secret-token', enabled: true }
      ]
    }
  ],
  items: [],
  root: {
    request: {
      headers: [],
      auth: { mode: 'none' }
    }
  },
  runtimeVariables: {},
  collectionVariables: {},
  ...overrides
});

// Minimal item fixture
const makeItem = (overrides = {}) => ({
  uid: 'item-1',
  name: 'Test Request',
  type: 'http-request',
  cancelTokenUid: 'cancel-uid-123',
  request: {
    method: 'GET',
    url: '{{host}}/users',
    headers: [],
    params: [],
    body: { mode: 'none' },
    auth: { mode: 'none' }
  },
  ...overrides
});

describe('prepareIosRequest', () => {
  describe('url and method', () => {
    it('interpolates {{vars}} in the url from environment', () => {
      const item = makeItem();
      const collection = makeCollection();
      const result = prepareIosRequest(item, collection, null, {});
      expect(result.url).toBe('https://api.example.com/users');
    });

    it('uppercases the method', () => {
      const item = makeItem({ request: { ...makeItem().request, method: 'post' } });
      const result = prepareIosRequest(item, makeCollection(), null, {});
      expect(result.method).toBe('POST');
    });

    it('appends enabled query params to the url', () => {
      const item = makeItem({
        request: {
          ...makeItem().request,
          url: '{{host}}/search',
          params: [
            { name: 'q', value: '{{token}}', enabled: true, type: 'query' },
            { name: 'page', value: '2', enabled: true, type: 'query' },
            { name: 'disabled', value: 'x', enabled: false, type: 'query' }
          ]
        }
      });
      const result = prepareIosRequest(item, makeCollection(), null, {});
      expect(result.url).toContain('q=secret-token');
      expect(result.url).toContain('page=2');
      expect(result.url).not.toContain('disabled');
    });

    it('does not append path params to the url query string', () => {
      const item = makeItem({
        request: {
          ...makeItem().request,
          url: '{{host}}/users/:id',
          params: [
            { name: 'id', value: '42', enabled: true, type: 'path' }
          ]
        }
      });
      const result = prepareIosRequest(item, makeCollection(), null, {});
      expect(result.url).not.toContain('id=42');
    });

    it('uses item.draft.request when a draft exists', () => {
      const item = {
        ...makeItem(),
        draft: {
          request: {
            method: 'PUT',
            url: '{{host}}/draft',
            headers: [],
            params: [],
            body: { mode: 'none' },
            auth: { mode: 'none' }
          }
        }
      };
      const result = prepareIosRequest(item, makeCollection(), null, {});
      expect(result.method).toBe('PUT');
      expect(result.url).toBe('https://api.example.com/draft');
    });
  });

  describe('header flattening', () => {
    it('includes only enabled headers as a plain object', () => {
      const item = makeItem({
        request: {
          ...makeItem().request,
          headers: [
            { name: 'X-Custom', value: '{{token}}', enabled: true },
            { name: 'X-Off', value: 'nope', enabled: false }
          ]
        }
      });
      const result = prepareIosRequest(item, makeCollection(), null, {});
      expect(result.headers['X-Custom']).toBe('secret-token');
      expect(result.headers['X-Off']).toBeUndefined();
    });

    it('interpolates header values from environment variables', () => {
      const item = makeItem({
        request: {
          ...makeItem().request,
          headers: [{ name: 'Authorization', value: 'Bearer {{token}}', enabled: true }]
        }
      });
      const result = prepareIosRequest(item, makeCollection(), null, {});
      expect(result.headers['Authorization']).toBe('Bearer secret-token');
    });

    it('produces a plain object (not an array)', () => {
      const item = makeItem({
        request: {
          ...makeItem().request,
          headers: [{ name: 'Accept', value: 'application/json', enabled: true }]
        }
      });
      const result = prepareIosRequest(item, makeCollection(), null, {});
      expect(typeof result.headers).toBe('object');
      expect(Array.isArray(result.headers)).toBe(false);
    });
  });

  describe('auth header assembly', () => {
    it('adds Authorization header for bearer auth', () => {
      const item = makeItem({
        request: {
          ...makeItem().request,
          auth: { mode: 'bearer', bearer: { token: '{{token}}' } }
        }
      });
      const result = prepareIosRequest(item, makeCollection(), null, {});
      expect(result.headers['Authorization']).toBe('Bearer secret-token');
    });

    it('adds Authorization header for basic auth', () => {
      const item = makeItem({
        request: {
          ...makeItem().request,
          auth: { mode: 'basic', basic: { username: 'user', password: 'pass' } }
        }
      });
      const result = prepareIosRequest(item, makeCollection(), null, {});
      const expected = `Basic ${Buffer.from('user:pass').toString('base64')}`;
      expect(result.headers['Authorization']).toBe(expected);
    });

    it('adds named header for apikey auth with header placement', () => {
      const item = makeItem({
        request: {
          ...makeItem().request,
          auth: { mode: 'apikey', apikey: { key: 'X-API-Key', value: 'my-key', placement: 'header' } }
        }
      });
      const result = prepareIosRequest(item, makeCollection(), null, {});
      expect(result.headers['X-API-Key']).toBe('my-key');
    });

    it('does not add Authorization for auth mode none', () => {
      const result = prepareIosRequest(makeItem(), makeCollection(), null, {});
      expect(result.headers['Authorization']).toBeUndefined();
    });
  });

  describe('body normalization', () => {
    it('returns kind:none for body mode none', () => {
      const result = prepareIosRequest(makeItem(), makeCollection(), null, {});
      expect(result.body).toEqual({ kind: 'none' });
    });

    it('normalizes json body with interpolated content', () => {
      const item = makeItem({
        request: {
          ...makeItem().request,
          method: 'POST',
          body: { mode: 'json', json: '{"t":"{{token}}"}' }
        }
      });
      const result = prepareIosRequest(item, makeCollection(), null, {});
      expect(result.body.kind).toBe('json');
      expect(result.body.encoding).toBe('utf8');
      expect(JSON.parse(result.body.data).t).toBe('secret-token');
    });

    it('normalizes text body', () => {
      const item = makeItem({
        request: {
          ...makeItem().request,
          body: { mode: 'text', text: 'hello {{host}}' }
        }
      });
      const result = prepareIosRequest(item, makeCollection(), null, {});
      expect(result.body.kind).toBe('text');
      expect(result.body.data).toBe('hello https://api.example.com');
    });

    it('injects content-type for json body when not already present', () => {
      const item = makeItem({
        request: {
          ...makeItem().request,
          body: { mode: 'json', json: '{}' }
        }
      });
      const result = prepareIosRequest(item, makeCollection(), null, {});
      const ctKey = Object.keys(result.headers).find((k) => k.toLowerCase() === 'content-type');
      expect(ctKey).toBeDefined();
      expect(result.headers[ctKey]).toBe('application/json');
    });

    it('does not duplicate content-type when already set on headers', () => {
      const item = makeItem({
        request: {
          ...makeItem().request,
          headers: [{ name: 'content-type', value: 'application/json; charset=utf-8', enabled: true }],
          body: { mode: 'json', json: '{}' }
        }
      });
      const result = prepareIosRequest(item, makeCollection(), null, {});
      const ctKeys = Object.keys(result.headers).filter((k) => k.toLowerCase() === 'content-type');
      expect(ctKeys).toHaveLength(1);
    });

    it('normalizes formUrlEncoded body to kind:form with encoded data', () => {
      const item = makeItem({
        request: {
          ...makeItem().request,
          body: {
            mode: 'formUrlEncoded',
            formUrlEncoded: [
              { name: 'key1', value: 'val1', enabled: true },
              { name: 'key2', value: 'val2', enabled: false }
            ]
          }
        }
      });
      const result = prepareIosRequest(item, makeCollection(), null, {});
      expect(result.body.kind).toBe('form');
      expect(result.body.data).toContain('key1=val1');
      expect(result.body.data).not.toContain('key2');
    });
  });

  describe('cancelTokenUid', () => {
    it('passes through item.cancelTokenUid', () => {
      const item = { ...makeItem(), cancelTokenUid: 'my-cancel-uid' };
      const result = prepareIosRequest(item, makeCollection(), null, {});
      expect(result.cancelTokenUid).toBe('my-cancel-uid');
    });

    it('defaults to empty string when cancelTokenUid is not set', () => {
      const item = makeItem();
      delete item.cancelTokenUid;
      const result = prepareIosRequest(item, makeCollection(), null, {});
      expect(result.cancelTokenUid).toBe('');
    });
  });

  describe('timeout', () => {
    it('includes a numeric timeout field', () => {
      const result = prepareIosRequest(makeItem(), makeCollection(), null, {});
      expect(typeof result.timeout).toBe('number');
    });
  });
});
