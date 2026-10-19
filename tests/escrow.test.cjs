const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");

const repoRoot = process.env.ESCROW_REPO ?? path.resolve(__dirname, "..");
const workspaceRequire = Module.createRequire(
  path.join(repoRoot, "packages/nextjs/package.json"),
);
const ts = workspaceRequire("typescript");
const helperPath =
  process.env.ESCROW_HELPER_SOURCE ??
  path.join(repoRoot, "packages/nextjs/utils/escrow.ts");
const compiled = new Module(helperPath, module);
compiled.filename = helperPath;
compiled.require = workspaceRequire;
compiled._compile(
  ts.transpileModule(fs.readFileSync(helperPath, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: helperPath,
  }).outputText,
  helperPath,
);
const {
  ORDER_STATUS,
  sameAddress,
  getOrderPermissions,
  parseOrderForm,
  payWithApproval,
} = compiled.exports;

const BUYER = `0x${"a".repeat(40)}`;
const SELLER = `0x${"b".repeat(40)}`;
const ARBITER = `0x${"c".repeat(40)}`;
const OBSERVER = `0x${"d".repeat(40)}`;
const TOKEN = `0x${"e".repeat(40)}`;
const APPROVAL_HASH = `0x${"1".repeat(64)}`;
const DEPOSIT_HASH = `0x${"2".repeat(64)}`;
const order = {
  buyer: BUYER,
  seller: SELLER,
  token: TOKEN,
  amount: 30n * 10n ** 18n,
  deadline: 1800000000n,
  status: 0,
  description: "Pedido",
};
const form = {
  seller: SELLER,
  amount: "30",
  minutes: "30",
  description: "  Pedido de prueba  ",
};
const nowMs = 1800000000123;

test("all five statuses expose only the actions allowed for each role", () => {
  assert.deepEqual(ORDER_STATUS, [
    "Created",
    "Paid",
    "Completed",
    "Refunded",
    "Disputed",
  ]);
  for (let status = 0; status < 5; status++) {
    for (const account of [BUYER, SELLER, ARBITER, OBSERVER, undefined]) {
      assert.deepEqual(
        getOrderPermissions({ ...order, status }, account, ARBITER),
        {
          canPay: status === 0 && account === BUYER,
          canConfirm: status === 1 && account === BUYER,
          canDispute: status === 1 && [BUYER, SELLER].includes(account),
          canResolve: status === 4 && account === ARBITER,
        },
        `status=${status}, account=${account}`,
      );
    }
  }
  assert.deepEqual(
    getOrderPermissions({ ...order, status: 99 }, BUYER, BUYER),
    {
      canPay: false,
      canConfirm: false,
      canDispute: false,
      canResolve: false,
    },
  );
});

test("wallet comparisons ignore case and never grant a role to a missing account", () => {
  const upperBuyer = `0x${"A".repeat(40)}`;
  assert.equal(sameAddress(BUYER, upperBuyer), true);
  assert.equal(sameAddress(undefined, undefined), false);
  assert.equal(sameAddress("", ""), false);
  assert.equal(getOrderPermissions(order, upperBuyer, ARBITER).canPay, true);
  assert.equal(
    getOrderPermissions({ ...order, status: 4 }, undefined, undefined)
      .canResolve,
    false,
  );
  assert.equal(
    getOrderPermissions({ ...order, status: 4 }, BUYER, upperBuyer).canResolve,
    true,
  );
});

test("form conversion preserves exact token units, uses seconds, and trims text", () => {
  assert.deepEqual(parseOrderForm(form, BUYER, 18, nowMs), {
    seller: SELLER,
    amount: 30000000000000000000n,
    deadline: 1800001800n,
    description: "Pedido de prueba",
  });
  assert.equal(
    parseOrderForm(
      { ...form, amount: "0.000000000000000001" },
      BUYER,
      18,
      nowMs,
    ).amount,
    1n,
  );
  assert.equal(
    parseOrderForm({ ...form, amount: ".25" }, BUYER, 6, nowMs).amount,
    250000n,
  );
  assert.equal(
    parseOrderForm({ ...form, amount: "3" }, BUYER, 0, nowMs).amount,
    3n,
  );
});

test("invalid sellers, including the buyer and zero address, are rejected", () => {
  for (const seller of [
    "invalid",
    `0x${"0".repeat(40)}`,
    BUYER,
    `0x${"A".repeat(40)}`,
  ]) {
    assert.throws(
      () => parseOrderForm({ ...form, seller }, BUYER, 18, nowMs),
      /vendedor|comprador/,
    );
  }
});

test("bad amounts and excessive precision are rejected without rounding", () => {
  for (const amount of [
    "0",
    "0.000",
    "-1",
    "1e3",
    "1,5",
    "",
    "NaN",
    "0.0000000000000000001",
    "30.0000000000000000000",
  ]) {
    assert.throws(
      () => parseOrderForm({ ...form, amount }, BUYER, 18, nowMs),
      /importe/,
    );
  }
  assert.throws(
    () => parseOrderForm({ ...form, amount: "1.1" }, BUYER, 0, nowMs),
    /decimales/,
  );
  for (const decimals of [-1, 1.5, 256, NaN]) {
    assert.throws(
      () => parseOrderForm(form, BUYER, decimals, nowMs),
      /precisión/,
    );
  }
});

test("the deadline requires safe positive whole minutes and a description", () => {
  for (const minutes of [
    "0",
    "-1",
    "1.5",
    "1e3",
    "Infinity",
    "",
    "9007199254740992",
  ]) {
    assert.throws(
      () => parseOrderForm({ ...form, minutes }, BUYER, 18, nowMs),
      /plazo/,
    );
  }
  assert.throws(
    () => parseOrderForm({ ...form, description: "  " }, BUYER, 18, nowMs),
    /descripción/,
  );
  assert.throws(() => parseOrderForm(form, BUYER, 18, NaN), /hora/);
});

test("deposit remains blocked until the approval promise confirms", async () => {
  let confirmApproval;
  const actions = [];
  const payment = payWithApproval({
    assertContext: () => {
      actions.push("check");
    },
    onStage: (stage) => actions.push(stage),
    approve: () =>
      new Promise((resolve) => {
        confirmApproval = resolve;
        actions.push("approval requested");
      }),
    onApproved: (hash) => {
      assert.equal(hash, APPROVAL_HASH);
      actions.push("approval confirmed");
    },
    deposit: async () => {
      actions.push("deposit requested");
      return DEPOSIT_HASH;
    },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(actions, ["check", "approval", "approval requested"]);
  confirmApproval(APPROVAL_HASH);
  assert.deepEqual(await payment, {
    approvalHash: APPROVAL_HASH,
    depositHash: DEPOSIT_HASH,
  });
  assert.deepEqual(actions, [
    "check",
    "approval",
    "approval requested",
    "approval confirmed",
    "check",
    "deposit",
    "deposit requested",
  ]);
});

test("rejected, reverted, or absent approval never submits a deposit", async () => {
  for (const failure of [
    new Error("Usuario rechazó"),
    new Error("Approval reverted"),
    undefined,
  ]) {
    let deposits = 0;
    await assert.rejects(
      payWithApproval({
        approve: async () => {
          if (failure) throw failure;
          return undefined;
        },
        deposit: async () => {
          deposits++;
          return DEPOSIT_HASH;
        },
      }),
    );
    assert.equal(deposits, 0);
  }
});

test("changed wallet or chain prevents deposits even after approval succeeds", async () => {
  for (const failAtCheck of [1, 2]) {
    let checks = 0;
    let approvals = 0;
    let deposits = 0;
    await assert.rejects(
      payWithApproval({
        assertContext: () => {
          if (++checks === failAtCheck)
            throw new Error("La cuenta o la red ha cambiado");
        },
        approve: async () => {
          approvals++;
          return APPROVAL_HASH;
        },
        deposit: async () => {
          deposits++;
          return DEPOSIT_HASH;
        },
      }),
      /cuenta o la red/,
    );
    assert.equal(approvals, failAtCheck === 1 ? 0 : 1);
    assert.equal(deposits, 0);
  }
});

test("a rejected or missing deposit never reports payment success", async () => {
  await assert.rejects(
    payWithApproval({
      approve: async () => APPROVAL_HASH,
      deposit: async () => undefined,
    }),
    /depósito no se confirmó/,
  );
  await assert.rejects(
    payWithApproval({
      approve: async () => APPROVAL_HASH,
      deposit: async () => {
        throw new Error("Usuario rechazó el depósito");
      },
    }),
    /rechazó el depósito/,
  );
});
