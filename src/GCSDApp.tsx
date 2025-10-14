/* GCSDApp.tsx — single-file app (React + TypeScript, Vite)
   Implements: admin metric resets, safe corrections, active-redeem counting, epochs, neon-friendly selects.
   NOTE: Business data is KV-only. Only theme uses localStorage. */

import React, { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { ChevronDown, RotateCcw, Gift, User, Home as HomeIcon, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { kvGetRemember as kvGet, kvSetIfChanged as kvSet, onKVChange } from "./lib/db";

/* =========================== Types & constants =========================== */

type TxnKind = "credit" | "debit";
type Transaction = {
  id: string;
  kind: TxnKind;
  amount: number;
  memo?: string;           // prefixes contract below
  dateISO: string;
  fromId?: string;         // debits subtract from this account
  toId?: string;           // credits add to this account
  meta?: Record<string, any>;
};

type Account = { id: string; name: string; role?: "system" | "agent" };
type ProductRule = { key: string; label: string; gcsd: number };
type PrizeItem   = { key: string; label: string; price: number };
type Notification = { id: string; when: string; text: string };

type MetricsEpoch = { earned30d?: string; spent30d?: string; starOfDay?: string; leaderOfMonth?: string };

type Theme = "light" | "dark" | "neon";

/* Memo prefixes (contract)
   - System seed: "Mint"
   - Correction debits (reduce earned): "Reversal of sale: …", "Correction (withdraw): …", "Balance reset to 0"
   - Redeem debits: "Redeem: <Prize Label>"
   - Reversal of redemption credits: "Reversal of redemption: <Prize Label>"
*/

/* Datasets */
const PRODUCT_RULES: ProductRule[] = [
  { key: "small-collection", label: "Small Collection", gcsd: 190 },
  { key: "big-whv", label: "Big WHV", gcsd: 320 },
  { key: "full-eval", label: "Full Evaluation", gcsd: 500 },
  { key: "big-partial", label: "Big Partial Evaluation", gcsd: 350 },
  { key: "small-partial", label: "Small Partial Evaluation", gcsd: 220 },
  { key: "student-visa", label: "Student Visa", gcsd: 150 },
  { key: "tourist-visa", label: "Tourist Visa", gcsd: 120 },
  { key: "big-collection", label: "Big Collection", gcsd: 280 },
  { key: "small-whv", label: "Small WHV", gcsd: 200 },
];

const PRIZE_ITEMS: PrizeItem[] = [
  { key: "airfryer", label: "Philips Airfryer", price: 6000 },
  { key: "lgsoundbar", label: "LG Soundbar", price: 11000 },
  { key: "burger", label: "Burger Lunch", price: 650 },
  { key: "cash50", label: "Cash Voucher 50 лв", price: 3000 },
  { key: "poker", label: "Texas Poker Set", price: 1200 },
  { key: "soda", label: "Philips Soda Maker", price: 5200 },
  { key: "magsafe", label: "MagSafe Charger", price: 600 },
  { key: "fit3", label: "Samsung Galaxy Fit 3", price: 5000 },
  { key: "cinema", label: "Cinema Tickets", price: 800 },
  { key: "neo", label: "Neo Massager", price: 1400 },
  { key: "g102", label: "Logitech G102 Mouse", price: 1900 },
  { key: "flight-mad", label: "Madrid Flights", price: 11350 },
  { key: "flight-lon", label: "London Flights", price: 11350 },
  { key: "flight-mil", label: "Milan Flights", price: 11350 },
];

const MAX_PRIZES_PER_AGENT = 2;

/* KV keys */
const CORE_KEY   = "gcs-v4-core";   // { accounts, txns }
const STOCK_KEY  = "gcs-v4-stock";  // Record<prizeKey, number>
const PINS_KEY   = "gcs-v4-pins";   // Record<agentId, string>
const GOALS_KEY  = "gcs-v4-goals";  // Record<agentId, number>
const NOTIF_KEY  = "gcs-v4-notifs"; // Notification[]
const EPOCHS_KEY = "gcs-v4-epochs"; // Record<agentId, ISOString>
const METRIC_KEY = "gcs-v4-metrics";// MetricsEpoch

/* Seeds (system account only; agents are created by admin) */
const SEED_ACCOUNTS: Account[] = [{ id: "vault", name: "Bank Vault", role: "system" }];
const SEED_TXNS: Transaction[] = [
  { id: nid(), kind: "credit", amount: 0, memo: "Mint", dateISO: nowISO(), toId: "vault" }
];

/* =========================== Small utilities =========================== */

function nowISO() { return new Date().toISOString(); }
function nid() { return Math.random().toString(36).slice(2, 10); }
function clampNonNeg(x: number) { return Math.max(0, x); }

function afterISO(epochISO: string | undefined, dateISO: string) {
  if (!epochISO) return true;
  return new Date(dateISO).getTime() >= new Date(epochISO).getTime();
}

/* ===== Transaction classifiers (single definitions) ===== */
function G_isCorrectionDebit(t: Transaction) {
  return t.kind === "debit" && !!t.memo && (
    t.memo.startsWith("Reversal of sale:") ||
    t.memo.startsWith("Correction (withdraw)") ||
    t.memo.startsWith("Balance reset to 0")
  );
}
function G_isReversalOfRedemption(t: Transaction) {
  return t.kind === "credit" && !!t.memo && t.memo.startsWith("Reversal of redemption:");
}
function G_isRedeemTxn(t: Transaction) {
  return t.kind === "debit" && !!t.memo && t.memo.startsWith("Redeem:");
}
function G_isRedeemStillActive(redeemTxn: Transaction, all: Transaction[]) {
  if (!G_isRedeemTxn(redeemTxn) || !redeemTxn.fromId) return false;
  const label = redeemTxn.memo!.replace(/^Redeem:\s*/, "");
  const when  = new Date(redeemTxn.dateISO).getTime();
  const sameAgent = (t: Transaction) => t.toId === redeemTxn.fromId || t.fromId === redeemTxn.fromId;
  const reversed = all.some(t =>
    t.kind === "credit" &&
    !!t.memo && t.memo.startsWith("Reversal of redemption:") &&
    sameAgent(t) &&
    new Date(t.dateISO).getTime() > when &&
    t.memo!.replace(/^Reversal of redemption:\s*/, "") === label
  );
  return !reversed;
}
/** A credited sale counts as 'active' unless later withdrawn or reversed */
function G_isSaleStillActive(creditTxn: Transaction, all: Transaction[]) {
  if (creditTxn.kind !== "credit" || !creditTxn.toId) return false;
  if (creditTxn.memo === "Mint") return false;
  const label = creditTxn.memo || "Sale";
  const rid = creditTxn.id;
  const after = new Date(creditTxn.dateISO).getTime();
  return !all.some(t =>
    t.kind === "debit" &&
    !!t.fromId && t.fromId === creditTxn.toId &&
    !!t.memo &&
    (
      t.memo.startsWith("Reversal of sale:") ||
      t.memo.startsWith("Correction (withdraw)")
    ) &&
    new Date(t.dateISO).getTime() >= after &&
    (
      (t.meta && (t.meta as any).reversesTxnId === rid) ||
      t.memo.replace(/^Reversal of sale:\s*/, "") === label
    )
  );
}
/* ===== Epoch helpers ===== */
function afterEpoch(epochs: Record<string,string>, agentId: string, dateISO: string) {
  const e = epochs[agentId];
  if (!e) return true;
  return new Date(dateISO).getTime() >= new Date(e).getTime();
}

/* =========================== Mini UI bits =========================== */

function classNames(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function neonBox(theme: Theme) {
  return theme === "neon"
    ? "border-orange-800/60 bg-black/40"
    : "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900";
}
function neonBtn(theme: Theme, outline=false) {
  if (theme !== "neon") return outline ? "border border-slate-300 dark:border-slate-700" : "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900";
  return outline ? "border border-orange-500/60 text-orange-300" : "bg-orange-500/90 text-black hover:bg-orange-400";
}
function inputCls(theme: Theme) {
  return classNames(
    "w-full px-3 py-2 rounded-xl outline-none",
    theme === "neon" ? "bg-black/40 border border-orange-800/70 text-orange-100 placeholder:text-orange-300/50" : "bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700"
  );
}

function FancySelect(props: { value?: string; onChange: (v: string)=>void; theme: Theme; placeholder?: string; children: React.ReactNode }) {
  const { value, onChange, theme, placeholder, children } = props;
  return (
    <div className={classNames("relative rounded-xl", theme==="neon" ? "border border-orange-800/70 bg-black/30" : "border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800")}>
      <select
        value={value ?? ""}
        onChange={(e)=> onChange(e.target.value)}
        className={classNames("appearance-none w-full px-3 py-2 rounded-xl bg-transparent pr-8", theme==="neon" ? "text-orange-50 [color-scheme:dark]" : "text-slate-900 dark:text-slate-100")}
      >
        {placeholder && <option value="">{placeholder}</option>}
        {children}
      </select>
      <ChevronDown className={classNames("absolute right-2 top-2.5 w-4 h-4 pointer-events-none", theme==="neon" ? "text-orange-300" : "text-slate-500 dark:text-slate-300")} />
    </div>
  );
}

function NumberFlash({ value }: { value: number }) {
  return (
    <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.25 }}>
      {value.toLocaleString()}
    </motion.span>
  );
}

/* =========================== Pages =========================== */

export default function GCSDApp() {
  // Core live state
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [txns, setTxns] = useState<Transaction[]>([]);
  const [stock, setStock] = useState<Record<string, number>>({});
  const [pins, setPins] = useState<Record<string, string>>({});
  const [goals, setGoals] = useState<Record<string, number>>({});
  const [notifs, setNotifs] = useState<Notification[]>([]);
  const [epochs, setEpochs] = useState<Record<string, string>>({});
  const [hydrated, setHydrated] = useState(false);

  // theme only in localStorage
  const [theme, setTheme] = useState<Theme>((localStorage.getItem("gcs-v4-theme") as Theme) || "light");
  useEffect(()=> { localStorage.setItem("gcs-v4-theme", theme); }, [theme]);

  // Page + user context
  const [page, setPage] = useState<"home"|"agent"|"admin"|"feed"|"sandbox">("home");
  const [currentAgentId, setCurrentAgentId] = useState<string>("");

  // Metrics epochs live in a separate KV (Admin writes; Home reads too)
  const [metrics, setMetrics] = useState<MetricsEpoch>({});

  /* hydrate from KV (single-shot, safe lines; do not split) */
  useEffect(() => {
    (async () => {
      try {
        const core = await kvGet<{ accounts: Account[]; txns: Transaction[] }>(CORE_KEY);
        if (core?.accounts && core?.txns) {
          setAccounts(core.accounts); setTxns(core.txns);
        } else {
          setAccounts(SEED_ACCOUNTS); setTxns(SEED_TXNS);
          await kvSet(CORE_KEY, { accounts: SEED_ACCOUNTS, txns: SEED_TXNS });
        }
        setStock((await kvGet<Record<string, number>>(STOCK_KEY)) ?? {});
        setPins((await kvGet<Record<string, string>>(PINS_KEY)) ?? {});
        setGoals((await kvGet<Record<string, number>>(GOALS_KEY)) ?? {});
        setNotifs((await kvGet<Notification[]>(NOTIF_KEY)) ?? []);
        setEpochs((await kvGet<Record<string, string>>(EPOCHS_KEY)) ?? {});
        setMetrics((await kvGet<MetricsEpoch>(METRIC_KEY)) ?? {});
      } finally {
        setHydrated(true);
      }
    })();
  }, []);

  // live KV sync
  useEffect(() => {
    return onKVChange(async ({ key, val }) => {
      if (key === CORE_KEY) { const v = val ?? (await kvGet(CORE_KEY)) ?? { accounts: accounts, txns: txns }; setAccounts(v.accounts); setTxns(v.txns); }
      if (key === STOCK_KEY) setStock(val ?? (await kvGet(STOCK_KEY)) ?? {});
      if (key === PINS_KEY) setPins(val ?? (await kvGet(PINS_KEY)) ?? {});
      if (key === GOALS_KEY) setGoals(val ?? (await kvGet(GOALS_KEY)) ?? {});
      if (key === NOTIF_KEY) setNotifs(val ?? (await kvGet(NOTIF_KEY)) ?? []);
      if (key === EPOCHS_KEY) setEpochs(val ?? (await kvGet(EPOCHS_KEY)) ?? {});
      if (key === METRIC_KEY) setMetrics(val ?? (await kvGet(METRIC_KEY)) ?? {});
    });
  }, [accounts, txns]);

  // persist mirrors (safe)
  useEffect(() => { if (hydrated) kvSet(CORE_KEY, { accounts, txns }); }, [hydrated, accounts, txns]);
  useEffect(() => { if (hydrated) kvSet(STOCK_KEY, stock); }, [hydrated, stock]);
  useEffect(() => { if (hydrated) kvSet(PINS_KEY, pins); }, [hydrated, pins]);
  useEffect(() => { if (hydrated) kvSet(GOALS_KEY, goals); }, [hydrated, goals]);
  useEffect(() => { if (hydrated) kvSet(NOTIF_KEY, notifs); }, [hydrated, notifs]);
  useEffect(() => { if (hydrated) kvSet(EPOCHS_KEY, epochs); }, [hydrated, epochs]);
  useEffect(() => { if (hydrated) kvSet(METRIC_KEY, metrics); }, [hydrated, metrics]);

  /* computed balances (per-agent) */
  const balances = useMemo(() => {
    const map = new Map<string, number>();
    for (const a of accounts) map.set(a.id, 0);
    for (const t of txns) {
      if (t.kind === "credit" && t.toId) map.set(t.toId, (map.get(t.toId) || 0) + t.amount);
      if (t.kind === "debit"  && t.fromId) map.set(t.fromId, (map.get(t.fromId) || 0) - t.amount);
    }
    return map;
  }, [accounts, txns]);

  const getName = (id?: string) => accounts.find(a => a.id === id)?.name || "—";
  const isAdmin = true; // your PIN-gate can flip this; left true to expose controls (replace with your existing admin unlock)

  /* =========================== actions =========================== */

  function notify(text: string) {
    const newItem: Notification = { id: nid(), when: nowISO(), text };
    setNotifs(prev => [newItem, ...prev].slice(0, 200));
  }

  function postTxn(partial: Omit<Transaction, "id" | "dateISO">) {
    const t: Transaction = { id: nid(), dateISO: nowISO(), ...partial };
    setTxns(prev => [t, ...prev]);
    return t;
  }

  function addAgent(name: string) {
    const id = nid();
    setAccounts(prev => [...prev, { id, name, role: "agent" }]);
    notify(`👤 Added agent ${name}`);
    return id;
  }

  function adminCredit(agentId: string, ruleKey: string, qty=1) {
    const rule = PRODUCT_RULES.find(r => r.key === ruleKey); if (!rule) return;
    const amount = rule.gcsd * Math.max(1, qty);
    postTxn({ kind: "credit", amount, toId: agentId, memo: rule.label });
    notify(`🧾 Sale credit • ${getName(agentId)} +${amount} GCSD (${rule.label}${qty>1?` × ${qty}`:""})`);
  }

  function manualTransfer(toId: string, amount: number, note?: string) {
    postTxn({ kind: "credit", amount, toId, memo: note?.trim() || "Transfer" });
    notify(`🏦 Transfer to ${getName(toId)} +${amount} GCSD`);
  }

  function redeemPrize(agentId: string, prizeKey: string) {
    const prize = PRIZE_ITEMS.find(p => p.key === prizeKey); if (!prize) return;
    const bal = balances.get(agentId) || 0;
    if (bal < prize.price) return toast.error("Insufficient GCSD");
    // enforce active redeem count (2)
    const count = txns.filter(t => G_isRedeemTxn(t) && t.fromId === agentId && afterEpoch(epochs, agentId, t.dateISO) && G_isRedeemStillActive(t, txns)).length;
    if (count >= MAX_PRIZES_PER_AGENT) return toast.error(`Max ${MAX_PRIZES_PER_AGENT} active prizes`);
    postTxn({ kind: "debit", amount: prize.price, fromId: agentId, memo: `Redeem: ${prize.label}` });
    setStock(prev => ({ ...prev, [prizeKey]: Math.max(0, (prev[prizeKey] || 0) - 1) }));
    notify(`🎁 ${getName(agentId)} redeemed ${prize.label} (−${prize.price})`);
  }

  function undoRedemption(agentId: string, redeemTxnId: string) {
    const r = txns.find(t => t.id === redeemTxnId && G_isRedeemTxn(t)); if (!r) return;
    const label = r.memo!.replace(/^Redeem:\s*/, "");
    postTxn({ kind: "credit", amount: r.amount, toId: agentId, memo: `Reversal of redemption: ${label}` });
    // restore stock
    const prize = PRIZE_ITEMS.find(p => p.label === label);
    if (prize) setStock(prev => ({ ...prev, [prize.key]: (prev[prize.key] || 0) + 1 }));
    notify(`↩️ Undo redeem for ${getName(agentId)}: ${label}`);
  }

  function withdrawAgentCredit(agentId: string, creditTxnId: string) {
    const t = txns.find(x => x.id === creditTxnId && x.kind === "credit" && x.toId === agentId); if (!t) return;
    // post Reversal of sale
    postTxn({ kind: "debit", amount: t.amount, fromId: agentId, memo: `Reversal of sale: ${t.memo || "Sale"}`, meta: { reversesTxnId: t.id } });
    notify(`🧾 Reversed sale for ${getName(agentId)} (${t.memo || "Sale"})`);
  }

  function withdrawManual(agentId: string, amount: number, note?: string) {
    if (!agentId) return toast.error("Choose an agent");
    if (!amount || amount <= 0) return toast.error("Enter a positive amount");
    const bal = balances.get(agentId) || 0;
    if (bal < amount) return toast.error("Cannot withdraw more than current balance");
    postTxn({ kind: "debit", amount, fromId: agentId, memo: `Correction (withdraw): ${note?.trim() || "Manual correction"}` });
    notify(`🧾 Withdrawn ${amount} from ${getName(agentId)} (manual correction)`);
  }

  function resetAgentBalance(agentId: string) {
    const bal = balances.get(agentId) || 0;
    if (bal === 0) { setEpochs(prev => ({ ...prev, [agentId]: nowISO() })); return; }
    // post balancing txn and epoch
    if (bal > 0) postTxn({ kind: "debit", amount: bal, fromId: agentId, memo: "Balance reset to 0" });
    else postTxn({ kind: "credit", amount: -bal, toId: agentId, memo: "Balance reset to 0" });
    setEpochs(prev => ({ ...prev, [agentId]: nowISO() }));
    notify(`🗓️ Reset balance to 0 for ${getName(agentId)}`);
  }

  function resetMetric(kind: keyof MetricsEpoch) {
    setMetrics(prev => ({ ...prev, [kind]: nowISO() }));
    toast.success("Reset applied");
  }

  /* =========================== Render =========================== */

  return (
    <div className={classNames("min-h-screen", theme==="neon" ? "bg-[#0B0B0B] text-orange-50" : "bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100")}>
      {/* Topbar */}
      <div className={classNames("sticky top-0 z-10 backdrop-blur border-b", neonBox(theme))}>
        <div className="mx-auto max-w-6xl px-4 py-3 flex items-center gap-3">
          <HomeIcon className="w-5 h-5" />
          <div className="font-semibold">GCS Bank</div>
          <div className="flex-1" />
          <button className={classNames("px-3 py-1.5 rounded-xl", neonBtn(theme, page==="home"))} onClick={()=> setPage("home")}>Home</button>
          <button className={classNames("px-3 py-1.5 rounded-xl", neonBtn(theme, page==="agent"))} onClick={()=> setPage("agent")}><User className="w-4 h-4 inline mr-1" />Agent</button>
          <button className={classNames("px-3 py-1.5 rounded-xl", neonBtn(theme, page==="admin"))} onClick={()=> setPage("admin")}><Settings2 className="w-4 h-4 inline mr-1" />Admin</button>
          <button className={classNames("px-3 py-1.5 rounded-xl", neonBtn(theme, page==="feed"))} onClick={()=> setPage("feed")}>Feed</button>
          <button className={classNames("px-3 py-1.5 rounded-xl", neonBtn(theme, page==="sandbox"))} onClick={()=> setPage("sandbox")}>Sandbox</button>
          <div className="ml-3">
            <FancySelect theme={theme} value={theme} onChange={(v)=> setTheme(v as Theme)}>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
              <option value="neon">Neon</option>
            </FancySelect>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-4 py-6">
        {page === "home" && (
          <Home
            theme={theme}
            accounts={accounts}
            txns={txns}
            stock={stock}
            prizes={PRIZE_ITEMS}
            isAdmin={isAdmin}
            metrics={metrics}
            onResetMetric={resetMetric}
          />
        )}

        {page === "agent" && (
          <AgentPortal
            theme={theme}
            agentId={currentAgentId}
            accounts={accounts}
            txns={txns}
            stock={stock}
            prizes={PRIZE_ITEMS}
            goals={goals}
            onSetGoal={(amt)=> setGoals(prev => ({ ...prev, [currentAgentId]: amt }))}
            onRedeem={(k)=> redeemPrize(currentAgentId, k)}
            epochs={epochs}
          />
        )}

        {page === "admin" && (
          <AdminPortal
            theme={theme}
            accounts={accounts}
            txns={txns}
            stock={stock}
            prizes={PRIZE_ITEMS}
            balances={balances}
            onAddAgent={addAgent}
            onCredit={adminCredit}
            onTransfer={manualTransfer}
            onWithdrawSale={withdrawAgentCredit}
            onWithdrawManual={withdrawManual}
            onUndoRedemption={undoRedemption}
            onResetMetric={resetMetric}
            epochs={epochs}
          />
        )}

        {page === "feed" && <FeedPage theme={theme} notifs={notifs} />}

        {page === "sandbox" && <SandboxPage theme={theme} onExit={()=> setPage("home")} />}
      </div>
    </div>
  );
}

/* ===== Home page: charts & tiles (earned/spent 30d; star/leader; purchases list) ===== */

function Home({
  theme, accounts, txns, stock, prizes, isAdmin, metrics, onResetMetric,
}: {
  theme: Theme;
  accounts: Account[];
  txns: Transaction[];
  stock: Record<string, number>;
  prizes: PrizeItem[];
  isAdmin: boolean;
  metrics: MetricsEpoch;
  onResetMetric: (k: keyof MetricsEpoch) => void;
}) {
  const nonSystemIds = new Set(accounts.filter((a) => a.role !== "system").map((a) => a.id));

  /* Earned (credits minus corrections) in last 30 days; clamp daily ≥ 0 */
  const days: string[] = [];
  for (let i=29; i>=0; i--) { const d = new Date(); d.setDate(d.getDate()-i); days.push(d.toISOString().slice(0,10)); }

  const earnedByDay = new Map<string, number>(days.map(d => [d, 0]));
  const spentByDay  = new Map<string, number>(days.map(d => [d, 0]));

  for (const t of txns) {
    const dstr = t.dateISO.slice(0,10);
    if (!earnedByDay.has(dstr) || !spentByDay.has(dstr)) continue;

    if (t.kind === "credit" && t.toId && nonSystemIds.has(t.toId) && t.memo !== "Mint" && !G_isReversalOfRedemption(t) && afterISO(metrics.earned30d, t.dateISO)) {
      earnedByDay.set(dstr, (earnedByDay.get(dstr) || 0) + t.amount);
    }
    if (G_isCorrectionDebit(t) && t.fromId && nonSystemIds.has(t.fromId) && afterISO(metrics.earned30d, t.dateISO)) {
      earnedByDay.set(dstr, clampNonNeg((earnedByDay.get(dstr) || 0) - t.amount));
    }
    if (t.kind === "debit" && t.fromId && nonSystemIds.has(t.fromId) && !G_isCorrectionDebit(t) && afterISO(metrics.spent30d, t.dateISO)) {
      spentByDay.set(dstr, (spentByDay.get(dstr) || 0) + t.amount);
    }
  }

  const totalEarned = [...earnedByDay.values()].reduce((a,b)=> a+b, 0);
  const totalSpent  = [...spentByDay.values()].reduce((a,b)=> a+b, 0);

  /* Star of the Day / Leader of the Month (derived from txns; metric epochs applied) */
  const todayStr = new Date().toISOString().slice(0,10);
  const monthStr = new Date().toISOString().slice(0,7);

  const earnedToday: Record<string, number> = {};
  const earnedMonth: Record<string, number> = {};

  for (const t of txns) {
    if (!t.toId) continue;
    if (t.memo === "Mint") continue;
    const d = new Date(t.dateISO);
    if (!afterISO(metrics.starOfDay, t.dateISO) && !afterISO(metrics.leaderOfMonth, t.dateISO)) continue;

    const dStr = t.dateISO.slice(0,10);
    const mStr = t.dateISO.slice(0,7);

    if (t.kind === "credit" && !G_isReversalOfRedemption(t)) {
      if (dStr === todayStr) earnedToday[t.toId] = (earnedToday[t.toId] || 0) + t.amount;
      if (mStr === monthStr) earnedMonth[t.toId] = (earnedMonth[t.toId] || 0) + t.amount;
    }
    if (G_isCorrectionDebit(t) && t.fromId) {
      if (dStr === todayStr) earnedToday[t.fromId] = clampNonNeg((earnedToday[t.fromId] || 0) - t.amount);
      if (mStr === monthStr) earnedMonth[t.fromId] = clampNonNeg((earnedMonth[t.fromId] || 0) - t.amount);
    }
  }

  const starOfDay = Object.entries(earnedToday)
    .filter(([id]) => nonSystemIds.has(id))
    .sort((a,b)=> b[1]-a[1])[0];
  const leaderOfMonth = Object.entries(earnedMonth)
    .filter(([id]) => nonSystemIds.has(id))
    .sort((a,b)=> b[1]-a[1])[0];

  const starLabel = starOfDay ? `${(accounts.find(a=>a.id===starOfDay[0])?.name || "—")} • +${starOfDay[1].toLocaleString()} GCSD` : "—";
  const leaderLabel = leaderOfMonth ? `${(accounts.find(a=>a.id===leaderOfMonth[0])?.name || "—")} • +${leaderOfMonth[1].toLocaleString()} GCSD` : "—";

  /* Active purchases */
  const activeRedeems = txns.filter(t => G_isRedeemTxn(t) && t.fromId && G_isRedeemStillActive(t, txns));

  return (
    <div className="grid md:grid-cols-3 gap-4">
      <div className={classNames("rounded-2xl border p-4", neonBox(theme))}>
        <TileRow label="Total GCSD Earned (30d)" value={totalEarned} isAdmin={isAdmin} onReset={()=> onResetMetric("earned30d")} />
        <div className="mt-2 text-xs opacity-70">Daily values are clamped ≥ 0 after corrections.</div>
      </div>
      <div className={classNames("rounded-2xl border p-4", neonBox(theme))}>
        <TileRow label="Total GCSD Spent (30d)" value={totalSpent} isAdmin={isAdmin} onReset={()=> onResetMetric("spent30d")} />
      </div>
      <div className={classNames("rounded-2xl border p-4", neonBox(theme))}>
        <Highlight title="Star of the Day" value={starLabel} isAdmin={isAdmin} onReset={()=> onResetMetric("starOfDay")} />
        <div className="h-2" />
        <Highlight title="Leader of the Month" value={leaderLabel} isAdmin={isAdmin} onReset={()=> onResetMetric("leaderOfMonth")} />
      </div>

      <div className={classNames("rounded-2xl border p-4 md:col-span-3", neonBox(theme))}>
        <div className="text-sm opacity-70 mb-2">Purchased Prizes (Active)</div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {activeRedeems.length === 0 && <div className="opacity-60">No active redeems yet.</div>}
          {activeRedeems.map(t => (
            <div key={t.id} className={classNames("border rounded-xl px-3 py-2", neonBox(theme))}>
              <div className="text-sm">{t.memo!.replace(/^Redeem:\s*/, "")}</div>
              <div className="text-xs opacity-70">by {(accounts.find(a=>a.id===t.fromId)?.name)||"—"} • {t.amount.toLocaleString()} GCSD</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function TileRow({ label, value, isAdmin, onReset }: { label: string; value: number; isAdmin?: boolean; onReset?: ()=>void }) {
  return (
    <div>
      <div className="text-xs opacity-70 mb-1 flex items-center justify-between">
        <span>{label}</span>
        {isAdmin && onReset && (
          <button className="text-[11px] px-2 py-0.5 rounded-lg border hover:opacity-80" onClick={onReset}>Reset</button>
        )}
      </div>
      <div className="text-2xl font-semibold"><NumberFlash value={value} /> GCSD</div>
    </div>
  );
}
function Highlight({ title, value, isAdmin, onReset }: { title: string; value: string; isAdmin?: boolean; onReset?: ()=>void }) {
  return (
    <div>
      <div className="text-xs opacity-70 mb-1 flex items-center justify-between">
        <span>{title}</span>
        {isAdmin && onReset && (
          <button className="text-[11px] px-2 py-0.5 rounded-lg border hover:opacity-80" onClick={onReset}>Reset</button>
        )}
      </div>
      <div className="text-base">{value}</div>
    </div>
  );
}

/* ===== Agent portal ===== */
function AgentPortal({
  theme, agentId, accounts, txns, stock, prizes, goals, onSetGoal, onRedeem, epochs
}: {
  theme: Theme;
  agentId: string;
  accounts: Account[];
  txns: Transaction[];
  stock: Record<string, number>;
  prizes: PrizeItem[];
  goals: Record<string, number>;
  onSetGoal: (amt: number) => void;
  onRedeem: (k: string)=> void;
  epochs: Record<string, string>;
}) {
  const agentIds = accounts.filter(a => a.role !== "system");
  const currentId = agentId || agentIds[0]?.id || "";
  const name = accounts.find(a => a.id === currentId)?.name || "—";

  const agentTxns = txns.filter(t => (t.toId === currentId || t.fromId === currentId) && afterEpoch(epochs, currentId, t.dateISO));
  const balance = agentTxns.reduce((sum, t) => sum + (t.kind==="credit" && t.toId===currentId ? t.amount : 0) - (t.kind==="debit" && t.fromId===currentId ? t.amount : 0), 0);

  const prizeCount = txns.filter((t)=> G_isRedeemTxn(t) && t.fromId===currentId && afterEpoch(epochs, currentId, t.dateISO) && G_isRedeemStillActive(t, txns)).length;

  return (
    <div className="grid md:grid-cols-3 gap-4">
      <div className={classNames("rounded-2xl border p-4", neonBox(theme))}>
        <div className="text-xs opacity-70 mb-1">Agent</div>
        <div className="mb-2">{name}</div>
        <div className="text-sm opacity-70 mb-1">Balance</div>
        <div className="text-2xl font-semibold"><NumberFlash value={balance} /> GCSD</div>
      </div>

      <div className={classNames("rounded-2xl border p-4 md:col-span-2", neonBox(theme))}>
        <div className="text-sm opacity-70 mb-2"><Gift className="w-4 h-4 inline mr-1" />Shop (active {prizeCount}/{MAX_PRIZES_PER_AGENT})</div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {prizes.map(p => (
            <div key={p.key} className={classNames("border rounded-xl p-3", neonBox(theme))}>
              <div className="font-medium">{p.label}</div>
              <div className="text-xs opacity-70 mb-2">{p.price.toLocaleString()} GCSD</div>
              <button className={classNames("px-3 py-1.5 rounded-xl", neonBtn(theme, true))} onClick={()=> onRedeem(p.key)}>Redeem</button>
            </div>
          ))}
        </div>
      </div>

      <div className={classNames("rounded-2xl border p-4 md:col-span-3", neonBox(theme))}>
        <div className="text-sm opacity-70 mb-2">Recent activity</div>
        <div className="space-y-2 max-h-[360px] overflow-auto pr-2">
          {agentTxns.length === 0 && <div className="opacity-60">No activity yet.</div>}
          {agentTxns.map(t => (
            <div key={t.id} className={classNames("border rounded-xl px-3 py-2 flex items-center justify-between", neonBox(theme))}>
              <div>
                <div className="text-sm">
                  {t.kind === "credit" ? "+" : "−"}{t.amount.toLocaleString()} • {t.memo || (t.kind==="credit"?"Credit":"Debit")}
                </div>
                <div className="text-xs opacity-70">{new Date(t.dateISO).toLocaleString()}</div>
              </div>
              {G_isRedeemTxn(t) && G_isRedeemStillActive(t, txns) && (
                <button className={classNames("px-3 py-1.5 rounded-xl", neonBtn(theme, true))} onClick={()=> toast.info("Undo redeem from Admin page")}>
                  <RotateCcw className="w-4 h-4 inline mr-1" />Undo
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ===== Admin portal ===== */
function AdminPortal({
  theme, accounts, txns, stock, prizes, balances,
  onAddAgent, onCredit, onTransfer, onWithdrawSale, onWithdrawManual, onUndoRedemption, onResetMetric, epochs
}: {
  theme: Theme;
  accounts: Account[];
  txns: Transaction[];
  stock: Record<string, number>;
  prizes: PrizeItem[];
  balances: Map<string, number>;
  onAddAgent: (name: string)=> string | void;
  onCredit: (agentId: string, ruleKey: string, qty?: number)=> void;
  onTransfer: (toId: string, amount: number, note?: string)=> void;
  onWithdrawSale: (agentId: string, creditTxnId: string)=> void;
  onWithdrawManual: (agentId: string, amount: number, note?: string)=> void;
  onUndoRedemption: (agentId: string, redeemTxnId: string)=> void;
  onResetMetric: (k: keyof MetricsEpoch)=> void;
  epochs: Record<string, string>;
}) {
  const [tab, setTab] = useState<"dashboard"|"sales"|"corrections"|"users"|"stock">("dashboard");
  const [agentId, setAgentId] = useState<string>(accounts.find(a=>a.role!=="system")?.id || "");
  const [qty, setQty] = useState("1");
  const [note, setNote] = useState("");
  const [amt, setAmt] = useState("");
  const [manualAmt, setManualAmt] = useState("");
  const [manualNote, setManualNote] = useState("");

  const nonSystemAgents = accounts.filter(a => a.role !== "system");

  const agentCredits = txns.filter(t => t.kind === "credit" && t.toId === agentId && t.memo !== "Mint" && G_isSaleStillActive(t, txns));
  const agentRedeems = txns.filter(t => G_isRedeemTxn(t) && t.fromId === agentId);

  return (
    <div className="space-y-4">
      {/* Tabs */}
      <div className="flex gap-2">
        {["dashboard","sales","corrections","users","stock"].map(k => (
          <button key={k} className={classNames("px-3 py-1.5 rounded-xl", neonBtn(theme, tab===k as any))} onClick={()=> setTab(k as any)}>{k}</button>
        ))}
      </div>

      {tab === "dashboard" && (
        <div className="grid md:grid-cols-3 gap-4">
          {/* Quick metrics reset */}
          <div className={classNames("rounded-2xl border p-4", neonBox(theme))}>
            <div className="text-sm opacity-70 mb-2">Reset metrics</div>
            <div className="grid gap-2">
              <button className={classNames("px-3 py-2 rounded-xl", neonBtn(theme, true))} onClick={()=> onResetMetric("earned30d")}>Reset “Total GCSD Earned (30d)”</button>
              <button className={classNames("px-3 py-2 rounded-xl", neonBtn(theme, true))} onClick={()=> onResetMetric("spent30d")}>Reset “Total GCSD Spent (30d)”</button>
              <button className={classNames("px-3 py-2 rounded-xl", neonBtn(theme, true))} onClick={()=> onResetMetric("starOfDay")}>Reset “Star of the Day”</button>
              <button className={classNames("px-3 py-2 rounded-xl", neonBtn(theme, true))} onClick={()=> onResetMetric("leaderOfMonth")}>Reset “Leader of the Month”</button>
            </div>
          </div>

          {/* Simple balances viewer */}
          <div className={classNames("rounded-2xl border p-4 md:col-span-2", neonBox(theme))}>
            <div className="text-sm opacity-70 mb-2">Balances</div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {nonSystemAgents.map(a => (
                <div key={a.id} className={classNames("border rounded-xl px-3 py-2", neonBox(theme))}>
                  <div className="text-sm">{a.name}</div>
                  <div className="text-xs opacity-70">{(balances.get(a.id)||0).toLocaleString()} GCSD</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {tab === "sales" && (
        <div className={classNames("rounded-2xl border p-4", neonBox(theme))}>
          <div className="grid sm:grid-cols-3 gap-3">
            <div>
              <div className="text-xs opacity-70 mb-1">Agent</div>
              <FancySelect theme={theme} value={agentId} onChange={setAgentId} placeholder="Choose agent…">
                {nonSystemAgents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </FancySelect>
            </div>
            <div>
              <div className="text-xs opacity-70 mb-1">Product</div>
              <FancySelect theme={theme} value={note} onChange={setNote} placeholder="Choose product…">
                {PRODUCT_RULES.map(r => <option key={r.key} value={r.key}>{r.label} (+{r.gcsd})</option>)}
              </FancySelect>
            </div>
            <div>
              <div className="text-xs opacity-70 mb-1">Qty</div>
              <input className={inputCls(theme)} value={qty} onChange={(e)=> setQty(e.target.value.replace(/[^\d]/g,""))} placeholder="1" />
            </div>
          </div>
          <div className="mt-3">
            <button className={classNames("px-3 py-2 rounded-xl", neonBtn(theme, true))} onClick={()=> {
              if (!agentId || !note) return toast.error("Select agent and product");
              onCredit(agentId, note, parseInt(qty||"1",10) || 1);
            }}>Add Sale</button>
          </div>
        </div>
      )}

      {tab === "corrections" && (
        <div className="grid md:grid-cols-2 gap-4">
          <div className={classNames("rounded-2xl border p-4", neonBox(theme))}>
            <div className="text-sm opacity-70 mb-2">Withdraw from a prior sale</div>
            <div className="mb-3">
              <div className="text-xs opacity-70 mb-1">Agent</div>
              <FancySelect theme={theme} value={agentId} onChange={setAgentId} placeholder="Choose agent…">
                {nonSystemAgents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </FancySelect>
            </div>
            <div className="space-y-2 max-h-[280px] overflow-auto pr-2">
              {agentId && agentCredits.length>0 ? agentCredits.map(t => (
                <div key={t.id} className={classNames("border rounded-xl px-3 py-2 flex items-center justify-between", neonBox(theme))}>
                  <div className="text-sm">{t.memo || "Sale"} • +{t.amount.toLocaleString()} GCSD</div>
                  <button className={classNames("px-3 py-1.5 rounded-xl", neonBtn(theme, true))} onClick={()=> onWithdrawSale(agentId, t.id)}>
                    <RotateCcw className="w-4 h-4 inline mr-1" />Withdraw
                  </button>
                </div>
              )) : <div className="opacity-60">No active credits.</div>}
            </div>
          </div>

          <div className={classNames("rounded-2xl border p-4", neonBox(theme))}>
            <div className="text-sm opacity-70 mb-2">Manual withdraw</div>
            <div className="grid sm:grid-cols-3 gap-3">
              <div>
                <div className="text-xs opacity-70 mb-1">Agent</div>
                <FancySelect theme={theme} value={agentId} onChange={setAgentId} placeholder="Choose agent…">
                  {nonSystemAgents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </FancySelect>
              </div>
              <div>
                <div className="text-xs opacity-70 mb-1">Amount</div>
                <input className={inputCls(theme)} value={manualAmt} onChange={(e)=> setManualAmt(e.target.value.replace(/[^\d]/g,""))} placeholder="Amount" />
              </div>
              <div>
                <div className="text-xs opacity-70 mb-1">Note</div>
                <input className={inputCls(theme)} value={manualNote} onChange={(e)=> setManualNote(e.target.value)} placeholder="(optional)" />
              </div>
            </div>
            <div className="mt-3">
              <button className={classNames("px-3 py-2 rounded-xl", neonBtn(theme, true))} onClick={()=> onWithdrawManual(agentId, parseInt(manualAmt||"0",10), manualNote)}>
                Withdraw amount
              </button>
            </div>

            <div className="mt-6">
              <div className="text-sm opacity-70 mb-2">Undo redemptions</div>
              <div className="space-y-2 max-h-[200px] overflow-auto pr-2">
                {agentId && agentRedeems.length>0 ? agentRedeems.map(t => (
                  <div key={t.id} className={classNames("border rounded-xl px-3 py-2 flex items-center justify-between", neonBox(theme))}>
                    <div className="text-sm">{t.memo!.replace(/^Redeem:\s*/, "")} • −{t.amount.toLocaleString()} GCSD</div>
                    <button className={classNames("px-3 py-1.5 rounded-xl", neonBtn(theme, true))} onClick={()=> onUndoRedemption(agentId, t.id)}>
                      <RotateCcw className="w-4 h-4 inline mr-1" />Undo
                    </button>
                  </div>
                )) : <div className="opacity-60">No redeems.</div>}
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === "users" && (
        <div className={classNames("rounded-2xl border p-4", neonBox(theme))}>
          <div className="text-sm opacity-70 mb-2">Agents</div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {nonSystemAgents.map(a => (
              <div key={a.id} className={classNames("border rounded-xl px-3 py-2 flex items-center justify-between", neonBox(theme))}>
                <div className="text-sm">{a.name}</div>
                <button className={classNames("px-3 py-1.5 rounded-xl", neonBtn(theme, true))} onClick={()=> resetAgentBalance(a.id)}>Reset Balance</button>
              </div>
            ))}
          </div>
          <div className="mt-4">
            <button className={classNames("px-3 py-2 rounded-xl", neonBtn(theme, true))} onClick={()=> {
              const n = prompt("New agent name?"); if (!n) return;
              onAddAgent(n);
              toast.success("Agent added");
            }}>Add Agent</button>
          </div>
        </div>
      )}

      {tab === "stock" && (
        <div className={classNames("rounded-2xl border p-4", neonBox(theme))}>
          <div className="text-sm opacity-70 mb-2">Prize stock</div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {prizes.map(p => (
              <div key={p.key} className={classNames("border rounded-xl p-3", neonBox(theme))}>
                <div className="font-medium">{p.label}</div>
                <div className="text-xs opacity-70 mb-2">In stock: {stock[p.key] ?? 0}</div>
                <button className={classNames("px-3 py-1.5 rounded-xl mr-2", neonBtn(theme, true))} onClick={()=> toast.info("Adjust stock from your existing UI/flow")}>Adjust</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ===== Feed & Sandbox (minimal) ===== */

function FeedPage({ theme, notifs }: { theme: Theme; notifs: Notification[] }) {
  return (
    <div className={classNames("rounded-2xl border p-4", neonBox(theme))}>
      <div className="text-sm opacity-70 mb-2">Activity Feed</div>
      <div className="space-y-2 max-h-[480px] overflow-auto pr-2">
        {notifs.length === 0 && <div className="opacity-60">Nothing yet.</div>}
        {notifs.map(n => (
          <div key={n.id} className={classNames("border rounded-xl px-3 py-2", neonBox(theme))}>
            <div className="text-sm">{n.text}</div>
            <div className="text-xs opacity-70">{new Date(n.when).toLocaleString()}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SandboxPage({ theme, onExit }: { theme: Theme; onExit: ()=>void }) {
  return (
    <div className={classNames("rounded-2xl border p-6 text-center", neonBox(theme))}>
      <div className="text-lg font-semibold mb-2">Sandbox Mode</div>
      <div className="opacity-70 mb-4">Home button does not exit sandbox. Use explicit exit.</div>
      <button className={classNames("px-3 py-2 rounded-xl", neonBtn(theme, true))} onClick={onExit}>Exit Sandbox</button>
    </div>
  );
}

/* =========================== End =========================== */
