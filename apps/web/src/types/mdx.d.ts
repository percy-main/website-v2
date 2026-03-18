declare module "*.mdx" {
  import type { FC } from "react";

  export const frontmatter: Record<string, unknown>;

  const MDXComponent: FC;
  export default MDXComponent;
}
