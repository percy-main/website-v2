/** Used while the auth session is still resolving on first paint. */
export function PageLoading() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-surface-raised">
      <div className="flex flex-col items-center gap-3">
        <div className="size-8 animate-spin rounded-full border-2 border-border border-t-navy" />
        <p className="text-sm text-text-secondary">Loading Matchday…</p>
      </div>
    </div>
  );
}
