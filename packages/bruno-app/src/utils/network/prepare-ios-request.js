import { interpolate } from '@usebruno/common';
import { getAllVariables, mergeHeaders, getTreePathFromCollectionToItem } from 'utils/collections/index';
import { getAuthHeaders } from 'utils/codegenerator/auth';
import { resolveInheritedAuth } from 'utils/auth';
import {
  interpolateAuth,
  interpolateHeaders,
  interpolateParams,
  interpolateBody
} from 'utils/network/interpolate-request';

const BODY_CONTENT_TYPE = {
  json: 'application/json',
  text: 'text/plain',
  xml: 'application/xml',
  sparql: 'application/sparql-query',
  graphql: 'application/json'
};

/**
 * Builds a fully-resolved URL from the interpolated base url and enabled query params.
 * Path params (type='path') are excluded — the url field already contains interpolated
 * path segments after the interpolate() call on request.url.
 */
const buildUrl = (baseUrl, params) => {
  const queryParams = (params || []).filter((p) => p.enabled && p.type !== 'path');
  if (!queryParams.length) return baseUrl;
  const qs = queryParams
    .map((p) => `${encodeURIComponent(p.name)}=${encodeURIComponent(p.value)}`)
    .join('&');
  const separator = baseUrl.includes('?') ? '&' : '?';
  return `${baseUrl}${separator}${qs}`;
};

/**
 * Normalizes the interpolated body into the iOS contract shape:
 * { kind, data?, encoding? }
 *
 * Supported kinds: 'none', 'json', 'text', 'form', 'binary'
 */
const normalizeBody = (body) => {
  if (!body || body.mode === 'none' || !body.mode) {
    return { kind: 'none' };
  }

  switch (body.mode) {
    case 'json':
      return { kind: 'json', data: body.json || '', encoding: 'utf8' };

    case 'text':
      return { kind: 'text', data: body.text || '', encoding: 'utf8' };

    case 'xml':
      return { kind: 'text', data: body.xml || '', encoding: 'utf8' };

    case 'sparql':
      return { kind: 'text', data: body.sparql || '', encoding: 'utf8' };

    case 'graphql': {
      const graphqlBody = body.graphql || {};
      const payload = {
        query: graphqlBody.query || '',
        variables: graphqlBody.variables ? graphqlBody.variables : undefined
      };
      return { kind: 'json', data: JSON.stringify(payload), encoding: 'utf8' };
    }

    case 'formUrlEncoded': {
      const params = (body.formUrlEncoded || []).filter((p) => p.enabled);
      const encoded = params
        .map((p) => `${encodeURIComponent(p.name)}=${encodeURIComponent(p.value)}`)
        .join('&');
      return { kind: 'form', data: encoded, encoding: 'utf8' };
    }

    case 'multipartForm': {
      // Pass raw params as JSON; the native layer handles multipart encoding
      const params = (body.multipartForm || []).filter((p) => p.enabled);
      return { kind: 'form', data: JSON.stringify(params), encoding: 'utf8' };
    }

    case 'file': {
      const files = Array.isArray(body.file) ? body.file : [];
      const selected = files.find((f) => f.selected) || files[0];
      if (!selected || !selected.filePath) return { kind: 'none' };
      // Binary file: data is base64-encoded content (caller must supply it)
      return { kind: 'binary', data: selected.filePath, encoding: 'base64' };
    }

    default:
      return { kind: 'none' };
  }
};

/**
 * Derives the Content-Type header value for the given body mode.
 * Returns null when no content-type should be injected automatically.
 */
const contentTypeForMode = (mode) => BODY_CONTENT_TYPE[mode] || null;

/**
 * Builds the resolved request object that the BrunoHttp native plugin's send() expects.
 *
 * @param {Object} item - Redux item (may have .draft)
 * @param {Object} collection - Redux collection (with activeEnvironmentUid, runtimeVariables, etc.)
 * @param {Object} environment - Active environment object (may be null)
 * @param {Object} runtimeVariables - Runtime variables map
 * @returns {{ url, method, headers, body, timeout, cancelTokenUid }}
 */
export const prepareIosRequest = (item, collection, environment, runtimeVariables) => {
  const request = item.draft ? item.draft.request : item.request;
  const variables = getAllVariables(collection, item);

  // Resolve inherited auth before interpolation
  const resolvedItem = resolveInheritedAuth(item, collection);
  const effectiveAuth = resolvedItem.auth;

  // Interpolate auth so tokens are resolved before building auth headers
  const interpolatedAuth = interpolateAuth(effectiveAuth, variables);

  // Gather merged headers (collection + folder + request) then interpolate
  const requestTreePath = getTreePathFromCollectionToItem(collection, item);
  let mergedHeadersList = mergeHeaders(collection, request, requestTreePath);
  mergedHeadersList = interpolateHeaders(mergedHeadersList, variables);

  // Build auth headers and append
  const authHeaderList = getAuthHeaders(interpolatedAuth, collection, item);

  // Interpolate params and body
  const interpolatedParams = interpolateParams(request.params || [], variables);
  const interpolatedBody = interpolateBody(request.body, variables);

  // Interpolate the URL (includes {{vars}} and inline path params)
  const interpolatedUrl = interpolate(request.url || '', variables);

  // Append enabled query params to the URL
  const finalUrl = buildUrl(interpolatedUrl, interpolatedParams);

  // Flatten all headers: collection+folder+request (enabled only), then auth headers
  // Auth headers may override existing Authorization; last write wins — put auth last.
  const headersMap = {};
  mergedHeadersList.forEach((h) => {
    if (h.enabled && h.name) {
      headersMap[h.name] = h.value;
    }
  });
  authHeaderList.forEach((h) => {
    if (h.enabled && h.name) {
      headersMap[h.name] = h.value;
    }
  });

  // Inject Content-Type if not already present and body mode requires one
  const bodyMode = interpolatedBody && interpolatedBody.mode;
  if (bodyMode) {
    const ct = contentTypeForMode(bodyMode);
    const hasContentType = Object.keys(headersMap).some((k) => k.toLowerCase() === 'content-type');
    if (ct && !hasContentType) {
      headersMap['content-type'] = ct;
    }
  }

  const nativeBody = normalizeBody(interpolatedBody);

  return {
    url: finalUrl,
    method: (request.method || 'GET').toUpperCase(),
    headers: headersMap,
    body: nativeBody,
    timeout: 0,
    cancelTokenUid: item.cancelTokenUid || ''
  };
};
