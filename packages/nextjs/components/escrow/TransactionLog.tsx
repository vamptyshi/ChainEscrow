"use client";

import { useCallback, useEffect, useState } from "react";
import type { Address, Hash } from "viem";

export type TransactionEntry = {
  action: string;
  orderId?: string;
  hash: Hash;
  actor: Address;
};

const EXPLORER = "https://scan-testnet.potos.hk";
const STORAGE_KEY = "escrow-route-b:60600:0x7a2a512e658446bd5f25eb484c9f97adbe7c7afa:transactions";
const DEPLOYMENT: TransactionEntry = {
  action: "实验 3 合约部署",
  hash: "0x72810759c1ead34bd554f2c81e1fc7c75ce62eaa5d77427cc82eba4d802c0cf3",
  actor: "0x891DCDd39972A017D4C2f7a479Bf23c3f4e4Ee3d",
};

export function useTransactionLog() {
  const [entries, setEntries] = useState<TransactionEntry[]>([DEPLOYMENT]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      if (Array.isArray(saved)) {
        const valid = saved.filter(
          (entry): entry is TransactionEntry =>
            typeof entry?.action === "string" &&
            /^0x[0-9a-f]{64}$/i.test(entry?.hash) &&
            /^0x[0-9a-f]{40}$/i.test(entry?.actor),
        );
        setEntries([DEPLOYMENT, ...valid.filter(entry => entry.hash !== DEPLOYMENT.hash)]);
      }
    } catch {
      // A damaged browser cache does not prevent reading the on-chain orders.
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
    } catch {
      // The visible log and CSV still work when browser storage is unavailable.
    }
  }, [entries, loaded]);

  const record = useCallback((entry: TransactionEntry) => {
    setEntries(current => [...current.filter(item => item.hash !== entry.hash), entry]);
  }, []);

  return { entries, record };
}

export function TransactionLog({ entries }: { entries: TransactionEntry[] }) {
  const download = () => {
    const escape = (value: string) => `"${value.replaceAll('"', '""')}"`;
    const rows = [
      ["操作", "订单", "交易哈希", "区块浏览器", "签名账户"],
      ...entries.map(entry => [
        entry.action,
        entry.orderId || "",
        entry.hash,
        `${EXPLORER}/tx/${entry.hash}`,
        entry.actor,
      ]),
    ];
    const csv = "\uFEFF" + rows.map(row => row.map(escape).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "ChainEscrow-交易记录.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <details className="ce-panel ce-log-panel">
      <summary className="cursor-pointer font-semibold">交易记录 · {entries.length} 笔交易</summary>
      <p className="my-3 text-sm opacity-70">
        本浏览器会保存通过此页面提交的交易记录。请在区块浏览器中核对真实交易回执；记录不代表完整的链上历史。
      </p>
      <button className="btn btn-outline btn-sm mb-4" onClick={download}>
        导出 CSV 报表
      </button>
      <div className="overflow-x-auto">
        <table className="table table-sm">
          <thead>
            <tr>
              <th>操作</th>
              <th>订单</th>
              <th>交易哈希</th>
              <th>签名账户</th>
            </tr>
          </thead>
          <tbody>
            {entries.map(entry => (
              <tr key={entry.hash}>
                <td>{entry.action}</td>
                <td>{entry.orderId ?? "—"}</td>
                <td>
                  <a
                    className="link link-primary font-mono"
                    href={`${EXPLORER}/tx/${entry.hash}`}
                    target="_blank"
                    rel="noreferrer"
                    title={entry.hash}
                  >
                    {entry.hash.slice(0, 10)}…{entry.hash.slice(-6)}
                  </a>
                </td>
                <td>
                  <a
                    className="link font-mono"
                    href={`${EXPLORER}/address/${entry.actor}`}
                    target="_blank"
                    rel="noreferrer"
                    title={entry.actor}
                  >
                    {entry.actor.slice(0, 6)}…{entry.actor.slice(-4)}
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
