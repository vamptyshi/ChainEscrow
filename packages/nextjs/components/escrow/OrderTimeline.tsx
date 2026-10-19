"use client";

import { useEffect, useState } from "react";
import { Address, Hash, parseAbi } from "viem";
import { usePublicClient } from "wagmi";
import { ArrowPathIcon, ArrowTopRightOnSquareIcon } from "@heroicons/react/24/outline";

// Eventos reales del Escrow.sol desplegado; no hay pasos simulados en esta vista.
const ESCROW_EVENTS = parseAbi([
  "event OrderCreated(uint256 indexed id, address indexed buyer, address indexed seller, address token, uint256 amount, uint256 deadline)",
  "event OrderPaid(uint256 indexed id)",
  "event OrderCompleted(uint256 indexed id)",
  "event OrderRefunded(uint256 indexed id)",
  "event OrderDisputed(uint256 indexed id, address by)",
  "event OrderResolved(uint256 indexed id, bool sellerWins)",
]);

const CHAIN_ID = 60600;
const EXPLORER = "https://scan-testnet.potos.hk";
const BLOCKS_PER_REQUEST = 10n; // Límite eth_getLogs de POTOS Testnet.

export type TimelineEvent = {
  name: string;
  transactionHash: Hash;
  blockNumber: bigint;
  logIndex: number;
  timestamp?: bigint;
  by?: Address;
  sellerWins?: boolean;
};

// El historial de pedidos finalizados es inmutable: se reutiliza al cerrar/abrir.
const completedCache = new Map<string, TimelineEvent[]>();

function eventLabel(item: TimelineEvent) {
  switch (item.name) {
    case "OrderCreated":
      return "订单创建";
    case "OrderPaid":
      return "付款成功";
    case "OrderCompleted":
      return "买家确认收货";
    case "OrderDisputed":
      return "发起争议";
    case "OrderResolved":
      return item.sellerWins ? "仲裁完成 · 判给卖家" : "仲裁完成 · 退还买家";
    case "OrderRefunded":
      return "到期退款";
    default:
      return item.name;
  }
}

function eventDescription(item: TimelineEvent) {
  switch (item.name) {
    case "OrderCreated":
      return "合约已发出 OrderCreated 事件";
    case "OrderPaid":
      return "代币已转入 Escrow 托管合约";
    case "OrderCompleted":
      return "买家确认收货，合约向卖家付款";
    case "OrderDisputed":
      return item.by ? `争议发起人：${item.by.slice(0, 8)}…${item.by.slice(-4)}` : "买家或卖家发起争议";
    case "OrderResolved":
      return item.sellerWins ? "仲裁人决定向卖家支付代币" : "仲裁人决定将代币退还买家";
    case "OrderRefunded":
      return "超过截止时间后退还买家";
    default:
      return "合约事件";
  }
}

function isTerminal(name: string) {
  return name === "OrderCompleted" || name === "OrderResolved" || name === "OrderRefunded";
}

function formatTime(seconds?: bigint) {
  if (seconds === undefined) return "区块时间未能读取";
  return new Date(Number(seconds) * 1000).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function OrderTimeline({
  orderId,
  escrowAddress,
  createdHash,
}: {
  orderId: bigint;
  escrowAddress: Address;
  createdHash: Hash;
}) {
  const publicClient = usePublicClient({ chainId: CHAIN_ID });
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const cacheKey = `${CHAIN_ID}:${escrowAddress.toLowerCase()}:${orderId}`;
    const cached = completedCache.get(cacheKey);
    if (cached) {
      setEvents(cached);
      setLoading(false);
      setError("");
      setProgress("");
      return;
    }
    if (!publicClient) {
      setError("暂时无法连接 POTOS Testnet。请检查网络后重试。");
      setLoading(false);
      return;
    }

    const load = async () => {
      setLoading(true);
      setError("");
      setProgress("正在查询链上事件…");
      setEvents([]);
      const collected: TimelineEvent[] = [];
      try {
        // El recibo de OrderCreated limita la búsqueda a la vida real de este pedido.
        const receipt = await publicClient.getTransactionReceipt({ hash: createdHash });
        const startBlock = receipt.blockNumber;
        const latestBlock = await publicClient.getBlockNumber();
        let finished = false;

        // POTOS acepta a lo sumo 10 bloques por eth_getLogs. Una sola consulta
        // por lote recupera los seis tipos de eventos del Escrow (OR de firmas).
        for (let fromBlock = startBlock; fromBlock <= latestBlock; fromBlock += BLOCKS_PER_REQUEST) {
          if (cancelled) return;
          const toBlock =
            fromBlock + BLOCKS_PER_REQUEST - 1n > latestBlock ? latestBlock : fromBlock + BLOCKS_PER_REQUEST - 1n;

          // Un fallo transitorio no obliga a empezar otra vez desde el principio.
          const loadBatch = async () => {
            for (let retry = 0; retry < 3; retry++) {
              try {
                return await publicClient.getLogs({
                  address: escrowAddress,
                  events: ESCROW_EVENTS,
                  fromBlock,
                  toBlock,
                  strict: true,
                });
              } catch (cause) {
                if (retry === 2) throw cause;
                await new Promise(resolve => setTimeout(resolve, (retry + 1) * 650));
              }
            }
            throw new Error("RPC eth_getLogs 连续三次请求失败");
          };
          const logs = await loadBatch();
          for (const log of logs) {
            const args = log.args as { id?: bigint; by?: Address; sellerWins?: boolean } | undefined;
            if (args?.id !== orderId || !log.transactionHash || log.blockNumber === null) continue;
            const record: TimelineEvent = {
              name: log.eventName,
              transactionHash: log.transactionHash,
              blockNumber: log.blockNumber,
              logIndex: log.logIndex ?? 0,
              by: args.by,
              sellerWins: args.sellerWins,
            };
            collected.push(record);
            if (isTerminal(record.name)) finished = true;
          }
          // El contrato no permite más cambios después de Completed/Refunded.
          // Evita cientos de consultas inútiles hasta el bloque actual.
          if (finished) break;
          if ((fromBlock - startBlock) % 100n === 0n && !cancelled) {
            setProgress(`正在扫描区块 ${fromBlock}–${toBlock} / ${latestBlock}…`);
          }
        }

        collected.sort((a, b) =>
          a.blockNumber < b.blockNumber ? -1 : a.blockNumber > b.blockNumber ? 1 : a.logIndex - b.logIndex,
        );

        // Las marcas de tiempo se leen del bloque, no se inventan.
        const uniqueBlocks = [...new Set(collected.map(event => event.blockNumber.toString()))];
        const timestamps = new Map<string, bigint>();
        for (const number of uniqueBlocks) {
          if (cancelled) return;
          try {
            const block = await publicClient.getBlock({ blockNumber: BigInt(number) });
            timestamps.set(number, block.timestamp);
          } catch {
            // Muestra el bloque y el hash aunque falle una marca de tiempo.
          }
        }
        const result = collected.map(event => ({
          ...event,
          timestamp: timestamps.get(event.blockNumber.toString()),
        }));
        if (!cancelled) {
          setEvents(result);
          setProgress("");
          if (finished) completedCache.set(cacheKey, result);
        }
      } catch (cause) {
        if (!cancelled) {
          const details = cause instanceof Error ? cause.message : String(cause);
          setEvents(collected);
          setError(`读取事件时发生错误，结果可能不完整。${details.slice(0, 180)}`);
          setProgress("");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [publicClient, orderId, escrowAddress, createdHash, attempt]);

  return (
    <section className="ce-timeline" aria-label={`订单 ${orderId} 的链上时间线`}>
      <div className="ce-timeline-heading">
        <div>
          <span className="ce-micro">ON-CHAIN EVENTS / 交易时间线</span>
          <h3>订单 #{orderId.toString()} · 链上交易时间线</h3>
          <p>直接从 Escrow 合约事件读取，按区块及日志顺序排列。</p>
        </div>
        <button
          type="button"
          className="ce-timeline-retry"
          onClick={() => {
            completedCache.delete(`${CHAIN_ID}:${escrowAddress.toLowerCase()}:${orderId}`);
            setAttempt(value => value + 1);
          }}
          disabled={loading}
        >
          <ArrowPathIcon className="h-4 w-4" /> 重新读取
        </button>
      </div>
      {loading && (
        <div className="ce-timeline-message" role="status">
          <span className="loading loading-spinner loading-xs" /> {progress}
        </div>
      )}
      {error && (
        <div className="ce-timeline-error" role="alert">
          {error}
        </div>
      )}
      {!loading && !error && events.length === 0 && <p className="ce-timeline-message">此订单暂无可读取的合约事件。</p>}
      {events.length > 0 && (
        <ol className="ce-timeline-list">
          {events.map((entry, index) => (
            <li className="ce-timeline-item" key={`${entry.transactionHash}:${entry.logIndex}`}>
              <span
                className={`ce-timeline-node ${entry.name === "OrderDisputed" ? "ce-timeline-node-warning" : ""}`}
                aria-hidden="true"
              />
              <div className="ce-timeline-entry">
                <div className="ce-timeline-event-title">
                  <strong>{eventLabel(entry)}</strong>
                  <small>#{index + 1}</small>
                </div>
                <p>{eventDescription(entry)}</p>
                <div className="ce-timeline-meta">
                  <span>{formatTime(entry.timestamp)}</span>
                  <span>Block #{entry.blockNumber.toString()}</span>
                  <a href={`${EXPLORER}/tx/${entry.transactionHash}`} target="_blank" rel="noreferrer">
                    查看交易 {entry.transactionHash.slice(0, 10)}… <ArrowTopRightOnSquareIcon className="h-3 w-3" />
                  </a>
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
