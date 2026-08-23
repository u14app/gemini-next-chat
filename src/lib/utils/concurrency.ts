export async function mapSettledWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new RangeError("Concurrency must be a positive integer");
  }

  const results = new Array<PromiseSettledResult<R>>(items.length);
  let nextIndex = 0;

  const worker = async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      try {
        results[index] = {
          status: "fulfilled",
          value: await mapper(items[index], index),
        };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, worker),
  );
  return results;
}

export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new RangeError("Concurrency must be a positive integer");
  }

  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, worker),
  );
  return results;
}

/**
 * Maps with a global concurrency cap while serializing items that share a
 * non-empty execution group. Grouped items start in their original order;
 * ungrouped items and different groups may still run concurrently.
 */
export async function mapWithConcurrencyGroups<T, R>(
  items: readonly T[],
  concurrency: number,
  getGroup: (item: T, index: number) => string | undefined,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const groupTails = new Map<string, Promise<void>>();

  return mapWithConcurrency(items, concurrency, async (item, index) => {
    const group = getGroup(item, index);
    if (!group) return mapper(item, index);

    const previous = groupTails.get(group) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    groupTails.set(group, current);

    await previous;
    try {
      return await mapper(item, index);
    } finally {
      release();
      if (groupTails.get(group) === current) groupTails.delete(group);
    }
  });
}
