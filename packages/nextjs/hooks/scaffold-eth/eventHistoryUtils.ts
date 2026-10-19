export type EventBlockRange = {
  fromBlock: bigint;
  toBlock: bigint;
};

export type EventHistoryPage<TEvent> = {
  events: TEvent[];
  toBlock: bigint;
};

/** A cursor advances only after the complete, bounded RPC request succeeds. */
export async function fetchEventHistoryPage<TEvent>(
  fromBlock: bigint,
  latestBlock: bigint | undefined,
  blocksBatchSize: number,
  readEvents: (range: EventBlockRange) => Promise<TEvent[]>,
): Promise<EventHistoryPage<TEvent>> {
  if (latestBlock === undefined) throw new Error("Latest block is not available yet");
  if (!Number.isSafeInteger(blocksBatchSize) || blocksBatchSize < 1) {
    throw new Error("blocksBatchSize must be a positive safe integer");
  }

  // A contract may start in a future block, or the requested range may be empty.
  if (fromBlock > latestBlock) return { events: [], toBlock: fromBlock - 1n };

  const batchEnd = fromBlock + BigInt(blocksBatchSize) - 1n;
  const toBlock = batchEnd < latestBlock ? batchEnd : latestBlock;
  const events = await readEvents({ fromBlock, toBlock });
  return { events, toBlock };
}

export function getNextEventBlock<TEvent>(
  lastPage: EventHistoryPage<TEvent>,
  latestBlock: bigint | undefined,
): bigint | undefined {
  if (latestBlock === undefined) return undefined;
  const nextBlock = lastPage.toBlock + 1n;
  return nextBlock <= latestBlock ? nextBlock : undefined;
}

export function deduplicateEvents<
  TEvent extends { transactionHash: string | null; logIndex: number | null; blockHash: string | null },
>(events: TEvent[]): TEvent[] {
  const seen = new Set<string>();
  return events.filter(event => {
    const key = `${event.transactionHash}-${event.logIndex}-${event.blockHash}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
