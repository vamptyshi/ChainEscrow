const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");

const repoRoot = process.env.ESCROW_REPO ?? path.resolve(__dirname, "..");
const workspaceRequire = Module.createRequire(path.join(repoRoot, "packages/nextjs/package.json"));
const ts = workspaceRequire("typescript");
const transactorPath = path.join(repoRoot, "packages/nextjs/hooks/scaffold-eth/useTransactor.tsx");
const ORIGINAL_HASH = `0x${"1".repeat(64)}`;
const REPLACEMENT_HASH = `0x${"2".repeat(64)}`;

function fixture(reason, status = "success") {
  const confirmed = [];
  const successes = [];
  const explorerLinks = [];
  const receipt = { transactionHash: reason ? REPLACEMENT_HASH : ORIGINAL_HASH, status, logs: [] };
  const wallet = { getChainId: async () => 60600 };
  const config = {};
  const jsx = (type, props) => ({ type, props });
  const stubs = {
    "react/jsx-runtime": { jsx, jsxs: jsx },
    wagmi: { useWalletClient: () => ({ data: wallet }) },
    "wagmi/actions": {
      getPublicClient: receivedConfig => {
        assert.equal(receivedConfig, config);
        return {
          waitForTransactionReceipt: async options => {
            assert.equal(options.hash, ORIGINAL_HASH);
            if (reason) options.onReplaced?.({ reason, transactionReceipt: receipt });
            return receipt;
          },
        };
      },
    },
    "~~/scaffold.config": { default: { targetNetworks: [{ id: 60600 }] } },
    "~~/services/web3/wagmiConfig": { wagmiConfig: config },
    "~~/utils/scaffold-eth": {
      notification: {
        loading: () => "loading",
        remove: () => {},
        success: content => successes.push(content),
        error: () => {},
      },
      getBlockExplorerTxLink: (chainId, hash) => {
        assert.equal(chainId, 60600);
        const link = `https://scan-testnet.potos.hk/tx/${hash}`;
        explorerLinks.push(link);
        return link;
      },
    },
    "~~/utils/scaffold-eth/contract": { getParsedErrorWithAllAbis: error => error.message },
  };
  const compiled = new Module(transactorPath, module);
  compiled.filename = transactorPath;
  compiled.require = name => {
    if (!(name in stubs)) throw new Error(`Unexpected runtime import in isolated transactor test: ${name}`);
    return stubs[name];
  };
  const code = ts.transpileModule(fs.readFileSync(transactorPath, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    fileName: transactorPath,
  }).outputText;
  // Hide the module's expected error logging without changing global console.
  compiled._compile("const console = { error() {} };\n" + code, transactorPath);
  const transact = compiled.exports.useTransactor();
  const payment = transact(async () => ORIGINAL_HASH, { onBlockConfirmation: result => confirmed.push(result) });
  return { payment, confirmed, successes, explorerLinks, receipt };
}

test("a normal confirmed transaction reports its receipt and hash", async () => {
  const current = fixture();
  assert.equal(await current.payment, ORIGINAL_HASH);
  assert.deepEqual(current.confirmed, [current.receipt]);
  assert.equal(current.successes.length, 1);
});

test("a repriced transaction reports the mined replacement hash and explorer link", async () => {
  const current = fixture("repriced");
  assert.equal(await current.payment, REPLACEMENT_HASH);
  assert.deepEqual(current.confirmed, [current.receipt]);
  assert.equal(current.successes.length, 1);
  assert.equal(current.successes[0].props.blockExplorerLink, `https://scan-testnet.potos.hk/tx/${REPLACEMENT_HASH}`);
});

for (const reason of ["cancelled", "replaced"]) {
  test(`a ${reason} transaction never reports payment success or invokes confirmation`, async () => {
    const current = fixture(reason);
    await assert.rejects(current.payment);
    assert.equal(current.successes.length, 0);
    assert.equal(current.confirmed.length, 0);
  });
}

test("a reverted receipt never reports payment success or invokes confirmation", async () => {
  const current = fixture(undefined, "reverted");
  await assert.rejects(current.payment);
  assert.equal(current.successes.length, 0);
  assert.equal(current.confirmed.length, 0);
});
