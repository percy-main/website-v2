import { getPersonBySlug, type PersonData } from "./people.js";
import type { FC } from "react";

interface NewsMdxModule {
  default: FC;
  frontmatter: Record<string, unknown>;
}

export interface NewsArticle {
  slug: string;
  title: string;
  date: Date;
  tags: string[];
  author: PersonData | undefined;
  authorSlug: string | undefined;
  Component: FC;
}

const modules = import.meta.glob<NewsMdxModule>(
  "../../content/news/**/*.mdx",
  { eager: true },
);

const articles: NewsArticle[] = Object.values(modules)
  .map((mod) => {
    const fm = mod.frontmatter;
    const authorSlug = fm.author as string | undefined;
    return {
      slug: fm.slug as string,
      title: (fm.title as string) ?? "Untitled",
      date: new Date(fm.date as string),
      tags: (fm.tags as string[] | undefined) ?? [],
      author: authorSlug ? getPersonBySlug(authorSlug) : undefined,
      authorSlug,
      Component: mod.default,
    };
  })
  .sort((a, b) => b.date.getTime() - a.date.getTime());

export const allNews: NewsArticle[] = articles;

export const newsBySlug = new Map(articles.map((a) => [a.slug, a]));
