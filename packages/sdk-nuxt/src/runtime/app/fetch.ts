/**
 * The `fetch` the page composables hand the content API reader. No Nuxt
 * imports, so it is tested on its own.
 */
/** Nuxt's `$fetch` as far as this file calls it. */
export type RequestFetch = (
  path: string,
  options: {
    method: string;
    headers?: HeadersInit;
    responseType: "text";
    ignoreResponseError: true;
    onResponse: (context: { response: Response }) => void;
  },
) => Promise<string>;

/**
 * A `fetch` over Nuxt's request fetch. The content API reader asks for an
 * absolute URL; this keeps only its path, so the server answers it in-process
 * with the incoming request's headers, and the browser fetches it same-origin.
 */
export function fetchVia(requestFetch: RequestFetch): typeof globalThis.fetch {
  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    let status = 200;
    let contentType = "application/json";
    const body = await requestFetch(`${url.pathname}${url.search}`, {
      method: init?.method ?? "GET",
      headers: init?.headers,
      responseType: "text",
      ignoreResponseError: true,
      onResponse: ({ response }) => {
        status = response.status;
        contentType = response.headers.get("content-type") ?? contentType;
      },
    });
    return new Response(body, { status, headers: { "content-type": contentType } });
  };
}
