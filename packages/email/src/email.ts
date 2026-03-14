import type { FC } from "react";

export interface EmailMetadata<T> {
  preview?: T;
};

export const email =
  <T>(subject: string, metadata: EmailMetadata<T>) =>
  (component: FC<T>) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    (component as any).PreviewProps = metadata.preview;

    return {
      subject,
      component,
      metadata,
    };
  };
