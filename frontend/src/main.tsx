import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import "./index.css";
import App from "./App";
import { fetchPricing } from "./lib/api";
import { buildWagmiConfig, type WagmiAppConfig } from "./lib/wagmi";
import type { PricingInfo } from "./lib/types";

const queryClient = new QueryClient();

function Bootstrap() {
  const [pricing, setPricing] = useState<PricingInfo | null>(null);
  const [config, setConfig] = useState<WagmiAppConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  // StrictMode double-invokes effects in dev — a plain state guard doesn't
  // prevent this closure from building a SECOND WagmiConfig (with its own
  // fresh `injected()` connector, attaching its own listeners to the same
  // `window.ethereum`) before the first `setConfig` has re-rendered. Two
  // connector instances racing on one wallet extension is exactly the kind
  // of thing that produces confused/wrong responses from it. A ref (updated
  // synchronously, unlike state) makes the guard reliable.
  const configBuilt = useRef(false);

  useEffect(() => {
    fetchPricing()
      .then((p) => {
        setPricing(p);
        if (p.configured && p.network && p.rpcUrl && !configBuilt.current) {
          configBuilt.current = true;
          setConfig(buildWagmiConfig(p.rpcUrl, Number(p.network.split(":")[1])));
        }
      })
      .catch((err) => setError(err.message ?? String(err)));
  }, []);

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-page p-6 text-primary">
        <p className="max-w-md text-center text-sm text-secondary">
          Could not reach the Verigraph API: {error}
        </p>
      </div>
    );
  }

  if (!pricing) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-page">
        <p className="text-sm text-muted">Loading Verigraph…</p>
      </div>
    );
  }

  if (!pricing.configured || !config) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-page p-6">
        <p className="max-w-md text-center text-sm text-secondary">
          The payment gate isn't configured on the server yet (missing:{" "}
          {(pricing.missingConfig ?? []).join(", ")}). Set the required environment
          variables and restart the backend.
        </p>
      </div>
    );
  }

  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <App pricing={pricing} />
      </QueryClientProvider>
    </WagmiProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Bootstrap />
  </StrictMode>,
);
