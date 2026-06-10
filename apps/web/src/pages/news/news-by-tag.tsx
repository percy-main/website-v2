import { useDocumentMeta } from "@/hooks/use-document-meta.js";
import { Navigate, useParams } from "react-router";
import { NewsListView } from "./news-list-view.js";

export function Component() {
  const params = useParams();
  const tag = params.tag ?? null;
  const page = Math.max(1, Number(params.page) || 1);

  useDocumentMeta(
    tag ? `News - ${tag}` : "News",
    "Latest news and updates from Percy Main Community Sports Club.",
  );

  if (!tag) {
    return <Navigate to="/news/1" replace />;
  }

  return <NewsListView tag={tag} page={page} />;
}
