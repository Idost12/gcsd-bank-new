import React, { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import {
  Plus, Wallet, Gift, History, Download, Upload,
  Sparkles, UserCircle2, Lock, Check, X, Sun, Moon
} from "lucide-react";

/** =========================
 *   GCS BANK — Worker + Admin portals
 *   - Admin PIN gate after choosing Admin tile
 *   - Add Sale via product blocks -> modal (select agent)
 *   - Admin Dashboard (balances, prize stock) + History
 *   - Worker portal (Overview / Shop / Activity)
 *   - Dark/Light mode toggle (persists)
 * ==========================*/

// ---------- APP BRAND ----------
const APP_NAME = "GCS Bank";
const LOGO_URL = "/logo.png"; // upload logo.png at repo root to show it

// ---------- TYPES ----------
type TxnKind = "credit" | "debit" | "transfer";
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
type Account = { id: string; name: string; role?: string; balance: number };
type PrizeItem = { key: string; label: string; price: number };
type ProductRule = { key: string; label: string; gcsd: number };

// ---------- AGENTS ----------
const AGENT_NAMES = [
  "Ben Mills","Oliver Steele","Maya Graves","Stan Harris","Frank Collins","Michael Wilson",
  "Caitlyn Stone","Rebecca Brooks","Logan Noir","Christopher O'Connor","Viktor Parks",
  "Hope Marshall","Justin Frey","Kevin Nolan","Sofie Roy"
];

// ---------- PRODUCT CREDIT RULES (Admin uses these) ----------
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

// ---------- PRIZES (with prices) ----------
const PRIZE_ITEMS: PrizeItem[] = [
  { key: "airfryer",        label: "Philips Airfryer",        price: 1600 },
  { key: "soundbar",        label: "LG Soundbar",             price: 2400 },
  { key: "burger_lunch",    label: "Burger Lunch",            price: 180  },
  { key: "voucher_50",      label: "Cash Voucher (50 лв)",    price: 600  },
  { key: "poker",           label: "Texas Poker Set",         price: 900  },
  { key: "soda_maker",      label: "Philips Soda Maker",      price: 900  },
  { key: "magsafe",         label: "MagSafe Charger",         price: 700  },
  { key: "galaxy_fit3",     label: "Samsung Galaxy Fit 3",    price: 3200 },
  { key: "cinema_tickets",  label: "Cinema Tickets",          price: 160  },
  { key: "neo_massager",    label: "Neo Massager",            price: 1800 },
  { key: "logi_g102",       label: "Logitech G102 Mouse",     price: 900  },
  { key: "flight_madrid",   label: "Flight to Madrid",        price: 11350 },
  { key: "flight_london",   label: "Flight to London",        price: 11350 },
  { key: "flight_milan",    label: "Flight to Milan",         price: 11350 },
];

// ---------- INITIAL STOCK ----------
const INITIAL_STOCK: Record<string, number> = {
  airfryer: 1,
  soundbar: 1,
  burger_lunch: 2,
  voucher_50: 1,
  poker: 1,
  soda_maker: 1,
  magsafe: 1,
  galaxy_fit3: 1,
  cinema_tickets: 2,
  neo_massager: 1,
  logi_g102: 1,
  flight_madrid: 2,
  flight_london: 1,
  flight_milan: 1,
};

// ---------- LIMITS ----------
const MAX_PRIZES_PER_AGENT = 2;

// ---------- KEYS ----------
const STORAGE_KEY = "gcs-v3-bank";
const STOCK_KEY   = "gcs-v3-stock";
const INTRO_SEEN_KEY = "gcs-v3-intro";
const CURRENT_AGENT_KEY = "gcs-v3-current-agent";
const ADMIN_FLAG_KEY = "gcs-v3-admin";
const THEME_KEY = "gcs-v3-theme";
const ADMIN_PIN = "13577531"; // <- your PIN

// ---------- UTILS ----------
const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
const nowISO = () => new Date().toISOString();

function computeBalances(accounts: Account[], txns: Transaction[]) {
  const map = new Map<string, number>(accounts.map(a => [a.id, 0]));
  for (const t of txns) {
    if (t.kind === "credit" && t.toId) map.set(t.toId, (map.get(t.toId) || 0) + t.amount);
    if (t.kind === "debit" && t.fromId) map.set(t.fromId, (map.get(t.fromId) || 0) - t.amount);
  }
  return map;
}
function summarizeMonthly(txns: Transaction[]) {
  const byMonth = new Map<string, number>();
  for (const t of txns) {
    const d = new Date(t.dateISO);
    const k = `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,"0")}`;
    byMonth.set(k, (byMonth.get(k) || 0) + t.amount);
  }
  return Array.from(byMonth, ([month, volume]) => ({ month, volume })).sort((a,b)=>a.month.localeCompare(b.month));
}
function loadJSON<T>(k: string, fallback: T): T {
  try { const raw = localStorage.getItem(k); return raw ? JSON.parse(raw) as T : fallback; }
  catch { return fallback; }
}
function saveJSON(k: string, v: any) {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch {}
}

// ---------- SEED ----------
const seedAccounts: Account[] = [
  { id: uid(), name: "Bank Vault", role: "system", balance: 0 },
  ...AGENT_NAMES.map(n => ({ id: uid(), name: n, role: "agent", balance: 0 })),
];
const VAULT_ID = seedAccounts[0].id;
const seedTxns: Transaction[] = [
  { id: uid(), kind: "credit", amount: 8000, memo: "Initial mint", dateISO: nowISO(), toId: VAULT_ID },
];

// ---------- APP ----------
type Portal = "none" | "agent" | "admin";

export default function GCSDApp() {
  const persisted = loadJSON<{accounts:Account[]; txns:Transaction[] } | null>(STORAGE_KEY, null);
  const [accounts, setAccounts] = useState<Account[]>(persisted?.accounts || seedAccounts);
  const [txns, setTxns] = useState<Transaction[]>(persisted?.txns || seedTxns);
  const [stock, setStock] = useState<Record<string, number>>(loadJSON(STOCK_KEY, INITIAL_STOCK));

  const [introSeen, setIntroSeen] = useState<boolean>(Boolean(localStorage.getItem(INTRO_SEEN_KEY)));
  const [portal, setPortal] = useState<Portal>("none");
  const [currentAgentId, setCurrentAgentId] = useState<string>(localStorage.getItem(CURRENT_AGENT_KEY) || "");
  const [isAdmin, setIsAdmin] = useState<boolean>(Boolean(localStorage.getItem(ADMIN_FLAG_KEY)));
  const [showPinModal, setShowPinModal] = useState(false);
  const [tab, setTab] = useState<"overview"|"shop"|"activity">("overview");
  const [adminTab, setAdminTab] = useState<"dashboard"|"addsale"|"history">("dashboard");
  const [theme, setTheme] = useState<"light"|"dark">((localStorage.getItem(THEME_KEY) as any) || "light");

  // persist
  useEffect(()=> saveJSON(STORAGE_KEY, {accounts, txns}), [accounts, txns]);
  useEffect(()=> saveJSON(STOCK_KEY, stock), [stock]);
  useEffect(()=> { if(currentAgentId) localStorage.setItem(CURRENT_AGENT_KEY, currentAgentId); }, [currentAgentId]);
  useEffect(()=> { if(isAdmin) localStorage.setItem(ADMIN_FLAG_KEY, "1"); else localStorage.removeItem(ADMIN_FLAG_KEY); }, [isAdmin]);
  useEffect(()=> { localStorage.setItem(THEME_KEY, theme); document.documentElement.classList.toggle("dark", theme==="dark"); }, [theme]);

  const balances = useMemo(()=>computeBalances(accounts, txns), [accounts, txns]);
  const monthly = useMemo(()=>summarizeMonthly(txns), [txns]);

  // derived for agent
  const agent = accounts.find(a=>a.id===currentAgentId);
  const agentBalance = balances.get(currentAgentId)||0;
  const agentTxns = txns.filter(t=> t.fromId===currentAgentId || t.toId===currentAgentId);
  const agentPrizeCount = agentTxns.filter(t=> t.kind==="debit" && t.fromId===currentAgentId).length;
  const lifetimeEarn = agentTxns.filter(t=> t.kind==="credit" && t.toId===currentAgentId).reduce((a,b)=>a+b.amount,0);
  const lifetimeSpend = agentTxns.filter(t=> t.kind==="debit" && t.fromId===currentAgentId).reduce((a,b)=>a+b.amount,0);

  // engine ops
  function postTxn(partial: Partial<Transaction> & Pick<Transaction,"kind"|"amount">) {
    const t: Transaction = { id: uid(), dateISO: nowISO(), memo: "", ...partial };
    setTxns(prev => [t, ...prev]);
  }

  function redeemPrize(agentId:string, prizeKey:string){
    const prize = PRIZE_ITEMS.find(p=>p.key===prizeKey); if(!prize) return;
    if (agentPrizeCount >= MAX_PRIZES_PER_AGENT) return toast.error(`Limit reached (${MAX_PRIZES_PER_AGENT})`);
    const left = stock[prizeKey] ?? 0;
    if (left <= 0) return toast.error("Out of stock");
    if ((balances.get(agentId)||0) < prize.price) return toast.error("Insufficient balance");
    postTxn({ kind:"debit", amount: prize.price, fromId: agentId, memo:`Redeem: ${prize.label}` });
    setStock(s=>({...s, [prizeKey]: left-1}));
    toast.success(`Redeemed ${prize.label}`);
  }

  // ADMIN actions
  function adminCredit(agentId:string, ruleKey:string, qty:number){
    if (!isAdmin) return toast.error("Admin only");
    const rule = PRODUCT_RULES.find(r=>r.key===ruleKey); if(!rule) return;
    if (!agentId) return toast.error("Choose agent");
    const amount = rule.gcsd * Math.max(1, qty||1);
    postTxn({ kind:"credit", amount, toId: agentId, memo:`${rule.label}${qty>1?` x${qty}`:""}`, meta:{product:rule.key, qty} });
    toast.success(`Added ${amount} GCSD to ${accounts.find(a=>a.id===agentId)?.name}`);
  }
  function mintToVault(amount:number){
    if (!isAdmin) return toast.error("Admin only");
    if (!amount || amount<=0) return toast.error("Enter amount");
    postTxn({ kind:"credit", amount, toId: VAULT_ID, memo:"Mint" });
  }

  // UI
  return (
    <div className="min-h-screen overflow-x-hidden bg-gradient-to-b from-slate-50 to-white dark:from-slate-900 dark:to-slate-950 dark:text-slate-100">
      {/* Intro */}
      <AnimatePresence>
        {!introSeen && (
          <motion.div initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}}
            className="fixed inset-0 z-50 grid place-items-center bg-black/80 text-white">
            <motion.div initial={{scale:0.9, y:20}} animate={{scale:1, y:0}}
              transition={{type:"spring", stiffness:120, damping:14}} className="text-center p-8 max-w-lg">
              <motion.div initial={{opacity:0, y:10}} animate={{opacity:1, y:0}} transition={{delay:0.1}}
                className="mx-auto mb-4 w-16 h-16 rounded-2xl bg-white/10 grid place-items-center">
                <Sparkles className="w-8 h-8"/>
              </motion.div>
              <h1 className="text-3xl font-bold mb-2">Welcome to {APP_NAME}</h1>
              <p className="text-white/80 mb-6">Choose Admin or your Agent portal.</p>
              <motion.button whileHover={{scale:1.03}} whileTap={{scale:0.97}}
                className="px-5 py-2 rounded-2xl bg-white text-black font-medium"
                onClick={()=>{ setIntroSeen(true); localStorage.setItem(INTRO_SEEN_KEY,"1"); }}>
                Continue
              </motion.button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Portal picker */}
      <AnimatePresence>
        {introSeen && portal==="none" && (
          <motion.div initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}}
            className="fixed inset-0 z-40 bg-white/80 backdrop-blur dark:bg-slate-900/70 grid place-items-center">
            <motion.div initial={{y:20, opacity:0}} animate={{y:0, opacity:1}}
              transition={{type:"spring", stiffness:120, damping:16}}
              className="bg-white dark:bg-slate-900 rounded-3xl shadow-xl p-6 w-[min(780px,92vw)]">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2"><UserCircle2/><h2 className="text-xl font-semibold">Choose portal</h2></div>
                <ThemeToggle theme={theme} setTheme={setTheme}/>
              </div>

              <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-2 max-h-[60vh] overflow-auto pr-2">
                {/* Admin tile */}
                <motion.button
                  initial={{opacity:0, y:6}} animate={{opacity:1, y:0}} transition={{delay:0.03}}
                  whileHover={{y:-2}} whileTap={{scale:0.98}}
                  onClick={()=>{ setPortal("admin"); if(!isAdmin) setShowPinModal(true); }}
                  className="border rounded-2xl px-3 py-3 text-left bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700">
                  <div className="font-semibold flex items-center gap-2"><Lock className="w-4 h-4"/> Admin Portal</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    {isAdmin ? "Logged in" : "PIN required"}
                  </div>
                </motion.button>

                {/* Agents */}
                {accounts.filter(a=>a.role!=="system").map((a,i)=>(
                  <motion.button key={a.id}
                    initial={{opacity:0, y:6}} animate={{opacity:1, y:0}} transition={{delay:0.04 + i*0.02}}
                    whileHover={{y:-2}} whileTap={{scale:0.98}}
                    onClick={()=>{ setCurrentAgentId(a.id); setPortal("agent"); setTab("overview"); }}
                    className="border rounded-2xl px-3 py-3 text-left bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700">
                    <div className="font-medium">{a.name}</div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">Balance: {(balances.get(a.id)||0).toLocaleString()} GCSD</div>
                  </motion.button>
                ))}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <div className="sticky top-0 z-10 backdrop-blur bg-white/70 dark:bg-slate-900/70 border-b border-slate-200 dark:border-slate-800">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
          <motion.div layout className="flex items-center gap-3">
            {LOGO_URL ? <img src={LOGO_URL} alt="logo" className="h-6 w-6 rounded" /> : <Sparkles className="w-5 h-5" />}
            <span className="font-semibold">{APP_NAME}</span>
          </motion.div>
          <div className="flex items-center gap-2">
            <ThemeToggle theme={theme} setTheme={setTheme}/>
            {portal!=="none" && (
              <motion.button whileHover={{scale:1.03}} whileTap={{scale:0.97}}
                className="px-3 py-1.5 rounded-xl border bg-white dark:bg-slate-800"
                onClick={()=>{ setPortal("none"); setCurrentAgentId(""); }}>
                Switch portal
              </motion.button>
            )}
          </div>
        </div>
      </div>

      {/* PIN modal */}
      <AnimatePresence>
        {showPinModal && (
          <PinModal onClose={()=>setShowPinModal(false)} onOk={()=>{ setIsAdmin(true); setShowPinModal(false); toast.success("Admin unlocked"); }}/>
        )}
      </AnimatePresence>

      {/* Main */}
      <div className="max-w-6xl mx-auto px-4 py-6">
        {portal==="agent" && currentAgentId ? (
          <AgentPortal
            monthly={monthly}
            tab={tab} setTab={setTab}
            agentName={agent?.name||""}
            agentBalance={agentBalance}
            lifetimeEarn={lifetimeEarn}
            lifetimeSpend={lifetimeSpend}
            txns={agentTxns}
            prizes={PRIZE_ITEMS}
            stock={stock}
            prizeCount={agentPrizeCount}
            onRedeem={(k)=>redeemPrize(currentAgentId, k)}
          />
        ) : portal==="admin" ? (
          <AdminPortal
            isAdmin={isAdmin}
            accounts={accounts}
            balances={balances}
            stock={stock}
            setStock={setStock}
            rules={PRODUCT_RULES}
            txns={txns}
            onCredit={adminCredit}
            onMint={mintToVault}
            adminTab={adminTab} setAdminTab={setAdminTab}
          />
        ) : (
          <HomeDashboard accounts={accounts} balances={balances} monthly={monthly}/>
        )}
      </div>
    </div>
  );
}

/* ---------------- Components ---------------- */

function ThemeToggle({theme, setTheme}:{theme:"light"|"dark"; setTheme:(t:"light"|"dark")=>void}) {
  return (
    <button className="px-3 py-1.5 rounded-xl border bg-white dark:bg-slate-800 flex items-center gap-2"
      onClick={()=> setTheme(theme==="light"?"dark":"light")}>
      {theme==="light" ? <><Moon className="w-4 h-4"/> Dark</> : <><Sun className="w-4 h-4"/> Light</>}
    </button>
  );
}

function PinModal({ onClose, onOk }:{ onClose:()=>void; onOk:()=>void }) {
  const [pin, setPin] = useState("");
  return (
    <motion.div initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} className="fixed inset-0 z-50 bg-black/40 grid place-items-center">
      <motion.div initial={{scale:0.95}} animate={{scale:1}} exit={{scale:0.95}} className="bg-white dark:bg-slate-900 rounded-2xl p-5 w-[min(420px,92vw)]">
        <div className="flex items-center justify-between mb-3">
          <div className="font-semibold flex items-center gap-2"><Lock className="w-4 h-4"/> Admin PIN</div>
          <button className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800" onClick={onClose}><X className="w-4 h-4"/></button>
        </div>
        <div className="space-y-3">
          <div className="text-sm text-slate-600 dark:text-slate-300">Enter PIN to unlock Admin portal.</div>
          <input className="border rounded-xl px-3 py-2 w-full bg-white dark:bg-slate-800" placeholder="PIN" type="password" value={pin} onChange={e=>setPin(e.target.value)} />
          <button className="px-3 py-1.5 rounded-xl border bg-black text-white" onClick={()=> pin===ADMIN_PIN ? onOk() : toast.error("Wrong PIN")}>
            <Check className="w-4 h-4 inline mr-1"/> Unlock
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function AgentPortal(props:{
  monthly:{month:string; volume:number}[];
  tab:"overview"|"shop"|"activity"; setTab:(t:any)=>void;
  agentName:string; agentBalance:number; lifetimeEarn:number; lifetimeSpend:number;
  txns:Transaction[]; prizes:PrizeItem[]; stock:Record<string,number>; prizeCount:number;
  onRedeem:(k:string)=>void;
}) {
  const { monthly, tab, setTab, agentName, agentBalance, lifetimeEarn, lifetimeSpend, txns, prizes, stock, prizeCount, onRedeem } = props;
  return (
    <motion.div layout initial={{opacity:0, y:10}} animate={{opacity:1, y:0}} transition={{type:"spring", stiffness:120, damping:16}}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <UserCircle2 className="w-6 h-6"/>
          <div>
            <div className="text-sm text-slate-500 dark:text-slate-400">Signed in as</div>
            <div className="text-lg font-semibold">{agentName}</div>
          </div>
        </div>
        <div className="flex gap-2">
          {(["overview","shop","activity"] as const).map(k=> (
            <motion.button key={k} whileHover={{y:-2}} whileTap={{scale:0.98}}
              className={`px-3 py-1.5 rounded-xl border ${tab===k?"bg-black text-white":"bg-white dark:bg-slate-800"}`}
              onClick={()=>setTab(k)}>
              {k[0].toUpperCase()+k.slice(1)}
            </motion.button>
          ))}
        </div>
      </div>

      <AnimatePresence mode="wait">
        {tab==="overview" && (
          <motion.div key="overview" initial={{opacity:0, y:8}} animate={{opacity:1, y:0}} exit={{opacity:0, y:-8}} className="grid md:grid-cols-3 gap-4">
            <Tile icon={<Wallet/>} label="Current Balance" value={`${agentBalance.toLocaleString()} GCSD`} />
            <Tile icon={<Sparkles/>} label="Lifetime Earned" value={`${lifetimeEarn.toLocaleString()} GCSD`} />
            <Tile icon={<Gift/>} label="Lifetime Spent" value={`${lifetimeSpend.toLocaleString()} GCSD`} />
            <div className="md:col-span-3 card dark:bg-slate-800">
              <div className="text-sm text-slate-500 dark:text-slate-400 mb-2">Monthly Volume</div>
              <div className="flex flex-wrap gap-2">
                {monthly.map((m,i)=> (
                  <motion.span key={m.month} initial={{opacity:0, y:6}} animate={{opacity:1, y:0}} transition={{delay:i*0.03}} className="badge dark:bg-slate-700">
                    {m.month}: {m.volume.toLocaleString()}
                  </motion.span>
                ))}
              </div>
            </div>
          </motion.div>
        )}

        {tab==="shop" && (
          <motion.div key="shop" initial={{opacity:0, y:8}} animate={{opacity:1, y:0}} exit={{opacity:0, y:-8}} className="grid sm:grid-cols-2 md:grid-cols-3 gap-3">
            <div className="sm:col-span-2 md:col-span-3 text-sm text-slate-600 dark:text-slate-300 mb-1">
              You can redeem <b>{Math.max(0, MAX_PRIZES_PER_AGENT - prizeCount)}</b> more {MAX_PRIZES_PER_AGENT - prizeCount === 1 ? "prize" : "prizes"}.
            </div>
            {prizes.map((p,i)=> {
              const left = stock[p.key] ?? 0;
              const canBuy = agentBalance >= p.price && left > 0 && prizeCount < MAX_PRIZES_PER_AGENT;
              const label = left <= 0 ? "Out of stock" : (prizeCount >= MAX_PRIZES_PER_AGENT ? "Limit reached" : (canBuy ? "Redeem" : "Insufficient balance"));
              return (
                <motion.div key={p.key} initial={{opacity:0, y:10}} animate={{opacity:1, y:0}} transition={{delay:i*0.03}}
                  className={`border rounded-2xl p-4 bg-white dark:bg-slate-800 ${!canBuy ? "opacity-70" : ""}`}>
                  <div className="font-medium mb-1">{p.label}</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400 mb-1">Remaining: {left}</div>
                  <div className="text-sm text-slate-500 dark:text-slate-400 mb-3">{p.price.toLocaleString()} GCSD</div>
                  <motion.button whileHover={{scale: canBuy?1.03:1}} whileTap={{scale: canBuy?0.97:1}}
                    disabled={!canBuy} onClick={()=>onRedeem(p.key)}
                    className={`px-3 py-1.5 rounded-xl border ${canBuy ? "bg-black text-white" : "bg-white dark:bg-slate-700"}`}>
                    {label}
                  </motion.button>
                </motion.div>
              );
            })}
          </motion.div>
        )}

        {tab==="activity" && (
          <motion.div key="activity" initial={{opacity:0, y:8}} animate={{opacity:1, y:0}} exit={{opacity:0, y:-8}} className="card dark:bg-slate-800">
            <div className="flex items-center justify-between mb-2">
              <div className="text-lg font-semibold flex items-center gap-2"><History className="w-4 h-4"/> Activity</div>
              <div className="text-xs text-slate-500 dark:text-slate-400">Newest first</div>
            </div>
            <div className="space-y-2 max-h-[60vh] overflow-auto pr-2">
              {txns.map((t,i)=> (
                <motion.div key={t.id} initial={{opacity:0, y:8}} animate={{opacity:1, y:0}} transition={{delay:i*0.02}}
                  className="grid grid-cols-12 gap-2 items-center border rounded-xl p-3">
                  <div className="col-span-3 text-xs text-slate-500 dark:text-slate-400">{new Date(t.dateISO).toLocaleString()}</div>
                  <div className="col-span-2"><span className="badge dark:bg-slate-700">{t.kind}</span></div>
                  <div className="col-span-2 font-medium">{t.amount.toLocaleString()} GCSD</div>
                  <div className="col-span-5 text-sm">{t.memo}</div>
                </motion.div>
              ))}
              {txns.length===0 && <div className="text-sm text-slate-500 dark:text-slate-400">No activity yet.</div>}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function AdminPortal(props:{
  isAdmin:boolean;
  accounts:Account[];
  balances:Map<string,number>;
  stock:Record<string,number>;
  setStock:React.Dispatch<React.SetStateAction<Record<string,number>>>;
  rules:ProductRule[];
  txns:Transaction[];
  onCredit:(agent:string, rule:string, qty:number)=>void;
  onMint:(amt:number)=>void;
  adminTab:"dashboard"|"addsale"|"history";
  setAdminTab:(t:"dashboard"|"addsale"|"history")=>void;
}) {
  const { isAdmin, accounts, balances, stock, rules, txns, onCredit, onMint, adminTab, setAdminTab } = props;
  return (
    <motion.div layout initial={{opacity:0, y:10}} animate={{opacity:1, y:0}} transition={{type:"spring", stiffness:120, damping:16}}>
      <div className="flex items-center justify-between mb-4">
        <div className="font-semibold flex items-center gap-2"><Lock className="w-4 h-4"/> Admin</div>
        <div className="flex gap-2">
          {(["dashboard","addsale","history"] as const).map(k=> (
            <button key={k} className={`px-3 py-1.5 rounded-xl border ${adminTab===k?"bg-black text-white":"bg-white dark:bg-slate-800"}`}
              onClick={()=>setAdminTab(k)}>{k[0].toUpperCase()+k.slice(1)}</button>
          ))}
        </div>
      </div>

      {!isAdmin ? (
        <div className="card dark:bg-slate-800">Enter PIN from the portal screen to unlock.</div>
      ) : (
        <>
          {adminTab==="dashboard" && (
            <motion.div key="dashboard" initial={{opacity:0, y:8}} animate={{opacity:1, y:0}} exit={{opacity:0, y:-8}} className="grid md:grid-cols-3 gap-4">
              <div className="card dark:bg-slate-800">
                <div className="text-sm text-slate-500 dark:text-slate-400 mb-1">All Balances</div>
                <ul className="space-y-1 max-h-72 overflow-auto pr-1">
                  {accounts.filter(a=>a.role!=="system").sort((a,b)=>(balances.get(b.id)||0)-(balances.get(a.id)||0)).map(a=>(
                    <li key={a.id} className="flex justify-between">
                      <span>{a.name}</span><span className="font-medium">{(balances.get(a.id)||0).toLocaleString()} GCSD</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="card dark:bg-slate-800">
                <div className="text-sm text-slate-500 dark:text-slate-400 mb-1">Prize Stock</div>
                <ul className="space-y-1 max-h-72 overflow-auto pr-1">
                  {PRIZE_ITEMS.map(p=>(
                    <li key={p.key} className="flex justify-between">
                      <span>{p.label}</span><span className="font-medium">{stock[p.key] ?? 0}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="card dark:bg-slate-800">
                <div className="text-sm text-slate-500 dark:text-slate-400 mb-2">Mint (optional)</div>
                <MintPanel onMint={onMint}/>
                <div className="text-xs text-slate-500 dark:text-slate-400 mt-2">Adds GCSD to the Vault; does not credit an agent.</div>
              </div>
            </motion.div>
          )}

          {adminTab==="addsale" && <AddSale rules={rules} accounts={accounts} onCredit={onCredit} />}
          {adminTab==="history" && <AdminHistory txns={txns} accounts={accounts} />}
        </>
      )}
    </motion.div>
  );
}

function AddSale({ rules, accounts, onCredit }:{
  rules:ProductRule[]; accounts:Account[]; onCredit:(agent:string, rule:string, qty:number)=>void
}) {
  const [modal, setModal] = useState<{open:boolean; rule?:ProductRule}>({open:false});
  const [agent, setAgent] = useState("");
  const [qty, setQty] = useState<number>(1);

  function open(rule:ProductRule){ setModal({open:true, rule}); }
  function confirm(){
    if (!modal.rule) return;
    onCredit(agent, modal.rule.key, qty);
    setModal({open:false}); setQty(1); setAgent("");
  }

  return (
    <>
      <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-3">
        {rules.map((r,i)=>(
          <motion.button key={r.key} initial={{opacity:0, y:8}} animate={{opacity:1, y:0}} transition={{delay:i*0.03}}
            className="border rounded-2xl p-4 bg-white dark:bg-slate-800 text-left hover:bg-slate-50 dark:hover:bg-slate-700"
            onClick={()=>open(r)}>
            <div className="font-semibold">{r.label}</div>
            <div className="text-sm text-slate-500 dark:text-slate-400">+{r.gcsd} GCSD</div>
          </motion.button>
        ))}
      </div>

      <AnimatePresence>
        {modal.open && modal.rule && (
          <motion.div initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} className="fixed inset-0 z-50 bg-black/40 grid place-items-center">
            <motion.div initial={{scale:0.95}} animate={{scale:1}} exit={{scale:0.95}} className="bg-white dark:bg-slate-900 rounded-2xl p-5 w-[min(440px,92vw)]">
              <div className="flex items-center justify-between mb-3">
                <div className="font-semibold">Add Sale — {modal.rule.label} (+{modal.rule.gcsd})</div>
                <button className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800" onClick={()=>setModal({open:false})}><X className="w-4 h-4"/></button>
              </div>
              <div className="space-y-3">
                <div>
                  <div className="text-xs text-slate-500 dark:text-slate-400 mb-1">Agent</div>
                  <select className="border rounded-xl px-3 py-2 w-full bg-white dark:bg-slate-800" value={agent} onChange={e=>setAgent(e.target.value)}>
                    <option value="">Choose agent</option>
                    {accounts.filter(a=>a.role!=="system").map(a=>(
                      <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <div className="text-xs text-slate-500 dark:text-slate-400 mb-1">Quantity</div>
                  <input className="border rounded-xl px-3 py-2 w-full bg-white dark:bg-slate-800" type="number" min={1} value={qty} onChange={e=>setQty(Math.max(1, Number(e.target.value)||1))}/>
                </div>
                <div className="flex gap-2">
                  <button className="px-3 py-1.5 rounded-xl border bg-black text-white" onClick={confirm}>Confirm</button>
                  <button className="px-3 py-1.5 rounded-xl border bg-white dark:bg-slate-800" onClick={()=>setModal({open:false})}>Cancel</button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

function AdminHistory({ txns, accounts }:{ txns:Transaction[]; accounts:Account[] }) {
  const credits = txns.filter(t=> t.kind==="credit" && t.toId && t.memo && t.memo !== "Mint");
  const byId = new Map(accounts.map(a=>[a.id, a.name]));
  return (
    <div className="card dark:bg-slate-800">
      <div className="text-sm text-slate-500 dark:text-slate-400 mb-2">Sales History</div>
      <div className="space-y-2 max-h-[65vh] overflow-auto pr-2">
        {credits.map((t,i)=>(
          <motion.div key={t.id} initial={{opacity:0, y:6}} animate={{opacity:1, y:0}} transition={{delay:i*0.02}}
            className="flex items-center justify-between border rounded-xl p-3">
            <div className="text-sm">
              <b>{byId.get(t.toId!)}</b> — {t.memo}
            </div>
            <div className="text-sm font-medium">+{t.amount} GCSD</div>
            <div className="text-xs text-slate-500 dark:text-slate-400">{new Date(t.dateISO).toLocaleString()}</div>
          </motion.div>
        ))}
        {credits.length===0 && <div className="text-sm text-slate-500 dark:text-slate-400">No sales yet.</div>}
      </div>
    </div>
  );
}

function Tile({ icon, label, value }:{icon:React.ReactNode, label:string, value:string}){
  return (
    <motion.div initial={{opacity:0, y:8}} animate={{opacity:1, y:0}} transition={{type:"spring", stiffness:120, damping:14}} className="card dark:bg-slate-800">
      <div className="flex items-center gap-3">{icon}<div><div className="text-sm text-slate-500 dark:text-slate-400">{label}</div><div className="text-2xl font-semibold">{value}</div></div></div>
    </motion.div>
  );
}

function MintPanel({ onMint }:{onMint:(amt:number)=>void}){
  const [amt, setAmt] = useState<number>(1000);
  return (
    <div className="inline-flex gap-2">
      <input className="border rounded-xl px-3 py-1.5 w-28 bg-white dark:bg-slate-800" type="number" value={amt} onChange={e=>setAmt(Number(e.target.value))} />
      <motion.button whileHover={{scale:1.03}} whileTap={{scale:0.97}} className="px-3 py-1.5 rounded-xl border bg-white dark:bg-slate-800" onClick={()=> onMint(amt)}>
        <Plus className="w-4 h-4 mr-1 inline"/> Mint
      </motion.button>
    </div>
  );
}

function ImportExport({ accounts, txns, setAll }:{
  accounts:Account[]; txns:Transaction[]; setAll:(a:Account[],t:Transaction[])=>void
}) {
  function exportJSON() {
    const blob = new Blob([JSON.stringify({ accounts, txns }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob); const a = document.createElement("a");
    a.href = url; a.download = `gcs-bank-${Date.now()}.json`; a.click(); URL.revokeObjectURL(url);
  }
  function onImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const obj:any = JSON.parse(String(reader.result));
        if (obj.accounts && obj.txns) setAll(obj.accounts, obj.txns);
        else toast.error("Invalid file");
      } catch { toast.error("Failed to import"); }
    };
    reader.readAsText(file);
  }
  return (
    <div className="flex gap-2">
      <motion.button whileHover={{scale:1.03}} whileTap={{scale:0.97}} className="px-3 py-1.5 rounded-xl border bg-white dark:bg-slate-800" onClick={exportJSON}>
        <Download className="w-4 h-4 mr-1 inline"/> Export
      </motion.button>
      <label className="px-3 py-1.5 rounded-xl border bg-white dark:bg-slate-800 cursor-pointer">
        <Upload className="w-4 h-4 mr-1 inline"/> Import
        <input type="file" accept="application/json" className="hidden" onChange={onImportFile} />
      </label>
    </div>
  );
}

function HomeDashboard({ accounts, balances, monthly }:{
  accounts:Account[]; balances:Map<string,number>; monthly:{month:string; volume:number}[];
}) {
  return (
    <motion.div layout initial={{opacity:0, y:10}} animate={{opacity:1, y:0}} transition={{type:"spring", stiffness:120, damping:16}}>
      <div className="grid md:grid-cols-3 gap-4">
        <Tile icon={<Wallet/>} label="Total Circulating" value={`${Array.from(balances.values()).reduce((a,b)=>a+b,0).toLocaleString()} GCSD`} />
        <div className="card dark:bg-slate-800">
          <div className="text-sm text-slate-500 dark:text-slate-400 mb-1">Top Balances</div>
          <ul className="space-y-1 max-h-56 overflow-auto pr-1">
            {[...accounts.filter(a=>a.role!=="system")]
              .sort((a,b)=>(balances.get(b.id)||0)-(balances.get(a.id)||0))
              .slice(0,10)
              .map(a=> (
                <li key={a.id} className="flex justify-between">
                  <span>{a.name}</span><span className="font-medium">{(balances.get(a.id)||0).toLocaleString()} GCSD</span>
                </li>
              ))}
          </ul>
        </div>
        <div className="card dark:bg-slate-800">
          <div className="text-sm text-slate-500 dark:text-slate-400 mb-2">Monthly Volume</div>
          <div className="flex flex-wrap gap-2">
            {monthly.map((m,i)=> (
              <motion.span key={m.month} initial={{opacity:0, y:6}} animate={{opacity:1, y:0}} transition={{delay:i*0.03}} className="badge dark:bg-slate-700">
                {m.month}: {m.volume.toLocaleString()}
              </motion.span>
            ))}
          </div>
        </div>
      </div>
    </motion.div>
  );
}
