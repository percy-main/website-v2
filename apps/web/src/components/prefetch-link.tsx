import {
  useQueryClient,
  type QueryKey,
  type QueryExecuteOptions,
} from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";
import { Link, type LinkProps } from "react-router";

/**
 * Link that warms the react-query cache for its destination on intent
 * (mouse-enter or focus) and on first viewport intersection - the #489
 * mitigation for losing instant bundled-content navigation. Pass the same
 * query options object the destination page reads (see lib/content-queries)
 * so the prefetch lands in the cache entry the navigation will use.
 */
export function PrefetchLink<
  TQueryFnData,
  TError,
  TData,
  TQueryKey extends QueryKey,
>({
  query,
  onMouseEnter,
  onFocus,
  ...props
}: LinkProps & {
  query: QueryExecuteOptions<TQueryFnData, TError, TData, TData, TQueryKey>;
}) {
  const queryClient = useQueryClient();
  const ref = useRef<HTMLAnchorElement>(null);
  const prefetched = useRef(false);

  // Latest-ref pattern: the observer callback always prefetches the current
  // options without re-subscribing when the parent re-renders.
  const queryRef = useRef(query);
  useEffect(() => {
    queryRef.current = query;
  });

  const prefetch = useCallback(() => {
    if (prefetched.current) return;
    prefetched.current = true;
    void queryClient.query(queryRef.current).catch(() => undefined);
  }, [queryClient]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        prefetch();
        observer.disconnect();
      }
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, [prefetch]);

  return (
    <Link
      ref={ref}
      onMouseEnter={(event) => {
        prefetch();
        onMouseEnter?.(event);
      }}
      onFocus={(event) => {
        prefetch();
        onFocus?.(event);
      }}
      {...props}
    />
  );
}
