import { useSearchParams } from "react-router";
import type { z } from "zod";

export function useSearchParam<T>({
  param,
  decode = true,
  parse,
  schema,
}: {
  param: string;
  decode?: boolean;
  parse?: (params: string) => unknown;
  schema: z.ZodType<T>;
}) {
  const [searchParams] = useSearchParams();
  const rawValue = searchParams.get(param) ?? undefined;
  const value = decode && rawValue ? decodeURIComponent(rawValue) : rawValue;
  const candidate = parse && value ? parse(value) : value;
  return schema.parse(candidate);
}
