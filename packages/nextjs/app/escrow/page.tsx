"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Address, BaseError, Hash, erc20Abi, formatUnits, parseEventLogs } from "viem";
import { useAccount, useBlockNumber, useConfig, useReadContract, useSwitchChain } from "wagmi";
import { getAccount } from "wagmi/actions";
import {
  ArrowPathIcon,
  ArrowTopRightOnSquareIcon,
  ChartBarIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  PlusIcon,
  ShieldCheckIcon,
  Squares2X2Icon,
} from "@heroicons/react/24/outline";
import { OrderTimeline } from "~~/components/escrow/OrderTimeline";
import { TransactionEntry, TransactionLog, useTransactionLog } from "~~/components/escrow/TransactionLog";
import { WalletButton } from "~~/components/escrow/WalletButton";
import {
  useDeployedContractInfo,
  useScaffoldEventHistory,
  useScaffoldReadContract,
  useScaffoldWriteContract,
} from "~~/hooks/scaffold-eth";
import { getOrderPermissions, parseOrderForm, payWithApproval, sameAddress } from "~~/utils/escrow";
import type { EscrowOrder } from "~~/utils/escrow";

const CHAIN_ID = 60600;
const DEPLOY_BLOCK = 2669129n;
const EXPLORER = "https://scan-testnet.potos.hk";
const STATUS_STYLE = ["badge-neutral", "badge-info", "badge-success", "badge-warning", "badge-error"];
const STATUS_LABELS = ["待付款", "已付款", "已完成", "已退款", "争议中"];
const STATUS_DESCRIPTION = ["等待买家支付", "代币已存入托管合约", "买家已确认收货", "代币已退还买家", "等待仲裁人处理"];

type CreatedOrder = { id: bigint; buyer: Address; seller: Address; transactionHash: Hash };
type RunAction = (label: string, action: () => Promise<void>) => Promise<void>;

function AccountLink({ address, emptyLabel = "未连接" }: { address?: string; emptyLabel?: string }) {
  if (!address) return <span className="opacity-60">{emptyLabel}</span>;
  return (
    <a
      href={`${EXPLORER}/address/${address}`}
      target="_blank"
      rel="noreferrer"
      title={address}
      className="link link-hover font-mono text-sm"
    >
      {address.slice(0, 6)}…{address.slice(-4)}
    </a>
  );
}

function formatDeadline(seconds: bigint) {
  const milliseconds = seconds * 1000n;
  return milliseconds <= 8640000000000000n
    ? new Date(Number(milliseconds)).toLocaleString("zh-CN", { dateStyle: "short", timeStyle: "short" })
    : `Unix ${seconds}`;
}

function errorMessage(error: unknown) {
  const message =
    error instanceof BaseError ? error.shortMessage : error instanceof Error ? error.message : "操作未能完成。";
  return /rejected|denied|rechaz|cancel/i.test(message) ? "钱包中的操作已取消。重试前请先检查订单状态。" : message;
}

function OrderRow({
  item,
  visible,
  account,
  arbiter,
  tokenAddress,
  decimals,
  symbol,
  busy,
  canTransact,
  runAction,
  record,
  setProgress,
  assertContext,
  onStatus,
}: {
  item: CreatedOrder;
  visible: boolean;
  account?: Address;
  arbiter?: Address;
  tokenAddress?: Address;
  decimals?: number;
  symbol?: string;
  busy: boolean;
  canTransact: boolean;
  runAction: RunAction;
  record: (entry: TransactionEntry) => void;
  setProgress: (message: string) => void;
  assertContext: (account: Address) => void;
  onStatus: (id: string, status: number) => void;
}) {
  const {
    data: order,
    error,
    refetch,
  } = useScaffoldReadContract({ contractName: "Escrow", functionName: "getOrder", args: [item.id] });
  const { writeContractAsync: writeEscrow } = useScaffoldWriteContract({ contractName: "Escrow" });
  const { writeContractAsync: writeToken } = useScaffoldWriteContract({ contractName: "ZWNToken" });
  const { data: escrow } = useDeployedContractInfo({ contractName: "Escrow" });
  const [timelineOpen, setTimelineOpen] = useState(false);
  const isCourseToken = sameAddress(order?.token, tokenAddress);
  const { data: otherDecimals } = useReadContract({
    address: order?.token,
    abi: erc20Abi,
    functionName: "decimals",
    chainId: CHAIN_ID,
    query: { enabled: !!order && !isCourseToken },
  });
  const { data: otherSymbol } = useReadContract({
    address: order?.token,
    abi: erc20Abi,
    functionName: "symbol",
    chainId: CHAIN_ID,
    query: { enabled: !!order && !isCourseToken },
  });
  const displayDecimals = isCourseToken ? decimals : otherDecimals;
  const displaySymbol = isCourseToken ? symbol : otherSymbol;
  // El resumen usa exactamente los estados leídos del contrato, nunca datos de ejemplo.
  const orderStatus = order?.status;
  useEffect(() => {
    if (orderStatus !== undefined) onStatus(item.id.toString(), Number(orderStatus));
  }, [item.id, onStatus, orderStatus]);

  if (error)
    return (
      <tr hidden={!visible}>
        <td colSpan={8}>
          <div className="flex items-center justify-between gap-3 text-error">
            <span>无法读取订单 #{item.id.toString()}。</span>
            <button className="btn btn-ghost btn-sm" onClick={() => void refetch()}>
              重新读取
            </button>
          </div>
        </td>
      </tr>
    );
  if (!order)
    return (
      <tr hidden={!visible}>
        <td colSpan={8}>
          <span className="loading loading-spinner loading-xs mr-2" />
          正在读取订单 #{item.id.toString()}…
        </td>
      </tr>
    );

  const permissions = getOrderPermissions(order as EscrowOrder, account, arbiter);
  const disabled = busy || !canTransact;
  const roles = [
    sameAddress(account, order.buyer) && "买家",
    sameAddress(account, order.seller) && "卖家",
    sameAddress(account, arbiter) && "仲裁人",
  ].filter(Boolean);

  const act = (kind: "confirm" | "dispute" | "resolve", sellerWins?: boolean) =>
    runAction(
      `${{ confirm: "确认收货", dispute: "发起争议", resolve: "仲裁处理" }[kind]} · 订单 #${item.id}`,
      async () => {
        if (!account) throw new Error("请先连接钱包。");
        assertContext(account);
        const hash =
          kind === "resolve"
            ? await writeEscrow({ functionName: "resolve", args: [item.id, Boolean(sellerWins)], account })
            : await writeEscrow({ functionName: kind, args: [item.id], account });
        if (!hash) throw new Error("交易发送失败，请检查钱包及网络。");
        record({
          action: kind === "resolve" ? `resolve · ${sellerWins ? "判给卖家" : "退还买家"}` : kind,
          orderId: item.id.toString(),
          hash,
          actor: account,
        });
        await refetch();
        setProgress(`订单 #${item.id}：操作已确认。`);
      },
    );

  const pay = () =>
    runAction(`付款 · 订单 #${item.id}`, async () => {
      if (!account || !escrow || !isCourseToken) throw new Error("该订单不能使用当前配置的代币支付。");
      let approved = false;
      try {
        const result = await payWithApproval({
          assertContext: () => assertContext(account),
          onStage: stage =>
            setProgress(
              stage === "approval"
                ? "第 1/2 步：请在 MetaMask 中授权代币并等待链上确认。"
                : "第 2/2 步：授权已确认，请在 MetaMask 中确认存款交易。",
            ),
          approve: () => writeToken({ functionName: "approve", args: [escrow.address, order.amount], account }),
          onApproved: hash => {
            approved = true;
            record({ action: "approve", orderId: item.id.toString(), hash, actor: account });
          },
          deposit: () => writeEscrow({ functionName: "deposit", args: [item.id], account }),
        });
        record({ action: "deposit", orderId: item.id.toString(), hash: result.depositHash, actor: account });
        await refetch();
        setProgress(`订单 #${item.id} 付款已确认，代币已存入托管合约。`);
      } catch (cause) {
        await refetch();
        if (approved) throw new Error(`授权已确认，但存款未完成：${errorMessage(cause)}`);
        throw cause;
      }
    });

  return (
    <>
      <tr hidden={!visible} className="align-top ce-order-row">
        <td>
          <span className="font-semibold">#{item.id.toString()}</span>
          <div className="mt-1 text-xs opacity-60">{roles.join(" · ") || "旁观者"}</div>
          <button
            type="button"
            className="ce-timeline-toggle"
            aria-expanded={timelineOpen}
            aria-controls={`order-timeline-${item.id}`}
            onClick={() => setTimelineOpen(open => !open)}
          >
            {timelineOpen ? "收起时间线 ▲" : "查看时间线 ▼"}
          </button>
        </td>
        <td>
          <AccountLink address={order.buyer} />
        </td>
        <td>
          <AccountLink address={order.seller} />
        </td>
        <td className="max-w-48">
          <span className="font-medium break-all">
            {displayDecimals === undefined ? "…" : formatUnits(order.amount, displayDecimals)}
          </span>
          <div className="text-xs opacity-60 break-all">{displaySymbol || "代币"}</div>
        </td>
        <td>
          <span className="text-xs whitespace-nowrap" title={`Unix: ${order.deadline}`}>
            {formatDeadline(order.deadline)}
          </span>
        </td>
        <td className="min-w-36 max-w-56 break-words whitespace-normal">{order.description || "无描述"}</td>
        <td>
          <span className={`badge badge-sm ce-status ${STATUS_STYLE[order.status] || "badge-ghost"}`}>
            {STATUS_LABELS[order.status] || "未知状态"}
          </span>
          <div className="mt-1 text-xs opacity-60 max-w-32">{STATUS_DESCRIPTION[order.status]}</div>
        </td>
        <td>
          <div className="flex flex-col items-start gap-2 min-w-36">
            {permissions.canPay && isCourseToken && (
              <button className="btn btn-primary btn-sm" disabled={disabled} onClick={() => void pay()}>
                支付
              </button>
            )}
            {permissions.canPay && !isCourseToken && <span className="text-xs opacity-60">订单代币与当前配置不同</span>}
            {permissions.canConfirm && (
              <button className="btn btn-success btn-sm" disabled={disabled} onClick={() => void act("confirm")}>
                确认收货
              </button>
            )}
            {permissions.canDispute && (
              <button className="btn btn-warning btn-sm" disabled={disabled} onClick={() => void act("dispute")}>
                发起争议
              </button>
            )}
            {permissions.canResolve && (
              <>
                <button
                  className="btn btn-success btn-sm"
                  disabled={disabled}
                  onClick={() => void act("resolve", true)}
                >
                  判给卖家
                </button>
                <button className="btn btn-error btn-sm" disabled={disabled} onClick={() => void act("resolve", false)}>
                  退还买家
                </button>
              </>
            )}
            {!permissions.canPay && !permissions.canConfirm && !permissions.canDispute && !permissions.canResolve && (
              <span className="text-xs opacity-60">
                {order.status === 4
                  ? "等待仲裁人处理"
                  : order.status === 2 || order.status === 3
                    ? "已结束"
                    : "当前账户无可执行操作"}
              </span>
            )}
          </div>
        </td>
      </tr>
      {timelineOpen && visible && escrow && (
        <tr className="ce-timeline-row" id={`order-timeline-${item.id}`}>
          <td colSpan={8}>
            <OrderTimeline orderId={item.id} escrowAddress={escrow.address} createdHash={item.transactionHash} />
          </td>
        </tr>
      )}
    </>
  );
}

export default function EscrowPage() {
  const { address, chainId, isConnected } = useAccount();
  const config = useConfig();
  const { switchChain, isPending: switching } = useSwitchChain();
  const { data: escrow } = useDeployedContractInfo({ contractName: "Escrow" });
  const { data: token } = useDeployedContractInfo({ contractName: "ZWNToken" });
  const { data: arbiter } = useScaffoldReadContract({ contractName: "Escrow", functionName: "arbiter" });
  const { data: currentBlock, refetch: refreshHead } = useBlockNumber({ chainId: CHAIN_ID });
  const { data: orderCount, refetch: refreshCount } = useScaffoldReadContract({
    contractName: "Escrow",
    functionName: "orderCount",
  });
  const { data: decimals } = useScaffoldReadContract({ contractName: "ZWNToken", functionName: "decimals" });
  const { data: symbol } = useScaffoldReadContract({ contractName: "ZWNToken", functionName: "symbol" });
  const { data: balance, refetch: refreshBalance } = useScaffoldReadContract({
    contractName: "ZWNToken",
    functionName: "balanceOf",
    args: [address],
    query: { enabled: !!address },
  });
  const {
    data: created,
    error: eventError,
    isLoading,
    isFetchingNewEvent,
    refetch: refetchEvents,
  } = useScaffoldEventHistory({
    contractName: "Escrow",
    eventName: "OrderCreated",
    fromBlock: DEPLOY_BLOCK,
    watch: true,
    blocksBatchSize: 10,
  });
  const { writeContractAsync: writeEscrow } = useScaffoldWriteContract({ contractName: "Escrow" });
  const { entries, record } = useTransactionLog();
  const [confirmedEvents, setConfirmedEvents] = useState<CreatedOrder[]>([]);
  const [seller, setSeller] = useState("");
  const [amount, setAmount] = useState("30");
  const [minutes, setMinutes] = useState("30");
  const [description, setDescription] = useState("");
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [orderStatuses, setOrderStatuses] = useState<Record<string, number>>({});
  const [activeAction, setActiveAction] = useState<string>();
  const [progress, setProgress] = useState("");
  const [actionError, setActionError] = useState("");
  const busyRef = useRef(false);
  const canTransact = isConnected && chainId === CHAIN_ID;

  const orders = useMemo(() => {
    const unique = new Map<string, CreatedOrder>();
    for (const event of created || []) {
      const { id, buyer, seller } = event.args;
      if (id !== undefined && buyer && seller && event.transactionHash)
        unique.set(id.toString(), { id, buyer, seller, transactionHash: event.transactionHash });
    }
    for (const event of confirmedEvents) unique.set(event.id.toString(), event);
    return [...unique.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }, [created, confirmedEvents]);
  const buying = orders.filter(order => sameAddress(address, order.buyer)).length;
  const selling = orders.filter(order => sameAddress(address, order.seller)).length;
  const role = !address
    ? "未连接"
    : [
        sameAddress(address, arbiter) && "仲裁人",
        buying > 0 && `买家（${buying} 笔）`,
        selling > 0 && `卖家（${selling} 笔）`,
      ]
        .filter(Boolean)
        .join(" · ") || "旁观者";
  const syncing =
    isLoading || isFetchingNewEvent || orderCount === undefined || (!eventError && BigInt(orders.length) < orderCount);

  const onStatus = useCallback((id: string, status: number) => {
    setOrderStatuses(previous => (previous[id] === status ? previous : { ...previous, [id]: status }));
  }, []);
  const statusCounts = useMemo(() => {
    const counts = [0, 0, 0, 0, 0];
    for (const item of orders) {
      const status = orderStatuses[item.id.toString()];
      if (status !== undefined && status >= 0 && status < counts.length) counts[status]++;
    }
    return counts;
  }, [orders, orderStatuses]);
  const loadedStatuses = statusCounts.reduce((sum, value) => sum + value, 0);
  const statsLoading = syncing || loadedStatuses < orders.length;
  const activeOrders = statusCounts[0] + statusCounts[1] + statusCounts[4];
  const visibleOrders = orders.filter(order => {
    const status = orderStatuses[order.id.toString()];
    const currentFilter =
      filter === "all" ||
      (filter === "mine" && (sameAddress(address, order.buyer) || sameAddress(address, order.seller))) ||
      (filter === "active" && (status === 0 || status === 1)) ||
      (filter === "disputed" && status === 4) ||
      (filter === "finished" && (status === 2 || status === 3));
    const text = search.trim().toLowerCase();
    const matchesSearch =
      !text ||
      order.id.toString().includes(text.replace(/^#/, "")) ||
      order.buyer.toLowerCase().includes(text) ||
      order.seller.toLowerCase().includes(text);
    return currentFilter && matchesSearch;
  });

  const assertContext = (expectedAccount: Address) => {
    const current = getAccount(config);
    if (!sameAddress(current.address, expectedAccount) || current.chainId !== CHAIN_ID)
      throw new Error("钱包账户或网络已发生变化，请重新选择 POTOS Testnet 上的账户后再试。");
  };

  const runAction: RunAction = async (label, action) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setActiveAction(label);
    setActionError("");
    setProgress("请在 MetaMask 中确认操作，并等待区块链确认。");
    try {
      await action();
    } catch (error) {
      setActionError(errorMessage(error));
      setProgress("");
    } finally {
      await Promise.allSettled([refreshHead(), refreshCount(), refreshBalance()]);
      busyRef.current = false;
      setActiveAction(undefined);
    }
  };

  const createOrder = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void runAction("创建订单", async () => {
      if (!address || !token || !escrow || decimals === undefined) throw new Error("请等待合约加载完成并连接钱包。");
      assertContext(address);
      const input = parseOrderForm({ seller, amount, minutes, description }, address, decimals);
      let newId: bigint | undefined;
      const hash = await writeEscrow(
        {
          functionName: "createOrder",
          args: [input.seller, token.address, input.amount, input.deadline, input.description],
          account: address,
        },
        {
          onBlockConfirmation: receipt => {
            const logs = parseEventLogs({ abi: escrow.abi, eventName: "OrderCreated", logs: receipt.logs });
            const created = logs.find(log => sameAddress(log.address, escrow.address));
            if (created) {
              newId = created.args.id;
              setConfirmedEvents(current => [
                ...current,
                {
                  id: created.args.id,
                  buyer: created.args.buyer,
                  seller: created.args.seller,
                  transactionHash: receipt.transactionHash,
                },
              ]);
            }
          },
        },
      );
      if (!hash) throw new Error("订单提交失败，请检查钱包及网络。");
      record({ action: "createOrder", orderId: newId?.toString(), hash, actor: address });
      setDescription("");
      setProgress(
        newId === undefined ? "创建成功，刷新订单列表后即可查看。" : `订单 #${newId} 创建成功，现在可以付款。`,
      );
    });
  };

  return (
    <main className="ce-shell" id="overview">
      <div className="ce-ticker" aria-label="链上网络概况">
        <span>
          <span className="ce-dot" /> POTOS TESTNET <b>在线网络</b>
        </span>
        <span>
          CHAIN ID <b>60600</b>
        </span>
        <span>
          BLOCK HEIGHT <b>{currentBlock?.toString() ?? "—"}</b>
        </span>
        <span>
          ESCROW <b>{escrow ? `${escrow.address.slice(0, 8)}…${escrow.address.slice(-4)}` : "读取中…"}</b>
        </span>
        <span>
          ORDER COUNT <b>{orderCount?.toString() ?? "—"}</b>
        </span>
        <span className="ce-ticker-end">
          NON-CUSTODIAL <b>BY DESIGN</b>
        </span>
      </div>

      <div className="ce-container">
        <section className="ce-hero" aria-label="平台介绍">
          <div>
            <div className="ce-eyebrow">
              <ShieldCheckIcon className="h-4 w-4" /> 链上资金托管 · 去中心化交易
            </div>
            <h1>
              交易更透明<span className="ce-accent">.</span> 托管更安心<span className="ce-accent">.</span>
            </h1>
            <p>从订单创建到付款、收货确认与争议仲裁，所有关键操作都由 POTOS Testnet 上的智能合约执行。</p>
            <div className="ce-hero-actions">
              <a href="#create-order" className="ce-action-primary">
                <PlusIcon className="h-4 w-4" /> 创建新订单
              </a>
              <a href="#orders" className="ce-action-secondary">
                查看链上订单 <ArrowTopRightOnSquareIcon className="h-4 w-4" />
              </a>
            </div>
          </div>
          <div className="ce-hero-note">
            <div className="ce-micro">SMART CONTRACT / VERIFIED</div>
            <div className="ce-signal">
              <span /> <span /> <span /> <span /> <span />
            </div>
            <div className="ce-hero-note-title">资金由合约管理</div>
            <div className="ce-muted">无托管服务器私钥 · 用户自行签名</div>
            <a
              href={`${EXPLORER}/address/${escrow?.address || "0x7A2a512E658446bd5F25EB484c9F97ADBe7c7afA"}`}
              target="_blank"
              rel="noreferrer"
              className="ce-inline-link"
            >
              查看智能合约 ↗
            </a>
          </div>
        </section>

        <section className="ce-metrics" aria-label="订单统计">
          {[
            {
              key: "total",
              title: "链上订单总数",
              hint: "ALL ON-CHAIN ORDERS",
              value: orderCount?.toString() ?? "—",
              icon: <Squares2X2Icon className="h-5 w-5" />,
              tag: "TOTAL",
            },
            {
              key: "active",
              title: "进行中订单",
              hint: "CREATED / PAID / DISPUTED",
              value: statsLoading ? "—" : String(activeOrders),
              icon: <ChartBarIcon className="h-5 w-5" />,
              tag: "ACTIVE",
            },
            {
              key: "completed",
              title: "已完成订单",
              hint: "DELIVERY CONFIRMED",
              value: statsLoading ? "—" : String(statusCounts[2]),
              icon: <CheckCircleIcon className="h-5 w-5" />,
              tag: "COMPLETED",
            },
            {
              key: "disputed",
              title: "争议处理中",
              hint: "AWAITING ARBITRATION",
              value: statsLoading ? "—" : String(statusCounts[4]),
              icon: <ExclamationTriangleIcon className="h-5 w-5" />,
              tag: "DISPUTED",
            },
          ].map(metric => (
            <article className="ce-metric" key={metric.key}>
              <div className="ce-metric-top">
                <span>{metric.title}</span>
                <span className="ce-metric-icon">{metric.icon}</span>
              </div>
              <div className="ce-metric-number">
                {metric.value}
                <span className="ce-metric-unit">笔</span>
              </div>
              <div className="ce-metric-bottom">
                <span>{metric.hint}</span>
                <span>{metric.tag}</span>
              </div>
            </article>
          ))}
        </section>

        <section className="ce-analytics" aria-label="订单统计图表">
          <div className="ce-panel ce-analytics-main">
            <div className="ce-panel-heading">
              <div>
                <div className="ce-micro">REAL-TIME DATA / ON-CHAIN</div>
                <h2>订单状态分布</h2>
                <p>
                  根据合约 <code>getOrder</code> 的最新状态统计，而非模拟数据。
                </p>
              </div>
              <span className="ce-live-tag">
                <span className="ce-dot" /> LIVE DATA
              </span>
            </div>
            <div className="ce-chart-grid">
              {STATUS_LABELS.map((label, index) => {
                const value = statusCounts[index];
                const max = Math.max(1, ...statusCounts);
                const height = loadedStatuses === 0 ? 2 : Math.max(3, (value / max) * 100);
                return (
                  <div className="ce-chart-col" key={label}>
                    <div className="ce-chart-value">{statsLoading ? "—" : value}</div>
                    <div className="ce-bar-track">
                      <div className={`ce-bar ce-bar-${index}`} style={{ height: `${height}%` }} />
                    </div>
                    <div className="ce-chart-label">{label}</div>
                  </div>
                );
              })}
            </div>
            <div className="ce-chart-footer">
              <span>
                <span className="ce-dot" /> 已读取 {loadedStatuses} / {orders.length} 笔订单状态
              </span>
              <span>{syncing ? "正在同步区块链数据…" : "数据直接来自 POTOS Testnet"}</span>
            </div>
          </div>
          <aside className="ce-panel ce-side-panel">
            <div className="ce-micro">ACCOUNT / PERMISSIONS</div>
            <h2>当前钱包</h2>
            <div className="ce-account-detail">
              <span>账户地址</span>
              <AccountLink address={address} />
            </div>
            <div className="ce-account-detail">
              <span>当前角色</span>
              <strong>{role}</strong>
            </div>
            <div className="ce-account-detail">
              <span>代币余额</span>
              <strong className="ce-balance">
                {balance === undefined || decimals === undefined ? "—" : formatUnits(balance, decimals)}{" "}
                <small>{symbol || "ZWN"}</small>
              </strong>
            </div>
            <div className="ce-account-detail">
              <span>合约仲裁人</span>
              <AccountLink address={arbiter} emptyLabel="读取中…" />
            </div>
            <div className="ce-account-foot">连接钱包后，系统会根据订单参与方和链上权限显示操作按钮。</div>
            {!isConnected && (
              <div className="ce-wallet-slot">
                <WalletButton />
              </div>
            )}
          </aside>
        </section>

        {isConnected && chainId !== CHAIN_ID && (
          <div className="ce-notice ce-notice-warning" role="alert">
            <span>当前钱包网络不正确。请切换至 POTOS Testnet 执行交易。</span>
            <button className="btn btn-sm" disabled={switching} onClick={() => switchChain({ chainId: CHAIN_ID })}>
              切换至 POTOS
            </button>
          </div>
        )}
        {(progress || actionError) && (
          <div
            className={`ce-notice ${actionError ? "ce-notice-error" : "ce-notice-info"}`}
            role={actionError ? "alert" : "status"}
            aria-live="polite"
          >
            {activeAction && <span className="loading loading-spinner loading-xs mr-2" />}
            {actionError || progress}
          </div>
        )}

        <section className="ce-panel ce-orders" id="orders">
          <div className="ce-panel-heading ce-orders-heading">
            <div>
              <div className="ce-micro">ORDER MANAGEMENT / 订单管理</div>
              <h2>
                链上订单{" "}
                <span className="ce-subcount">
                  {orders.length}
                  {orderCount !== undefined ? ` / ${orderCount}` : ""}
                </span>
              </h2>
              <p>{syncing ? "正在同步订单历史记录…" : "订单状态已从智能合约同步"}</p>
            </div>
            <a href="#create-order" className="ce-action-primary ce-small">
              <PlusIcon className="h-4 w-4" /> 创建订单
            </a>
          </div>
          <div className="ce-table-toolbar">
            <label className="ce-search">
              <span aria-hidden="true">⌕</span>
              <input
                type="search"
                value={search}
                onChange={event => setSearch(event.target.value)}
                placeholder="搜索订单 ID 或钱包地址"
                aria-label="搜索订单"
              />
            </label>
            <div className="ce-filter-actions">
              <label className="sr-only" htmlFor="order-filter">
                筛选订单
              </label>
              <select
                id="order-filter"
                className="ce-filter"
                value={filter}
                onChange={event => setFilter(event.target.value)}
              >
                <option value="all">全部订单</option>
                <option value="mine" disabled={!address}>
                  我的订单
                </option>
                <option value="active">进行中</option>
                <option value="disputed">争议中</option>
                <option value="finished">已结束</option>
              </select>
              <button
                className="ce-refresh"
                title="刷新历史记录"
                aria-label="刷新历史记录"
                disabled={isLoading || isFetchingNewEvent}
                onClick={() => void refetchEvents()}
              >
                <ArrowPathIcon className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
              </button>
            </div>
          </div>
          {eventError && (
            <div className="ce-notice ce-notice-error ce-notice-inline" role="alert">
              订单读取失败，列表可能不完整。
              <button className="link font-semibold" onClick={() => void refetchEvents()}>
                重试
              </button>
            </div>
          )}
          <div className="ce-table-wrap">
            <table className="table ce-table w-full">
              <thead>
                <tr>
                  <th>订单 / 角色</th>
                  <th>买家</th>
                  <th>卖家</th>
                  <th>金额</th>
                  <th>截止时间</th>
                  <th>描述</th>
                  <th>状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {orders.map(item => (
                  <OrderRow
                    key={item.id.toString()}
                    item={item}
                    visible={visibleOrders.some(candidate => candidate.id === item.id)}
                    account={address}
                    arbiter={arbiter}
                    tokenAddress={token?.address}
                    decimals={decimals}
                    symbol={symbol}
                    busy={!!activeAction}
                    canTransact={canTransact}
                    runAction={runAction}
                    record={record}
                    setProgress={setProgress}
                    assertContext={assertContext}
                    onStatus={onStatus}
                  />
                ))}
                {visibleOrders.length === 0 && (
                  <tr>
                    <td colSpan={8} className="py-12 text-center opacity-60">
                      {syncing
                        ? "正在查询链上订单…"
                        : eventError
                          ? "请重试读取，以恢复订单列表。"
                          : search
                            ? "未找到匹配的订单。"
                            : filter !== "all"
                              ? "该筛选条件下没有订单。"
                              : "暂无订单，请创建第一笔订单。"}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="ce-table-foot">
            <ShieldCheckIcon className="h-4 w-4" />
            付款分为两笔交易：先在 MetaMask 中授权（approve），确认后再存入托管合约（deposit）。
          </div>
        </section>

        <section className="ce-panel ce-create" id="create-order">
          <div className="ce-panel-heading">
            <div>
              <div className="ce-micro">NEW TRANSACTION / 新交易</div>
              <h2>创建托管订单</h2>
              <p>连接的钱包将作为买家。代币金额会自动转换为链上 18 位精度（以实际 token.decimals 为准）。</p>
            </div>
            <span className="ce-outline-badge">SECURE · ON-CHAIN</span>
          </div>
          <form onSubmit={createOrder} className="ce-form">
            <label className="ce-field ce-wide">
              <span>
                卖家钱包地址 <b>*</b>
              </span>
              <input
                className="input input-bordered font-mono text-sm"
                placeholder="0x…"
                value={seller}
                onChange={event => setSeller(event.target.value)}
                required
                disabled={!!activeAction}
                autoComplete="off"
              />
            </label>
            <label className="ce-field">
              <span>
                金额（代币） <b>*</b>
              </span>
              <input
                className="input input-bordered"
                inputMode="decimal"
                placeholder="30"
                value={amount}
                onChange={event => setAmount(event.target.value)}
                required
                disabled={!!activeAction}
              />
            </label>
            <label className="ce-field">
              <span>
                到期时间（分钟） <b>*</b>
              </span>
              <input
                className="input input-bordered"
                type="number"
                min="1"
                step="1"
                value={minutes}
                onChange={event => setMinutes(event.target.value)}
                required
                disabled={!!activeAction}
              />
            </label>
            <label className="ce-field ce-wide">
              <span>
                订单描述 <b>*</b>
              </span>
              <input
                className="input input-bordered"
                placeholder="请输入交付内容及交易条件"
                value={description}
                onChange={event => setDescription(event.target.value)}
                required
                disabled={!!activeAction}
              />
            </label>
            <div className="ce-create-submit">
              <span>
                代币合约 <AccountLink address={token?.address} emptyLabel="读取中…" /> ·{" "}
                {decimals === undefined ? "精度读取中" : `${decimals} 位精度`}
              </span>
              <button
                type="submit"
                className="ce-action-primary ce-submit"
                disabled={!canTransact || !!activeAction || decimals === undefined || !token || !escrow}
              >
                <PlusIcon className="h-4 w-4" /> 创建订单
              </button>
            </div>
          </form>
        </section>

        <div className="ce-history" id="history">
          <TransactionLog entries={entries} />
        </div>
        <footer className="ce-footer-note">
          CHAINESCROW <span>·</span> BUILT ON POTOS TESTNET <span>·</span> 所有交易由用户钱包签名
        </footer>
      </div>
    </main>
  );
}
