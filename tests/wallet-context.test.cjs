const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");

const repoRoot = process.env.ESCROW_REPO ?? path.resolve(__dirname, "..");
const workspaceRequire = Module.createRequire(path.join(repoRoot, "packages/nextjs/package.json"));
const ts = workspaceRequire("typescript");
const wrapperPath = path.join(repoRoot, "packages/nextjs/hooks/scaffold-eth/useScaffoldWriteContract.ts");
const BUYER = `0x${"a".repeat(40)}`;
const OTHER = `0x${"b".repeat(40)}`;
const CONTRACT = `0x${"c".repeat(40)}`;
const HASH = `0x${"1".repeat(64)}`;

function deferred() {
  let resolve;
  const promise = new Promise(done => {
    resolve = done;
  });
  return { promise, resolve };
}

// Exercise the actual wrapper without React rendering, a provider, or network calls.
function fixture() {
  const simulation = deferred();
  const simulationStarted = deferred();
  const submitted = [];
  const config = {};
  const state = { account: { address: BUYER, chainId: 60600, chain: { id: 60600 } } };
  const scaffoldHooks = {
    useSelectedNetwork: () => ({ id: 60600, name: "POTOS Testnet" }),
    useDeployedContractInfo: () => ({ data: { address: CONTRACT, abi: [] } }),
    useTransactor: () => async callback => callback(),
  };
  const stubs = {
    react: { useEffect: () => {}, useState: initial => [initial, () => {}] },
    wagmi: {
      useAccount: () => state.account,
      useConfig: () => config,
      useWriteContract: () => ({
        writeContractAsync: async params => {
          submitted.push(params);
          return HASH;
        },
        writeContract: params => {
          submitted.push(params);
        },
      }),
    },
    "wagmi/actions": {
      getAccount: receivedConfig => {
        assert.equal(receivedConfig, config);
        return state.account;
      },
    },
    "~~/hooks/scaffold-eth": scaffoldHooks,
    "~~/utils/scaffold-eth": { notification: { error: () => {} } },
    "~~/utils/scaffold-eth/contract": {
      simulateContractWriteAndNotifyError: async () => {
        simulationStarted.resolve();
        await simulation.promise;
      },
    },
  };
  const compiled = new Module(wrapperPath, module);
  compiled.filename = wrapperPath;
  compiled.require = name => {
    if (!(name in stubs)) throw new Error(`Unexpected runtime import in isolated wrapper test: ${name}`);
    return stubs[name];
  };
  compiled._compile(
    ts.transpileModule(fs.readFileSync(wrapperPath, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      fileName: wrapperPath,
    }).outputText,
    wrapperPath,
  );
  const hook = compiled.exports.useScaffoldWriteContract({ contractName: "Escrow" });
  return { state, simulation, simulationStarted, submitted, hook };
}

test("the real write wrapper aborts if the wallet changes while simulation is pending", async () => {
  const current = fixture();
  const payment = current.hook.writeContractAsync({ functionName: "deposit", args: [3n], account: BUYER });
  await current.simulationStarted.promise;
  assert.equal(current.submitted.length, 0);
  current.state.account = { address: OTHER, chainId: 60600, chain: { id: 60600 } };
  current.simulation.resolve();
  await assert.rejects(payment);
  assert.equal(current.submitted.length, 0);
});

test("the real write wrapper aborts if the chain changes while simulation is pending", async () => {
  const current = fixture();
  const payment = current.hook.writeContractAsync({ functionName: "deposit", args: [3n], account: BUYER });
  await current.simulationStarted.promise;
  current.state.account = { address: BUYER, chainId: 1, chain: { id: 1 } };
  current.simulation.resolve();
  await assert.rejects(payment);
  assert.equal(current.submitted.length, 0);
});

test("the real write wrapper pins the initiating account and target chain on success", async () => {
  const current = fixture();
  const payment = current.hook.writeContractAsync({ functionName: "deposit", args: [3n] });
  await current.simulationStarted.promise;
  assert.equal(current.submitted.length, 0);
  current.simulation.resolve();
  assert.equal(await payment, HASH);
  assert.equal(current.submitted.length, 1);
  assert.equal(current.submitted[0].account, BUYER);
  assert.equal(current.submitted[0].chainId, 60600);
  assert.equal(current.submitted[0].address, CONTRACT);
  assert.deepEqual(current.submitted[0].args, [3n]);
});

test("the synchronous write path also pins the account and target chain", () => {
  const current = fixture();
  current.hook.writeContract({ functionName: "deposit", args: [3n] });
  assert.equal(current.submitted.length, 1);
  assert.equal(current.submitted[0].account, BUYER);
  assert.equal(current.submitted[0].chainId, 60600);
});
