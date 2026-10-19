"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";

/** Chinese labels while RainbowKit still handles wallet connection and permissions. */
export function WalletButton() {
  return (
    <ConnectButton.Custom>
      {({ account, chain, mounted, openAccountModal, openChainModal, openConnectModal }) => {
        const connected = mounted && account && chain;
        return (
          <div
            className="ce-wallet-button-group"
            {...(!mounted && { "aria-hidden": true, style: { opacity: 0, pointerEvents: "none" as const } })}
          >
            {!connected ? (
              <button type="button" className="ce-wallet-button" onClick={openConnectModal}>
                连接钱包 ↗
              </button>
            ) : chain.unsupported ? (
              <button type="button" className="ce-wallet-button ce-wallet-unsupported" onClick={openChainModal}>
                切换网络
              </button>
            ) : (
              <>
                <button type="button" className="ce-chain-chip" onClick={openChainModal} title="选择钱包网络">
                  <span className="ce-dot" /> {chain.name}
                </button>
                <button type="button" className="ce-wallet-button" onClick={openAccountModal} title={account.address}>
                  {account.displayName}
                </button>
              </>
            )}
          </div>
        );
      }}
    </ConnectButton.Custom>
  );
}
