// A module-resolution hook so `supabase/functions/voice-gateway/index.ts` can be
// imported by `node --test`.
//
// The entrypoint is a Deno module: it imports supabase-js by an `npm:` specifier
// node cannot resolve, and it calls `Deno.serve` at load. Only the first of
// those needs machinery — this hook points the `npm:` specifier at a stub that
// records what the function asks the database for. `Deno` itself is a plain
// object the test installs on `globalThis` before importing.
//
// Without this the whole request path — which check runs before which, what
// status each refusal produces, what is and is not in a response body — would
// be reachable only from a deployed function, and would therefore go untested.
const STUB = new URL("./voice-gateway-supabase-stub.mjs", import.meta.url).href;

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("npm:@supabase/supabase-js")) {
    return { url: STUB, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
