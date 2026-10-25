import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer as createNetServer } from "node:net";
import { fileURLToPath, pathToFileURL } from "node:url";

const kubRequire = createRequire(new URL("../../artifacts/kub/package.json", import.meta.url));
const root = fileURLToPath(new URL("../../artifacts/kub/", import.meta.url));
const sourceRoot = fileURLToPath(new URL("../../artifacts/kub/src/", import.meta.url));
const { build } = createRequire(kubRequire.resolve("vite"))("esbuild");

export const mutations = {
  "wrong-limit": ["64 * MEBIBYTE", "65 * MEBIBYTE"],
  "fake-empty": ["stats !== null && stats.bytes === 0 && stats.count === 0", "stats !== null && (stats.bytes === 0 || stats.count === 0)"],
  "unrequested-success": ["clearRequested && empty", "empty"],
  "missing-pending-lock": ["pending || stats === null", "stats === null"],
  "unclamped-meter": ["Math.min(stats.bytes, stats.limitBytes)", "stats.bytes"],
};

// No App, auth store, service, credentials or production page is loaded here.
export async function startMediaCacheFixture(mutant) {
  assert.equal(process.env.KUB_QA_ALLOW_MUTATIONS, "0", "fixture requires explicit mutation refusal");
  let applied = 0;
  const bundle = await build({
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    alias: { "@": sourceRoot },
    define: { "process.env.NODE_ENV": '"development"' },
    plugins: mutant ? [{ name: "media-cache-ui-in-memory-mutation", setup(plugin) {
      plugin.onLoad({ filter: /MediaCacheSection\.tsx$/ }, ({ path }) => {
        const before = readFileSync(path, "utf8");
        const [from, to] = mutations[mutant];
        assert.equal(before.split(from).length - 1, 1, `unique mutation anchor: ${mutant}`);
        const after = before.replace(from, to);
        assert.notEqual(createHash("sha256").update(before).digest("hex"), createHash("sha256").update(after).digest("hex"));
        applied++;
        return { contents: after, loader: "tsx" };
      });
    } }] : [],
    stdin: { resolveDir: sourceRoot, sourcefile: "media-cache-settings-fixture.tsx", loader: "tsx", contents: `
      import React from "react";
      import { createRoot } from "react-dom/client";
      import { flushSync } from "react-dom";
      import { MediaCacheSection } from "./components/settings/MediaCacheSection";
      const root = createRoot(document.getElementById("root"));
      let key = 0, props;
      const calls = { clear: 0, limits: [] };
      function draw() {
        flushSync(() => root.render(<main style={{width: "100%", maxWidth: 476, margin: "0 auto", padding: 16}}>
          <h1 className="mb-4 text-lg font-semibold text-[color:var(--kub-text)]">Данные и память</h1>
          <div className="kub-glass rounded-xl p-4"><MediaCacheSection key={key} {...props}/></div>
        </main>));
      }
      function update(next) { props = {...props, ...next}; draw(); }
      function reset(next = {}) {
        key++; calls.clear = 0; calls.limits = [];
        props = { stats: {bytes: 25165824, count: 12, limitBytes: 134217728}, pending: false, error: null,
          onClear: () => { calls.clear++; update({pending: true, error: null}); },
          onLimitChange: bytes => { calls.limits.push(bytes); update({pending: true, error: null}); },
          ...next };
        draw();
      }
      window.mediaCacheFixture = {update, reset, calls}; reset();
    ` },
  });
  if (mutant) assert.equal(applied, 1, "exactly one in-memory mutation was applied");
  const { createServer } = await import(pathToFileURL(kubRequire.resolve("vite")).href);
  const tailwind = (await import(pathToFileURL(kubRequire.resolve("@tailwindcss/vite")).href)).default;
  const port = await new Promise((resolve, reject) => {
    const socket = createNetServer();
    socket.once("error", reject);
    socket.listen(0, "127.0.0.1", () => {
      const {port} = socket.address();
      socket.close(error => error ? reject(error) : resolve(port));
    });
  });
  const server = await createServer({
    configFile: false, envFile: false, root, plugins: [tailwind(), {
      name: "synthetic-media-cache-settings-only",
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url === "/__media-cache-settings/bundle.js") {
            res.setHeader("Content-Type", "text/javascript"); res.end(bundle.outputFiles[0].text); return;
          }
          if (req.url?.startsWith("/__media-cache-settings/")) {
            res.setHeader("Content-Type", "text/html; charset=utf-8");
            res.end(`<!doctype html><html lang="ru" class="dark" style="height:auto;overflow:auto"><head><meta charset="utf-8">
              <meta name="viewport" content="width=device-width, initial-scale=1">
              <title>LETSCUBE synthetic media cache settings</title>
              <link rel="stylesheet" href="/src/index.css?direct"></head>
              <body style="height:auto;min-height:100vh;overflow:visible"><div id="root"></div><script src="/__media-cache-settings/bundle.js"></script></body></html>`);
            return;
          }
          next();
        });
      },
    }],
    server: { host: "127.0.0.1", port, strictPort: true, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
    logLevel: "error",
  });
  try {
    await server.listen();
    const address = server.httpServer.address();
    assert.equal(typeof address, "object");
    const origin = `http://127.0.0.1:${address.port}`;
    return { origin, url: `${origin}/__media-cache-settings/`, close: () => server.close() };
  } catch (error) { await server.close(); throw error; }
}
