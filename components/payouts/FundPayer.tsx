"use client";

import { motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useState } from "react";
import { createPublicClient, encodeFunctionData, erc20Abi, formatUnits, http, parseUnits } from "viem";
import { baseSepolia } from "viem/chains";
import { payerBalance } from "@/app/actions";
import { shortHash } from "@/lib/format";

const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as const;
const CHAIN_HEX = `0x${baseSepolia.id.toString(16)}`;
const chain = createPublicClient({ chain: baseSepolia, transport: http() });

type Eth = { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> };
const injected = () => (typeof window !== "undefined" ? (window as unknown as { ethereum?: Eth }).ethereum : undefined);

type Step = "idle" | "connecting" | "ready" | "sending" | "confirming" | "arrived" | "error";

/** A figure that rolls when it changes: the balance moving is the confirmation. */
function Rolling({ value, digits }: { value: number; digits: number }) {
  const reduce = useReducedMotion();
  const text = value.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: Math.min(2, digits) });
  return (
    <span className="relative inline-block overflow-hidden align-bottom tabular-nums">
      <motion.span key={text} className="inline-block" initial={reduce ? false : { y: "-90%", opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}>
        {text}
      </motion.span>
    </span>
  );
}

export function FundPayer() {
  const [balance, setBalance] = useState<{ address: string; usdc: number; eth: number } | null>(null);
  const [account, setAccount] = useState<`0x${string}` | null>(null);
  const [mine, setMine] = useState<number | null>(null);
  const [amount, setAmount] = useState("5");
  const [step, setStep] = useState<Step>("idle");
  const [tx, setTx] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // Only the browser can know whether a wallet extension exists; decide after mount so the first render matches the server's.
  const [hasWallet, setHasWallet] = useState<boolean | null>(null);
  useEffect(() => setHasWallet(!!injected()), []);

  const refresh = useCallback(async () => {
    const r = await payerBalance();
    if (r.ok) setBalance(r.value);
  }, []);

  // The balance is live: re-read it every 8 seconds, and right after a top-up lands.
  useEffect(() => {
    void refresh();
    const t = setInterval(refresh, 8000);
    return () => clearInterval(t);
  }, [refresh]);

  const readMine = useCallback(async (who: `0x${string}`) => {
    const v = await chain.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [who] });
    const held = Number(formatUnits(v, 6));
    setMine(held);
    // Start from an amount the wallet can actually send.
    setAmount((a) => (Number(a) > held ? String(Math.floor(held * 100) / 100) : a));
  }, []);

  const connect = async () => {
    const eth = injected();
    if (!eth) return;
    setError(null);
    setStep("connecting");
    try {
      const [who] = (await eth.request({ method: "eth_requestAccounts" })) as `0x${string}`[];
      try {
        await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: CHAIN_HEX }] });
      } catch (e) {
        if ((e as { code?: number }).code !== 4902) throw e;
        await eth.request({
          method: "wallet_addEthereumChain",
          params: [{ chainId: CHAIN_HEX, chainName: "Base Sepolia", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: ["https://sepolia.base.org"], blockExplorerUrls: ["https://sepolia.basescan.org"] }],
        });
      }
      setAccount(who);
      await readMine(who);
      setStep("ready");
    } catch (e) {
      setStep("error");
      setError((e as { message?: string }).message?.slice(0, 160) ?? "The wallet refused to connect.");
    }
  };

  const send = async () => {
    const eth = injected();
    if (!eth || !account || !balance) return;
    const value = Number(amount);
    if (!(value > 0)) return setError("Enter an amount above zero.");
    if (mine !== null && value > mine) return setError(`Your wallet holds ${mine} test USDC.`);
    setError(null);
    setStep("sending");
    try {
      const hash = (await eth.request({
        method: "eth_sendTransaction",
        params: [{ from: account, to: USDC, data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [balance.address as `0x${string}`, parseUnits(amount, 6)] }) }],
      })) as `0x${string}`;
      setTx(hash);
      setStep("confirming");
      await chain.waitForTransactionReceipt({ hash });
      await Promise.all([refresh(), readMine(account)]);
      setStep("arrived");
    } catch (e) {
      setStep("error");
      setError((e as { shortMessage?: string; message?: string }).shortMessage ?? (e as { message?: string }).message?.slice(0, 160) ?? "The transfer did not go through.");
    }
  };

  const copy = async () => {
    if (!balance) return;
    await navigator.clipboard.writeText(balance.address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  return (
    <section aria-label="Paying wallet" className="rounded-[3px] bg-band p-5 text-on-band shadow-[var(--shadow-paper)] sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-type text-xs text-on-band-2">Paying wallet · Base Sepolia</p>
          <p className="mt-1 text-[2.4rem] font-black leading-none tracking-[-0.04em]">
            {balance ? <Rolling value={balance.usdc} digits={2} /> : <span className="skeleton inline-block h-9 w-28 rounded-[2px] align-middle" />}
            <span className="ml-2 text-lg font-bold text-on-band-2">test USDC</span>
          </p>
          <p className="mt-1 font-type text-xs text-on-band-2">
            {balance ? (
              <>
                <Rolling value={balance.eth} digits={5} /> ETH for gas ·{" "}
                <button type="button" onClick={copy} className="underline decoration-dotted underline-offset-2 hover:text-on-band">
                  {copied ? "copied" : shortHash(balance.address)}
                </button>
              </>
            ) : (
              "reading the chain…"
            )}
          </p>
        </div>

        {step === "idle" || (step === "error" && !account) ? (
          hasWallet === null ? (
            <span className="skeleton inline-block h-10 w-48 rounded-[3px]" aria-hidden />
          ) : hasWallet ? (
            <button type="button" onClick={connect} className="press rounded-[3px] bg-marker px-4 py-2.5 text-sm font-black text-ink hover:bg-marker-press" style={{ boxShadow: "2px 3px 0 oklch(0.18 0.06 258)" }}>
              Top up from your wallet
            </button>
          ) : (
            <p className="max-w-[34ch] text-sm text-on-band-2">
              No browser wallet here. Send test USDC on Base Sepolia to the address on the left, or get some at{" "}
              <a href="https://faucet.circle.com" target="_blank" rel="noreferrer" className="font-bold text-on-band underline">
                faucet.circle.com
              </a>
              .
            </p>
          )
        ) : null}
      </div>

      {account && step !== "idle" ? (
        <div className="mt-5 flex flex-wrap items-center gap-3 rounded-[3px] bg-paper p-3 text-ink">
          <span className="font-type text-xs leading-relaxed">
            From your wallet {shortHash(account)} · {mine ?? "…"} test USDC
            <br />
            To Payrun&apos;s paying wallet {balance ? shortHash(balance.address) : "…"}
          </span>
          <span className="flex-1" />
          <label className="flex items-center gap-2 text-sm font-bold">
            <span className="sr-only">Amount</span>
            <input
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
              disabled={step === "sending" || step === "confirming"}
              className="w-20 rounded-[2px] border-2 border-rule bg-paper px-2 py-1 text-right font-type outline-none focus:border-ink"
            />
            USDC
          </label>
          <button
            type="button"
            onClick={send}
            disabled={step === "sending" || step === "confirming"}
            className="press rounded-[3px] bg-ink px-4 py-2 text-sm font-black text-paper hover:bg-band disabled:cursor-progress disabled:opacity-70"
          >
            {step === "sending" ? "Confirm in your wallet…" : step === "confirming" ? "Waiting for Base…" : `Send ${amount || 0} USDC to ${balance ? shortHash(balance.address) : "the payer"}`}
          </button>
        </div>
      ) : null}

      {step === "arrived" && tx ? (
        <p className="mt-3 font-hand text-xl text-marker">
          Arrived.{" "}
          <a href={`https://sepolia.basescan.org/tx/${tx}`} target="_blank" rel="noreferrer" className="underline">
            {shortHash(tx)}
          </a>
        </p>
      ) : null}
      {error ? <p role="alert" className="mt-3 w-fit rounded-[2px] bg-paper px-3 py-1.5 text-sm font-bold text-block">{error}</p> : null}
    </section>
  );
}
