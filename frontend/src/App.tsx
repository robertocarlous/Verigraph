import Header from "./components/Header";
import Hero from "./components/Hero";
import WalletPanel from "./components/WalletPanel";
import CheckPanel from "./components/CheckPanel";
import type { PricingInfo } from "./lib/types";

export default function App({ pricing }: { pricing: PricingInfo }) {
  return (
    <div className="min-h-screen bg-page text-primary">
      <div className="mx-auto max-w-3xl px-5 py-10">
        <Header />
        <Hero pricing={pricing} />
        <WalletPanel pricing={pricing} />
        <CheckPanel pricing={pricing} />
      </div>
    </div>
  );
}
