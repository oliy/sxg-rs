/**
 * Copyright 2021 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {
  signer,
} from './signer';
import {
  arrayBufferToBase64,
} from './utils';
import {
  WasmResponse,
  wasmFunctionsPromise,
  WasmRequest,
} from './wasmFunctions';

addEventListener('fetch', (event) => {
  event.respondWith(handleRequest(event.request))
})

function responseFromWasm(data: WasmResponse) {
  return new Response(
    new Uint8Array(data.body),
    {
      status: data.status,
      headers: data.headers,
    },
  );
}

/**
 * Consumes the input stream, and returns an byte array containing the data in
 * the input stream. If the input stream contains more bytes than `maxSize`,
 * returns null.
 * @param {ReadableStream | null} inputStream
 * @param {number} maxSize
 * @returns {Promise<Uint8Array | null>}
 */
async function readIntoArray(inputStream: ReadableStream | null, maxSize: number) {
  if (inputStream === null) {
    return new Uint8Array([]);
  }
  const reader = inputStream.getReader();
  const received = new Uint8Array(maxSize);
  let receivedSize = 0;
  while (true) {
    const {
      value,
      done,
    } = await reader.read();
    if (value) {
      if (receivedSize + value.byteLength > maxSize) {
        reader.releaseLock();
        inputStream.cancel();
        return null;
      }
      received.set(value, receivedSize);
      receivedSize += value.byteLength;
    }
    if (done) {
      return received.subarray(0, receivedSize);
    }
  }
}

function teeResponse(response: Response) {
  const {
    body,
    headers,
    status,
  } = response;
  const [body1, body2] = body?.tee() ?? [null, null];
  return [
      new Response(body1, { headers, status }),
      new Response(body2, { headers, status }),
  ] as const;
}

// Fetches latest OCSP from the CA, and writes it into key-value store.
// The outgoing traffic to the CA is throttled; when this function is called
// concurrently, the first fetched OCSP will be reused to be returned to all
// callers.
const fetchOcspFromCa = (() => {
  // The un-throttled implementation to fetch OCSP
  async function fetchOcspFromCaImpl() {
    const {
      fetchOcspFromCa: wasmFetchOcspFromCa,
    } = await wasmFunctionsPromise;
    const ocspDer = await wasmFetchOcspFromCa(fetcher);
    const ocspBase64 = arrayBufferToBase64(ocspDer);
    const now = Date.now() / 1000;
    OCSP.put(
      /*key=*/'ocsp',
      /*value=*/JSON.stringify({
        expirationTime: now + 3600 * 24 * 6,
        nextFetchTime: now + 3600 * 24,
        ocspBase64,
      }),
      {
        expirationTtl: 3600 * 24 * 6, // in seconds
      },
    );
    return ocspBase64;
  }
  let singletonTask: Promise<string> | null = null;
  return async function() {
    if (singletonTask !== null) {
      return await singletonTask;
    } else {
      singletonTask = fetchOcspFromCaImpl();
      const result = await singletonTask;
      singletonTask = null;
      return result;
    }
  };
})();

async function getOcsp() {
  const ocspInCache = await OCSP.get('ocsp');
  if (ocspInCache) {
    const {
      expirationTime,
      nextFetchTime,
      ocspBase64,
    } = JSON.parse(ocspInCache);
    const now = Date.now() / 1000;
    if (now >= expirationTime) {
      return await fetchOcspFromCa();
    }
    if (now >= nextFetchTime) {
      // Spawns a non-blocking task to update latest OCSP in store
      fetchOcspFromCa();
    }
    return ocspBase64;
  } else {
    return await fetchOcspFromCa();
  }
}

// Returns the proper fallbackUrl and certOrigin. fallbackUrl should be
// https://my_domain.com in all environments, and certOrigin should be the
// origin of the worker (localhost, foo.bar.workers.dev, or my_domain.com).
//
// The request.url for each environment is as follows:
// wrangler dev:                           https://my_domain.com/
// wrangler publish + workers_dev = true:  https://sxg.user.workers.dev/
// wrangler publish + workers_dev = false: https://my_domain.com/
//
// So config-generator sets HTML_HOST = my_domain.com when workers_dev is true.
//
// For wrangler dev, add CERT_ORIGIN = 'http://localhost:8787' to [vars] in
// wrangler.toml. Afterwards, set it to '' for production.
//
// For preset content, replaceHost is false because the fallback is on the
// worker origin, not the HTML_HOST.
function fallbackUrlAndCertOrigin(url: string, replaceHost: boolean): [string, string] {
  let fallbackUrl = new URL(url);
  let certOrigin = typeof CERT_ORIGIN !== 'undefined' && CERT_ORIGIN ?
      CERT_ORIGIN : fallbackUrl.origin;
  if (replaceHost && typeof HTML_HOST !== 'undefined' && HTML_HOST) {
      fallbackUrl.host = HTML_HOST;
  }
  return [fallbackUrl.toString(), certOrigin];
}

async function handleRequest(request: Request) {
  const {
    createRequestHeaders,
    getLastErrorMessage,
    servePresetContent,
    shouldRespondDebugInfo,
  } = await wasmFunctionsPromise;
  let fallback: Response | undefined;
  try {
    const ocsp = await getOcsp();
    const presetContent = servePresetContent(request.url, ocsp);
    let fallbackUrl: string;
    let certOrigin: string;
    let sxgPayload: Response;
    if (presetContent) {
      if (presetContent.kind === 'direct') {
        return responseFromWasm(presetContent);
      } else {
        [fallbackUrl, certOrigin] = fallbackUrlAndCertOrigin(presetContent.url, false);
        fallback = responseFromWasm(presetContent.fallback);
        sxgPayload = responseFromWasm(presetContent.payload);
        // Although we are not sending any request to the backend,
        // we still need to check the validity of the request header.
        // For example, if the header does not contain
        // `Accept: signed-exchange;v=b3`, we will throw an error.
        createRequestHeaders('AcceptsSxg', Array.from(request.headers));
      }
    } else {
      [fallbackUrl, certOrigin] = fallbackUrlAndCertOrigin(request.url, true);
      const requestHeaders = createRequestHeaders('PrefersSxg', Array.from(request.headers));
      [sxgPayload, fallback] = teeResponse(await fetch(
        fallbackUrl,
        {
          headers: requestHeaders,
        }
      ));
    }
    return await generateSxgResponse(fallbackUrl, certOrigin, sxgPayload);
  } catch (e) {
    if (shouldRespondDebugInfo()) {
      let message;
      if (e instanceof WebAssembly.RuntimeError) {
        message = `WebAssembly code is aborted.\n${e}.\n${getLastErrorMessage()}`;
      } else if (typeof e === 'string') {
        message = `A message is gracefully thrown.\n${e}`;
      } else {
        message = `JavaScript code throws an error.\n${e}`;
      }
      if (!fallback) {
        fallback = new Response(message);
      }
      return new Response(
        fallback.body,
        {
          status: fallback.status,
          headers: [
              ...Array.from(fallback.headers || []),
              ['sxg-edge-worker-debug-info', JSON.stringify(message)],
          ],
        },
      );
    } else {
      if (fallback) {
        // The error occurs after fetching from origin server, hence we reuse
        // the response of that fetch.
        return fallback;
      } else {
        // The error occurs before fetching from origin server, hence we need to
        // fetch now. Since we are not generating SXG anyway in this case, we
        // simply use all http headers from the user.
        return fetch(request);
      }
    }
  }
}

async function generateSxgResponse(fallbackUrl: string, certOrigin: string, payload: Response) {
  const {
    createSignedExchange,
    validatePayloadHeaders,
  } = await wasmFunctionsPromise;
  const payloadStatusCode = payload.status;
  if (payloadStatusCode !== 200) {
    throw `The resource status code is ${payloadStatusCode}`;
  }
  const payloadHeaders = Array.from(payload.headers);
  validatePayloadHeaders(payloadHeaders);
  const PAYLOAD_SIZE_LIMIT = 8000000;
  const payloadBody = await readIntoArray(payload.body, PAYLOAD_SIZE_LIMIT);
  if (!payloadBody) {
    throw `The size of payload exceeds the limit ${PAYLOAD_SIZE_LIMIT}`;
  }
  const sxg = await createSignedExchange(
    fallbackUrl,
    certOrigin,
    payloadStatusCode,
    payloadHeaders,
    new Uint8Array(payloadBody),
    Math.round(Date.now() / 1000 - 60 * 60 * 12),
    signer,
  );
  return responseFromWasm(sxg);
}

async function fetcher(request: WasmRequest): Promise<WasmResponse> {
  const response = await fetch(
    request.url,
    {
      body: new Uint8Array(request.body),
      headers: request.headers,
      method: request.method,
    },
  );
  const responseBody = await response.arrayBuffer();
  return {
    body: Array.from(new Uint8Array(responseBody)),
    headers: [],
    status: response.status,
  };
}
