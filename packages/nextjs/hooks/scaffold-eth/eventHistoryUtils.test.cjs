/* Run from packages/nextjs: node --test hooks/scaffold-eth/eventHistoryUtils.test.cjs */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");
const { InfiniteQueryObserver, QueryClient } = require("@tanstack/query-core");

// Exercise the shipped TypeScript without introducing a test-runner dependency.
const filename = path.join(__dirname, "eventHistoryUtils.ts");
const compiled = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
});
const loaded = { exports: {} };
new Function("exports", "require", "module", compiled.outputText)(loaded.exports, require, loaded);
const { deduplicateEvents, fetchEventHistoryPage, getNextEventBlock } = loaded.exports;

function fakeEvents({ fromBlock, toBlock }, context = "a") {
  const events = [];
  for (let block = fromBlock; block <= toBlock; block++) {
    events.push({
      transactionHash: `${context}-tx-${block}`,
      logIndex: 0,
      blockHash: `${context}-block-${block}`,
      id: block,
    });
  }
  return events;
}

test("startup never sends an unbounded request, and invalid batches cannot loop", async () => {
  let calls = 0;
  const read = async range => {
    calls++;
    return fakeEvents(range);
  };
  await assert.rejects(fetchEventHistoryPage(2669129n, undefined, 10, read), /Latest block/);
  for (const batchSize of [0, -1, 1.5, NaN, Infinity]) {
    await assert.rejects(fetchEventHistoryPage(0n, 10n, batchSize, read), /positive safe integer/);
  }
  assert.equal(calls, 0);
  const genesis = await fetchEventHistoryPage(0n, 0n, 10, read);
  assert.equal(genesis.toBlock, 0n);
  assert.equal(genesis.events.length, 1);
});

test("empty and future ranges do not query RPC or skip the first eligible block", async () => {
  const read = async () => assert.fail("no RPC request for an empty range");
  const page = await fetchEventHistoryPage(20n, 19n, 10, read);
  assert.deepEqual(page, { events: [], toBlock: 19n });
  assert.equal(getNextEventBlock(page, 19n), undefined);
  assert.equal(getNextEventBlock(page, 20n), 20n);
});

test("historical and watched gaps continue after a partial batch without gaps", async () => {
  const ranges = [];
  const read = async range => {
    ranges.push(range);
    return fakeEvents(range);
  };
  const first = await fetchEventHistoryPage(2669129n, 2669132n, 10, read);
  assert.equal(getNextEventBlock(first, 2669132n), undefined);
  let page = first;
  const events = [...first.events];
  while (getNextEventBlock(page, 2669160n) !== undefined) {
    page = await fetchEventHistoryPage(getNextEventBlock(page, 2669160n), 2669160n, 10, read);
    events.push(...page.events);
  }
  assert.deepEqual(ranges, [
    { fromBlock: 2669129n, toBlock: 2669132n },
    { fromBlock: 2669133n, toBlock: 2669142n },
    { fromBlock: 2669143n, toBlock: 2669152n },
    { fromBlock: 2669153n, toBlock: 2669160n },
  ]);
  assert.equal(events.length, 32);
  assert.equal(new Set(events.map(event => event.id)).size, 32);
  assert.ok(ranges.every(range => range.toBlock - range.fromBlock + 1n <= 10n));
});

test("empty event batches still scan the full requested history", async () => {
  const ranges = [];
  let nextBlock = 100n;
  while (nextBlock !== undefined) {
    const page = await fetchEventHistoryPage(nextBlock, 112n, 5, async range => {
      ranges.push(range);
      return [];
    });
    nextBlock = getNextEventBlock(page, 112n);
  }
  assert.deepEqual(ranges, [
    { fromBlock: 100n, toBlock: 104n },
    { fromBlock: 105n, toBlock: 109n },
    { fromBlock: 110n, toBlock: 112n },
  ]);
});

function createObserver(t, readEvents, initialLatest = 4n) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const options = (latestBlock, context = "a") => ({
    queryKey: ["eventHistory", context],
    initialPageParam: 0n,
    enabled: latestBlock !== undefined,
    queryFn: ({ pageParam }) => fetchEventHistoryPage(pageParam, latestBlock, 10, range => readEvents(range, context)),
    getNextPageParam: lastPage => getNextEventBlock(lastPage, latestBlock),
  });
  const observer = new InfiniteQueryObserver(client, options(initialLatest));
  const unsubscribe = observer.subscribe(() => {});
  t.after(() => {
    unsubscribe();
    client.clear();
  });
  return { observer, options };
}

test("the real query observer detects new head blocks and paginates the entire live gap", async t => {
  const ranges = [];
  const { observer, options } = createObserver(t, async range => {
    ranges.push(range);
    return fakeEvents(range);
  });
  await observer.refetch();
  assert.equal(observer.getCurrentResult().hasNextPage, false);

  // This is the option update produced when useBlockNumber(watch:true) changes.
  observer.setOptions(options(29n));
  assert.equal(observer.getCurrentResult().hasNextPage, true);
  while (observer.getCurrentResult().hasNextPage) await observer.fetchNextPage();

  assert.deepEqual(ranges, [
    { fromBlock: 0n, toBlock: 4n },
    { fromBlock: 5n, toBlock: 14n },
    { fromBlock: 15n, toBlock: 24n },
    { fromBlock: 25n, toBlock: 29n },
  ]);
  assert.equal(observer.getCurrentResult().data.pages.flatMap(page => page.events).length, 30);
});

test("a failed live page exposes its error and retries the same cursor without loss or duplication", async t => {
  const ranges = [];
  let failOnce = true;
  const { observer, options } = createObserver(t, async range => {
    ranges.push(range);
    if (range.fromBlock === 5n && failOnce) {
      failOnce = false;
      throw new Error("test RPC unavailable");
    }
    return fakeEvents(range);
  });
  await observer.refetch();
  observer.setOptions(options(16n));
  const failed = await observer.fetchNextPage();
  assert.match(failed.error.message, /test RPC unavailable/);
  assert.equal(failed.status, "error");
  assert.equal(failed.data.pages.length, 1);
  assert.equal(failed.data.pages[0].toBlock, 4n);

  await observer.fetchNextPage();
  while (observer.getCurrentResult().hasNextPage) await observer.fetchNextPage();
  const result = observer.getCurrentResult();
  assert.equal(result.error, null);
  assert.equal(result.status, "success");
  assert.deepEqual(ranges.slice(1, 3), [
    { fromBlock: 5n, toBlock: 14n },
    { fromBlock: 5n, toBlock: 14n },
  ]);
  const events = result.data.pages.flatMap(page => page.events);
  assert.equal(events.length, 17);
  assert.equal(new Set(events.map(event => event.id)).size, 17);
});

test("changing query context cannot retain another account, filter, or chain's events", async t => {
  const { observer, options } = createObserver(t, async (range, context) => fakeEvents(range, context));
  await observer.refetch();
  assert.equal(observer.getCurrentResult().data.pages[0].events[0].transactionHash, "a-tx-0");

  observer.setOptions(options(4n, "b"));
  assert.equal(observer.getCurrentResult().data, undefined);
  await observer.refetch();
  const events = observer.getCurrentResult().data.pages.flatMap(page => page.events);
  assert.ok(events.every(event => event.transactionHash.startsWith("b-")));
});

test("event identity keeps separate logs within one transaction while removing replayed logs", () => {
  const first = { transactionHash: "tx", logIndex: 0, blockHash: "block" };
  const second = { transactionHash: "tx", logIndex: 1, blockHash: "block" };
  assert.deepEqual(deduplicateEvents([first, { ...first }, second, { ...second }]), [first, second]);
});
