import React, { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import {
  Plus, Wallet, Gift, History, Download, Upload,
  Sparkles, UserCircle2, Lock, Check, X
} from "lucide-react";

/** =========================
 *   GCS BANK — Worker + Admin
 *   - Free client-only app
 *   - Admin-only funding
 *   - Agent prize limit (2)
 *   - Prize stock control
 * ==========================*/

// ---------- APP BRAND ----------
const APP_NAME = "GCS Bank";
// Set this to "/logo.png" after you upload that file to the repo root
const LOGO_URL = "/logo.png";

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
// >>> Your requested admin PIN:
const ADMIN_PIN = "13577531";

// ---------- UTILS ----------
const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
const nowISO = () => new Date().toISOString();

function computeBalances(accounts: Account[], txns: Transaction[]) {
  const map = new Map<string, number>(accounts.map(a => [a.id, 0]));
  for (const t of txns) {
    if (t.kind === "credit" && t.toId) map.set(t.toId, (map.get(t.toId) || 0) + t.amount);
    if (t.kind === "debit" && t.fromId) map.set(t.fromId, (map.get(t.fromId) || 0) - t.amount);
    if (t.kind === "transfer") {
      if (t.fromId) map.set(t.fromId, (map.get(t.fromId) || 0) - t.amount);
      if (t.toId)   map.set(t.toId,   (map.get(t.toId)   || 0) + t.amount);
    }
  }
  return map;
}

function summarizeMonthly(txns: Transaction[]) {
  const byMonth = new Map<string, number>();
  for (const t of txns) {
    const d = new Date(t.dateISO);
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,"0")}`;
    byMonth.set(key, (byMonth.get(key) || 0) + t.amount);
  }
  return Array.from(byMonth, ([month, volume]) => ({ month, volume }))
    .sort((a,b) => a.month.localeCompare(b.month));
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
export default function GCSDApp() {
  const persisted = loadJSON<{accounts:Account[]; txns:Transaction[] } | null>(STORAGE_KEY, null);
  const [accounts, setAccounts] = useState<Account[]>(persisted?.accounts || seedAccounts);
  const [txns, setTxns] = useState<Transaction[]>(persisted?.txns || seedTxns);
  const [stock, setStock] = useState<Record<string, number>>(
    loadJSON<Record<string,number>>(STOCK_KEY, INITIAL_STOCK)
  );

  const [introSeen, setIntroSeen] = useState<boolean>(Boolean(localStorage.getItem(INTRO_SEEN_KEY)));
  const [currentAgentId, setCurrentAgentId] = useState<string>(localStorage.getItem(CURRENT_AGENT_KEY) || "");
  const [isAdmin, setIsAdmin] = useState<boolean>(Boolean(localStorage.getItem(ADMIN_FLAG_KEY)));
  const [showAdmin, setShowAdmin] = useState(false);
  const [tab, setTab] = useState<"overview"|"shop"|"activity">("overview");

  // persist
  useEffect(() => saveJSON(STORAGE_KEY, { accounts, txns }), [accounts, txns]);
  useEffect(() => saveJSON(STOCK_KEY, stock), [stock]);
  useEffect(() => { if (currentAgentId) localStorage.setItem(CURRENT_AGENT_KEY, currentAgentId); }, [currentAgentId]);
  useEffect(() => { if (isAdmin) localStorage.setItem(ADMIN_FLAG_KEY, "1"); else localStorage.removeItem(ADMIN_FLAG_KEY); }, [isAdmin]);

  const balances = useMemo(() => computeBalances(accounts, txns), [accounts, txns]);
  const monthly  = useMemo(() => summarizeMonthly(txns), [txns]);

  // derived
  const agent = accounts.find(a => a.id === currentAgentId);
  const agentBalance = balances.get(currentAgentId) || 0;
  const agentTxns = txns.filter(t => t.fromId === currentAgentId || t.toId === currentAgentId);
  const agentPrizeCount = agentTxns.filter(t => t.kind === "debit" && t.fromId === currentAgentId).length;
  const lifetimeEarn = agentTxns.filter(t =>
    (t.kind==="credit" && t.toId===currentAgentId) || (t.kind==="transfer" && t.toId===currentAgentId)
  ).reduce((a,b)=>a+b.amount,0);
  const lifetimeSpend = agentTxns.filter(t =>
    (t.kind==="debit" && t.fromId===currentAgentId) || (t.kind==="transfer" && t.fromId===currentAgentId)
  ).reduce((a,b)=>a+b.amount,0);

  // engine ops
  function postTxn(partial: Partial<Transaction> & Pick<Transaction,"kind"|"amount">) {
    const t: Transaction = { id: uid(), dateISO: nowISO(), memo: "", ...partial };
    setTxns(prev => [t, ...prev]);
  }

  // ADMIN: credit based on sale rule (agents themselves never see this UI)
  function adminCredit(agentId: string, ruleKey: string, qty: number) {
    if (!isAdmin) return toast.error("Admin only");
    const rule = PRODUCT_RULES.find(r => r.key === ruleKey);
    if (!rule) return toast.error("Unknown rule");
    if (!agentId) return toast.error("Pick an agent");
    const amount = rule.gcsd * Math.max(1, qty || 1);
    postTxn({ kind: "credit", amount, toId: agentId, memo: `${rule.label}${qty>1?` x${qty}`:""}` });
    toast.success(`Credited ${amount} GCSD to ${accounts.find(a=>a.id===agentId)?.name}`);
  }

  // WORKER: redeem a prize (enforce per-agent limit and stock)
  function redeemPrize(agentId: string, prizeKey: string) {
    const prize = PRIZE_ITEMS.find(p => p.key === prizeKey);
    if (!prize) return;
    if (agentPrizeCount >= MAX_PRIZES_PER_AGENT) return toast.error(`Limit reached (${MAX_PRIZES_PER_AGENT} prizes)`);
    const left = stock[prizeKey] ?? 0;
    if (left <= 0) return toast.error("Out of stock");
    if ((balances.get(agentId) || 0) < prize.price) return toast.error("Insufficient balance");
    postTxn({ kind: "debit", amount: prize.price, fromId: agentId, memo: `Redeem: ${prize.label}` });
    setStock(prev => ({ ...prev, [prizeKey]: left - 1 }));
    toast.success(`Redeemed ${prize.label}`);
  }

  // Mint (keep for admin ops only; agents can't add funds to themselves)
  function mintToVault(amount: number) {
    if (!isAdmin) return toast.error("Admin only");
    if (!amount || amount <= 0) return toast.error("Enter amount");
    postTxn({ kind: "credit", amount, toId: VAULT_ID, memo: "Mint" });
  }

  // UI
  return (
    <div className="min-h-screen overflow-x-hidden bg-gradient-to-b from-slate-50 to-white">
      {/* Intro */}
      <AnimatePresence>
        {!introSeen && (
          <motion.div initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} className="fixed inset-0 z-50 grid place-items-center bg-black/80 text-white">
            <motion.div initial={{scale:0.9, y:20}} animate={{scale:1, y:0}} transition={{type:"spring", stiffness:120, damping:14}} className="text-center p-8 max-w-lg">
              <motion.div initial={{opacity:0, y:10}} animate={{opacity:1, y:0}} transition={{delay:0.1}} className="mx-auto mb-4 w-16 h-16 rounded-2xl bg-white/10 grid place-items-center">
                <Sparkles className="w-8 h-8"/>
              </motion.div>
              <h1 className="text-3xl font-bold mb-2">Welcome to {APP_NAME}</h1>
              <p className="text-white/80 mb-6">Earn credits for sales. Redeem prizes. Smooth animations, instant joy.</p>
              <motion.button whileHover={{scale:1.03}} whileTap={{scale:0.97}} className="px-5 py-2 rounded-2xl bg-white text-black font-medium"
                onClick={()=>{ setIntroSeen(true); localStorage.setItem(INTRO_SEEN_KEY, "1"); }}>
                Enter
              </motion.button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Agent picker */}
      <AnimatePresence>
        {introSeen && !currentAgentId && (
          <motion.div initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} className="fixed inset-0 z-40 bg-white/80 backdrop-blur grid place-items-center">
            <motion.div initial={{y:20, opacity:0}} animate={{y:0, opacity:1}} transition={{type:"spring", stiffness:120, damping:16}} className="bg-white rounded-3xl shadow-xl p-6 w-[min(720px,92vw)]">
              <div className="flex items-center gap-2 mb-4">
                <UserCircle2/>
                <h2 className="text-xl font-semibold">Choose your portal</h2>
              </div>
              <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-2 max-h-[60vh] overflow-auto pr-2">
                {accounts.filter(a=>a.role!=="system").map((a, i)=> (
                  <motion.button key={a.id} initial={{opacity:0, y:6}} animate={{opacity:1, y:0}} transition={{delay:i*0.03}}
                    whileHover={{y:-2}} whileTap={{scale:0.98}} onClick={()=>{ setCurrentAgentId(a.id); setTab("overview"); }}
                    className="border rounded-2xl px-3 py-2 text-left bg-white hover:bg-slate-50">
                    <div className="font-medium">{a.name}</div>
                    <div className="text-xs text-slate-500">Balance: {(balances.get(a.id)||0).toLocaleString()} GCSD</div>
                  </motion.button>
                ))}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <div className="sticky top-0 z-10 backdrop-blur bg-white/70 border-b">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
          <motion.div layout className="flex items-center gap-3">
            {LOGO_URL ? <img src={LOGO_URL} alt="logo" className="h-6 w-6 rounded" /> : <Sparkles className="w-5 h-5" />}
            <span className="font-semibold">{APP_NAME}</span>
          </motion.div>
          <div className="flex items-center gap-2">
            {isAdmin && (<>
              <ImportExport accounts={accounts} txns={txns} setAll={(a,t)=>{setAccounts(a); setTxns(t);}} />
              <MintPanel onMint={mintToVault} />
            </>)}
            <motion.button whileHover={{scale:1.03}} whileTap={{scale:0.97}} className="px-3 py-1.5 rounded-xl border bg-white flex items-center gap-2"
              onClick={()=> setShowAdmin(true)}>
              <Lock className="w-4 h-4"/>{isAdmin ? "Admin" : "Admin login"}
            </motion.button>
            {currentAgentId && (
              <motion.button whileHover={{scale:1.03}} whileTap={{scale:0.97}} className="px-3 py-1.5 rounded-xl border bg-white"
                onClick={()=> setCurrentAgentId("")}>
                Switch agent
              </motion.button>
            )}
          </div>
        </div>
      </div>

      {/* Admin Drawer */}
      <AnimatePresence>
        {showAdmin && (
          <motion.div initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} className="fixed inset-0 z-40 bg-black/30">
            <motion.div initial={{x:400}} animate={{x:0}} exit={{x:400}}
              className="absolute right-0 top-0 h-full w-[min(420px,92vw)] bg-white p-4 shadow-2xl">
              <div className="flex items-center justify-between mb-3">
                <div className="font-semibold flex items-center gap-2"><Lock className="w-4 h-4"/> Admin</div>
                <button className="p-1 rounded hover:bg-slate-100" onClick={()=>setShowAdmin(false)}><X className="w-4 h-4"/></button>
              </div>

              {!isAdmin ? <AdminLogin onOk={()=>setIsAdmin(true)} /> : <AdminPanel
                accounts={accounts}
                rules={PRODUCT_RULES}
                onCredit={adminCredit}
              />}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main */}
      <div className="max-w-6xl mx-auto px-4 py-6">
        {currentAgentId ? (
          <motion.div layout initial={{opacity:0, y:10}} animate={{opacity:1, y:0}} transition={{type:"spring", stiffness:120, damping:16}}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <UserCircle2 className="w-6 h-6"/>
                <div>
                  <div className="text-sm text-slate-500">Signed in as</div>
                  <div className="text-lg font-semibold">{agent?.name}</div>
                </div>
              </div>
              <div className="flex gap-2">
                {(["overview","shop","activity"] as const).map(k=> (
                  <motion.button key={k} whileHover={{y:-2}} whileTap={{scale:0.98}}
                    className={`px-3 py-1.5 rounded-xl border ${tab===k?"bg-black text-white":"bg-white"}`}
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
                  <div className="md:col-span-3 card">
                    <div className="text-sm text-slate-500 mb-2">Monthly Volume</div>
                    <div className="flex flex-wrap gap-2">
                      {monthly.map((m,i)=> (
                        <motion.span key={m.month} initial={{opacity:0, y:6}} animate={{opacity:1, y:0}} transition={{delay:i*0.03}} className="badge">
                          {m.month}: {m.volume.toLocaleString()}
                        </motion.span>
                      ))}
                    </div>
                  </div>
                </motion.div>
              )}

              {tab==="shop" && (
                <motion.div key="shop" initial={{opacity:0, y:8}} animate={{opacity:1, y:0}} exit={{opacity:0, y:-8}} className="grid sm:grid-cols-2 md:grid-cols-3 gap-3">
                  <div className="sm:col-span-2 md:col-span-3 text-sm text-slate-600 mb-1">
                    You can redeem <b>{Math.max(0, MAX_PRIZES_PER_AGENT - agentPrizeCount)}</b> more {MAX_PRIZES_PER_AGENT - agentPrizeCount === 1 ? "prize" : "prizes"}.
                  </div>
                  {PRIZE_ITEMS.map((p,i)=> {
                    const left = stock[p.key] ?? 0;
                    const canBuy = agentBalance >= p.price && left > 0 && agentPrizeCount < MAX_PRIZES_PER_AGENT;
                    const label = left <= 0 ? "Out of stock" : (agentPrizeCount >= MAX_PRIZES_PER_AGENT ? "Limit reached" : (canBuy ? "Redeem" : "Insufficient balance"));
                    return (
                      <motion.div key={p.key} initial={{opacity:0, y:10}} animate={{opacity:1, y:0}} transition={{delay:i*0.03}}
                        className={`border rounded-2xl p-4 bg-white ${!canBuy ? "opacity-70" : ""}`}>
                        <div className="font-medium mb-1">{p.label}</div>
                        <div className="text-xs text-slate-500 mb-1">Remaining: {left}</div>
                        <div className="text-sm text-slate-500 mb-3">{p.price.toLocaleString()} GCSD</div>
                        <motion.button whileHover={{scale: canBuy?1.03:1}} whileTap={{scale: canBuy?0.97:1}}
                          disabled={!canBuy} onClick={()=>redeemPrize(currentAgentId, p.key)}
                          className={`px-3 py-1.5 rounded-xl border ${canBuy ? "bg-black text-white" : "bg-white"}`}>
                          {label}
                        </motion.button>
                      </motion.div>
                    );
                  })}
                </motion.div>
              )}

              {tab==="activity" && (
                <motion.div key="activity" initial={{opacity:0, y:8}} animate={{opacity:1, y:0}} exit={{opacity:0, y:-8}} className="card">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-lg font-semibold flex items-center gap-2"><History className="w-4 h-4"/> Activity</div>
                    <div className="text-xs text-slate-500">Newest first</div>
                  </div>
                  <div className="space-y-2 max-h-[60vh] overflow-auto pr-2">
                    {agentTxns.map((t,i)=> (
                      <motion.div key={t.id} initial={{opacity:0, y:8}} animate={{opacity:1, y:0}} transition={{delay:i*0.02}}
                        className="grid grid-cols-12 gap-2 items-center border rounded-xl p-3">
                        <div className="col-span-3 text-xs text-slate-500">{new Date(t.dateISO).toLocaleString()}</div>
                        <div className="col-span-2"><span className="badge">{t.kind}</span></div>
                        <div className="col-span-2 font-medium">{t.amount.toLocaleString()} GCSD</div>
                        <div className="col-span-5 text-sm">{t.memo}</div>
                      </motion.div>
                    ))}
                    {agentTxns.length===0 && <div className="text-sm text-slate-500">No activity yet.</div>}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        ) : (
          <HomeDashboard accounts={accounts} balances={balances} monthly={monthly}/>
        )}
      </div>
    </div>
  );
}

/* ---------------- Admin UI ---------------- */

function AdminLogin({ onOk }:{ onOk: () => void }) {
  const [pin, setPin] = useState("");
  return (
    <div className="space-y-3">
      <div className="text-sm text-slate-600">Enter admin PIN.</div>
      <input className="border rounded-xl px-3 py-2 w-full" placeholder="PIN" type="password" value={pin} onChange={e=>setPin(e.target.value)} />
      <div className="flex gap-2">
        <button className="px-3 py-1.5 rounded-xl border bg-white" onClick={()=> {
          if (pin === ADMIN_PIN) onOk();
          else toast.error("Wrong PIN");
        }}>
          <Check className="w-4 h-4 inline mr-1" /> Login
        </button>
      </div>
    </div>
  );
}

function AdminPanel({ accounts, rules, onCredit }:{
  accounts: Account[];
  rules: ProductRule[];
  onCredit: (agentId:string, ruleKey:string, qty:number) => void;
}) {
  const [agentId, setAgentId] = useState("");
  const [ruleKey, setRuleKey] = useState(rules[0]?.key || "");
  const [qty, setQty] = useState<number>(1);

  return (
    <div className="space-y-4">
      <div className="text-sm text-slate-600">Credit agents based on sales. Agents cannot self-credit.</div>
      <div className="space-y-2">
        <div className="text-xs text-slate-500">Agent</div>
        <select className="border rounded-xl px-3 py-2 w-full" value={agentId} onChange={e=>setAgentId(e.target.value)}>
          <option value="">Select agent</option>
          {accounts.filter(a=>a.role!=="system").map(a => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
      </div>
      <div className="space-y-2">
        <div className="text-xs text-slate-500">Sale type</div>
        <select className="border rounded-xl px-3 py-2 w-full" value={ruleKey} onChange={e=>setRuleKey(e.target.value)}>
          {rules.map(r => <option key={r.key} value={r.key}>{r.label} (+{r.gcsd})</option>)}
        </select>
      </div>
      <div className="space-y-2">
        <div className="text-xs text-slate-500">Quantity</div>
        <input className="border rounded-xl px-3 py-2 w-full" type="number" min={1} value={qty} onChange={e=>setQty(Math.max(1, Number(e.target.value)||1))}/>
      </div>
      <button className="px-3 py-1.5 rounded-xl border bg-black text-white"
        onClick={()=> onCredit(agentId, ruleKey, qty)}>
        Credit
      </button>
      <div className="pt-4 border-t">
        <div className="text-xs text-slate-500 mb-2">Backup & restore (JSON)</div>
        <ImportExportInline />
      </div>
    </div>
  );
}

/* ---------------- Reusable UI ---------------- */

function Tile({ icon, label, value }:{icon:React.ReactNode, label:string, value:string}){
  return (
    <motion.div initial={{opacity:0, y:8}} animate={{opacity:1, y:0}} transition={{type:"spring", stiffness:120, damping:14}} className="card">
      <div className="flex items-center gap-3">{icon}<div><div className="text-sm text-slate-500">{label}</div><div className="text-2xl font-semibold">{value}</div></div></div>
    </motion.div>
  );
}

function MintPanel({ onMint }:{onMint:(amt:number)=>void}){
  const [amt, setAmt] = useState<number>(1000);
  return (
    <div className="inline-flex gap-2">
      <input className="border rounded-xl px-3 py-1.5 w-28" type="number" value={amt} onChange={e=>setAmt(Number(e.target.value))} />
      <motion.button whileHover={{scale:1.03}} whileTap={{scale:0.97}} className="px-3 py-1.5 rounded-xl border bg-white" onClick={()=> onMint(amt)}>
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
      <motion.button whileHover={{scale:1.03}} whileTap={{scale:0.97}} className="px-3 py-1.5 rounded-xl border bg-white" onClick={exportJSON}>
        <Download className="w-4 h-4 mr-1 inline"/> Export
      </motion.button>
      <label className="px-3 py-1.5 rounded-xl border bg-white cursor-pointer">
        <Upload className="w-4 h-4 mr-1 inline"/> Import
        <input type="file" accept="application/json" className="hidden" onChange={onImportFile} />
      </label>
    </div>
  );
}

function ImportExportInline() {
  // lightweight export/import for admin drawer (shares app state via events)
  function trigger(action:"export"|"import") {
    const ev = new CustomEvent("gcs-admin-import-export", { detail: action });
    window.dispatchEvent(ev);
  }
  return (
    <div className="flex gap-2">
      <button className="px-3 py-1.5 rounded-xl border bg-white" onClick={()=>trigger("export")}><Download className="w-4 h-4 mr-1 inline"/> Export</button>
      <button className="px-3 py-1.5 rounded-xl border bg-white" onClick={()=>trigger("import")}><Upload className="w-4 h-4 mr-1 inline"/> Import</button>
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
        <div className="card">
          <div className="text-sm text-slate-500 mb-1">Top Balances</div>
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
        <div className="card">
          <div className="text-sm text-slate-500 mb-2">Monthly Volume</div>
          <div className="flex flex-wrap gap-2">
            {monthly.map((m,i)=> (
              <motion.span key={m.month} initial={{opacity:0, y:6}} animate={{opacity:1, y:0}} transition={{delay:i*0.03}} className="badge">
                {m.month}: {m.volume.toLocaleString()}
              </motion.span>
            ))}
          </div>
        </div>
      </div>
      <div className="mt-6 text-sm text-slate-600">Tip: click <b>Admin login</b> (top-right) to open the manager controls.</div>
    </motion.div>
  );
}

