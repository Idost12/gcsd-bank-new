import React, { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Toaster, toast } from "sonner";
import {
  Wallet, Gift, History, Sparkles, UserCircle2, Lock, Check, X,
  Sun, Moon, Users, Home as HomeIcon, RotateCcw
} from "lucide-react";

/** =========================
 *   GCS BANK — Public Home + Portals
 * ==========================*/

const APP_NAME = "GCS Bank";
const LOGO_URL = "/logo.png"; // MUST exist at /public/logo.png

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
type Account = { id: string; name: string; role?: "system"|"agent"; balance: number };
type PrizeItem = { key: string; label: string; price: number };
type ProductRule = { key: string; label: string; gcsd: number };

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

const INITIAL_STOCK: Record<string, number> = {
  airfryer: 1, soundbar: 1, burger_lunch: 2, voucher_50: 1, poker: 1,
  soda_maker: 1, magsafe: 1, galaxy_fit3: 1, cinema_tickets: 2, neo_massager: 1, logi_g102: 1,
  flight_madrid: 1, flight_london: 1, flight_milan: 1,
};

const MAX_PRIZES_PER_AGENT = 2;

const STORAGE_KEY = "gcs-v3-bank";
const STOCK_KEY   = "gcs-v3-stock";
const THEME_KEY   = "gcs-v3-theme";
const ADMIN_PIN   = "13577531";

const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
const nowISO = () => new Date().toISOString();
const fmtTime = (d: Date) => [d.getHours(), d.getMinutes(), d.getSeconds()].map(n => String(n).padStart(2,"0")).join(":");
const fmtDate = (d: Date) => d.toLocaleDateString(undefined, {year:"numeric", month:"short", day:"2-digit" });
const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;

function computeBalances(accounts: Account[], txns: Transaction[]) {
  const map = new Map<string, number>(accounts.map(a => [a.id, 0]));
  for (const t of txns) {
    if (t.kind === "credit" && t.toId) map.set(t.toId, (map.get(t.toId) || 0) + t.amount);
    if (t.kind === "debit" && t.fromId) map.set(t.fromId, (map.get(t.fromId) || 0) - t.amount);
  }
  return map;
}
function loadJSON<T>(k: string, fallback: T): T { try { const raw = localStorage.getItem(k); return raw ? JSON.parse(raw) as T : fallback; } catch { return fallback; } }
function saveJSON(k: string, v: any) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }

const seedAccounts: Account[] = [
  { id: uid(), name: "Bank Vault", role: "system", balance: 0 },
  ...AGENT_NAMES.map(n => ({ id: uid(), name: n, role: "agent", balance: 0 })),
];
const VAULT_ID = seedAccounts[0].id;
const seedTxns: Transaction[] = [
  { id: uid(), kind: "credit", amount: 8000, memo: "Mint", dateISO: nowISO(), toId: VAULT_ID },
];

type Portal = "none" | "agent" | "admin";

export default function GCSDApp() {
  const persisted = loadJSON<{accounts:Account[]; txns:Transaction[] } | null>(STORAGE_KEY, null);
  const [accounts] = useState<Account[]>(persisted?.accounts || seedAccounts);
  const [txns, setTxns] = useState<Transaction[]>(persisted?.txns || seedTxns);
  const [stock, setStock] = useState<Record<string, number>>(loadJSON(STOCK_KEY, INITIAL_STOCK));

  const [portal, setPortal] = useState<Portal>("none");
  const [currentAgentId, setCurrentAgentId] = useState<string>("");
  const [isAdmin, setIsAdmin] = useState<boolean>(false);
  const [pickerOpen, setPickerOpen] = useState<boolean>(false);

  const [showIntro, setShowIntro] = useState<boolean>(true);

  const [adminTab, setAdminTab] = useState<"dashboard"|"addsale"|"history"|"transfer"|"corrections">("dashboard");

  const [theme, setTheme] = useState<"light"|"dark">((localStorage.getItem(THEME_KEY) as any) || "light");
  const [clock, setClock] = useState<string>(fmtTime(new Date()));
  const [dateStr, setDateStr] = useState<string>(fmtDate(new Date()));
  const [themeFlip, setThemeFlip] = useState<number>(0);

  useEffect(()=> saveJSON(STORAGE_KEY, {accounts, txns}), [accounts, txns]);
  useEffect(()=> saveJSON(STOCK_KEY, stock), [stock]);
  useEffect(()=> {
    localStorage.setItem(THEME_KEY, theme);
    document.documentElement.classList.toggle("dark", theme==="dark");
    setThemeFlip(x=>x+1);
  }, [theme]);
  useEffect(()=> {
    const t = setInterval(()=> { const d = new Date(); setClock(fmtTime(d)); setDateStr(fmtDate(d)); }, 1000);
    return ()=> clearInterval(t);
  }, []);
  useEffect(()=> {
    if (!showIntro) return;
    const timer = setTimeout(()=> setShowIntro(false), 2000);
    const onKey = (e: KeyboardEvent)=> { if (e.key === "Enter") setShowIntro(false); };
    window.addEventListener("keydown", onKey);
    return ()=> { clearTimeout(timer); window.removeEventListener("keydown", onKey); };
  }, [showIntro]);

  const balances = useMemo(()=>computeBalances(accounts, txns), [accounts, txns]);

  const agent = accounts.find(a=>a.id===currentAgentId);
  const agentBalance = balances.get(currentAgentId)||0;
  const agentTxns = txns.filter(t=> t.fromId===currentAgentId || t.toId===currentAgentId);
  const agentPrizeCount = agentTxns.filter(t=> t.kind==="debit" && t.fromId===currentAgentId).length;
  const lifetimeEarn = agentTxns.filter(t=> t.kind==="credit" && t.toId===currentAgentId && t.memo!=="Mint").reduce((a,b)=>a+b.amount,0);
  const lifetimeSpend = agentTxns.filter(t=> t.kind==="debit" && t.fromId===currentAgentId).reduce((a,b)=>a+b.amount,0);

  const nonSystemIds = new Set(accounts.filter(a=>a.role!=="system").map(a=>a.id));
  const totalEarned = txns
    .filter(t=> t.kind==="credit" && t.toId && nonSystemIds.has(t.toId) && t.memo!=="Mint")
    .reduce((a,b)=>a+b.amount,0);
  const totalSpent  = txns
    .filter(t=> t.kind==="debit" && t.fromId && nonSystemIds.has(t.fromId))
    .reduce((a,b)=>a+b.amount,0);

  const purchases = txns
    .filter(t=> t.kind==="debit" && t.fromId && nonSystemIds.has(t.fromId) && (t.memo||"").startsWith("Redeem:"))
    .map(t=> ({ when: new Date(t.dateISO), memo: t.memo!, amount: t.amount }));

  const todayKey = new Date().toLocaleDateString();
  const curMonthKey = monthKey(new Date());
  const earnedTodayBy: Record<string, number> = {};
  const earnedMonthBy: Record<string, number> = {};
  for (const t of txns) {
    if (t.kind!=="credit" || !t.toId || t.memo==="Mint" || !nonSystemIds.has(t.toId)) continue;
    const d = new Date(t.dateISO);
    if (d.toLocaleDateString() === todayKey) earnedTodayBy[t.toId] = (earnedTodayBy[t.toId] || 0) + t.amount;
    if (monthKey(d) === curMonthKey)       earnedMonthBy[t.toId] = (earnedMonthBy[t.toId] || 0) + t.amount;
  }
  const starId = Object.entries(earnedTodayBy).sort((a,b)=>b[1]-a[1])[0]?.[0];
  const starOfDay = starId ? { name: accounts.find(a=>a.id===starId)?.name || "—", amount: earnedTodayBy[starId] } : null;
  const leaderId = Object.entries(earnedMonthBy).sort((a,b)=>b[1]-a[1])[0]?.[0];
  const leaderOfMonth = leaderId ? { name: accounts.find(a=>a.id===leaderId)?.name || "—", amount: earnedMonthBy[leaderId] } : null;

  const postTxn = (partial: Partial<Transaction> & Pick<Transaction,"kind"|"amount">) =>
    setTxns(prev => [{ id: uid(), dateISO: nowISO(), memo: "", ...partial }, ...prev]);

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

  // ADMIN: credit based on sale rule
  function adminCredit(agentId:string, ruleKey:string, qty:number){
    if (!isAdmin) return toast.error("Admin only");
    const rule = PRODUCT_RULES.find(r=>r.key===ruleKey); if(!rule) return;
    if (!agentId) return toast.error("Choose agent");
    const amount = rule.gcsd * Math.max(1, qty||1);
    postTxn({ kind:"credit", amount, toId: agentId, memo:`${rule.label}${qty>1?` x${qty}`:""}`, meta:{product:rule.key, qty} });
    toast.success(`Added ${amount} GCSD to ${accounts.find(a=>a.id===agentId)?.name}`);
  }
  function manualTransfer(agentId:string, amount:number, note:string){
    if (!isAdmin) return toast.error("Admin only");
    if (!agentId || !amount || amount<=0) return toast.error("Enter agent and amount");
    postTxn({ kind:"credit", amount, toId: agentId, memo: note || "Manual transfer" });
    toast.success(`Transferred ${amount} GCSD to ${accounts.find(a=>a.id===agentId)?.name}`);
  }

  // ADMIN: corrections (undo)
  function undoSale(txId:string){
    if (!isAdmin) return toast.error("Admin only");
    const t = txns.find(x=>x.id===txId); if (!t || t.kind!=="credit" || !t.toId) return;
    postTxn({ kind:"debit", amount: t.amount, fromId: t.toId, memo:`Reversal of sale: ${t.memo}` });
    toast.success("Sale reversed");
  }
  function undoRedemption(txId:string){
    if (!isAdmin) return toast.error("Admin only");
    const t = txns.find(x=>x.id===txId); if (!t || t.kind!=="debit" || !t.fromId) return;
    const label = (t.memo||"").replace("Redeem: ","");
    const prize = PRIZE_ITEMS.find(p=>p.label===label);
    postTxn({ kind:"credit", amount: t.amount, toId: t.fromId, memo:`Reversal of redemption: ${label}` });
    if (prize) setStock(s=> ({...s, [prize.key]: (s[prize.key]??0)+1}));
    toast.success("Redemption reversed & stock restored");
  }

  return (
    <div className="min-h-screen overflow-x-hidden bg-gradient-to-b from-slate-50 to-white dark:from-slate-900 dark:to-slate-950 dark:text-slate-100 transition-colors duration-200">
      <Toaster position="top-center" richColors />

      {/* Theme overlay */}
      <AnimatePresence>
        <motion.div
          key={themeFlip}
          initial={{ opacity: 0 }}
          animate={{ opacity: 0 }}
          exit={{ opacity: 0.18 }}
          transition={{ duration: 0.1 }}
          className="pointer-events-none fixed inset-0 z-40 bg-white dark:bg-slate-900"
        />
      </AnimatePresence>

      {/* Intro — EVERY visit */}
      <AnimatePresence>
        {showIntro && (
          <motion.div initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}}
            className="fixed inset-0 z-50 grid place-items-center bg-black/80 text-white">
            <motion.div initial={{scale:0.96}} animate={{scale:1}} className="text-center p-8">
              <div className="mx-auto mb-5 w-20 h-20 rounded-3xl bg-white/10 grid place-items-center">
                <img src={LOGO_URL} className="w-10 h-10 rounded" alt="logo"/>
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
      <div className="sticky top-0 z-20 backdrop-blur bg-white/70 dark:bg-slate-900/70 border-b border-slate-200 dark:border-slate-800 transition-colors duration-200">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
          <motion.div layout className="flex items-center gap-3">
            <img src={LOGO_URL} alt="logo" className="h-6 w-6 rounded" />
            <span className="font-semibold">{APP_NAME}</span>
            <button
              className="ml-3 inline-flex items-center gap-1 text-sm px-2 py-1 rounded-lg border bg-white dark:bg-slate-800"
              onClick={()=> setPortal("none")}
              title="Go Home"
            >
              <HomeIcon className="w-4 h-4"/> Home
            </button>
          </motion.div>
          <div className="flex items-center gap-3">
            <span className="text-xs font-mono text-slate-600 dark:text-slate-300">{dateStr} • {clock}</span>
            <ThemeToggle theme={theme} setTheme={setTheme}/>
            <motion.button whileHover={{y:-1, boxShadow:"0 6px 16px rgba(0,0,0,.08)"}} whileTap={{scale:0.98}}
              className="px-3 py-1.5 rounded-xl border bg-white dark:bg-slate-800 flex items-center gap-2"
              onClick={()=> setPickerOpen(true)}>
              <Users className="w-4 h-4"/> Switch User
            </motion.button>
          </div>
        </div>
      </div>

      {/* User Picker modal */}
      <AnimatePresence>
        {pickerOpen && (
          <Picker
            accounts={accounts}
            balances={balances}
            onClose={()=> setPickerOpen(false)}
            onChooseAdmin={()=>{
              setPortal("admin");
              setIsAdmin(false);
              setPickerOpen(false);
            }}
            onChooseAgent={(id)=>{
              setCurrentAgentId(id);
              setPortal("agent");
              setIsAdmin(false);
              setPickerOpen(false);
            }}
          />
        )}
      </AnimatePresence>

      {/* Admin PIN modal — auto when admin chosen */}
      <AdminPinMount
        active={portal==="admin" && !isAdmin}
        onCancel={()=>{ setPortal("none"); }}
        onUnlocked={()=> setIsAdmin(true)}
      />

      {/* Main content */}
      <div className="max-w-6xl mx-auto px-4 py-6">
        {portal==="agent" && currentAgentId ? (
          <AgentPortal
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
            rules={PRODUCT_RULES}
            txns={txns}
            onCredit={adminCredit}
            onManualTransfer={(a,m,n)=>manualTransfer(a,m,n)}
            onUndoSale={undoSale}
            onUndoRedemption={undoRedemption}
            adminTab={adminTab} setAdminTab={setAdminTab}
          />
        ) : (
          <HomeDashboard
            totalEarned={totalEarned}
            totalSpent={totalSpent}
            purchases={purchases}
            prizes={PRIZE_ITEMS}
            stock={stock}
            starOfDay={starOfDay}
            leaderOfMonth={leaderOfMonth}
            txns={txns}
            accounts={accounts}
          />
        )}
      </div>
    </div>
  );
}

/* ---------- Small shared components ---------- */

function TypeLabel({ text }:{ text:string }) {
  return (
    <div aria-label={text} className="text-2xl font-semibold">
      {text.split("").map((ch, i)=>(
        <motion.span
          key={i}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.08, delay: i * 0.015 }}
        >
          {ch}
        </motion.span>
      ))}
    </div>
  );
}

/* cleaned-up icon-only theme toggle */
function ThemeToggle({theme, setTheme}:{theme:"light"|"dark"; setTheme:(t:"light"|"dark")=>void}) {
  const isDark = theme === "dark";
  return (
    <button
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className={`h-8 w-8 grid place-items-center rounded-full border bg-white dark:bg-slate-800`}
      aria-label={isDark ? "Switch to light" : "Switch to dark"}
      title={isDark ? "Light mode" : "Dark mode"}
    >
      <AnimatePresence initial={false} mode="wait">
        {isDark ? (
          <motion.span key="moon" initial={{ rotate:-20, scale:0.7, opacity:0 }} animate={{ rotate:0, scale:1, opacity:1 }} exit={{ rotate:20, scale:0.7, opacity:0 }} transition={{ duration:0.1 }}>
            <Moon className="w-4 h-4" />
          </motion.span>
        ) : (
          <motion.span key="sun"  initial={{ rotate:20,  scale:0.7, opacity:0 }} animate={{ rotate:0, scale:1, opacity:1 }} exit={{ rotate:-20, scale:0.7, opacity:0 }} transition={{ duration:0.1 }}>
            <Sun className="w-4 h-4" />
          </motion.span>
        )}
      </AnimatePresence>
    </button>
  );
}

function Picker({ accounts, balances, onClose, onChooseAdmin, onChooseAgent }:{
  accounts:Account[]; balances:Map<string,number>;
  onClose:()=>void; onChooseAdmin:()=>void; onChooseAgent:(id:string)=>void;
}) {
  return (
    <motion.div initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}}
      className="fixed inset-0 z-40 bg-white/80 backdrop-blur dark:bg-slate-900/70 grid place-items-center">
      <motion.div initial={{y:18, opacity:0}} animate={{y:0, opacity:1}}
        transition={{type:"spring", stiffness:160, damping:18}}
        className="bg-white dark:bg-slate-900 rounded-3xl shadow-xl p-6 w-[min(780px,92vw)]">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2"><Users className="w-4 h-4"/><h2 className="text-xl font-semibold">Switch User</h2></div>
          <button className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800" onClick={onClose}><X className="w-4 h-4"/></button>
        </div>

        <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-2 max-h-[60vh] overflow-auto pr-2">
          <HoverCard onClick={onChooseAdmin}>
            <div className="font-semibold flex items-center gap-2"><Lock className="w-4 h-4"/> Admin Portal</div>
            <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">PIN required</div>
          </HoverCard>

          {accounts.filter(a=>a.role!=="system").map((a,i)=>(
            <HoverCard key={a.id} delay={0.03 + i*0.02} onClick={()=>onChooseAgent(a.id)}>
              <div className="font-medium">{a.name}</div>
              <div className="text-xs text-slate-500 dark:text-slate-400">Balance: {(balances.get(a.id)||0).toLocaleString()} GCSD</div>
            </HoverCard>
          ))}
        </div>
      </motion.div>
    </motion.div>
  );
}
function HoverCard({ children, onClick, delay=0.03 }:{children:React.ReactNode; onClick:()=>void; delay?:number}) {
  return (
    <motion.button
      initial={{opacity:0, y:6}} animate={{opacity:1, y:0}} transition={{delay}}
      whileHover={{y:-3, boxShadow:"0 10px 22px rgba(0,0,0,.10)"}} whileTap={{scale:0.98}}
      onClick={onClick}
      className="border rounded-2xl px-3 py-3 text-left bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
    >
      {children}
    </motion.button>
  );
}
function AdminPinMount({ active, onCancel, onUnlocked }:{ active:boolean; onCancel:()=>void; onUnlocked:()=>void }) {
  const [show, setShow] = useState<boolean>(false);
  useEffect(()=> { if (active) setShow(true); else setShow(false); }, [active]);
  return (
    <AnimatePresence>
      {show && (
        <PinModal
          onClose={()=>{ setShow(false); onCancel(); }}
          onOk={()=>{ setShow(false); onUnlocked(); toast.success("Admin unlocked"); }}
        />
      )}
    </AnimatePresence>
  );
}
function PinModal({ onClose, onOk }:{ onClose:()=>void; onOk:()=>void }) {
  const [pin, setPin] = useState("");
  return (
    <motion.div initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} className="fixed inset-0 z-50 bg-black/40 grid place-items-center">
      <motion.div initial={{scale:0.95}} animate={{scale:1}} exit={{scale:0.95}} className="bg-white dark:bg-slate-900 rounded-2xl p-5 w-[min(440px,92vw)]">
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

/* ---------- Home (Public) ---------- */

function HomeDashboard(props:{
  totalEarned:number; totalSpent:number;
  purchases:{when:Date; memo:string; amount:number}[];
  prizes: PrizeItem[]; stock: Record<string,number>;
  starOfDay: {name:string; amount:number} | null;
  leaderOfMonth: {name:string; amount:number} | null;
  txns: Transaction[];
  accounts: Account[];
}) {
  const { totalEarned, totalSpent, purchases, prizes, stock, starOfDay, leaderOfMonth, txns, accounts } = props;

  // Build 30-day earned/spent series (non-system)
  const nonSystemIds = new Set(accounts.filter(a=>a.role!=="system").map(a=>a.id));
  const days = Array.from({length:30}, (_,i)=> {
    const d = new Date(); d.setDate(d.getDate()-(29-i)); d.setHours(0,0,0,0);
    return d;
  });
  const earnedSeries = days.map(d=>{
    const next = new Date(d); next.setDate(d.getDate()+1);
    return txns.filter(t=> t.kind==="credit" && t.toId && nonSystemIds.has(t.toId) && t.memo!=="Mint" && new Date(t.dateISO)>=d && new Date(t.dateISO)<next)
               .reduce((a,b)=>a+b.amount,0);
  });
  const spentSeries = days.map(d=>{
    const next = new Date(d); next.setDate(d.getDate()+1);
    return txns.filter(t=> t.kind==="debit" && t.fromId && nonSystemIds.has(t.fromId) && new Date(t.dateISO)>=d && new Date(t.dateISO)<next)
               .reduce((a,b)=>a+b.amount,0);
  });

  return (
    <motion.div layout initial={{opacity:0, y:10}} animate={{opacity:1, y:0}} transition={{type:"spring", stiffness:160, damping:18}}>
      <div className="grid md:grid-cols-3 gap-4">
        <BigCard title="Dashboard">
          <div className="grid sm:grid-cols-2 gap-4">
            <TileRow label="Total GCSD Earned" value={totalEarned}/>
            <TileRow label="Total GCSD Spent"  value={totalSpent}/>
          </div>

          <div className="mt-4">
            <div className="text-sm text-slate-500 dark:text-slate-400 mb-2">Finance (30 days)</div>
            <LineChart earned={earnedSeries} spent={spentSeries}/>
          </div>

          <div className="grid sm:grid-cols-2 gap-4 mt-4">
            <Highlight title="Star of the Day" value={starOfDay ? `${starOfDay.name} • +${starOfDay.amount.toLocaleString()} GCSD` : "—"} />
            <Highlight title="Leader of the Month" value={leaderOfMonth ? `${leaderOfMonth.name} • +${leaderOfMonth.amount.toLocaleString()} GCSD` : "—"} />
          </div>

          <div className="mt-4">
            <div className="text-sm text-slate-500 dark:text-slate-400 mb-2">Purchased Prizes (All Agents)</div>
            <div className="rounded-xl border p-3 bg-white dark:bg-slate-800">
              <div className="text-sm mb-2">Total purchases: <b>{purchases.length}</b></div>
              <div className="space-y-2 max-h-40 overflow-auto pr-1">
                {purchases.map((p, i)=> (
                  <div key={i} className="flex items-center justify-between text-sm border rounded-lg px-3 py-1.5">
                    <span>{p.memo.replace("Redeem: ","")}</span>
                    <span className="text-slate-500 dark:text-slate-300">{p.when.toLocaleString()}</span>
                  </div>
                ))}
                {purchases.length===0 && <div className="text-sm text-slate-500 dark:text-slate-400">No purchases yet.</div>}
              </div>
            </div>
          </div>
        </BigCard>

        <BigCard title="Prizes (Available)">
          <div className="space-y-2 max-h-[520px] overflow-auto pr-2">
            {prizes.map(p=>(
              <div key={p.key} className="flex justify-between items-center bg-white dark:bg-slate-800 border rounded-xl px-3 py-2">
                <div className="font-medium">{p.label}</div>
                <div className="text-sm text-slate-500 dark:text-slate-300 flex items-center gap-4">
                  <span>{p.price.toLocaleString()} GCSD</span>
                  <span className="badge dark:bg-slate-700">Stock: {stock[p.key] ?? 0}</span>
                </div>
              </div>
            ))}
          </div>
        </BigCard>

        {/* Info card removed as requested */}
      </div>
    </motion.div>
  );
}

/* Simple responsive SVG line chart (no libs) */
function LineChart({ earned, spent }:{earned:number[]; spent:number[]}) {
  const width = 520, height = 140, pad = 8;
  const max = Math.max(1, ...earned, ...spent);
  const scaleX = (i:number)=> pad + (i*(width-2*pad))/29;
  const scaleY = (v:number)=> height - pad - (v/max)*(height-2*pad);
  const toPath = (arr:number[]) => arr.map((v,i)=> `${i===0?"M":"L"} ${scaleX(i)} ${scaleY(v)}`).join(" ");
  return (
    <div className="rounded-xl border p-3 bg-white dark:bg-slate-800">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-36">
        <path d={toPath(earned)} fill="none" stroke="currentColor" className="text-emerald-500" strokeWidth="2"/>
        <path d={toPath(spent)}  fill="none" stroke="currentColor" className="text-rose-500" strokeWidth="2"/>
      </svg>
      <div className="flex justify-end gap-4 text-xs text-slate-500 dark:text-slate-300">
        <div className="inline-flex items-center gap-1"><span className="w-3 h-0.5 bg-emerald-500 inline-block"/><span>Earned</span></div>
        <div className="inline-flex items-center gap-1"><span className="w-3 h-0.5 bg-rose-500 inline-block"/><span>Spent</span></div>
      </div>
    </div>
  );
}

function Bar({ label, percent, colorClass }:{ label:string; percent:number; colorClass:string }) {
  return (
    <div className="flex-1 grid gap-1 text-xs">
      <div className={`rounded-md ${colorClass}`} style={{ height: `${Math.max(8, percent)}%` }} />
      <div className="text-center text-slate-500 dark:text-slate-300">{label}</div>
    </div>
  );
}
function BigCard({ title, children }:{ title:string; children:React.ReactNode }) {
  return (
    <div className="rounded-2xl border p-4 bg-white dark:bg-slate-800 shadow-sm">
      <div className="text-sm text-slate-500 dark:text-slate-400 mb-2">{title}</div>
      {children}
    </div>
  );
}
function TileRow({label, value}:{label:string; value:number}){
  return (
    <div className="rounded-xl border p-3 bg-white dark:bg-slate-800">
      <div className="text-sm text-slate-500 dark:text-slate-400">{label}</div>
      <div className="text-2xl font-semibold">{value.toLocaleString()} GCSD</div>
    </div>
  );
}
function Highlight({ title, value }:{ title:string; value:string }){
  return (
    <div className="rounded-xl border p-3 bg-white dark:bg-slate-800">
      <div className="text-sm text-slate-500 dark:text-slate-400">{title}</div>
      <div className="mt-1 font-medium">{value}</div>
    </div>
  );
}

/* ---------- Agent Portal ---------- */

function AgentPortal(props:{
  agentName:string; agentBalance:number; lifetimeEarn:number; lifetimeSpend:number;
  txns:Transaction[]; prizes:PrizeItem[]; stock:Record<string,number>; prizeCount:number;
  onRedeem:(k:string)=>void;
}) {
  const { agentName, agentBalance, lifetimeEarn, lifetimeSpend, txns, prizes, stock, prizeCount, onRedeem } = props;
  const [tab, setTab] = useState<"overview"|"shop"|"activity">("overview");
  return (
    <motion.div layout initial={{opacity:0, y:10}} animate={{opacity:1, y:0}} transition={{type:"spring", stiffness:160, damping:18}}>
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
            <motion.button key={k}
              whileHover={{y:-2, boxShadow:"0 8px 18px rgba(0,0,0,.08)"}}
              whileTap={{scale:0.98}}
              className={`px-3 py-1.5 rounded-xl border transition-colors ${tab===k?"bg-black text-white":"bg-white dark:bg-slate-800"}`}
              onClick={()=>setTab(k)}>
              {k[0].toUpperCase()+k.slice(1)}
            </motion.button>
          ))}
        </div>
      </div>

      <AnimatePresence mode="wait">
        {tab==="overview" && (
          <motion.div key="overview" initial={{opacity:0, y:8}} animate={{opacity:1, y:0}} exit={{opacity:0, y:-8}} className="grid md:grid-cols-3 gap-4">
            <StatCard icon={<Wallet/>} label="Current Balance" value={`${agentBalance.toLocaleString()} GCSD`} />
            <StatCard icon={<Sparkles/>} label="Lifetime Earned" value={`${lifetimeEarn.toLocaleString()} GCSD`} />
            <StatCard icon={<Gift/>} label="Lifetime Spent" value={`${lifetimeSpend.toLocaleString()} GCSD`} />
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
          <motion.div key="activity" initial={{opacity:0, y:8}} animate={{opacity:1, y:0}} exit={{opacity:0, y:-8}} className="rounded-2xl border p-4 bg-white dark:bg-slate-800">
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
function StatCard({ icon, label, value }:{icon:React.ReactNode, label:string, value:string}){
  return (
    <motion.div initial={{opacity:0, y:8}} animate={{opacity:1, y:0}} transition={{type:"spring", stiffness:160, damping:16}}
      className="rounded-2xl border p-4 bg-white dark:bg-slate-800 shadow-sm">
      <div className="flex items-center gap-3">{icon}<div><div className="text-sm text-slate-500 dark:text-slate-400">{label}</div><div className="text-2xl font-semibold">{value}</div></div></div>
    </motion.div>
  );
}

/* ---------- Admin Portal ---------- */

function AdminPortal(props:{
  isAdmin:boolean;
  accounts:Account[];
  balances:Map<string,number>;
  stock:Record<string,number>;
  rules:ProductRule[];
  txns:Transaction[];
  onCredit:(agent:string, rule:string, qty:number)=>void;
  onManualTransfer:(agent:string, amount:number, note:string)=>void;
  onUndoSale:(txId:string)=>void;
  onUndoRedemption:(txId:string)=>void;
  adminTab:"dashboard"|"addsale"|"history"|"transfer"|"corrections";
  setAdminTab:(t:"dashboard"|"addsale"|"history"|"transfer"|"corrections")=>void;
}) {
  const { isAdmin, accounts, balances, stock, rules, txns, onCredit, onManualTransfer, onUndoSale, onUndoRedemption, adminTab, setAdminTab } = props;
  return (
    <motion.div layout initial={{opacity:0, y:10}} animate={{opacity:1, y:0}} transition={{type:"spring", stiffness:160, damping:18}}>
      <div className="flex items-center justify-between mb-4">
        <div className="font-semibold flex items-center gap-2"><Lock className="w-4 h-4"/> Admin</div>
        <div className="flex gap-2">
          {(["dashboard","addsale","transfer","corrections","history"] as const).map(k=> (
            <motion.button key={k} whileHover={{y:-2, boxShadow:"0 8px 18px rgba(0,0,0,.08)"}} whileTap={{scale:0.98}}
              className={`px-3 py-1.5 rounded-xl border ${adminTab===k?"bg-black text-white":"bg-white dark:bg-slate-800"}`}
              onClick={()=>setAdminTab(k)}>{k==="addsale" ? "Add Sale" : k[0].toUpperCase()+k.slice(1)}</motion.button>
          ))}
        </div>
      </div>

      {!isAdmin ? (
        <div className="rounded-2xl border p-4 bg-white dark:bg-slate-800">Enter PIN to unlock Admin.</div>
      ) : (
        <>
          {adminTab==="dashboard" && (
            <motion.div key="dashboard" initial={{opacity:0, y:8}} animate={{opacity:1, y:0}} exit={{opacity:0, y:-8}} className="grid md:grid-cols-3 gap-4">
              <div className="rounded-2xl border p-5 bg-white dark:bg-slate-800 shadow-sm md:col-span-2">
                <div className="text-sm text-slate-500 dark:text-slate-400 mb-2">All Balances</div>
                <ul className="space-y-2 max-h-[520px] overflow-auto pr-2">
                  {accounts.filter(a=>a.role!=="system").sort((a,b)=>(balances.get(b.id)||0)-(balances.get(a.id)||0)).map(a=>(
                    <li key={a.id} className="flex justify-between text-lg bg-slate-50 dark:bg-slate-700/40 rounded-xl px-3 py-2">
                      <span>{a.name}</span><span className="font-semibold">{(balances.get(a.id)||0).toLocaleString()} GCSD</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="rounded-2xl border p-5 bg-white dark:bg-slate-800 shadow-sm">
                <div className="text-sm text-slate-500 dark:text-slate-400 mb-2">Prize Stock</div>
                <ul className="space-y-2 max-h-[520px] overflow-auto pr-2">
                  {PRIZE_ITEMS.map(p=>(
                    <li key={p.key} className="flex justify-between text-lg bg-slate-50 dark:bg-slate-700/40 rounded-xl px-3 py-2">
                      <span>{p.label}</span><span className="font-semibold">{stock[p.key] ?? 0}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </motion.div>
          )}

          {adminTab==="addsale" && <AddSale rules={rules} accounts={accounts} onCredit={onCredit} />}
          {adminTab==="transfer" && <ManualTransfer accounts={accounts} onTransfer={onManualTransfer} />}
          {adminTab==="corrections" && <Corrections accounts={accounts} txns={txns} onUndoSale={onUndoSale} onUndoRedemption={onUndoRedemption} />}
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
  const open = (rule:ProductRule)=> setModal({open:true, rule});
  const confirm = ()=> { if (modal.rule) { onCredit(agent, modal.rule.key, qty); setModal({open:false}); setQty(1); setAgent(""); } };

  return (
    <>
      <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-3">
        {rules.map((r,i)=>(
          <motion.button key={r.key}
            initial={{opacity:0, y:8}} animate={{opacity:1, y:0}} transition={{delay:i*0.03}}
            whileHover={{y:-2, boxShadow:"0 10px 22px rgba(0,0,0,.12)"}}
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
function ManualTransfer({ accounts, onTransfer }:{
  accounts:Account[]; onTransfer:(agent:string, amount:number, note:string)=>void
}) {
  const [agent, setAgent] = useState(""); const [amount, setAmount] = useState<number>(100); const [note, setNote] = useState<string>("Manual transfer");
  return (
    <div className="rounded-2xl border p-5 bg-white dark:bg-slate-800 shadow-sm max-w-xl">
      <div className="text-sm text-slate-500 dark:text-slate-400 mb-3">Admin has infinite balance; use this to add credits manually.</div>
      <div className="grid sm:grid-cols-2 gap-3">
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
          <div className="text-xs text-slate-500 dark:text-slate-400 mb-1">Amount</div>
          <input className="border rounded-xl px-3 py-2 w-full bg-white dark:bg-slate-800" type="number" min={1} value={amount} onChange={e=>setAmount(Math.max(1, Number(e.target.value)||1))}/>
        </div>
      </div>
      <div className="mt-3">
        <div className="text-xs text-slate-500 dark:text-slate-400 mb-1">Note</div>
        <input className="border rounded-xl px-3 py-2 w-full bg-white dark:bg-slate-800" value={note} onChange={e=>setNote(e.target.value)}/>
      </div>
      <motion.button whileHover={{y:-1, boxShadow:"0 8px 18px rgba(0,0,0,.08)"}} whileTap={{scale:0.98}}
        className="mt-4 px-4 py-2 rounded-xl border bg-black text-white"
        onClick={()=> onTransfer(agent, amount, note)}>
        Transfer
      </motion.button>
    </div>
  );
}

/* Admin Corrections (Undo) */
function Corrections({ accounts, txns, onUndoSale, onUndoRedemption }:{
  accounts:Account[]; txns:Transaction[];
  onUndoSale:(txId:string)=>void; onUndoRedemption:(txId:string)=>void;
}) {
  const [aid, setAid] = useState<string>("");

  const agentTx = txns.filter(t => (t.toId===aid && t.kind==="credit" && t.memo!=="Mint") || (t.fromId===aid && t.kind==="debit"));
  const sales   = agentTx.filter(t => t.kind==="credit");
  const redeems = agentTx.filter(t => t.kind==="debit" && (t.memo||"").startsWith("Redeem:"));

  return (
    <div className="grid md:grid-cols-2 gap-4">
      <div className="rounded-2xl border p-5 bg-white dark:bg-slate-800 shadow-sm">
        <div className="text-sm text-slate-500 dark:text-slate-400 mb-2">Choose Agent</div>
        <select className="border rounded-xl px-3 py-2 w-full bg-white dark:bg-slate-800" value={aid} onChange={e=>setAid(e.target.value)}>
          <option value="">—</option>
          {accounts.filter(a=>a.role!=="system").map(a=>(
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
      </div>

      <div className="rounded-2xl border p-5 bg-white dark:bg-slate-800 shadow-sm">
        <div className="text-sm text-slate-500 dark:text-slate-400 mb-2">Sales (credits)</div>
        <div className="space-y-2 max-h-[50vh] overflow-auto pr-2">
          {sales.map(t=>(
            <div key={t.id} className="flex items-center justify-between border rounded-xl px-3 py-2">
              <div className="text-sm">{t.memo} — <b>+{t.amount}</b> <span className="text-xs text-slate-500">{new Date(t.dateISO).toLocaleString()}</span></div>
              <button className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border bg-white dark:bg-slate-700"
                onClick={()=>onUndoSale(t.id)} title="Undo sale">
                <RotateCcw className="w-3.5 h-3.5"/> Undo
              </button>
            </div>
          ))}
          {sales.length===0 && <div className="text-sm text-slate-500 dark:text-slate-400">No sales.</div>}
        </div>
      </div>

      <div className="rounded-2xl border p-5 bg-white dark:bg-slate-800 shadow-sm md:col-span-2">
        <div className="text-sm text-slate-500 dark:text-slate-400 mb-2">Redemptions (purchases)</div>
        <div className="space-y-2 max-h-[50vh] overflow-auto pr-2">
          {redeems.map(t=>(
            <div key={t.id} className="flex items-center justify-between border rounded-xl px-3 py-2">
              <div className="text-sm">{t.memo} — <b>-{t.amount}</b> <span className="text-xs text-slate-500">{new Date(t.dateISO).toLocaleString()}</span></div>
              <button className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border bg-white dark:bg-slate-700"
                onClick={()=>onUndoRedemption(t.id)} title="Undo redemption (restock)">
                <RotateCcw className="w-3.5 h-3.5"/> Undo & Restock
              </button>
            </div>
          ))}
          {redeems.length===0 && <div className="text-sm text-slate-500 dark:text-slate-400">No redemptions.</div>}
        </div>
      </div>
    </div>
  );
}

function AdminHistory({ txns, accounts }:{ txns:Transaction[]; accounts:Account[] }) {
  const credits = txns.filter(t=> t.kind==="credit" && t.toId && t.memo && t.memo !== "Mint");
  const byId = new Map(accounts.map(a=>[a.id, a.name]));
  return (
    <div className="rounded-2xl border p-4 bg-white dark:bg-slate-800 shadow-sm">
      <div className="text-sm text-slate-500 dark:text-slate-400 mb-2">Sales History</div>
      <div className="space-y-2 max-h-[65vh] overflow-auto pr-2">
        {credits.map((t,i)=>(
          <motion.div key={t.id} initial={{opacity:0, y:6}} animate={{opacity:1, y:0}} transition={{delay:i*0.02}}
            className="flex items-center justify-between border rounded-xl p-3">
            <div className="text-sm"><b>{byId.get(t.toId!)}</b> — {t.memo}</div>
            <div className="text-sm font-medium">+{t.amount} GCSD</div>
            <div className="text-xs text-slate-500 dark:text-slate-400">{new Date(t.dateISO).toLocaleString()}</div>
          </motion.div>
        ))}
        {credits.length===0 && <div className="text-sm text-slate-500 dark:text-slate-400">No sales yet.</div>}
      </div>
    </div>
  );
}
