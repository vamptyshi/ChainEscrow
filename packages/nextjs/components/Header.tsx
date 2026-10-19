"use client";

import { useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bars3Icon, ShieldCheckIcon } from "@heroicons/react/24/outline";
import { WalletButton } from "~~/components/escrow/WalletButton";
import { useOutsideClick } from "~~/hooks/scaffold-eth";

type HeaderMenuLink = { label: string; href: string };

export const menuLinks: HeaderMenuLink[] = [
  { label: "总览", href: "/escrow#overview" },
  { label: "订单管理", href: "/escrow#orders" },
  { label: "创建订单", href: "/escrow#create-order" },
  { label: "交易记录", href: "/escrow#history" },
  { label: "合约调试", href: "/debug" },
];

export const HeaderMenuLinks = () => {
  const pathname = usePathname();
  return (
    <>
      {menuLinks.map(({ label, href }) => (
        <li key={href}>
          <Link
            href={href}
            className={`ce-nav-link ${pathname === "/debug" && href === "/debug" ? "ce-nav-active" : ""}`}
          >
            {label}
          </Link>
        </li>
      ))}
    </>
  );
};

export const Header = () => {
  const burgerMenuRef = useRef<HTMLDetailsElement>(null);
  useOutsideClick(burgerMenuRef, () => burgerMenuRef.current?.removeAttribute("open"));

  return (
    <header className="ce-header">
      <div className="ce-header-inner">
        <Link href="/escrow" className="ce-brand" aria-label="ChainEscrow 首页">
          <span className="ce-brand-icon">
            <ShieldCheckIcon className="h-5 w-5" />
          </span>
          <span className="ce-brand-text">
            CHAIN<span>ESCROW</span>
            <small>链上托管 · ON-CHAIN ESCROW</small>
          </span>
        </Link>
        <nav className="ce-desktop-nav" aria-label="主导航">
          <ul>
            <HeaderMenuLinks />
          </ul>
        </nav>
        <div className="ce-header-wallet">
          <WalletButton />
        </div>
        <details className="ce-mobile-menu" ref={burgerMenuRef}>
          <summary aria-label="打开菜单">
            <Bars3Icon className="h-6 w-6" />
          </summary>
          <nav aria-label="移动导航" onClick={() => burgerMenuRef.current?.removeAttribute("open")}>
            <ul>
              <HeaderMenuLinks />
            </ul>
          </nav>
        </details>
      </div>
    </header>
  );
};
