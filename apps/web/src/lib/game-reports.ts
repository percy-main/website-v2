import type { FC } from "react";

interface GameReportMdxModule {
  default: FC;
  frontmatter: Record<string, unknown>;
}

export interface GameReport {
  playCricketId: string;
  title: string;
  Component: FC;
}

const modules = import.meta.glob<GameReportMdxModule>(
  "../../content/games/*.mdx",
  { eager: true },
);

const reportsByMatchId = new Map<string, GameReport>();

for (const [, mod] of Object.entries(modules)) {
  const fm = mod.frontmatter;
  const playCricketId = fm.playCricketId as string | undefined;
  if (!playCricketId) continue;

  reportsByMatchId.set(playCricketId, {
    playCricketId,
    title: (fm.title as string) ?? "",
    Component: mod.default,
  });
}

export function getGameReport(playCricketId: string): GameReport | undefined {
  return reportsByMatchId.get(playCricketId);
}
