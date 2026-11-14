import type { Page } from "./services";

export async function collectPages<T>(read: (cursor?: string) => Page<T> | Promise<Page<T>>) {
  const values: T[] = [];
  let cursor: string | undefined;
  do {
    const page = await read(cursor);
    values.push(...page.items);
    cursor = page.next ?? undefined;
  } while (cursor);
  return values;
}
