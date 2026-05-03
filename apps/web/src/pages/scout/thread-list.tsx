import { Button } from "@/components/ui/button";
import { api, callApi } from "@/lib/api-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router";

export function ThreadList() {
  const params = useParams<{ threadId?: string }>();
  const activeThreadId = params.threadId;
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const threadsQuery = useQuery({
    queryKey: ["scout", "threads"],
    queryFn: () => callApi(api.GET("/api/scout/threads")),
  });

  const createMutation = useMutation({
    mutationFn: () =>
      callApi(
        api.POST("/api/scout/threads", {
          body: { title: "New thread" },
        }),
      ),
    onSuccess: async (thread) => {
      await queryClient.invalidateQueries({
        queryKey: ["scout", "threads"],
      });
      navigate(`/scout/${thread.id}`);
    },
  });

  return (
    <aside className="flex h-full w-64 flex-col border-r border-gray-200 bg-gray-50">
      <div className="border-b border-gray-200 p-3">
        <Button
          className="w-full"
          onClick={() => createMutation.mutate()}
          disabled={createMutation.isPending}
        >
          {createMutation.isPending ? "Creating…" : "New thread"}
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {threadsQuery.isLoading && (
          <div className="p-3 text-sm text-gray-500">Loading…</div>
        )}
        {threadsQuery.error && (
          <div className="p-3 text-sm text-red-600">
            {threadsQuery.error instanceof Error
              ? threadsQuery.error.message
              : "Failed to load threads"}
          </div>
        )}
        {threadsQuery.data?.threads.length === 0 && (
          <div className="p-3 text-sm text-gray-500">
            No threads yet. Click &ldquo;New thread&rdquo; to start.
          </div>
        )}
        <ul>
          {threadsQuery.data?.threads.map((t) => {
            const isActive = t.id === activeThreadId;
            return (
              <li key={t.id}>
                <Link
                  to={`/scout/${t.id}`}
                  className={`block px-3 py-2 text-sm hover:bg-white ${
                    isActive
                      ? "bg-white font-medium text-blue-700"
                      : "text-gray-700"
                  }`}
                >
                  <div className="truncate">{t.title}</div>
                  <div className="truncate text-xs text-gray-400">
                    {new Date(t.updatedAt).toLocaleString()}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </aside>
  );
}
