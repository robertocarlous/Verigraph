import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Dev server proxies /v1/* so the same fetch("/v1/...") calls work unchanged
// whether served by Vite (dev) or by Express itself serving the built dist/
// (prod/demo) — see backend/src/server.ts's static mount.
//
// Defaults to the deployed Railway backend (verified live and running the
// current commit — /v1/pricing returns rpcUrl/signerAddress, confirming it's
// not the older pre-redeploy code) — see vercel.json for the equivalent
// rewrite used when the frontend itself is deployed to Vercel, so both dev
// and prod consistently point at one real backend URL with no local server
// required. Override with VITE_API_TARGET (e.g. in frontend/.env.local) to
// point at a local backend (`npm run dev` / `npm run dev:all`) instead.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiTarget = env.VITE_API_TARGET || "https://verigraph-production.up.railway.app";

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
