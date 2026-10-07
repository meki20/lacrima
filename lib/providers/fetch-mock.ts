/** Test helper: swaps `globalThis.fetch` for a handler and records what was asked for. */
export type Handler = (url: URL, init?: RequestInit) => Response | undefined;

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export async function withFetch<T>(
  handler: Handler,
  run: (calls: URL[]) => Promise<T>,
): Promise<T> {
  const real = globalThis.fetch;
  const calls: URL[] = [];
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push(url);
    // Anything the test didn't script is a hard failure, never a silent success.
    return handler(url, init) ?? new Response("unscripted", { status: 599 });
  }) as typeof fetch;
  try {
    return await run(calls);
  } finally {
    globalThis.fetch = real;
  }
}

/** Runs `run` with `LACRIMA_TMDB_KEY` set (or deleted for `undefined`), then restores it. */
export async function withTmdbKey<T>(key: string | undefined, run: () => Promise<T>): Promise<T> {
  const before = process.env.LACRIMA_TMDB_KEY;
  if (key === undefined) delete process.env.LACRIMA_TMDB_KEY;
  else process.env.LACRIMA_TMDB_KEY = key;
  try {
    return await run();
  } finally {
    if (before === undefined) delete process.env.LACRIMA_TMDB_KEY;
    else process.env.LACRIMA_TMDB_KEY = before;
  }
}
