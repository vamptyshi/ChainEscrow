import { Address, Hash, isAddress, parseUnits } from "viem";

export const ORDER_STATUS = ["Created", "Paid", "Completed", "Refunded", "Disputed"] as const;

export type EscrowOrder = {
  buyer: string;
  seller: string;
  token: string;
  amount: bigint;
  deadline: bigint;
  status: number;
  description: string;
};

export const sameAddress = (a?: string, b?: string): boolean => Boolean(a && b && a.toLowerCase() === b.toLowerCase());

export function getOrderPermissions(order: EscrowOrder, account?: string, arbiter?: string) {
  const isBuyer = sameAddress(order.buyer, account);
  const isSeller = sameAddress(order.seller, account);
  return {
    canPay: order.status === 0 && isBuyer,
    canConfirm: order.status === 1 && isBuyer,
    canDispute: order.status === 1 && (isBuyer || isSeller),
    canResolve: order.status === 4 && sameAddress(account, arbiter),
  };
}

type OrderForm = { seller: string; amount: string; minutes: string; description: string };

export function parseOrderForm(form: OrderForm, buyer: string, decimals: number, nowMs: number = Date.now()) {
  const seller = form.seller.trim();
  if (!isAddress(seller) || /^0x0{40}$/i.test(seller)) {
    throw new Error("Introduce una dirección de vendedor válida y distinta de la dirección cero.");
  }
  if (sameAddress(seller, buyer)) throw new Error("El vendedor debe ser una cuenta distinta del comprador.");
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
    throw new Error("No se pudo determinar la precisión del token.");
  }

  const amountText = form.amount.trim();
  if (!/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(amountText)) {
    throw new Error("Introduce un importe positivo; usa un punto para los decimales.");
  }
  if ((amountText.split(".")[1]?.length ?? 0) > decimals) {
    throw new Error(`El importe admite como máximo ${decimals} decimales.`);
  }
  const amount = parseUnits(amountText, decimals);
  if (amount <= 0n) throw new Error("El importe debe ser mayor que cero.");
  const minutesText = form.minutes.trim();
  const minutes = Number(minutesText);
  if (!/^\d+$/.test(minutesText) || !Number.isSafeInteger(minutes) || minutes <= 0) {
    throw new Error("El plazo debe ser un número entero positivo de minutos.");
  }
  const nowSeconds = Math.floor(nowMs / 1000);
  if (!Number.isSafeInteger(nowSeconds) || nowSeconds < 0) throw new Error("La hora actual no es válida.");
  const description = form.description.trim();
  if (!description) throw new Error("Escribe una descripción del pedido.");
  return { seller: seller as Address, amount, deadline: BigInt(nowSeconds) + BigInt(minutes) * 60n, description };
}

type ApprovalPayment = {
  approve: () => Promise<Hash | undefined>;
  deposit: () => Promise<Hash | undefined>;
  assertContext?: () => void | Promise<void>;
  onStage?: (stage: "approval" | "deposit") => void;
  onApproved?: (hash: Hash) => void;
};

/** approve must resolve only after its transaction has been confirmed successfully. */
export async function payWithApproval({ approve, deposit, assertContext, onStage, onApproved }: ApprovalPayment) {
  await assertContext?.();
  onStage?.("approval");
  const approvalHash = await approve();
  if (!approvalHash) throw new Error("La autorización no se confirmó. El depósito no se ha enviado.");
  onApproved?.(approvalHash);
  await assertContext?.();
  onStage?.("deposit");
  const depositHash = await deposit();
  if (!depositHash) throw new Error("El depósito no se confirmó. Puedes volver a intentar el pago.");
  return { approvalHash, depositHash };
}
