// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, cloudflare (build-only),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... } }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { fileURLToPath } from "node:url";

// Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
// @cloudflare/vite-plugin builds from this — wrangler.jsonc main alone is insufficient.
//
// pkce-challenge alias: @modelcontextprotocol/sdk pulls in pkce-challenge for OAuth, but
// pkce-challenge's package.json only exposes node/browser conditions — Vite's workerd
// environment finds nothing. We don't use MCP OAuth, so alias it to the node entry directly.
export default defineConfig({
  tanstackStart: {
    server: { entry: "server" },
  },
  vite: {
    resolve: {
      alias: [
        {
          find: /^pkce-challenge$/,
          replacement: fileURLToPath(
            new URL(
              "./node_modules/pkce-challenge/dist/index.node.js",
              import.meta.url,
            ),
          ),
        },
      ],
    },
  },
});
