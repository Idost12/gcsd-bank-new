import React, { useEffect, useMemo, useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Toaster, toast } from "sonner";
import {
  Wallet, Gift, History, Sparkles, UserCircle2, Lock, Check, X, Sun, Moon,
  Users, Home as HomeIcon, RotateCcw, Bell, Flame, Plus, Shield, Zap, ChevronDown
} from "lucide-react";
import { kvGetRemember as kvGet, kvSetIfChanged as kvSet, onKVChange } from "./lib/db";

/* ===========================
   G C S  B A N K
   =========================== */

const APP_NAME = "GCS Bank";
const LOGO_URL = "/logo.png"; // put high-res in /public/logo.png

type Theme  = "light" | "dark" | "neon";
type Portal = "home" | "agent" | "admin" | "sandbox" | "feed";

type TxnKind = "credit" | "debit";
type Transaction = {
  id: string;
  kind: TxnKind;
  amount: number;
  memo?: string;
  dateISO: string;
  fromId?: string;
  toId?: string;
  meta?: Record<string, any>;
};
type Account = { id: string; name: string; role?: "system"|"agent" };
type ProductRule = { key: string; label: string; gcsd: number };
type PrizeItem   = { key: string; label: string; price: number };
type Notification = { id: string; when: string; text: string };

const MAX_PRIZES_PER_AGENT = 2;

const AGENT_NAMES = [
  "Ben Mills","Oliver Steele","Maya Graves","Stan Harris","Frank Collins","Michael Wilson",
  "Caitlyn Stone","Rebecca Brooks","Logan Noir","Christopher O'Connor","Viktor Parks",
  "Hope Marshall","Justin Frey","Kevin Nolan","Sofie Roy"
];

const PRODUCT_RULES: ProductRule[] = [
  { key: "small_collection",         label: "Small Collection",          gcsd: 190 },
  { key: "big_whv",                  label: "Big WHV",                   gcsd: 320 },
  { key: "full_evaluation",          label: "Full Evaluation",           gcsd: 500 },
  { key: "big_partial_evaluation",   label: "Big Partial Evaluation",    gcsd: 350 },
  { key: "small_partial_evaluation", label: "Small Partial Evaluation",  gcsd: 220 },
  { key: "student_visa",             label: "Student Visa",              gcsd: 150 },
  { key: "tourist_visa",             label: "Tourist Visa",              gcsd: 120 },
  { key: "big_collection",           label: "Big Collection",            gcsd: 280 },
  { key: "small_whv",                label: "Small WHV",                 gcsd: 200 },
];

const PRIZE_ITEMS: PrizeItem[] = [
  { key: "airfryer",        label: "Philips Airfryer",        price: 6000 },
  { key: "soundbar",        label: "LG Soundbar",             price: 11000 },
  { key: "burger_lunch",    label: "Burger Lunch",            price: 650  },
  { key: "voucher_50",      label: "Cash Voucher (50 лв)",    price: 3000  },
  { key: "poker",           label: "Texas Poker Set",         price: 1200  },
  { key: "soda_maker",      label: "Philips Soda Maker",      price: 5200  },
  { key: "magsafe",         label: "MagSafe Charger",         price: 600  },
  { key: "galaxy_fit3",     label: "Samsung Galaxy Fit 3",    price: 5000 },
  { key: "cinema_tickets",  label: "Cinema Tickets",          price: 800  },
  { key: "neo_massager",    label: "Neo Massager",            price: 1400 },
  { key: "logi_g102",       label: "Logitech G102 Mouse",     price: 1900  },
  { key: "flight_madrid",   label: "Flight to Madrid",        price: 11350 },
  { key: "flight_london",   label: "Flight to London",        price: 11350 },
  { key: "flight_milan",    label: "Flight to Milan",         price: 11350 },
];

const INITIAL_STOCK: Record<string, number> = {
  airfryer: 1, soundbar: 1, burger_lunch: 2, voucher_50: 1, poker: 1,
  soda_maker: 1, magsafe: 1, galaxy_fit3: 1, cinema_tickets: 2, neo_massager: 1, logi_g102: 1,
  flight_madrid: 1, flight_london: 1, flight_milan: 1,
};

/* ---------- helpers ---------- */
const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
const nowISO = () => new Date().toISOString();
const fmtTime = (d: Date) => [d.getHours(), d.getMinutes(), d.getSeconds()].map(n => String(n).padStart(2,"0")).join(":");
const fmtDate = (d: Date) => d.toLocaleDateString(undefined, {year:"numeric", month:"short", day:"2-digit" });
const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;

function mergeTxns(local: Transaction[], remote: Transaction[]) {
  const map = new Map<string, Transaction>();
  for (const t of remote) map.set(t.id, t);
  for (const t of local) map.set(t.id, t); // local wins
  const all = Array.from(map.values());
  all.sort((a,b)=> new Date(b.dateISO).getTime() - new Date(a.dateISO).getTime());
  return all;
}
function mergeAccounts(local: Account[], remote: Account[]) {
  const map = new Map<string, Account>();
  for (const a of remote) map.set(a.id, a);
  for (const a of local) map.set(a.id, a);
  return Array.from(map.values());
}
const isCorrectionDebit = (t: Transaction) =>
  t.kind === "debit" && !!t.memo && (
    t.memo.startsWith("Reversal of sale") ||
    t.memo.startsWith("Correction (withdraw)") ||
    t.memo.startsWith("Balance reset to 0")
  );

/* ---------- seed ---------- */
const seedAccounts: Account[] = [
  { id: uid(), name: "Bank Vault", role: "system" },
  ...AGENT_NAMES.map(n => ({ id: uid(), name: n, role: "agent" as const })),
];
const VAULT_ID = seedAccounts[0].id;
const seedTxns: Transaction[] = [
  { id: uid(), kind: "credit", amount: 8000, memo: "Mint", dateISO: nowISO(), toId: VAULT_ID },
];

/* ---------- Small animated number ---------- */
function NumberFlash({ value }:{ value:number }) {
  const prev = useRef(value);
  const [pulse, setPulse] = useState<"up"|"down"|"none">("none");

  useEffect(()=>{
    if (value > prev.current) { setPulse("up"); setTimeout(()=>setPulse("none"), 500); }
    else if (value < prev.current) { setPulse("down"); setTimeout(()=>setPulse("none"), 500); }
    prev.current = value;
  }, [value]);

  return (
    <motion.span
      key={value}
      initial={{ y: 4, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: .15 }}
      className={pulse==="up" ? "text-emerald-500" : pulse==="down" ? "text-rose-500" : undefined}
    >
      {value.toLocaleString()} GCSD
    </motion.span>
  );
}

/* =================================
   App
   ================================= */
export default function GCSDApp() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [txns, setTxns] = useState<Transaction[]>([]);
  const [stock, setStock] = useState<Record<string, number>>({});
  const [pins, setPins] = useState<Record<string, string>>({});
  const [goals, setGoals] = useState<Record<string, number>>({});
  const [notifs, setNotifs] = useState<Notification[]>([]);
  const [hydrated, setHydrated] = useState(false);

  const [theme, setTheme] = useState<Theme>((localStorage.getItem("gcs-v4-theme") as Theme) || "light");
  const [portal, setPortal] = useState<Portal>("home");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminPin, setAdminPin] = useState<string>("");
  const [currentAgentId, setCurrentAgentId] = useState<string>("");

  const [showIntro, setShowIntro] = useState(true);
  const [clock, setClock] = useState(fmtTime(new Date()));
  const [dateStr, setDateStr] = useState(fmtDate(new Date()));

  const [adminTab, setAdminTab] = useState<"dashboard"|"addsale"|"transfer"|"corrections"|"history"|"users">("dashboard");
  const [sandboxActive, setSandboxActive] = useState(false);
  const [receipt, setReceipt] = useState<{id:string; when:string; buyer:string; item:string; amount:number} | null>(null);
  const [pinModal, setPinModal] = useState<{open:boolean; agentId?:string; onOK?:(good:boolean)=>void}>({open:false});
  const [unread, setUnread] = useState(0);

  // theme side effect
  useEffect(() => {
    localStorage.setItem("gcs-v4-theme", theme);
    const root = document.documentElement;
    if (theme === "dark" || theme === "neon") root.classList.add("dark"); else root.classList.remove("dark");
  }, [theme]);

  /* hydrate from KV once on mount */
  useEffect(() => {
    (async () => {
      try {
        const core = await kvGet<{ accounts: Account[]; txns: Transaction[] }>("gcs-v4-core");
        if (core?.accounts && core?.txns) {
          setAccounts(core.accounts);
          setTxns(core.txns);
        } else {
          setAccounts(seedAccounts);
          setTxns(seedTxns);
          await kvSet("gcs-v4-core", { accounts: seedAccounts, txns: seedTxns });
        }
        setStock((await kvGet<Record<string, number>>("gcs-v4-stock")) ?? INITIAL_STOCK);
        setPins((await kvGet<Record<string, string>>("gcs-v4-pins")) ?? {});
        setGoals((await kvGet<Record<string, number>>("gcs-v4-goals")) ?? {});
        setNotifs((await kvGet<Notification[]>("gcs-v4-notifs")) ?? []);
      } finally {
        setHydrated(true);
      }
    })();
  }, []);

  /* realtime sync: merge (do not overwrite local) */
  useEffect(() => {
    const off = onKVChange(async ({ key, val }) => {
      if (!key) return;
      if (key === "gcs-v4-core") {
        const remote = (val ?? (await kvGet("gcs-v4-core"))) as {accounts: Account[]; txns: Transaction[]} | null;
        if (!remote) return;
        setAccounts(prev => mergeAccounts(prev, remote.accounts || []));
        setTxns(prev => mergeTxns(prev, remote.txns || []));
        return;
      }
      if (key === "gcs-v4-stock")  setStock(val ?? (await kvGet("gcs-v4-stock")) ?? {});
      if (key === "gcs-v4-pins")   setPins(val ?? (await kvGet("gcs-v4-pins")) ?? {});
      if (key === "gcs-v4-goals")  setGoals(val ?? (await kvGet("gcs-v4-goals")) ?? {});
      if (key === "gcs-v4-notifs") setNotifs(val ?? (await kvGet("gcs-v4-notifs")) ?? []);
    });
    return off;
  }, []);

  /* persist on changes */
  useEffect(() => { if (hydrated) kvSet("gcs-v4-core",  { accounts, txns }); }, [hydrated, accounts, txns]);
  useEffect(() => { if (hydrated) kvSet("gcs-v4-stock", stock);             }, [hydrated, stock]);
  useEffect(() => { if (hydrated) kvSet("gcs-v4-pins",  pins);              }, [hydrated, pins]);
  useEffect(() => { if (hydrated) kvSet("gcs-v4-goals", goals);             }, [hydrated, goals]);
  useEffect(() => { if (hydrated) kvSet("gcs-v4-notifs", notifs);           }, [hydrated, notifs]);

  /* clock + intro */
  useEffect(()=> {
    const t = setInterval(()=> { const d=new Date(); setClock(fmtTime(d)); setDateStr(fmtDate(d)); }, 1000);
    return ()=> clearInterval(t);
  }, []);
  useEffect(()=> {
    if (!showIntro) return;
    const timer = setTimeout(()=> setShowIntro(false), 2000);
    const onKey = (e: KeyboardEvent)=> { if (e.key === "Enter") setShowIntro(false); };
    window.addEventListener("keydown", onKey);
    return ()=> { clearTimeout(timer); window.removeEventListener("keydown", onKey); };
  }, [showIntro]);

  /* derived */
  const balances = useMemo(()=>computeBalances(accounts, txns), [accounts, txns]);
  const nonSystemIds = new Set(accounts.filter(a=>a.role!=="system").map(a=>a.id));

  const agent = accounts.find(a=>a.id===currentAgentId);
  const agentTxns = txns.filter(t=> t.fromId===currentAgentId || t.toId===currentAgentId);
  const agentBalance = balances.get(currentAgentId)||0;
  const lifetimeEarn = agentTxns
    .filter(t=> t.kind==="credit" && t.toId===currentAgentId && t.memo!=="Mint")
    .reduce((a,b)=>a+b.amount,0)
    - agentTxns.filter(t=> isCorrectionDebit(t) && t.fromId===currentAgentId).reduce((a,b)=>a+b.amount,0);
  const lifetimeSpend = agentTxns.filter(t=> t.kind==="debit"  && t.fromId===currentAgentId && !isCorrectionDebit(t)).reduce((a,b)=>a+b.amount,0);
  const prizeCount = agentTxns.filter(t=> t.kind==="debit" && (t.memo||"").startsWith("Redeem:")).length;

  // leaderboard + streaks
  const dayBuckets = bucketByDay(txns, nonSystemIds);
  const streaks = computeStreaks(dayBuckets);
  const leaderboard = Array.from(nonSystemIds).map(id => {
    const credited = txns.filter(t=> t.kind==="credit" && t.toId===id && t.memo!=="Mint").reduce((a,b)=>a+b.amount,0);
    const withdrawn = txns.filter(t=> isCorrectionDebit(t) && t.fromId===id).reduce((a,b)=>a+b.amount,0);
    const earned = Math.max(0, credited - withdrawn); // never negative on board
    return { id, name: accounts.find(a=>a.id===id)?.name || "—", earned, streak: streaks[id]||0 };
  }).sort((a,b)=> b.earned - a.earned);

  // star of the day / leader of month
  const todayKey = new Date().toLocaleDateString();
  const curMonth  = monthKey(new Date());
  const earnedToday: Record<string, number> = {}, earnedMonth: Record<string, number> = {};
  for (const t of txns) {
    if (t.kind!=="credit" || !t.toId || t.memo==="Mint" || !nonSystemIds.has(t.toId)) continue;
    const d = new Date(t.dateISO);
    if (d.toLocaleDateString() === todayKey) earnedToday[t.toId] = (earnedToday[t.toId]||0) + t.amount;
    if (monthKey(d) === curMonth)           earnedMonth[t.toId] = (earnedMonth[t.toId]||0) + t.amount;
  }
  const starId   = Object.entries(earnedToday).sort((a,b)=>b[1]-a[1])[0]?.[0];
  const leaderId = Object.entries(earnedMonth).sort((a,b)=>b[1]-a[1])[0]?.[0];
  const starOfDay = starId ? { name: accounts.find(a=>a.id===starId)?.name || "—", amount: earnedToday[starId] } : null;
  const leaderOfMonth = leaderId ? { name: accounts.find(a=>a.id===leaderId)?.name || "—", amount: earnedMonth[leaderId] } : null;

  /* helpers bound to state */
  const postTxn = (partial: Partial<Transaction> & Pick<Transaction,"kind"|"amount">) =>
    setTxns(prev => [{ id: uid(), dateISO: nowISO(), memo: "", ...partial }, ...prev ]);
  const notify = (text:string) => {
    setNotifs(prev => [{ id: uid(), when: nowISO(), text }, ...prev].slice(0,200));
    setUnread(c => c + 1);
  };
  const getName = (id:string) => accounts.find(a=>a.id===id)?.name || "—";
  const openAgentPin = (agentId:string, cb:(ok:boolean)=>void) => setPinModal({open:true, agentId, onOK:cb});

  /* ---- safety + admin helpers ------------------------------------------- */

  // never let an agent go negative; return false if blocked
  const safeDebit = (agentId: string, amount: number, memo: string) => {
    const bal = balances.get(agentId) || 0;
    if (amount > bal) {
      toast.error("Insufficient balance — cannot go negative");
      return false;
    }
    postTxn({ kind: "debit", amount, fromId: agentId, memo });
    return true;
  };

  // completely wipe ONE agent's history and settings
  const wipeAgent = (agentId: string) => {
    setTxns(prev => prev.filter(t => t.fromId !== agentId && t.toId !== agentId));
    setGoals(prev => { const n = { ...prev }; delete n[agentId]; return n; });
    setPins(prev  => { const n = { ...prev }; delete n[agentId]; return n; });
    notify(`🧹 Wiped history and settings for ${getName(agentId)} (balance reset)`);
    toast.success("Agent history wiped & balance reset");
  };

  // wipe EVERYTHING (will be guarded by extra PIN in UI)
  const doFactoryReset = async () => {
    setAccounts(seedAccounts);
    setTxns(seedTxns);
    setStock(INITIAL_STOCK);
    setPins({});
    setGoals({});
    setNotifs([]);
    await kvSet("gcs-v4-core", { accounts: seedAccounts, txns: seedTxns });
    await kvSet("gcs-v4-stock", INITIAL_STOCK);
    await kvSet("gcs-v4-pins", {});
    await kvSet("gcs-v4-goals", {});
    await kvSet("gcs-v4-notifs", []);
    toast.success("Factory reset complete");
    notify("🧨 System factory reset executed");
  };

  /* actions */
  function adminCredit(agentId:string, ruleKey:string, qty:number){
    if (!isAdmin) return toast.error("Admin only");
    const rule = PRODUCT_RULES.find(r=>r.key===ruleKey); if (!rule) return;
    if (!agentId) return toast.error("Choose agent");
    const amount = rule.gcsd * Math.max(1, qty||1);
    postTxn({ kind:"credit", amount, toId: agentId, memo:`${rule.label}${qty>1?` x${qty}`:""}`, meta:{product:rule.key, qty} });
    notify(`➕ ${getName(agentId)} credited +${amount} GCSD for ${rule.label}${qty>1?` ×${qty}`:""}`);
    toast.success(`Added ${amount} GCSD to ${getName(agentId)}`);
  }

  function manualTransfer(agentId:string, amount:number, note:string){
    if (!isAdmin) return toast.error("Admin only");
    if (!agentId || !amount || amount<=0) return toast.error("Enter agent and amount");
    postTxn({ kind:"credit", amount, toId: agentId, memo: note || "Manual transfer" });
    notify(`➕ ${getName(agentId)} credited +${amount} GCSD (manual)`);
    toast.success(`Transferred ${amount} GCSD to ${getName(agentId)}`);
  }

  function redeemPrize(agentId:string, prizeKey:string){
    const prize = PRIZE_ITEMS.find(p=>p.key===prizeKey); if(!prize) return;
    const left = stock[prizeKey] ?? 0;
    const bal  = balances.get(agentId)||0;
    const count= txns.filter(t=> t.kind==="debit" && t.fromId===agentId && (t.memo||"").startsWith("Redeem:")).length;
    if (count >= MAX_PRIZES_PER_AGENT) return toast.error(`Limit reached (${MAX_PRIZES_PER_AGENT})`);
    if (left <= 0) return toast.error("Out of stock");
    if (bal  < prize.price) return toast.error("Insufficient balance");

    openAgentPin(agentId, (ok)=>{
      if (!ok) return toast.error("Wrong PIN");
      if (!safeDebit(agentId, prize.price, `Redeem: ${prize.label}`)) return;
      setStock(s=> ({...s, [prizeKey]: left-1}));
      notify(`🎁 ${getName(agentId)} redeemed ${prize.label} (−${prize.price} GCSD)`);
      confettiBurst();
      setReceipt({ id: "ORD-" + Math.random().toString(36).slice(2,7).toUpperCase(),
                   when: new Date().toLocaleString(), buyer: getName(agentId), item: prize.label, amount: prize.price });
      toast.success(`Redeemed ${prize.label}`);
    });
  }

  function undoSale(txId:string){
    if (!isAdmin) return toast.error("Admin only");
    const t = txns.find(x=>x.id===txId); if (!t || t.kind!=="credit" || !t.toId) return;
    postTxn({ kind:"debit", amount: t.amount, fromId: t.toId, memo:`Reversal of sale: ${t.memo}` });
    notify(`↩️ Reversed sale for ${getName(t.toId)} (−${t.amount})`);
    toast.success("Sale reversed");
  }

  function undoRedemption(txId:string){
    if (!isAdmin) return toast.error("Admin only");
    const t = txns.find(x=>x.id===txId); if (!t || t.kind!=="debit" || !t.fromId) return;
    const label = (t.memo||"").replace("Redeem: ","");
    const prize = PRIZE_ITEMS.find(p=>p.label===label);
    postTxn({ kind:"credit", amount: t.amount, toId: t.fromId, memo:`Reversal of redemption: ${label}` });
    if (prize) setStock(s=> ({...s, [prize.key]: (s[prize.key]??0)+1}));
    notify(`↩️ Reversed redemption for ${getName(t.fromId)} (+${t.amount})`);
    toast.success("Redemption reversed & stock restored");
  }

  function withdrawAgentCredit(agentId:string, txId:string){
    if (!isAdmin) return toast.error("Admin only");
    const t = txns.find(x=>x.id===txId);
    if (!t || t.kind!=="credit" || t.toId!==agentId) return toast.error("Choose a credit to withdraw");
    if (!safeDebit(agentId, t.amount, `Correction (withdraw): ${t.memo || "Credit"}`)) return;
    notify(`🧾 Withdrawn ${t.amount} GCSD from ${getName(agentId)} (correction)`);
    toast.success("Credits withdrawn");
  }

  function addAgent(name:string){
    if (!isAdmin) return toast.error("Admin only");
    const trimmed = name.trim();
    if (!trimmed) return toast.error("Enter a name");
    if (accounts.some(a => a.role==="agent" && a.name.toLowerCase()===trimmed.toLowerCase())) {
      return toast.error("Agent already exists");
    }
    const a: Account = { id: uid(), name: trimmed, role: "agent" };
    setAccounts(prev=> [...prev, a]);
    notify(`👤 New agent added: ${trimmed}`);
    toast.success(`Added agent ${trimmed}`);
  }

  function setAgentPin(agentId:string, pin:string){
    if (!isAdmin) return toast.error("Admin only");
    if (!/^\d{5}$/.test(pin)) return toast.error("PIN must be 5 digits");
    setPins(prev=> ({...prev, [agentId]: pin}));
    notify(`🔐 PIN set/reset for ${getName(agentId)}`);
    toast.success("PIN updated");
  }

  function resetPin(agentId:string){
    if (!isAdmin) return toast.error("Admin only");
    setPins(prev=> { const next = {...prev}; delete next[agentId]; return next; });
    notify(`🔐 PIN cleared for ${getName(agentId)}`);
    toast.success("PIN reset (cleared)");
  }

  function setSavingsGoal(agentId:string, amount:number){
    if (amount <= 0) return toast.error("Enter a positive goal");
    openAgentPin(agentId, (ok)=>{
      if (!ok) return toast.error("Wrong PIN");
      setGoals(prev=> ({...prev, [agentId]: amount}));
      notify(`🎯 ${getName(agentId)} updated savings goal to ${amount} GCSD`);
      toast.success("Goal updated");
    });
  }

  function resetAgentBalance(agentId:string){
    if (!isAdmin) return toast.error("Admin only");
    const bal = balances.get(agentId)||0;
    if (bal === 0) return toast.info("Balance already zero");
    if (bal > 0) {
      if (!safeDebit(agentId, bal, `Balance reset to 0`)) return;
    } else {
      postTxn({ kind:"credit", amount: -bal, toId: agentId, memo:`Balance reset to 0` });
    }
    notify(`🧮 Reset balance of ${getName(agentId)}`);
    toast.success("Balance reset");
  }

  /* Sandbox */
  function enterSandbox() {
    const pin = prompt("Admin PIN to enter Sandbox:");
    if (!pin || !/^\d{5,8}$/.test(pin)) return toast.error("Enter a valid PIN");
    setAdminPin(pin);
    setSandboxActive(true);
    setPortal("sandbox");
    toast.success("Sandbox started");
  }
  function exitSandbox() {
    setSandboxActive(false);
    setPortal("home");
    toast.success("Sandbox cleared");
  }

  return (
    <div
      className={
        theme === "neon"
          ? "min-h-screen overflow-x-hidden bg-[#0B0B0B] text-orange-50 transition-colors duration-200"
          : "min-h-screen overflow-x-hidden bg-gradient-to-b from-slate-50 to-white dark:from-slate-900 dark:to-slate-950 dark:text-slate-100 transition-colors duration-200"
      }
    >
      {/* force readable system dropdowns in neon/dark */}
      <style>{`
        select, option { color-scheme: dark; }
        .neon-select select { color: #ffd7a1; background: transparent; }
        .neon-select option { color: #f8fafc; background: #0B0B0B; }
      `}</style>

      <Toaster position="top-center" richColors />

      {/* Intro */}
      <AnimatePresence>
        {showIntro && (
          <motion.div initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}}
            className={`fixed inset-0 z-50 grid place-items-center ${theme==="neon" ? "bg-[#0B0B0B]" : "bg-black/85"} text-white`}>
            <motion.div initial={{scale:0.96}} animate={{scale:1}} className="text-center p-8">
              <div className="mx-auto mb-6 w-48 h-48 rounded-[28px] bg-white/10 grid place-items-center shadow-[0_0_90px_rgba(255,165,0,.55)]">
                <img src={LOGO_URL} alt="GCS Bank logo" className="w-40 h-40 rounded drop-shadow-[0_6px_18px_rgba(255,165,0,.35)]"/>
              </div>
              <TypeLabel text={`Welcome to ${APP_NAME}`} />
              <div className="text-white/70 mt-2 mb-6">Press Enter to continue</div>
              <motion.button whileHover={{scale:1.05}} whileTap={{scale:0.97}}
                className="px-4 py-2 rounded-xl bg-white text-black"
                onClick={()=> setShowIntro(false)}>
                Skip
              </motion.button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <div
        className={
          theme === "neon"
            ? "sticky top-0 z-20 backdrop-blur bg-[#14110B]/85 border-b border-orange-800 transition-colors duration-200"
            : "sticky top-0 z-20 backdrop-blur bg-white/70 dark:bg-slate-900/70 border-b border-slate-200 dark:border-slate-800 transition-colors duration-200"
        }
      >
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src={LOGO_URL} alt="GCS Bank logo" className="h-14 w-14 rounded drop-shadow-sm" />
            <span className="font-semibold text-base sm:text-lg">{APP_NAME}</span>
            <button
              className={classNames("ml-3 inline-flex items-center gap-1 text-sm px-2 py-1 rounded-lg", neonBtn(theme))}
              onClick={()=> setPortal(sandboxActive ? "sandbox" : "home")}  // do NOT exit sandbox on Home
              title="Go Home"
            >
              <HomeIcon className="w-4 h-4"/> Home
            </button>
            <button
              className={classNames("ml-2 inline-flex items-center gap-1 text-sm px-2 py-1 rounded-lg", neonBtn(theme))}
              onClick={()=> portal==="sandbox" ? exitSandbox() : enterSandbox()}
              title={portal==="sandbox" ? "Exit Sandbox" : "Enter Sandbox"}
            >
              <Shield className="w-4 h-4"/> {portal==="sandbox" ? "Exit Sandbox" : "Sandbox"}
            </button>
          </div>
          <div className="flex items-center gap-3">
            <NotificationsBell notifs={notifs} theme={theme} unread={unread} onOpenFeed={() => { setPortal("feed"); setUnread(0); }} />
            <span className={classNames("text-xs font-mono", theme==="neon" ? "text-orange-200":"text-slate-600 dark:text-slate-300")}>{dateStr} • {clock}</span>
            <ThemeToggle theme={theme} setTheme={setTheme}/>
            <motion.button whileHover={{y:-1, boxShadow:"0 6px 16px rgba(0,0,0,.08)"}} whileTap={{scale:0.98}}
              className={classNames("px-3 py-1.5 rounded-xl flex items-center gap-2", neonBtn(theme))}
              onClick={()=> setPickerOpen(true)}>
              <Users className="w-4 h-4"/> Switch User
            </motion.button>
          </div>
        </div>
      </div>

      {/* Switch User */}
      <AnimatePresence>
        {pickerOpen && (
          <Picker
            theme={theme}
            accounts={accounts}
            balances={balances}
            onClose={()=> setPickerOpen(false)}
            onChooseAdmin={()=>{ setPortal("admin"); setIsAdmin(false); setPickerOpen(false); }}
            onChooseAgent={(id)=>{ setCurrentAgentId(id); setPortal("agent"); setIsAdmin(false); setPickerOpen(false); }}
          />
        )}
      </AnimatePresence>

      {/* Admin PIN modal */}
      <AnimatePresence>
        {portal==="admin" && !isAdmin && (
          <PinModalGeneric
            title="Admin PIN"
            maxLen={8}
            onClose={() => { setPortal("home"); }}
            onOk={(pin) => {
              if (!/^\d{5,8}$/.test(pin)) { toast.error("Enter a valid PIN"); return; }
              setAdminPin(pin);
              setIsAdmin(true);
              toast.success("Admin unlocked");
            }}
          />
        )}
      </AnimatePresence>

      {/* Agent PIN modal */}
      <PinModal
        open={pinModal.open}
        onClose={()=> setPinModal({open:false})}
        onCheck={(pin)=>{
          const aId = pinModal.agentId!;
          const ok = pins[aId] && pin === pins[aId];
          pinModal.onOK?.(!!ok);
          setPinModal({open:false});
        }}
      />

      {/* Receipt */}
      <AnimatePresence>
        {receipt && (
          <motion.div initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} className="fixed inset-0 z-50 bg-black/40 grid place-items-center">
            <motion.div initial={{scale:0.95}} animate={{scale:1}} exit={{scale:0.95}} className={classNames("rounded-2xl p-5 w-[min(460px,92vw)]", neonBox(theme))}>
              <div className="flex items-center justify-between mb-3">
                <div className="font-semibold flex items-center gap-2"><Gift className="w-4 h-4"/> Receipt</div>
                <button className="p-1 rounded hover:bg-black/10 dark:hover:bg-white/10" onClick={()=>setReceipt(null)}><X className="w-4 h-4"/></button>
              </div>
              <div className="text-sm space-y-2">
                <div><b>Order ID:</b> {receipt.id}</div>
                <div><b>Date:</b> {receipt.when}</div>
                <div><b>Buyer:</b> {receipt.buyer}</div>
                <div><b>Prize:</b> {receipt.item}</div>
                <div><b>Amount:</b> {receipt.amount.toLocaleString()} GCSD</div>
              </div>
              <div className="mt-4 text-xs opacity-70">Tip: screenshot or print this popup for records.</div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Pages */}
      <div className="max-w-6xl mx-auto px-4 py-6">
        {portal==="home" && (
          <Home
            theme={theme}
            accounts={accounts}
            txns={txns}
            stock={stock}
            prizes={PRIZE_ITEMS}
            leaderboard={leaderboard}
            starOfDay={starOfDay}
            leaderOfMonth={leaderOfMonth}
          />
        )}

        {portal==="agent" && currentAgentId && (
          <AgentPortal
            theme={theme}
            agentName={agent?.name||""}
            agentBalance={agentBalance}
            lifetimeEarn={lifetimeEarn}
            lifetimeSpend={lifetimeSpend}
            goal={goals[currentAgentId]||0}
            setGoal={(amt)=> setSavingsGoal(currentAgentId, amt)}
            txns={agentTxns}
            prizes={PRIZE_ITEMS}
            stock={stock}
            prizeCount={prizeCount}
            onRedeem={(k)=>redeemPrize(currentAgentId, k)}
          />
        )}

        {portal==="admin" && (
          <AdminPortal
            theme={theme}
            isAdmin={isAdmin}
            accounts={accounts}
            balances={balances}
            stock={stock}
            rules={PRODUCT_RULES}
            txns={txns}
            onCredit={adminCredit}
            onManualTransfer={manualTransfer}
            onUndoSale={undoSale}
            onUndoRedemption={undoRedemption}
            onWithdraw={withdrawAgentCredit}
            onAddAgent={addAgent}
            onSetPin={setAgentPin}
            onResetPin={(id)=>resetPin(id)}
            onResetBalance={(id)=>resetAgentBalance(id)}
            pins={pins}
            adminTab={adminTab} setAdminTab={setAdminTab}
            wipeAgent={wipeAgent}
            doFactoryReset={async () => {
              const confirmPin = prompt("Admin PIN (again) to confirm full reset:");
              if (!confirmPin || confirmPin !== adminPin) { toast.error("PIN incorrect"); return; }
              await doFactoryReset();
            }}
          />
        )}

        {portal==="sandbox" && <SandboxPage onExit={exitSandbox} theme={theme}/>}

        {portal==="feed" && <FeedPage theme={theme} notifs={notifs} />}
      </div>
    </div>
  );
}

/* ========== Derived utils ========== */
function computeBalances(accounts: Account[], txns: Transaction[]) {
  const map = new Map<string, number>(accounts.map(a => [a.id, 0]));
  for (const t of txns) {
    if (t.kind === "credit" && t.toId) map.set(t.toId, (map.get(t.toId) || 0) + t.amount);
    if (t.kind === "debit" && t.fromId) map.set(t.fromId, (map.get(t.fromId) || 0) - t.amount);
  }
  return map;
}
function bucketByDay(txns:Transaction[], nonSystem:Set<string>){
  const by: Record<string, Set<string>> = {};
  for (const t of txns) {
    if (t.kind==="credit" && t.toId && nonSystem.has(t.toId) && t.memo!=="Mint") {
      const d = new Date(t.dateISO); d.setHours(0,0,0,0);
      const day = d.toISOString();
      by[t.toId] = by[t.toId] || new Set<string>();
      by[t.toId].add(day);
    }
  }
  return by;
}
function computeStreaks(by: Record<string, Set<string>>){
  const res: Record<string, number> = {};
  for (const id of Object.keys(by)) {
    const today = new Date(); today.setHours(0,0,0,0);
    let streak = 0;
    for (let i=0; ; i++){
      const d = new Date(today); d.setDate(today.getDate() - i);
      const iso = d.toISOString();
      if (by[id].has(iso)) streak++; else break;
    }
    res[id] = streak;
  }
  return res;
}

/* ===== Shared UI (TypeLabel/ThemeToggle/Bell/Picker/Select/Pin modals) ===== */

function TypeLabel({ text }:{ text:string }) {
  return (
    <div aria-label={text} className="text-2xl font-semibold">
      {text.split("").map((ch, i)=>(
        <motion.span key={i} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.08, delay: i * 0.015 }}>
          {ch}
        </motion.span>
      ))}
    </div>
  );
}

function ThemeToggle({theme, setTheme}:{theme:Theme; setTheme:(t:Theme)=>void}) {
  const isDark = theme === "dark";
  const isNeon = theme === "neon";
  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => setTheme(isDark ? "light" : "dark")}
        className={
          theme==="neon"
            ? "h-8 w-8 grid place-items-center rounded-full border border-orange-700 bg-[#0B0B0B]/60"
            : "h-8 w-8 grid place-items-center rounded-full border bg-white dark:bg-slate-800"
        }
        aria-label={isDark ? "Switch to light" : "Switch to dark"}
        title={isDark ? "Light" : "Dark"}
      >
        <AnimatePresence initial={false} mode="wait">
          {isDark ? (
            <motion.span key="moon" initial={{ rotate:-20, scale:0.7, opacity:0 }} animate={{ rotate:0, scale:1, opacity:1 }} exit={{ rotate:20, scale:0.7, opacity:0 }} transition={{ duration:0.12 }}>
              <Moon className="w-4 h-4" />
            </motion.span>
          ) : (
            <motion.span key="sun"  initial={{ rotate:20,  scale:0.7, opacity:0 }} animate={{ rotate:0, scale:1, opacity:1 }} exit={{ rotate:-20, scale:0.7, opacity:0 }} transition={{ duration:0.12 }}>
              <Sun className="w-4 h-4" />
            </motion.span>
          )}
        </AnimatePresence>
      </button>
      <button
        onClick={() => setTheme(isNeon ? "light" : "neon")}
        className={
          isNeon
            ? "h-8 px-2 rounded-full border border-orange-700 bg-orange-700 text-black inline-flex items-center gap-1"
            : "h-8 px-2 rounded-full border inline-flex items-center gap-1 bg-white dark:bg-slate-800"
        }
        title="Neon mode"
      >
        <Zap className="w-4 h-4" /> Neon
      </button>
    </div>
  );
}

function NotificationsBell({ notifs, theme, unread, onOpenFeed }:{
  notifs: Notification[]; theme:Theme; unread:number; onOpenFeed:()=>void;
}) {
  return (
    <button
      className={ theme==="neon"
        ? "relative h-8 w-8 grid place-items-center rounded-full border border-orange-700 bg-[#0B0B0B]/60"
        : "relative h-8 w-8 grid place-items-center rounded-full border bg-white dark:bg-slate-800"
      }
      onClick={onOpenFeed}
      title="Notifications"
    >
      {unread>0 && (
        <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] text-[11px] rounded-full grid place-items-center bg-rose-600 text-white px-1">
          {Math.min(99, unread)}
        </span>
      )}
      <Bell className="w-4 h-4" />
    </button>
  );
}

function Picker({ theme, accounts, balances, onClose, onChooseAdmin, onChooseAgent }:{
  theme:Theme;
  accounts:Account[]; balances:Map<string,number>;
  onClose:()=>void; onChooseAdmin:()=>void; onChooseAgent:(id:string)=>void;
}) {
  return (
    <motion.div initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}}
      className="fixed inset-0 z-40 bg-white/80 backdrop-blur dark:bg-slate-900/70 grid place-items-center">
      <motion.div initial={{y:18, opacity:0}} animate={{y:0, opacity:1}}
        transition={{type:"spring", stiffness:160, damping:18}}
        className={classNames("rounded-3xl shadow-xl p-6 w-[min(780px,92vw)]", neonBox(theme))}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2"><Users className="w-4 h-4"/><h2 className="text-xl font-semibold">Switch User</h2></div>
          <button className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800" onClick={onClose}><X className="w-4 h-4"/></button>
        </div>

        <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-2 max-h-[60vh] overflow-auto pr-2">
          <HoverCard theme={theme} onClick={onChooseAdmin}>
            <div className="font-semibold flex items-center gap-2"><Lock className="w-4 h-4"/> Admin Portal</div>
            <div className="text-xs opacity-70 mt-1">PIN required</div>
          </HoverCard>

          {accounts.filter(a=>a.role!=="system").map((a,i)=>(
            <HoverCard key={a.id} theme={theme} delay={0.03 + i*0.02} onClick={()=>onChooseAgent(a.id)}>
              <div className="font-medium">{a.name}</div>
              <div className="text-xs opacity-70">Balance: {(balances.get(a.id)||0).toLocaleString()} GCSD</div>
            </HoverCard>
          ))}
        </div>
      </motion.div>
    </motion.div>
  );
}
function HoverCard({ children, onClick, delay=0.03, theme }:{
  children:React.ReactNode; onClick:()=>void; delay?:number; theme:Theme;
}) {
  return (
    <motion.button
      initial={{opacity:0, y:6}} animate={{opacity:1, y:0}} transition={{delay}}
      whileHover={{y:-3, boxShadow:"0 10px 22px rgba(0,0,0,.10)"}} whileTap={{scale:0.98}}
      onClick={onClick}
      className={classNames("border rounded-2xl px-3 py-3 text-left transition-colors", neonBox(theme))}>
      {children}
    </motion.button>
  );
}

function FancySelect({
  value, onChange, children, theme, placeholder
}:{
  value: string; onChange: (v:string)=>void; children: React.ReactNode; theme: Theme; placeholder?: string;
}) {
  return (
    <div className={classNames(
      "relative rounded-xl",
      theme==="neon" ? "neon-select border border-orange-700 bg-[#0B0B0B]/60 text-orange-50" : "border bg-white dark:bg-slate-800"
    )}>
      <select
        value={value}
        onChange={(e)=>onChange(e.target.value)}
        className={classNames(
          "appearance-none w-full px-3 py-2 pr-8 rounded-xl focus:outline-none",
          theme==="neon" ? "bg-transparent [color-scheme:dark]" : "bg-transparent"
        )}
      >
        {placeholder && <option value="">{placeholder}</option>}
        {children}
      </select>
      <ChevronDown className={classNames(
        "pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4",
        theme==="neon" ? "text-orange-200" : "text-slate-500 dark:text-slate-300"
      )}/>
    </div>
  );
}

function PinModal({ open, onClose, onCheck }:{ open:boolean; onClose:()=>void; onCheck:(pin:string)=>void }) {
  return (
    <AnimatePresence>
      {open && (
        <PinModalGeneric title="Enter PIN" onClose={onClose} onOk={(pin)=> onCheck(pin)} maxLen={5}/>
      )}
    </AnimatePresence>
  );
}
function PinModalGeneric({ title, onClose, onOk, maxLen }:{ title:string; onClose:()=>void; onOk:(pin:string)=>void; maxLen:number }) {
  const [pin, setPin] = useState("");
  return (
    <motion.div initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} className="fixed inset-0 z-50 bg-black/40 grid place-items-center">
      <motion.div initial={{scale:0.95}} animate={{scale:1}} exit={{scale:0.95}} className="bg-white dark:bg-slate-900 rounded-2xl p-5 w-[min(440px,92vw)]">
        <div className="flex items-center justify-between mb-3">
          <div className="font-semibold flex items-center gap-2"><Lock className="w-4 h-4"/> {title}</div>
          <button className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800" onClick={onClose}><X className="w-4 h-4"/></button>
        </div>
        <div className="space-y-3">
          <div className="text-sm opacity-70">Enter {maxLen}-digit PIN.</div>
          <input className="border rounded-xl px-3 py-2 w-full bg-white dark:bg-slate-800" placeholder="PIN" type="password" value={pin} onChange={e=>setPin(e.target.value.replace(/\D/g,""))} maxLength={maxLen}/>
          <button className="px-3 py-1.5 rounded-xl border bg-black text-white" onClick={()=> pin.length===maxLen ? onOk(pin) : toast.error(`PIN must be ${maxLen} digits`)}>
            <Check className="w-4 h-4 inline mr-1"/> OK
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

/* ========== Home ========== */
function Home({ theme, accounts, txns, stock, prizes, leaderboard, starOfDay, leaderOfMonth }:{
  theme:Theme;
  accounts:Account[]; txns:Transaction[]; stock:Record<string,number>; prizes:PrizeItem[];
  leaderboard: {id:string; name:string; earned:number; streak:number}[];
  starOfDay: {name:string; amount:number} | null; leaderOfMonth: {name:string; amount:number} | null;
}) {
  const nonSystemIds = new Set(accounts.filter(a=>a.role!=="system").map(a=>a.id));
  const purchases = txns
    .filter(t=> t.kind==="debit" && t.fromId && nonSystemIds.has(t.fromId) && (t.memo||"").startsWith("Redeem:"))
    .map(t=> ({ when: new Date(t.dateISO), memo: t.memo!, amount: t.amount }));

  // 30-day finance series (earned minus withdrawals) — clamp >= 0
  const days = Array.from({length:30}, (_,i)=> { const d=new Date(); d.setDate(d.getDate()-(29-i)); d.setHours(0,0,0,0); return d; });
  const earnedSeries: number[] = days.map(d=>{
    const credits = sumInRange(txns, d, 1, t =>
      t.kind==="credit" && !!t.toId && nonSystemIds.has(t.toId as string) && t.memo!=="Mint"
    );
    const withdrawals = sumInRange(txns, d, 1, t =>
      isCorrectionDebit(t) && !!t.fromId && nonSystemIds.has(t.fromId as string)
    );
    return Math.max(0, credits - withdrawals);
  });
  const spentSeries: number[]  = days.map(d=> sumInRange(txns, d, 1, t =>
    t.kind==="debit" && !!t.fromId && nonSystemIds.has(t.fromId as string) && !isCorrectionDebit(t)
  ));
  const totalEarned = earnedSeries.reduce((a: number, b: number)=>a+b,0);
  const totalSpent  = spentSeries.reduce((a: number, b: number)=>a+b,0);

  return (
    <motion.div layout initial={{opacity:0, y:10}} animate={{opacity:1, y:0}} transition={{type:"spring", stiffness:160, damping:18}}>
      <div className="grid md:grid-cols-3 gap-4">
        <div className={classNames("rounded-2xl border p-4 shadow-sm", neonBox(theme))}>
          <div className="text-sm opacity-70 mb-2">Dashboard</div>
          <div className="grid sm:grid-cols-2 gap-4">
            <TileRow label="Total GCSD Earned (30d)" value={totalEarned}/>
            <TileRow label="Total GCSD Spent (30d)"  value={totalSpent}/>
          </div>

          <div className="mt-4">
            <div className="text-sm opacity-70 mb-2">Finance (30 days)</div>
            <LineChart earned={earnedSeries} spent={spentSeries}/>
          </div>

          <div className="grid sm:grid-cols-2 gap-4 mt-4">
            <Highlight title="Star of the Day" value={starOfDay ? `${starOfDay.name} • +${starOfDay.amount.toLocaleString()} GCSD` : "—"} />
            <Highlight title="Leader of the Month" value={leaderOfMonth ? `${leaderOfMonth.name} • +${leaderOfMonth.amount.toLocaleString()} GCSD` : "—"} />
          </div>

          <div className="mt-4">
            <div className="text-sm opacity-70 mb-2">Purchased Prizes (All Agents)</div>
            <div className={classNames("rounded-xl border p-3", neonBox(theme))}>
              <div className="text-sm mb-2">Total purchases: <b>{purchases.length}</b></div>
              <div className="space-y-2 max-h-40 overflow-auto pr-1">
                {purchases.map((p, i)=> (
                  <div key={i} className="flex items-center justify-between text-sm border rounded-lg px-3 py-1.5">
                    <span>{p.memo.replace("Redeem: ","")}</span>
                    <span className="opacity-70">{p.when.toLocaleString()}</span>
                  </div>
                ))}
                {purchases.length===0 && <div className="text-sm opacity-70">No purchases yet.</div>}
              </div>
            </div>
          </div>
        </div>

        <div className={classNames("rounded-2xl border p-4 shadow-sm", neonBox(theme))}>
          <div className="text-sm opacity-70 mb-2">Leaderboard</div>
          <div className="space-y-2 max-h-[520px] overflow-auto pr-2">
            {leaderboard.map((row,i)=>(
              <motion.div key={row.id} layout whileHover={{y:-2}} className={classNames("flex items-center justify-between border rounded-xl px-3 py-2", neonBox(theme))}>
                <div className="flex items-center gap-2">
                  <span className="w-5 text-right">{i+1}.</span>
                  <span className="font-medium">{row.name}</span>
                  {row.streak>=2 && <span title={`${row.streak} day streak`} className="inline-flex items-center gap-1 text-orange-400 text-xs"><Flame className="w-4 h-4"/> {row.streak}</span>}
                </div>
                <div className="text-sm"><NumberFlash value={row.earned}/></div>
              </motion.div>
            ))}
            {leaderboard.length===0 && <div className="text-sm opacity-70">No data yet.</div>}
          </div>
        </div>

        <div className={classNames("rounded-2xl border p-4 shadow-sm", neonBox(theme))}>
          <div className="text-sm opacity-70 mb-2">Prizes (Available)</div>
          <div className="space-y-2 max-h-[520px] overflow-auto pr-2">
            {PRIZE_ITEMS.map(p=>(
              <motion.div key={p.key} layout whileHover={{y:-2}} className={classNames("flex items-center justify-between border rounded-xl px-3 py-2", neonBox(theme))}>
                <div className="font-medium">{p.label}</div>
                <div className="flex items-center gap-2">
                  <span className="text-sm opacity-80">{p.price.toLocaleString()} GCSD</span>
                  <span
                    className={
                      theme==="neon"
                        ? "px-2 py-0.5 rounded-md text-xs bg-[#0B0B0B] border border-orange-700 text-orange-200"
                        : "px-2 py-0.5 rounded-md text-xs bg-slate-100 dark:bg-slate-700"
                    }
                  >
                    Stock: {stock[p.key] ?? 0}
                  </span>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </motion.div>
  );
}
function sumInRange(txns:Transaction[], day:Date, spanDays:number, pred:(t:Transaction)=>boolean){
  const start = new Date(day); const end = new Date(day); end.setDate(start.getDate()+spanDays);
  return txns.filter(t=> pred(t) && new Date(t.dateISO)>=start && new Date(t.dateISO)<end).reduce((a,b)=>a+b.amount,0);
}

function TileRow({ label, value }:{ label:string; value:number }) {
  return (
    <div className="rounded-xl border p-3">
      <div className="text-xs opacity-70 mb-1">{label}</div>
      <div className="text-2xl font-semibold"><NumberFlash value={value}/></div>
    </div>
  );
}
function Highlight({ title, value }:{ title:string; value:string }) {
  return (
    <div className="rounded-xl border p-3">
      <div className="text-xs opacity-70 mb-1">{title}</div>
      <div>{value}</div>
    </div>
  );
}
function LineChart({ earned, spent }:{ earned:number[]; spent:number[] }) {
  const max = Math.max(1, ...earned, ...spent);
  const h = 110, w = 420, pad = 10, step = (w - pad*2) / (earned.length - 1 || 1);
  const toPath = (arr:number[]) =>
    arr.map((v,i)=> `${i===0 ? "M" : "L"} ${pad + i*step},${h - pad - (v/max)*(h-pad*2)}`).join(" ");

  return (
    <svg width="100%" viewBox={`0 0 ${w} ${h}`} className="rounded-xl border">
      <path d={toPath(earned)} fill="none" stroke="currentColor" strokeWidth="2" className="text-emerald-500" />
      <path d={toPath(spent)}  fill="none" stroke="currentColor" strokeWidth="2" className="text-rose-500" />
      <g className="text-xs">
        <text x={pad} y={h-2} className="fill-current opacity-60">Earned</text>
        <text x={pad+70} y={h-2} className="fill-current opacity-60">Spent</text>
      </g>
    </svg>
  );
}

/* === END OF PART 1/3 — ask me for PART 2 when ready (AgentPortal + AdminPortal + pages + utilities) === */

/* ========== Agent Portal ========== */
function AgentPortal({
  theme, agentName, agentBalance, lifetimeEarn, lifetimeSpend, goal, setGoal,
  txns, prizes, stock, prizeCount, onRedeem,
}:{
  theme:Theme; agentName:string; agentBalance:number; lifetimeEarn:number; lifetimeSpend:number; goal:number; setGoal:(n:number)=>void;
  txns:Transaction[]; prizes:PrizeItem[]; stock:Record<string,number>; prizeCount:number; onRedeem:(k:string)=>void;
}) {
  const [goalInput, setGoalInput] = useState(goal? String(goal):"");
  const progress = goal>0 ? Math.min(100, Math.round((agentBalance/goal)*100)) : 0;

  useEffect(()=> setGoalInput(goal? String(goal):""), [goal]);

  return (
    <motion.div layout initial={{opacity:0, y:10}} animate={{opacity:1, y:0}} transition={{type:"spring", stiffness:160, damping:18}}>
      <div className="grid lg:grid-cols-2 gap-4">
        {/* Summary */}
        <div className={classNames("rounded-2xl border p-4 shadow-sm", neonBox(theme))}>
          <div className="text-sm opacity-70 mb-2">Agent</div>
          <div className="text-xl font-semibold mb-1">{agentName}</div>
          <div className="grid sm:grid-cols-3 gap-3 mt-3">
            <TileRow label="Balance" value={agentBalance}/>
            <TileRow label="Lifetime Earned" value={Math.max(0, lifetimeEarn)}/>
            <TileRow label="Lifetime Spent" value={lifetimeSpend}/>
          </div>

          <div className="mt-4">
            <div className="text-sm opacity-70 mb-2">Savings goal</div>
            <div className="rounded-xl border p-3">
              <div className="flex items-center gap-3">
                <input
                  className={inputCls(theme)}
                  placeholder="Amount"
                  value={goalInput}
                  onChange={(e)=> setGoalInput(e.target.value.replace(/[^\d]/g,""))}
                />
                <button
                  className={classNames("px-3 py-1.5 rounded-xl", neonBtn(theme,true))}
                  onClick={()=> goalInput ? setGoal(parseInt(goalInput,10)) : null}
                >
                  <Check className="w-4 h-4 inline mr-1"/> Set goal
                </button>
              </div>
              <div className="mt-3 text-sm opacity-70">{goal>0 ? `${progress}% towards ${Number(goal).toLocaleString()} GCSD` : "No goal set"}</div>
              <div className="mt-2 h-2 rounded-full bg-black/10 dark:bg-white/10">
                <div className="h-2 rounded-full bg-emerald-500" style={{width: `${progress}%`}}/>
              </div>
            </div>
          </div>

          <div className="mt-4">
            <div className="text-sm opacity-70 mb-2">Recent activity</div>
            <div className="space-y-2 max-h-56 overflow-auto pr-2">
              {txns.slice(0,40).map(t=>(
                <motion.div key={t.id} layout whileHover={{y:-2}} className={classNames("border rounded-xl px-3 py-2 flex items-center justify-between", neonBox(theme))}>
                  <div className="text-sm">{t.memo || (t.kind==="credit" ? "Credit" : "Debit")}</div>
                  <div className={classNames("text-sm", t.kind==="credit" ? "text-emerald-500" : "text-rose-500")}>
                    {t.kind==="credit" ? "+" : "−"}{t.amount.toLocaleString()}
                  </div>
                </motion.div>
              ))}
              {txns.length===0 && <div className="text-sm opacity-70">No activity yet.</div>}
            </div>
          </div>
        </div>

        {/* Shop */}
        <div className={classNames("rounded-2xl border p-4 shadow-sm", neonBox(theme))}>
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm opacity-70">Shop (limit {MAX_PRIZES_PER_AGENT}, you have {prizeCount})</div>
            <div className="text-xs opacity-70">Balance: {agentBalance.toLocaleString()} GCSD</div>
          </div>
          <div className="space-y-2 max-h-[560px] overflow-auto pr-2">
            {prizes.map(p=>{
              const left = stock[p.key] ?? 0;
              const can = left>0 && agentBalance>=p.price && prizeCount<MAX_PRIZES_PER_AGENT;
              return (
                <motion.div key={p.key} layout whileHover={{y:-2}} className={classNames("flex items-center justify-between border rounded-xl px-3 py-2", neonBox(theme))}>
                  <div>
                    <div className="font-medium">{p.label}</div>
                    <div className="text-xs opacity-70">{p.price.toLocaleString()} GCSD • Stock {left}</div>
                  </div>
                  <button
                    disabled={!can}
                    className={classNames("px-3 py-1.5 rounded-xl disabled:opacity-50", neonBtn(theme,true))}
                    onClick={()=> onRedeem(p.key)}
                  >
                    <Gift className="w-4 h-4 inline mr-1"/> Redeem
                  </button>
                </motion.div>
              );
            })}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

/* ========== Admin Portal ========== */
function AdminPortal({
  theme, isAdmin, accounts, balances, stock, rules, txns,
  onCredit, onManualTransfer, onUndoSale, onUndoRedemption, onWithdraw, onAddAgent, onSetPin,
  onResetPin, onResetBalance, pins,
  adminTab, setAdminTab,
  wipeAgent, doFactoryReset
}:{
  theme:Theme; isAdmin:boolean; accounts:Account[]; balances:Map<string,number>;
  stock:Record<string,number>; rules:ProductRule[]; txns:Transaction[];
  onCredit:(agentId:string, ruleKey:string, qty:number)=>void;
  onManualTransfer:(agentId:string, amount:number, note:string)=>void;
  onUndoSale:(txId:string)=>void; onUndoRedemption:(txId:string)=>void; onWithdraw:(agentId:string, txId:string)=>void;
  onAddAgent:(name:string)=>void; onSetPin:(agentId:string, pin:string)=>void;
  onResetPin:(agentId:string)=>void; onResetBalance:(agentId:string)=>void; pins:Record<string,string>;
  adminTab:"dashboard"|"addsale"|"transfer"|"corrections"|"history"|"users"; setAdminTab:(t:any)=>void;
  wipeAgent:(id:string)=>void; doFactoryReset:()=>Promise<void>;
}) {
  const [agentId, setAgentId] = useState("");
  const [ruleKey, setRuleKey] = useState(rules[0]?.key || "");
  const [qty, setQty] = useState(1);
  const [xferAmt, setXferAmt] = useState("");
  const [xferNote, setXferNote] = useState("");
  const [newAgent, setNewAgent] = useState("");
  const [pinAgent, setPinAgent] = useState("");
  const [pinVal, setPinVal] = useState("");

  if (!isAdmin) {
    return (
      <div className={classNames("rounded-2xl border p-6 text-center", neonBox(theme))}>
        <Lock className="w-5 h-5 mx-auto mb-2"/>
        <div>Enter Admin PIN to access the portal.</div>
      </div>
    );
  }

  const creditsForAgent = txns.filter(t=> t.kind==="credit" && t.toId===agentId && t.memo!=="Mint");

  return (
    <div className="grid gap-4">
      {/* tabs */}
      <div className={classNames("rounded-2xl border p-2 flex flex-wrap gap-2", neonBox(theme))}>
        {[
          ["dashboard","Dashboard"],
          ["addsale","Add Sale"],
          ["transfer","Transfer"],
          ["corrections","Corrections"],
          ["history","History"],
          ["users","Users"]
        ].map(([k,lab])=>(
          <button key={k}
            onClick={()=> setAdminTab(k as any)}
            className={classNames("px-3 py-1.5 rounded-xl text-sm",
              adminTab===k ? neonBtn(theme,true) : neonBtn(theme))}>
            {lab}
          </button>
        ))}
      </div>

      {/* dashboard */}
      {adminTab==="dashboard" && (
        <div className="grid md:grid-cols-3 gap-4">
          <div className={classNames("rounded-2xl border p-4", neonBox(theme))}>
            <div className="text-sm opacity-70 mb-2">Balances</div>
            <div className="space-y-2 max-h-[420px] overflow-auto pr-2">
              {accounts.filter(a=>a.role!=="system").map(a=>(
                <motion.div key={a.id} layout whileHover={{y:-2}} className={classNames("border rounded-xl px-3 py-2 flex items-center justify-between", neonBox(theme))}>
                  <div className="font-medium">{a.name}</div>
                  <div className="text-sm">{(balances.get(a.id)||0).toLocaleString()} GCSD</div>
                </motion.div>
              ))}
            </div>
          </div>
          <div className={classNames("rounded-2xl border p-4", neonBox(theme))}>
            <div className="text-sm opacity-70 mb-2">Prize Stock</div>
            <div className="space-y-2 max-h-[420px] overflow-auto pr-2">
              {PRIZE_ITEMS.map(p=>(
                <motion.div key={p.key} layout whileHover={{y:-2}} className={classNames("border rounded-xl px-3 py-2 flex items-center justify-between", neonBox(theme))}>
                  <div>{p.label}</div>
                  <div className="text-sm">Stock: {stock[p.key] ?? 0}</div>
                </motion.div>
              ))}
            </div>
          </div>
          <div className={classNames("rounded-2xl border p-4", neonBox(theme))}>
            <div className="text-sm opacity-70 mb-2">System</div>
            <ul className="text-sm list-disc pl-5 space-y-1 opacity-80">
              <li>“Add Sale” posts credits by product rule.</li>
              <li>“Corrections” can withdraw previously posted credits.</li>
              <li>Withdrawals appear in History as “Correction (withdraw)”.</li>
            </ul>
            <div className="mt-4">
              <button
                className={classNames("px-4 py-2 rounded-xl", neonBtn(theme,true))}
                onClick={doFactoryReset}
              >
                🧨 Complete Reset (PIN required)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* add sale */}
      {adminTab==="addsale" && (
        <div className={classNames("rounded-2xl border p-4", neonBox(theme))}>
          <div className="grid sm:grid-cols-3 gap-3">
            <div>
              <div className="text-xs opacity-70 mb-1">Agent</div>
              <FancySelect value={agentId} onChange={setAgentId} theme={theme} placeholder="Choose agent…">
                {accounts.filter(a=>a.role!=="system").map(a=>(<option key={a.id} value={a.id}>{a.name}</option>))}
              </FancySelect>
            </div>
            <div>
              <div className="text-xs opacity-70 mb-1">Product</div>
              <FancySelect value={ruleKey} onChange={setRuleKey} theme={theme}>
                {rules.map(r=>(<option key={r.key} value={r.key}>{r.label} — {r.gcsd}</option>))}
              </FancySelect>
            </div>
            <div>
              <div className="text-xs opacity-70 mb-1">Qty</div>
              <input className={inputCls(theme)} value={qty} onChange={(e)=> setQty(Math.max(1,parseInt((e.target.value||"1").replace(/[^\d]/g,""),10)))} />
            </div>
            <div className="sm:col-span-3 flex justify-end">
              <button className={classNames("px-4 py-2 rounded-xl", neonBtn(theme,true))} onClick={()=> onCredit(agentId, ruleKey, qty)}>
                <Plus className="w-4 h-4 inline mr-1"/> Add Sale
              </button>
            </div>
          </div>
        </div>
      )}

      {/* transfer */}
      {adminTab==="transfer" && (
        <div className={classNames("rounded-2xl border p-4 grid sm:grid-cols-3 gap-4", neonBox(theme))}>
          <div>
            <div className="text-sm opacity-70 mb-2">Agent</div>
            <FancySelect value={agentId} onChange={setAgentId} theme={theme} placeholder="Choose agent…">
              {accounts.filter(a=>a.role!=="system").map(a=>(<option key={a.id} value={a.id}>{a.name}</option>))}
            </FancySelect>
          </div>
          <div>
            <div className="text-sm opacity-70 mb-2">Amount</div>
            <input className={inputCls(theme)} value={xferAmt} onChange={(e)=> setXferAmt(e.target.value.replace(/[^\d]/g,""))}/>
          </div>
          <div>
            <div className="text-sm opacity-70 mb-2">Note</div>
            <input className={inputCls(theme)} value={xferNote} onChange={(e)=> setXferNote(e.target.value)} placeholder="Manual transfer"/>
          </div>
          <div className="sm:col-span-3">
            <button className={classNames("px-4 py-2 rounded-xl", neonBtn(theme,true))}
              onClick={()=> onManualTransfer(agentId, parseInt(xferAmt||"0",10), xferNote)}>
              <Wallet className="w-4 h-4 inline mr-1"/> Transfer
            </button>
          </div>
        </div>
      )}

      {/* corrections */}
      {adminTab==="corrections" && (
        <div className={classNames("rounded-2xl border p-4 grid gap-4", neonBox(theme))}>
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <div className="text-xs opacity-70 mb-1">Choose agent to withdraw from</div>
              <FancySelect value={agentId} onChange={setAgentId} theme={theme} placeholder="Choose agent…">
                {accounts.filter(a=>a.role!=="system").map(a=>(<option key={a.id} value={a.id}>{a.name}</option>))}
              </FancySelect>
            </div>
          </div>

          {agentId && (
            <div className="rounded-xl border p-3">
              <div className="text-sm opacity-70 mb-2">Credits posted to {accounts.find(a=>a.id===agentId)?.name}</div>
              <div className="space-y-2 max-h-[360px] overflow-auto pr-2">
                {creditsForAgent.length===0 && <div className="text-sm opacity-70">No credit transactions found.</div>}
                {creditsForAgent.map(t=>(
                  <motion.div key={t.id} layout whileHover={{y:-2}} className={classNames("border rounded-xl px-3 py-2 flex items-center justify-between", neonBox(theme))}>
                    <div className="text-sm">
                      <div className="font-medium">{t.memo || "Credit"}</div>
                      <div className="opacity-70 text-xs">{new Date(t.dateISO).toLocaleString()}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="text-sm text-emerald-500">+{t.amount.toLocaleString()}</div>
                      <button className={classNames("px-2 py-1 rounded-lg text-xs", neonBtn(theme))}
                        onClick={()=> onWithdraw(agentId, t.id)}>
                        Withdraw
                      </button>
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>
          )}

          <div className="rounded-xl border p-3">
            <div className="text-sm opacity-70 mb-2">Quick reversals</div>
            <div className="space-y-2 max-h-[320px] overflow-auto pr-2">
              {txns.filter(t=>t.memo && t.memo!=="Mint").map(t=>(
                <motion.div key={t.id} layout whileHover={{y:-2}} className={classNames("border rounded-xl px-3 py-2 flex items-center justify-between", neonBox(theme))}>
                  <div className="text-sm">
                    <div className="font-medium">{t.memo}</div>
                    <div className="opacity-70 text-xs">{new Date(t.dateISO).toLocaleString()}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className={classNames("text-sm", t.kind==="credit" ? "text-emerald-500" : "text-rose-500")}>
                      {t.kind==="credit" ? "+" : "−"}{t.amount.toLocaleString()}
                    </div>
                    {t.kind==="credit" ? (
                      <button className={classNames("px-2 py-1 rounded-lg text-xs", neonBtn(theme))}
                        onClick={()=> onUndoSale(t.id)}>
                        <RotateCcw className="w-4 h-4 inline mr-1"/> Undo sale
                      </button>
                    ) : (t.memo||"").startsWith("Redeem:") ? (
                      <button className={classNames("px-2 py-1 rounded-lg text-xs", neonBtn(theme))}
                        onClick={()=> onUndoRedemption(t.id)}>
                        <RotateCcw className="w-4 h-4 inline mr-1"/> Undo redeem
                      </button>
                    ) : null}
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* history */}
      {adminTab==="history" && (
        <div className={classNames("rounded-2xl border p-4", neonBox(theme))}>
          <div className="text-sm opacity-70 mb-2">All activity</div>
          <div className="space-y-2 max-h-[560px] overflow-auto pr-2">
            {txns.map(t=>(
              <motion.div key={t.id} layout whileHover={{y:-2}} className={classNames("border rounded-xl px-3 py-2 flex items-center justify-between", neonBox(theme))}>
                <div className="text-sm">
                  <div className="font-medium">
                    {t.memo || (t.kind==="credit"?"Credit":"Debit")}
                    {(t.memo||"").startsWith("Correction (withdraw)") && <span className="ml-2 text-xs opacity-70">(withdraw)</span>}
                  </div>
                  <div className="opacity-70 text-xs">{new Date(t.dateISO).toLocaleString()}</div>
                </div>
                <div className={classNames("text-sm", t.kind==="credit" ? "text-emerald-500" : "text-rose-500")}>
                  {t.kind==="credit" ? "+" : "−"}{t.amount.toLocaleString()}
                </div>
              </motion.div>
            ))}
            {txns.length===0 && <div className="text-sm opacity-70">No activity recorded.</div>}
          </div>
        </div>
      )}

      {/* users */}
      {adminTab==="users" && (
        <div className={classNames("rounded-2xl border p-4", neonBox(theme))}>
          <div className="grid md:grid-cols-2 gap-4">
            {/* Add user */}
            <div className={classNames("rounded-xl border p-3", neonBox(theme))}>
              <div className="text-sm opacity-70 mb-2">Add Agent</div>
              <div className="flex gap-2">
                <input className={inputCls(theme)} value={newAgent} onChange={(e)=>setNewAgent(e.target.value)} placeholder="Full name"/>
                <button className={classNames("px-3 py-1.5 rounded-xl", neonBtn(theme,true))} onClick={()=> { onAddAgent(newAgent); setNewAgent(""); }}>
                  <Plus className="w-4 h-4 inline mr-1"/> Add
                </button>
              </div>
            </div>

            {/* PIN controls */}
            <div className={classNames("rounded-xl border p-3", neonBox(theme))}>
              <div className="text-sm opacity-70 mb-2">PIN Settings</div>
              <div className="grid sm:grid-cols-3 gap-2">
                <FancySelect value={pinAgent} onChange={setPinAgent} theme={theme} placeholder="Choose agent…">
                  {accounts.filter(a=>a.role!=="system").map(a=>(<option key={a.id} value={a.id}>{a.name}</option>))}
                </FancySelect>
                <input className={inputCls(theme)} maxLength={5} placeholder="5-digit PIN" value={pinVal} onChange={(e)=> setPinVal(e.target.value.replace(/\D/g,"").slice(0,5))}/>
                <div className="flex gap-2">
                  <button className={classNames("px-3 py-1.5 rounded-xl", neonBtn(theme,true))} onClick={()=> pinAgent && pinVal && onSetPin(pinAgent, pinVal)}>Set</button>
                  <button className={classNames("px-3 py-1.5 rounded-xl", neonBtn(theme))} onClick={()=> pinAgent && onResetPin(pinAgent)}>Reset</button>
                </div>
              </div>
              {pinAgent && <div className="mt-2 text-xs opacity-70">Current PIN: {pins[pinAgent] ? pins[pinAgent] : "— (not set)"}</div>}
            </div>
          </div>

          {/* list of agents with actions */}
          <div className="mt-4">
            <div className="text-sm opacity-70 mb-2">Agents</div>
            <div className="space-y-2 max-h-[520px] overflow-auto pr-2">
              {accounts.filter(a=>a.role!=="system").map(a=>{
                const bal = balances.get(a.id) || 0;
                return (
                  <motion.div key={a.id} layout whileHover={{y:-2}} className={classNames("border rounded-xl px-3 py-2", neonBox(theme))}>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="font-medium">{a.name}</div>
                        <div className="text-xs opacity-70">PIN: {pins[a.id] ?? "—"}</div>
                      </div>
                      <div className="text-sm">Balance: {bal.toLocaleString()} GCSD</div>
                      <div className="flex gap-2">
                        <button className={classNames("px-2 py-1 rounded-lg text-xs", neonBtn(theme))}
                          onClick={()=> onResetBalance(a.id)}>
                          Reset Balance
                        </button>
                        <button className={classNames("px-2 py-1 rounded-lg text-xs", neonBtn(theme,true))}
                          onClick={()=> {
                            if (confirm(`Wipe ALL history and settings for ${a.name}?`)) wipeAgent(a.id);
                          }}>
                          Wipe Agent (erase history)
                        </button>
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
/* ========== Feed (Notifications) ========== */
function FeedPage({ theme, notifs }: { theme: Theme; notifs: Notification[] }) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 160, damping: 18 }}
    >
      <div className={classNames("rounded-2xl border p-4 shadow-sm", neonBox(theme))}>
        <div className="flex items-center justify-between mb-2">
          <div className="text-sm opacity-70">Notifications</div>
          <div className="text-xs opacity-70">
            {notifs.length.toLocaleString()} total
          </div>
        </div>
        <div className="space-y-2 max-h-[560px] overflow-auto pr-2">
          {notifs.map((n) => (
            <motion.div
              key={n.id}
              layout
              whileHover={{ y: -2 }}
              className={classNames(
                "border rounded-xl px-3 py-2 flex items-center justify-between",
                neonBox(theme)
              )}
            >
              <div className="text-sm">{n.text}</div>
              <div className="text-xs opacity-70">
                {new Date(n.when).toLocaleString()}
              </div>
            </motion.div>
          ))}
          {notifs.length === 0 && (
            <div className="text-sm opacity-70">No notifications yet.</div>
          )}
        </div>
      </div>
    </motion.div>
  );
}

/* ========== Sandbox Page ========== */
function SandboxPage({ theme, onExit }: { theme: Theme; onExit: () => void }) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 160, damping: 18 }}
    >
      <div className={classNames("rounded-2xl border p-6", neonBox(theme))}>
        <div className="flex items-center gap-2 mb-2">
          <Shield className="w-4 h-4" />
          <div className="text-lg font-semibold">Sandbox Mode</div>
        </div>
        <div className="text-sm opacity-80">
          Changes here won’t affect production. You will only exit Sandbox by
          clicking the button below — navigating to Home won’t exit.
        </div>
        <div className="mt-4">
          <button
            className={classNames("px-4 py-2 rounded-xl", neonBtn(theme, true))}
            onClick={onExit}
          >
            <Shield className="w-4 h-4 inline mr-1" /> Exit Sandbox
          </button>
        </div>
      </div>
    </motion.div>
  );
}

/* ========== helpers / styles ========== */

function classNames(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

function neonBox(theme: Theme) {
  return theme === "neon"
    ? "bg-[#0B0B0B]/60 border-orange-700 text-orange-50"
    : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800";
}

function neonBtn(theme: Theme, solid = false) {
  if (theme === "neon") {
    return solid
      ? "bg-orange-600 hover:bg-orange-500 text-black border border-orange-700"
      : "bg-[#0B0B0B]/60 hover:bg-[#0B0B0B]/80 text-orange-200 border border-orange-700";
  }
  return solid
    ? "bg-black text-white hover:bg-black/90 dark:bg-white dark:text-black dark:hover:bg-white/90 border"
    : "bg-white hover:bg-slate-100 dark:bg-slate-800 dark:hover:bg-slate-700 border";
}

function inputCls(theme: Theme) {
  return classNames(
    "px-3 py-2 rounded-xl w-full border focus:outline-none",
    theme === "neon"
      ? "border-orange-700 bg-[#0B0B0B]/60 text-orange-50 placeholder-orange-300/50 [color-scheme:dark]"
      : "border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
  );
}

/* tiny confetti for milestones */
function confettiBurst() {
  // minimal, dependency-free sparkle
  const n = 20;
  const root = document.createElement("div");
  root.style.position = "fixed";
  root.style.left = "0";
  root.style.top = "0";
  root.style.width = "100vw";
  root.style.height = "100vh";
  root.style.pointerEvents = "none";
  root.style.zIndex = "9999";
  document.body.appendChild(root);

  for (let i = 0; i < n; i++) {
    const p = document.createElement("div");
    const size = 6 + Math.random() * 6;
    p.style.position = "absolute";
    p.style.left = window.innerWidth / 2 + "px";
    p.style.top = window.innerHeight / 3 + "px";
    p.style.width = size + "px";
    p.style.height = size + "px";
    p.style.borderRadius = "2px";
    p.style.background =
      ["#22c55e", "#f97316", "#06b6d4", "#e11d48"][i % 4]; // green, orange, cyan, rose
    p.style.transform =
      "translate(-50%,-50%) rotate(" + Math.floor(Math.random() * 360) + "deg)";
    root.appendChild(p);

    const dx = (Math.random() - 0.5) * 2;
    const dy = Math.random() * 1.5 + 0.5;
    const rot = (Math.random() - 0.5) * 10;

    let t = 0;
    const anim = () => {
      t += 0.016;
      const x = (window.innerWidth / 2) + dx * 600 * t;
      const y = (window.innerHeight / 3) + dy * 600 * t + 200 * t * t; // gravity
      p.style.transform = `translate(${x}px,${y}px) rotate(${rot * t * 180}deg)`;
      p.style.opacity = String(Math.max(0, 1 - t));
      if (t < 1.1) requestAnimationFrame(anim);
      else p.remove();
    };
    requestAnimationFrame(anim);
  }

  setTimeout(() => root.remove(), 1600);
}

/* ========== END GCSD APP (Part 3/3) ========== */
