import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Dev server proxies /v1/* so the same fetch("/v1/...") calls work unchanged
// whether served by Vite (dev) or by Express itself serving the built dist/
// (prod/demo) — see backend/src/server.ts's static mount.
//
// Defaults to localhost:8402 — Railway is currently running older code
// (from before this session's rpcUrl/signerAddress/signed-reports/retry/
// INSUFFICIENT_DATA additions) so pointing here at Railway would silently
// break the app until it's redeployed. Once Railway is updated, switch this
// default (or set VITE_API_TARGET=https://verigraph-production.up.railway.app
// in frontend/.env.local) — see vercel.json for the equivalent rewrite used
// when the frontend itself is deployed to Vercel, so both dev and prod
// consistently point at one real backend URL with no local server involved.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiTarget = env.VITE_API_TARGET || "http://localhost:8402";

  return {
    plugins: [react(), tailwindcss()],
    server: {
      port: 5173,
      proxy: {
        "/v1": {
          target: apiTarget,
          changeOrigin: true,
          secure: true,
          // Without this, an unreachable target makes the proxy silently
          // return an empty body or Vite's own index.html — the browser
          // then fails deep inside res.json() with a confusing
          // "Unexpected end of JSON input" / "Unexpected token '<'"
          // instead of a clear cause.
          configure(proxy) {
            proxy.on("error", (err) => {
              console.error(`\n[vite proxy] API target ${apiTarget} is unreachable (${err.message}).\n`);
            });
          },
        },
      },
    },
    build: {
      outDir: "dist",
    },
  };
});
