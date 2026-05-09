import type { FC } from "react";

export const PageLoading: FC = () => (
  <div className="flex min-h-[50vh] items-center justify-center">
    <div className="border-primary size-8 animate-spin rounded-full border-4 border-t-transparent" />
  </div>
);
