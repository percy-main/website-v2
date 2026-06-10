import { useDocumentMeta } from "@/hooks/use-document-meta.js";
import { useParams } from "react-router";
import { NewsListView } from "./news-list-view.js";

export function Component() {
  useDocumentMeta(
    "News",
    "Latest news and updates from Percy Main Community Sports Club.",
  );
  const params = useParams();
  const page = Math.max(1, Number(params.page) || 1);

  return <NewsListView page={page} />;
}
