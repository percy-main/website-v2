import { mdxComponents } from "@/components/mdx-components.js";
import { OptimisedImage } from "@/components/optimised-image.js";
import { getImageUrl, getPicture } from "@/lib/image-map.js";
import { newsBySlug } from "@/lib/news.js";
import { MDXProvider } from "@mdx-js/react";
import { format } from "date-fns";
import { IoChevronForward } from "react-icons/io5";
import { Link, useParams } from "react-router";

const ANON_IMAGE = getImageUrl("/images/anon.jpg");
const ANON_PICTURE = getPicture("/images/anon.jpg");

export function Component() {
  const params = useParams();
  const article = newsBySlug.get(params.id ?? "");

  if (!article) {
    return (
      <div className="container mx-auto px-4 py-12">
        <h1>Article Not Found</h1>
        <p>The article you're looking for doesn't exist.</p>
        <Link to="/news/1" className="text-primary hover:underline">
          Back to News
        </Link>
      </div>
    );
  }

  const PageContent = article.Component;

  return (
    <div className="container mx-auto px-4 py-6">
      {/* Breadcrumbs */}
      <div className="text-h4 mb-4 flex items-center gap-2">
        <Link to="/news/1" className="hover:text-primary text-gray-600">
          News
        </Link>
        <IoChevronForward className="text-gray-400" size={14} />
        <span className="text-dark font-medium">{article.title}</span>
      </div>

      <div className="max-w-3xl">
        {/* Author + date */}
        {article.author && (
          <Link
            to={`/person/${article.author.slug}`}
            className="flex items-center gap-4"
          >
            {(() => {
              const picture = article.author.photoPicture ?? ANON_PICTURE;
              return picture ? (
                <OptimisedImage
                  picture={picture}
                  alt={article.author.name}
                  className="h-14 w-14 rounded-full object-cover"
                  sizes="56px"
                />
              ) : (
                <img
                  className="h-14 w-14 rounded-full object-cover"
                  src={article.author.photo ?? ANON_IMAGE}
                  alt={article.author.name}
                />
              );
            })()}
            <span className="text-dark font-medium">{article.author.name}</span>
          </Link>
        )}
        <p className="pb-4 text-sm text-gray-600">
          Published on {format(article.date, "PPPP")}
        </p>

        {/* Article content */}
        <MDXProvider components={mdxComponents}>
          <div className="mdx-content flex flex-col *:mb-4">
            <PageContent />
          </div>
        </MDXProvider>
      </div>
    </div>
  );
}
