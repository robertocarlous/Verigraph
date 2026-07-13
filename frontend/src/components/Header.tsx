export default function Header() {
  return (
    <header className="mb-10 flex items-center gap-3">
      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent text-sm font-bold text-white">
        V
      </div>
      <div>
        <h1 className="text-lg font-semibold leading-tight">Verigraph</h1>
        <p className="text-xs text-muted">Agent Reputation Integrity Monitor</p>
      </div>
    </header>
  );
}
