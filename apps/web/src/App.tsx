import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const queryClient = new QueryClient();

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <div>
        <h1>Percy Main CSC</h1>
        <p>Frontend scaffold — migration in progress.</p>
      </div>
    </QueryClientProvider>
  );
}
