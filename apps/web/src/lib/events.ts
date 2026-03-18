import type { FC } from "react";

interface EventMdxModule {
  default: FC;
  frontmatter: Record<string, unknown>;
}

export interface EventData {
  slug: string;
  name: string;
  when: string;
  finish?: string;
  location?: string;
  Component: FC;
}

const modules = import.meta.glob<EventMdxModule>("../../content/events/*.mdx", {
  eager: true,
});

const events = new Map<string, EventData>();

for (const [path, mod] of Object.entries(modules)) {
  const fm = mod.frontmatter;
  const fileName = path.split("/").pop() ?? "";
  const slug = fileName.replace(".mdx", "");
  events.set(slug, {
    slug,
    name: fm.name as string,
    when: fm.when as string,
    finish: fm.finish as string | undefined,
    location: fm.location as string | undefined,
    Component: mod.default,
  });
}

export function getEventBySlug(slug: string): EventData | undefined {
  return events.get(slug);
}

export function getAllEvents(): EventData[] {
  return [...events.values()].sort(
    (a, b) => new Date(b.when).getTime() - new Date(a.when).getTime(),
  );
}
