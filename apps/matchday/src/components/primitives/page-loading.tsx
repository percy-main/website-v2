/** Used while the auth session is still resolving on first paint. */
export function PageLoading() {
  return (
    <div className="bg-surface-raised flex min-h-dvh items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <div className="border-border border-t-navy size-8 animate-spin rounded-full border-2" />
        <p className="text-text-secondary text-sm">Loading Matchday…</p>
      </div>
    </div>
  );
}
