import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Toaster, toast } from "sonner";
import {
  Wallet, Gift, History, Sparkles, UserCircle2, Lock, Check, X, Sun, Moon,
  Users, Home as HomeIcon, RotateCcw, Bell, Flame, Plus, Shield, Zap, ChevronDown
} from "lucide-react";
import { kvGetRemember as kvGet, kvSetIfChanged as kvSet, onKVChange } from "./lib/db";

/* ===========================
   Types & constants
   =========================== */

const APP_NAME = "GCS Bank";
const LOGO_URL = "/Logo.png"; // put high-res in /public/Logo.png

type Theme  = "light" | "dark" | "neon";
type Portal = "home" | "agent" | "admin" | "feed";

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

/** Metric reset epochs (admin control) */
type MetricsEpoch = { earned30d?: string; spent30d?: string; starOfDay?: string; leaderOfMonth?: string };

const MAX_PRIZES_PER_AGENT = 2;

const AGENT_NAMES = [
  "Oliver Steele", "Maya Graves", "Viktor Parks", "Ben Mills", "Stan Harris", "Michael Wilson",
  "Hope Marshall", "Sofie Roy", "Logan Noir", "Justin Frey", "Rebecca Brooks", "Christopher O'Connor",
  "Caitlyn Stone", "Frank Collins", "Antonio", "Kevin Nolan", "Daniel Hill"
];

// Updated product rules (these are “earn” credits)
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

// Prizes (DEBITS). Updated prices per your list.
const PRIZE_ITEMS: PrizeItem[] = [
  { key: "airfryer",       label: "Philips Airfryer",       price: 6000  },
  { key: "soundbar",       label: "LG Soundbar",            price: 11000 },
  { key: "burger_lunch",   label: "Burger Lunch",           price: 650   },
  { key: "voucher_50",     label: "Cash Voucher (50 лв)",   price: 3000  },
  { key: "poker",          label: "Texas Poker Set",        price: 1200  },
  { key: "soda_maker",     label: "Philips Soda Maker",     price: 5200  },
  { key: "magsafe",        label: "MagSafe Charger",        price: 600   },
  { key: "galaxy_fit3",    label: "Samsung Galaxy Fit 3",   price: 5000  },
  { key: "cinema_tickets", label: "Cinema Tickets",         price: 800   },
  { key: "neo_massager",   label: "Neo Massager",           price: 1400  },
  { key: "logi_g102",      label: "Logitech G102 Mouse",    price: 1900  },
  { key: "flight_madrid",  label: "Madrid Flights",         price: 11350 },
  { key: "flight_london",  label: "London Flights",         price: 11350 },
  { key: "flight_milan",   label: "Milan Flights",          price: 11350 },
];

const INITIAL_STOCK: Record<string, number> = {
  airfryer: 1, soundbar: 1, burger_lunch: 2, voucher_50: 1, poker: 1,
  soda_maker: 1, magsafe: 1, galaxy_fit3: 1, cinema_tickets: 2, neo_massager: 1, logi_g102: 1,
  flight_madrid: 1, flight_london: 1, flight_milan: 1,
};

/* ===========================
   Helpers (single, canonical versions only)
   =========================== */
const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
const nowISO = () => new Date().toISOString();
const fmtTime = (d: Date) => [d.getHours(), d.getMinutes(), d.getSeconds()].map(n => String(n).padStart(2,"0")).join(":");
const fmtDate = (d: Date) => d.toLocaleDateString(undefined, {year:"numeric", month:"short", day:"2-digit" });
const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;

// merge transactions by id (prevents realtime from overwriting local adds)
function mergeTxns(local: Transaction[], remote: Transaction[]) {
  const map = new Map<string, Transaction>();
  for (const t of remote) map.set(t.id, t);
  for (const t of local) map.set(t.id, t); // local wins on conflict
  const all = Array.from(map.values());
  all.sort((a,b)=> new Date(b.dateISO).getTime() - new Date(a.dateISO).getTime());
  return all;
}
function mergeAccounts(local: Account[], remote: Account[]) {
  const map = new Map<string, Account>();
  // Remote takes precedence to avoid duplication
  for (const a of remote) map.set(a.id, a);
  // Only add local accounts that don't exist remotely
  for (const a of local) {
    if (!map.has(a.id)) map.set(a.id, a);
  }
  return Array.from(map.values());
}

// Helper to check if accounts are the same (by name and role)
function accountsAreEqual(a1: Account[], a2: Account[]): boolean {
  if (a1.length !== a2.length) return false;
  const names1 = a1.map(a => `${a.name}-${a.role}`).sort();
  const names2 = a2.map(a => `${a.name}-${a.role}`).sort();
  return names1.join(',') === names2.join(',');
}

/** Compute balances map for all accounts - properly handles reversals and prevents negative balances */
function computeBalances(accounts: Account[], txns: Transaction[]) {
  const map = new Map<string, number>();
  for (const a of accounts) map.set(a.id, 0);
  
  // Process transactions in chronological order to handle reversals correctly
  const sortedTxns = [...txns].sort((a, b) => new Date(a.dateISO).getTime() - new Date(b.dateISO).getTime());
  
  for (const t of sortedTxns) {
    if (t.kind === "credit" && t.toId) {
      map.set(t.toId, (map.get(t.toId) || 0) + t.amount);
    }
    if (t.kind === "debit" && t.fromId) {
      const currentBalance = map.get(t.fromId) || 0;
      const newBalance = currentBalance - t.amount;
      // Prevent negative balances - minimum balance is 0
      map.set(t.fromId, Math.max(0, newBalance));
    }
  }
  return map;
}

/* ===== Epoch helpers (hide history prior to reset) ===== */
function afterEpoch(epochs: Record<string, string>, agentId: string | undefined, dateISO: string) {
  if (!agentId) return true;
  const e = epochs[agentId];
  if (!e) return true;
  return new Date(dateISO).getTime() >= new Date(e).getTime();
}

/** Metric epoch gate (admin resets) */
function afterISO(epochISO: string | undefined, dateISO: string) {
  if (!epochISO) return true;
  return new Date(dateISO).getTime() >= new Date(epochISO).getTime();
}

/* ===== Transaction classifiers (single definitions) ===== */
function G_isCorrectionDebit(t: Transaction) {
  return (
    t.kind === "debit" &&
    !!t.memo &&
    (t.memo.startsWith("Reversal of sale") ||
      t.memo.startsWith("Correction (withdraw)") ||
      t.memo.startsWith("Balance reset to 0"))
  );
}
function G_isReversalOfRedemption(t: Transaction) {
  return t.kind === "credit" && !!t.memo && t.memo.startsWith("Reversal of redemption:");
}
function G_isRedeemTxn(t: Transaction) {
  return t.kind === "debit" && !!t.memo && t.memo.startsWith("Redeem:");
}
/** For purchases list, exclude redeems that later got reversed */
function G_isRedeemStillActive(redeemTxn: Transaction, all: Transaction[]) {
  if (!G_isRedeemTxn(redeemTxn) || !redeemTxn.fromId) return false;
  const label = (redeemTxn.memo || "").replace("Redeem: ", "");
  const after = new Date(redeemTxn.dateISO).getTime();
  return !all.some(
    (t) =>
      G_isReversalOfRedemption(t) &&
      t.toId === redeemTxn.fromId &&
      (t.memo || "") === `Reversal of redemption: ${label}` &&
      new Date(t.dateISO).getTime() >= after
  );
}
/** A sale credit is active unless later withdrawn/reversed */
function G_isSaleStillActive(creditTxn: Transaction, all: Transaction[]) {
  if (creditTxn.kind !== "credit" || !creditTxn.toId) return false;
  if (creditTxn.memo === "Mint") return false;
  const label = creditTxn.memo || "Credit";
  const amt = creditTxn.amount;
  const after = new Date(creditTxn.dateISO).getTime();
  return !all.some(t =>
    t.kind === "debit" &&
    t.fromId === creditTxn.toId &&
    !!t.memo &&
    (
      t.memo.startsWith("Reversal of sale:") ||
      t.memo.startsWith("Correction (withdraw):")
    ) &&
    new Date(t.dateISO).getTime() >= after &&
    t.amount === amt &&
    (t.memo.endsWith(label) || t.memo === `Reversal of sale: ${label}` || t.memo === `Correction (withdraw): ${label}`)
  );
}

/** Check if a transaction has already been undone */
function G_isTransactionUndone(txn: Transaction, all: Transaction[]): boolean {
  if (txn.kind === "credit") {
    // Check if this credit has been reversed
    return !G_isSaleStillActive(txn, all);
  } else if (txn.kind === "debit" && txn.memo?.startsWith("Redeem:")) {
    // Check if this redemption has been reversed
    return !G_isRedeemStillActive(txn, all);
  }
  return false;
}

/* ===== Mini chart/tiles (single versions) ===== */
function LineChart({ earned, spent }: { earned: number[]; spent: number[] }) {
  const max = Math.max(1, ...earned, ...spent);
  const h = 110, w = 420, pad = 10;
  const step = (w - pad * 2) / (earned.length - 1 || 1);
  const toPath = (arr: number[]) =>
    arr.map((v, i) => `${i === 0 ? "M" : "L"} ${pad + i * step},${h - pad - (v / max) * (h - pad * 2)}`).join(" ");
  return (
    <svg width="100%" viewBox={`0 0 ${w} ${h}`} className="rounded-xl border">
      <path d={toPath(earned)} fill="none" stroke="currentColor" strokeWidth="2" className="text-emerald-500" />
      <path d={toPath(spent)}  fill="none" stroke="currentColor" strokeWidth="2" className="text-rose-500" />
      <g className="text-xs">
        <text x={pad} y={h - 2} className="fill-current opacity-60">Earned</text>
        <text x={pad + 70} y={h - 2} className="fill-current opacity-60">Spent</text>
      </g>
    </svg>
  );
}
function TileRow({ label, value }: { label: string; value: number }) {
  return (
    <motion.div 
      className="rounded-xl border p-3"
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.3 }}
      whileHover={{ scale: 1.02, y: -2 }}
    >
      <div className="text-xs opacity-70 mb-1">{label}</div>
      <div className="text-2xl font-semibold"><NumberFlash value={value} /></div>
    </motion.div>
  );
}
function NumberFlash({ value }:{ value:number }) {
  const [displayValue, setDisplayValue] = useState(value);
  
  useEffect(() => {
    // Smooth number transition
    const diff = value - displayValue;
    if (Math.abs(diff) < 1) {
      setDisplayValue(value);
      return;
    }
    
    const step = diff / 10;
    const timer = setInterval(() => {
      setDisplayValue(prev => {
        const next = prev + step;
        if (Math.abs(value - next) < Math.abs(step)) {
          clearInterval(timer);
          return value;
        }
        return next;
      });
    }, 30);
    
    return () => clearInterval(timer);
  }, [value]);
  
  return (
    <motion.span
      key={value}
      initial={{ scale: 1 }}
      animate={{ scale: [1, 1.05, 1] }}
      transition={{ duration: 0.3 }}
    >
      {Math.round(displayValue).toLocaleString()} GCSD
    </motion.span>
  );
}

/* ===== Misc helpers ===== */
function sumInRange(txns: Transaction[], day: Date, spanDays: number, pred: (t: Transaction) => boolean) {
  const start = new Date(day);
  const end = new Date(day);
  end.setDate(start.getDate() + spanDays);
  return txns
    .filter((t) => pred(t) && new Date(t.dateISO) >= start && new Date(t.dateISO) < end)
    .reduce((a, b) => a + b.amount, 0);
}

/* ===========================
   Shared UI pieces
   =========================== */

/** Safe join */
function classNames(...x: (string | false | undefined | null)[]) {
  return x.filter(Boolean).join(" ");
}

/** Neon-aware containers/buttons/inputs */
const neonBox = (theme: Theme) =>
  theme === "neon"
    ? "bg-[#1a1a1a] border border-orange-500 text-orange-100 shadow-lg shadow-orange-500/20"
    : "bg-white dark:bg-slate-800 dark:text-slate-100 dark:border-slate-700";

const neonBtn = (theme: Theme, solid?: boolean) =>
  theme === "neon"
    ? solid
      ? "bg-orange-500 text-black border border-orange-400 hover:bg-orange-400 shadow-lg shadow-orange-500/30"
      : "bg-[#2a2a2a] border border-orange-500 text-orange-100 hover:bg-[#3a3a3a] shadow-lg shadow-orange-500/20"
    : solid
      ? "bg-black text-white hover:bg-gray-800 dark:bg-slate-700 dark:hover:bg-slate-600"
      : "bg-white dark:bg-slate-700 dark:text-slate-100 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-600";

const inputCls = (theme: Theme) =>
  theme === "neon"
    ? "border border-orange-500 bg-[#2a2a2a] text-orange-100 rounded-xl px-3 py-2 w-full placeholder-orange-300 focus:border-orange-400 focus:ring-2 focus:ring-orange-500/20 [color-scheme:dark]"
    : "border rounded-xl px-3 py-2 w-full bg-white dark:bg-slate-800 dark:text-slate-100 dark:border-slate-600 focus:ring-2 focus:ring-blue-500/20";

function TypeLabel({ text }: { text: string }) {
  return (
    <div aria-label={text} className="text-2xl font-semibold">
      {text.split("").map((ch, i) => (
        <motion.span
          key={i}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: i * 0.05, duration: 0.2 }}
        >
          {ch}
        </motion.span>
      ))}
    </div>
  );
}

function ThemeToggle({ theme, setTheme }: { theme: Theme; setTheme: (t: Theme) => void }) {
  const isDark = theme === "dark";
  const isNeon = theme === "neon";
  return (
    <div className="flex items-center gap-2">
      <motion.button
        onClick={() => setTheme(isDark ? "light" : "dark")}
        className={theme === "neon" ? "h-8 w-8 grid place-items-center rounded-full border border-orange-700 bg-[#0B0B0B]/60" : "h-8 w-8 grid place-items-center rounded-full border bg-white dark:bg-slate-800"}
        aria-label={isDark ? "Switch to light" : "Switch to dark"}
        title={isDark ? "Light" : "Dark"}
        whileHover={{ scale: 1.1, rotate: 15 }}
        whileTap={{ scale: 0.9 }}
      >
        <AnimatePresence initial={false} mode="wait">
          {isDark ? (
            <motion.span 
              key="moon"
              initial={{ rotate: -90, opacity: 0 }}
              animate={{ rotate: 0, opacity: 1 }}
              exit={{ rotate: 90, opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              <Moon className="w-4 h-4" />
            </motion.span>
          ) : (
            <motion.span 
              key="sun"
              initial={{ rotate: -90, opacity: 0 }}
              animate={{ rotate: 0, opacity: 1 }}
              exit={{ rotate: 90, opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              <Sun className="w-4 h-4" />
            </motion.span>
          )}
        </AnimatePresence>
      </motion.button>
      <motion.button
        onClick={() => setTheme(isNeon ? "light" : "neon")}
        className={isNeon ? "h-8 px-2 rounded-full border border-orange-700 bg-orange-700 text-black inline-flex items-center gap-1" : "h-8 px-2 rounded-full border inline-flex items-center gap-1 bg-white dark:bg-slate-800"}
        title="Neon mode"
        whileHover={{ scale: 1.05, y: -1 }}
        whileTap={{ scale: 0.95 }}
      >
        <Zap className="w-4 h-4" /> Neon
      </motion.button>
    </div>
  );
}

function NotificationsBell({ theme, unread, onOpenFeed }: { theme: Theme; unread: number; onOpenFeed: () => void }) {
  return (
    <motion.button
      className={
        theme === "neon"
          ? "relative h-8 w-8 grid place-items-center rounded-full border border-orange-700 bg-[#0B0B0B]/60"
          : "relative h-8 w-8 grid place-items-center rounded-full border bg-white dark:bg-slate-800"
      }
      onClick={onOpenFeed}
      title="Notifications"
      whileHover={{ scale: 1.1, rotate: 15 }}
      whileTap={{ scale: 0.9 }}
    >
      {unread > 0 && (
        <motion.span 
          className="absolute -top-1 -right-1 min-w-[18px] h-[18px] text-[11px] rounded-full grid place-items-center bg-rose-600 text-white px-1"
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: "spring", stiffness: 500, damping: 15 }}
        >
          {Math.min(99, unread)}
        </motion.span>
      )}
      <motion.div
        animate={unread > 0 ? { rotate: [0, -15, 15, -15, 0] } : {}}
        transition={{ duration: 0.5, repeat: Infinity, repeatDelay: 3 }}
      >
        <Bell className="w-4 h-4" />
      </motion.div>
    </motion.button>
  );
}

function HoverCard({ children, onClick, delay = 0.03, theme }: { children: React.ReactNode; onClick: () => void; delay?: number; theme: Theme }) {
  return (
    <motion.button 
      onClick={onClick} 
      className={classNames("border rounded-2xl px-3 py-3 text-left", neonBox(theme))}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      transition={{ delay, duration: 0.3 }}
      whileHover={{ scale: 1.02, y: -2 }}
      whileTap={{ scale: 0.98 }}
    >
      {children}
    </motion.button>
  );
}

/** Neon-friendly select */
function FancySelect({ value, onChange, children, theme, placeholder }: { value: string; onChange: (v: string) => void; children: React.ReactNode; theme: Theme; placeholder?: string }) {
  return (
    <div className={classNames("relative rounded-xl", theme === "neon" ? "border border-orange-500 bg-[#2a2a2a] text-orange-100 shadow-lg shadow-orange-500/20" : "border bg-white dark:bg-slate-800 dark:text-slate-100")}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={classNames(
          "appearance-none w-full px-3 py-2 pr-8 rounded-xl focus:outline-none focus:ring-2",
          theme === "neon" 
            ? "bg-[#2a2a2a] text-orange-100 [color-scheme:dark] focus:ring-orange-500/20" 
            : "bg-white dark:bg-slate-800 dark:text-slate-100 focus:ring-blue-500/20"
        )}
        style={theme === "neon" || document.documentElement.classList.contains("dark") ? { colorScheme: "dark" } : {}}
      >
        {placeholder && <option value="">{placeholder}</option>}
        {children}
      </select>
      <ChevronDown className={classNames("pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4", theme === "neon" ? "text-orange-300" : "text-slate-500 dark:text-slate-300")} />
    </div>
  );
}

/* PIN modals */
function PinModal({ open, onClose, onCheck, theme }: { open: boolean; onClose: () => void; onCheck: (pin: string) => void; theme: Theme }) {
  return (
    <AnimatePresence>{open && <PinModalGeneric title="Enter PIN" onClose={onClose} onOk={(pin) => onCheck(pin)} maxLen={5} theme={theme} />}</AnimatePresence>
  );
}
function PinModalGeneric({ title, onClose, onOk, maxLen, theme }: { title: string; onClose: () => void; onOk: (pin: string) => void; maxLen: number; theme: Theme }) {
  const [pin, setPin] = useState("");
  return (
    <motion.div 
      className="fixed inset-0 z-50 bg-black/40 grid place-items-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
    >
      <motion.div 
        className={classNames("rounded-2xl p-5 w-[min(440px,92vw)]", neonBox(theme))}
        initial={{ scale: 0.9, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.9, opacity: 0, y: 20 }}
        transition={{ duration: 0.3 }}
      >
        <div className="flex items-center justify-between mb-3">
          <div className="font-semibold flex items-center gap-2">
            <Lock className="w-4 h-4" /> {title}
          </div>
          <motion.button 
            className={classNames("p-1 rounded", theme === "neon" ? "hover:bg-orange-500/20" : "hover:bg-slate-100 dark:hover:bg-slate-800")} 
            onClick={onClose}
            whileHover={{ scale: 1.1, rotate: 90 }}
            whileTap={{ scale: 0.9 }}
          >
            <X className="w-4 h-4" />
          </motion.button>
        </div>
        <div className="space-y-3">
          <div className="text-sm opacity-70">Enter {maxLen}-digit PIN.</div>
          <input className={inputCls(theme)} placeholder="PIN" type="password" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} maxLength={maxLen} />
          <motion.button 
            className={classNames("px-3 py-1.5 rounded-xl border", neonBtn(theme, true))} 
            onClick={() => (pin.length === maxLen ? onOk(pin) : toast.error(`PIN must be ${maxLen} digits`))}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
          >
            <Check className="w-4 h-4 inline mr-1" /> OK
          </motion.button>
        </div>
      </motion.div>
    </motion.div>
  );
}

/* ===========================
   App
   =========================== */

const seedAccounts: Account[] = [
  { id: uid(), name: "Bank Vault", role: "system" },
  ...AGENT_NAMES.map(n => ({ id: uid(), name: n, role: "agent" as const })),
];
const VAULT_ID = seedAccounts[0].id;
const seedTxns: Transaction[] = [
  { id: uid(), kind: "credit", amount: 8000, memo: "Mint", dateISO: nowISO(), toId: VAULT_ID },
];

export default function GCSDApp() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [txns, setTxns] = useState<Transaction[]>([]);
  const [stock, setStock] = useState<Record<string, number>>({});
  const [pins, setPins] = useState<Record<string, string>>({});
  const [goals, setGoals] = useState<Record<string, number>>({});
  const [notifs, setNotifs] = useState<Notification[]>([]);
  const [hydrated, setHydrated] = useState(false);

  const [theme, setTheme] = useState<Theme>("light");
  const [portal, setPortal] = useState<Portal>("home");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminPin, setAdminPin] = useState<string>("");
  const [currentAgentId, setCurrentAgentId] = useState<string>("");

  const [showIntro, setShowIntro] = useState(true);
  const [clock, setClock] = useState(fmtTime(new Date()));
  const [dateStr, setDateStr] = useState(fmtDate(new Date()));

  // Sandbox state removed
  const [receipt, setReceipt] = useState<{id:string; when:string; buyer:string; item:string; amount:number} | null>(null);
  const [pinModal, setPinModal] = useState<{open:boolean; agentId?:string; onOK?:(good:boolean)=>void}>({open:false});
  const [unread, setUnread] = useState(0);
  const [epochs, setEpochs] = useState<Record<string,string>>({}); // for “erase history from” timestamps

  /** metric epochs */
  const [metrics, setMetrics] = useState<MetricsEpoch>({});

  // theme side effect
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") root.classList.add("dark"); else root.classList.remove("dark");
    if (hydrated) kvSet("gcs-v4-theme", theme);
  }, [theme, hydrated]);

  /* hydrate from KV once on mount */
  useEffect(() => {
    (async () => {
      try {
        const core = await kvGet<{ accounts: Account[]; txns: Transaction[] }>("gcs-v4-core");
        if (core?.accounts && core?.txns) {
          // Clean up duplicates and ensure only valid agents exist
          const vault = core.accounts.find(a => a.role === "system") || seedAccounts[0];
          const existingAgents = core.accounts.filter(a => a.role === "agent");
          
          // Remove duplicates and only keep agents from AGENT_NAMES
          const cleanedAgents: Account[] = [];
          const seenNames = new Set<string>();
          
          // First, keep existing agents that are in AGENT_NAMES (no duplicates)
          for (const agent of existingAgents) {
            const normalizedName = agent.name.trim().toLowerCase();
            if (AGENT_NAMES.some(n => n.toLowerCase() === normalizedName) && !seenNames.has(normalizedName)) {
              cleanedAgents.push(agent);
              seenNames.add(normalizedName);
            }
          }
          
          // Add any missing agents from AGENT_NAMES
          for (const name of AGENT_NAMES) {
            const normalizedName = name.toLowerCase();
            if (!seenNames.has(normalizedName)) {
              cleanedAgents.push({ id: uid(), name, role: "agent" });
              seenNames.add(normalizedName);
            }
          }
          
          const cleanedAccounts = [vault, ...cleanedAgents];
          
          // Save cleaned accounts back to database
          if (cleanedAccounts.length !== core.accounts.length) {
            await kvSet("gcs-v4-core", { accounts: cleanedAccounts, txns: core.txns });
          }
          
          setAccounts(cleanedAccounts);
          setTxns(core.txns);
        } else {
          setAccounts(seedAccounts);
          setTxns(seedTxns);
          await kvSet("gcs-v4-core", { accounts: seedAccounts, txns: seedTxns });
        }
        setStock((await kvGet<Record<string, number>>("gcs-v4-stock")) ?? INITIAL_STOCK);
        setPins((await kvGet<Record<string, string>>("gcs-v4-pins")) ?? {});
        setGoals((await kvGet<Record<string, number>>("gcs-v4-goals")) ?? {});
        // Load notifications from KV storage instead of starting empty
        setNotifs((await kvGet<Notification[]>("gcs-v4-notifs")) ?? []);
        setEpochs((await kvGet<Record<string,string>>("gcs-v4-epochs")) ?? {});
        setMetrics((await kvGet<MetricsEpoch>("gcs-v4-metrics")) ?? {});
        // Load theme from KV storage
        setTheme((await kvGet<Theme>("gcs-v4-theme")) ?? "light");
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
        
        // Check if this is a complete reset by comparing account names
        setAccounts(prev => {
          const merged = mergeAccounts(prev, remote.accounts || []);
          // If remote has significantly different accounts (like after reset), use remote completely
          if (remote.accounts && remote.accounts.length > 0 && !accountsAreEqual(prev, remote.accounts)) {
            return remote.accounts;
          }
          return merged;
        });
        setTxns(prev => mergeTxns(prev, remote.txns || []));
        return;
      }
      if (key === "gcs-v4-stock")  setStock(val ?? (await kvGet("gcs-v4-stock")) ?? {});
      if (key === "gcs-v4-pins")   setPins(val ?? (await kvGet("gcs-v4-pins")) ?? {});
      if (key === "gcs-v4-goals")  setGoals(val ?? (await kvGet("gcs-v4-goals")) ?? {});
      // Notifications now sync live
      if (key === "gcs-v4-notifs") setNotifs(val ?? (await kvGet("gcs-v4-notifs")) ?? []);
      if (key === "gcs-v4-epochs") setEpochs(val ?? (await kvGet("gcs-v4-epochs")) ?? {});
      if (key === "gcs-v4-metrics") setMetrics(val ?? (await kvGet("gcs-v4-metrics")) ?? {});
      if (key === "gcs-v4-theme") setTheme(val ?? (await kvGet("gcs-v4-theme")) ?? "light");
    });
    return off;
  }, []);

  /* persist on changes */
  useEffect(() => { if (hydrated) kvSet("gcs-v4-core",  { accounts, txns }); }, [hydrated, accounts, txns]);
  useEffect(() => { if (hydrated) kvSet("gcs-v4-stock", stock);             }, [hydrated, stock]);
  useEffect(() => { if (hydrated) kvSet("gcs-v4-pins",  pins);              }, [hydrated, pins]);
  useEffect(() => { if (hydrated) kvSet("gcs-v4-goals", goals);             }, [hydrated, goals]);
  // Notifications now persist to KV storage
  useEffect(() => { if (hydrated) kvSet("gcs-v4-notifs", notifs);           }, [hydrated, notifs]);
  useEffect(() => { if (hydrated) kvSet("gcs-v4-epochs", epochs);           }, [hydrated, epochs]);
  useEffect(() => { if (hydrated) kvSet("gcs-v4-metrics", metrics);         }, [hydrated, metrics]);

  /* clock + intro */
  useEffect(()=> {
    const t = setInterval(()=> { const d=new Date(); setClock(fmtTime(d)); setDateStr(fmtDate(d)); }, 1000);
    return ()=> clearInterval(t);
  }, []);
  useEffect(()=> {
    if (!showIntro) return;
    const timer = setTimeout(()=> setShowIntro(false), 1500);
    const onKey = (e: KeyboardEvent)=> { if (e.key === "Enter") setShowIntro(false); };
    window.addEventListener("keydown", onKey);
    return ()=> { clearTimeout(timer); window.removeEventListener("keydown", onKey); };
  }, [showIntro]);

  /* theme body class management */
  useEffect(() => {
    if (theme === "neon") {
      document.body.classList.add("neon-theme");
    } else {
      document.body.classList.remove("neon-theme");
    }
    return () => {
      document.body.classList.remove("neon-theme");
    };
  }, [theme]);

  /* derived */
  const balances = useMemo(()=>computeBalances(accounts, txns), [accounts, txns]);
  const nonSystemIds = new Set(accounts.filter(a=>a.role!=="system").map(a=>a.id));

  const agent = accounts.find(a=>a.id===currentAgentId);
  const agentTxns = txns
    .filter(t => (t.fromId===currentAgentId || t.toId===currentAgentId) && afterEpoch(epochs, currentAgentId, t.dateISO))
    .sort((a,b)=> new Date(b.dateISO).getTime() - new Date(a.dateISO).getTime());
  const agentBalance = balances.get(currentAgentId)||0;

  // lifetime earned: all sale credits (not Mint) MINUS correction/withdraw debits
  const lifetimeEarn = agentTxns
    .filter(t=> t.kind==="credit" && t.toId===currentAgentId && t.memo!=="Mint" && !G_isReversalOfRedemption(t))
    .reduce((a,b)=>a+b.amount,0)
    - agentTxns.filter(t=> G_isCorrectionDebit(t) && t.fromId===currentAgentId).reduce((a,b)=>a+b.amount,0);
  const lifetimeSpend = agentTxns.filter(t=> t.kind==="debit"  && t.fromId===currentAgentId && !G_isCorrectionDebit(t)).reduce((a,b)=>a+b.amount,0);
  const prizeCountActive = agentTxns.filter(t=> G_isRedeemTxn(t) && G_isRedeemStillActive(t, txns)).length;

  /* helpers bound to state */
  const postTxn = (partial: Partial<Transaction> & Pick<Transaction,"kind"|"amount">) =>
    setTxns(prev => [{ id: uid(), dateISO: nowISO(), memo: "", ...partial }, ...prev ]);
  const notify = (text:string) => {
    setNotifs(prev => [{ id: uid(), when: nowISO(), text }, ...prev].slice(0,200));
    setUnread(c => c + 1);
  };
  const getName = (id:string) => accounts.find(a=>a.id===id)?.name || "—";
  const openAgentPin = (agentId:string, cb:(ok:boolean)=>void) => setPinModal({open:true, agentId, onOK:cb});

  /* actions */
  function adminCredit(agentId:string, ruleKey:string, qty:number){
    const rule = PRODUCT_RULES.find(r=>r.key===ruleKey); 
    if (!rule) return toast.error("Invalid product rule");
    if (!agentId) return toast.error("Choose agent");
    if (!qty || qty <= 0) return toast.error("Quantity must be positive");
    
    const amount = rule.gcsd * Math.max(1, qty||1);
    postTxn({ kind:"credit", amount, toId: agentId, memo:`${rule.label}${qty>1?` x${qty}`:""}`, meta:{product:rule.key, qty} });
    notify(`➕ ${getName(agentId)} credited +${amount} GCSD for ${rule.label}${qty>1?` ×${qty}`:""}`);
    toast.success(`Added ${amount} GCSD to ${getName(agentId)}`);
    
    // Update metrics when new sale is added
    setMetrics(prev => ({
      ...prev,
      starOfDay: nowISO(), // Reset star of the day
      leaderOfMonth: nowISO() // Reset leader of the month
    }));
  }

  function manualTransfer(agentId:string, amount:number, note:string){
    if (!agentId) return toast.error("Choose an agent");
    if (!amount || amount <= 0) return toast.error("Enter a positive amount");
    if (amount > 100000) return toast.error("Amount too large (max 100,000 GCSD)");
    
    postTxn({ kind:"credit", amount, toId: agentId, memo: note || "Manual transfer" });
    notify(`➕ ${getName(agentId)} credited +${amount} GCSD (manual)`);
    toast.success(`Transferred ${amount} GCSD to ${getName(agentId)}`);
    
    // Update metrics when manual transfer occurs
    setMetrics(prev => ({
      ...prev,
      starOfDay: nowISO(), // Reset star of the day
      leaderOfMonth: nowISO() // Reset leader of the month
    }));
  }

  function redeemPrize(agentId:string, prizeKey:string){
    const prize = PRIZE_ITEMS.find(p=>p.key===prizeKey); if(!prize) return;
    const left = stock[prizeKey] ?? 0;
    const bal  = balances.get(agentId)||0;
    /** count only ACTIVE redeems towards the limit */
    const count= txns.filter(t=> t.fromId===agentId && G_isRedeemTxn(t) && G_isRedeemStillActive(t, txns)).length;

    if (count >= MAX_PRIZES_PER_AGENT) return toast.error(`Limit reached (${MAX_PRIZES_PER_AGENT})`);
    if (left <= 0) return toast.error("Out of stock");
    if (bal  < prize.price) return toast.error("Insufficient balance");

    openAgentPin(agentId, (ok)=>{
      if (!ok) return toast.error("Wrong PIN");
      postTxn({ kind:"debit", amount: prize.price, fromId: agentId, memo:`Redeem: ${prize.label}` });
      setStock(s=> ({...s, [prizeKey]: left-1}));
      notify(`🎁 ${getName(agentId)} redeemed ${prize.label} (−${prize.price} GCSD)`);
      setReceipt({
        id: "ORD-" + Math.random().toString(36).slice(2,7).toUpperCase(),
        when: new Date().toLocaleString(), buyer: getName(agentId), item: prize.label, amount: prize.price
      });
      toast.success(`Redeemed ${prize.label}`);
      
      // Update metrics when prize is redeemed
      setMetrics(prev => ({
        ...prev,
        starOfDay: nowISO(), // Reset star of the day
        leaderOfMonth: nowISO() // Reset leader of the month
      }));
    });
  }

  function undoSale(txId:string){
    const t = txns.find(x=>x.id===txId); 
    if (!t || t.kind!=="credit" || !t.toId) return;
    
    // Check if already undone
    if (G_isTransactionUndone(t, txns)) {
      toast.error("This transaction has already been undone");
      return;
    }
    
    postTxn({ kind:"debit", amount: t.amount, fromId: t.toId, memo:`Reversal of sale: ${t.memo ?? "Sale"}`, meta:{reversesTxnId: t.id} });
    notify(`↩️ Reversed sale for ${getName(t.toId)} (−${t.amount})`);
    toast.success("Sale reversed");
    
    // Update metrics when sale is undone
    setMetrics(prev => ({
      ...prev,
      starOfDay: nowISO(), // Reset star of the day
      leaderOfMonth: nowISO() // Reset leader of the month
    }));
  }

  function undoRedemption(txId:string){
    const t = txns.find(x=>x.id===txId); 
    if (!t || t.kind!=="debit" || !t.fromId) return;
    
    // Check if already undone
    if (G_isTransactionUndone(t, txns)) {
      toast.error("This redemption has already been undone");
      return;
    }
    
    const label = (t.memo||"").replace("Redeem: ","");
    const prize = PRIZE_ITEMS.find(p=>p.label===label);
    postTxn({ kind:"credit", amount: t.amount, toId: t.fromId, memo:`Reversal of redemption: ${label}`, meta:{reversesTxnId: t.id} });
    if (prize) setStock(s=> ({...s, [prize.key]: (s[prize.key]??0)+1}));
    notify(`↩️ Reversed redemption for ${getName(t.fromId)} (+${t.amount})`);
    toast.success("Redemption reversed & stock restored");
    
    // Update metrics when redemption is undone
    setMetrics(prev => ({
      ...prev,
      starOfDay: nowISO(), // Reset star of the day
      leaderOfMonth: nowISO() // Reset leader of the month
    }));
  }

  function withdrawAgentCredit(agentId:string, txId:string){
    const t = txns.find(x=>x.id===txId);
    if (!t || t.kind!=="credit" || t.toId!==agentId) return toast.error("Choose a credit to withdraw");
    
    // Check if already withdrawn/undone
    if (G_isTransactionUndone(t, txns)) {
      toast.error("This credit has already been withdrawn");
      return;
    }
    
    const bal = balances.get(agentId)||0;
    if (bal < t.amount) return toast.error("Cannot withdraw more than current balance");
    /** Post a targeted reversal so this sale is treated as not active */
    postTxn({ kind:"debit", amount: t.amount, fromId: agentId, memo:`Reversal of sale: ${t.memo || "Sale"}`, meta:{reversesTxnId: t.id} });
    notify(`🧾 Withdrawn ${t.amount} GCSD from ${getName(agentId)} (reversal of sale)`);
    toast.success("Credits withdrawn");
    
    // Update metrics when withdrawal occurs
    setMetrics(prev => ({
      ...prev,
      starOfDay: nowISO(), // Reset star of the day
      leaderOfMonth: nowISO() // Reset leader of the month
    }));
  }

  /** Manual withdraw (correction) */
  function withdrawManual(agentId:string, amount:number, note?:string){
    if (!agentId) return toast.error("Choose an agent");
    if (!amount || amount <= 0) return toast.error("Enter a positive amount");
    const bal = balances.get(agentId)||0;
    if (bal < amount) return toast.error("Cannot withdraw more than current balance");
    postTxn({ kind:"debit", amount, fromId: agentId, memo:`Correction (withdraw): ${note?.trim() || "Manual correction"}` });
    notify(`🧾 Withdrawn ${amount} GCSD from ${getName(agentId)} (manual correction)`);
    toast.success("Credits withdrawn");
    
    // Update metrics when withdrawal occurs
    setMetrics(prev => ({
      ...prev,
      starOfDay: nowISO(), // Reset star of the day
      leaderOfMonth: nowISO() // Reset leader of the month
    }));
  }

  function addAgent(name:string){
    const trimmed = name.trim();
    if (!trimmed) return toast.error("Enter a name");
    
    // Check if agent already exists
    if (accounts.some(a => a.role==="agent" && a.name.toLowerCase()===trimmed.toLowerCase())) {
      return toast.error("Agent already exists");
    }
    
    // Check if we already have all agents from AGENT_NAMES
    const agentCount = accounts.filter(a => a.role === "agent").length;
    if (agentCount >= AGENT_NAMES.length) {
      return toast.error(`Maximum ${AGENT_NAMES.length} agents allowed`);
    }
    
    // Only allow adding agents that are in AGENT_NAMES
    if (!AGENT_NAMES.some(n => n.toLowerCase() === trimmed.toLowerCase())) {
      return toast.error(`Agent must be one of the predefined names`);
    }
    
    const a: Account = { id: uid(), name: trimmed, role: "agent" };
    setAccounts(prev=> [...prev, a]);
    notify(`👤 New agent added: ${trimmed}`);
    toast.success(`Added agent ${trimmed}`);
  }

  function setAgentPin(agentId:string, pin:string){
    if (!/^\d{5}$/.test(pin)) return toast.error("PIN must be 5 digits");
    setPins(prev=> ({...prev, [agentId]: pin}));
    notify(`🔐 PIN set/reset for ${getName(agentId)}`);
    toast.success("PIN updated");
  }

  function resetPin(agentId:string){
    setPins(prev=> { const next = {...prev}; delete next[agentId]; return next; });
    notify(`🔐 PIN cleared for ${getName(agentId)}`);
    toast.success("PIN reset (cleared)");
  }
  
  function deleteAgent(agentId:string){
    const agent = accounts.find(a => a.id === agentId);
    if (!agent) return toast.error("Agent not found");
    
    // Check if agent has any transactions
    const hasTransactions = txns.some(t => t.fromId === agentId || t.toId === agentId);
    if (hasTransactions) {
      const confirm = window.confirm(
        `${agent.name} has transaction history. Deleting will keep transactions but remove the agent. Continue?`
      );
      if (!confirm) return;
    }
    
    // Remove agent
    setAccounts(prev => prev.filter(a => a.id !== agentId));
    
    // Clean up related data
    setPins(prev => { const next = {...prev}; delete next[agentId]; return next; });
    setGoals(prev => { const next = {...prev}; delete next[agentId]; return next; });
    setEpochs(prev => { const next = {...prev}; delete next[agentId]; return next; });
    
    notify(`🗑️ Agent ${agent.name} removed`);
    toast.success(`Deleted ${agent.name}`);
  }

  function setSavingsGoal(agentId:string, amount:number){
    if (amount <= 0) return toast.error("Enter a positive goal");
    setGoals(prev=> ({...prev, [agentId]: amount}));
    notify(`🎯 ${getName(agentId)} updated savings goal to ${amount} GCSD`);
    toast.success("Goal updated");
  }

  // Reset balance to 0 by posting a correcting transaction (and mark an epoch to hide prior history)
  function resetAgentBalance(agentId:string){
    const bal = balances.get(agentId)||0;
    if (bal === 0) {
      setEpochs(prev=> ({...prev, [agentId]: nowISO()}));
      return toast.info("Balance already zero; history hidden from now");
    }
    if (bal > 0) {
      postTxn({ kind:"debit", amount: bal, fromId: agentId, memo:`Balance reset to 0` });
      notify(`🧮 Reset balance of ${getName(agentId)} by −${bal} GCSD`);
    } else {
      postTxn({ kind:"credit", amount: -bal, toId: agentId, memo:`Balance reset to 0` });
      notify(`🧮 Reset balance of ${getName(agentId)} by +${-bal} GCSD`);
    }
    setEpochs(prev=> ({...prev, [agentId]: nowISO()}));
    toast.success("Balance reset");
  }

  // Reset all transactions (keep agents, clear all sales/redeems/history)
  async function completeReset(){
    const extra = prompt("Type 'RESET' to confirm clearing all transactions:");
    if (!extra || extra !== "RESET") return toast.error("Reset cancelled");
    
    // Keep existing accounts but clear all transactions except initial mint to vault
    const vaultAccount = accounts.find(a => a.role === "system");
    if (!vaultAccount) return toast.error("System error: vault not found");
    
    const freshTxns: Transaction[] = [
      { id: uid(), kind: "credit", amount: 8000, memo: "Mint", dateISO: nowISO(), toId: vaultAccount.id },
    ];
    const freshStock = INITIAL_STOCK;
    const freshGoals = {};
    const freshEpochs = {};
    const freshMetrics = {};
    const freshNotifs: Notification[] = [];
    
    // Save to database
    try {
      await kvSet("gcs-v4-core", { accounts, txns: freshTxns });
      await kvSet("gcs-v4-stock", freshStock);
      await kvSet("gcs-v4-goals", freshGoals);
      await kvSet("gcs-v4-epochs", freshEpochs);
      await kvSet("gcs-v4-metrics", freshMetrics);
      await kvSet("gcs-v4-notifs", freshNotifs);
      // Keep PINs - don't reset them
    } catch (error) {
      console.warn("Failed to save reset state:", error);
    }
    
    // Update local state
    setTxns(freshTxns);
    setStock(freshStock);
    setGoals(freshGoals);
    setEpochs(freshEpochs);
    setMetrics(freshMetrics);
    setNotifs(freshNotifs);
    
    notify("🧨 All transactions cleared by admin");
    toast.success("All transactions cleared - agents preserved");
  }

  /** Admin metric resets */
  async function resetMetric(kind: keyof MetricsEpoch){
    const newMetrics = { ...metrics, [kind]: nowISO() };
    setMetrics(newMetrics);
    
    // Save to database
    try {
      await kvSet("gcs-v4-metrics", newMetrics);
    } catch (error) {
      console.warn("Failed to save metric reset:", error);
    }
    
    toast.success("Reset applied");
  }

  // Sandbox mode removed - not needed for banking app

  /* ============================ render ============================ */
  return (
    <div
      className={
        theme === "neon"
          ? "min-h-screen overflow-x-hidden bg-[#0B0B0B] text-orange-50 transition-colors duration-200"
          : "min-h-screen overflow-x-hidden bg-gradient-to-b from-slate-50 to-white dark:from-slate-900 dark:to-slate-950 dark:text-slate-100 transition-colors duration-200"
      }
    >
      <Toaster position="top-center" richColors />

      {/* Intro */}
      <AnimatePresence>
        {showIntro && (
          <motion.div 
            className={`fixed inset-0 z-50 grid place-items-center ${theme==="neon" ? "bg-[#0B0B0B]" : "bg-black/85"} text-white`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
          >
            <motion.div 
              className="text-center p-8"
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.8, opacity: 0 }}
              transition={{ duration: 0.5, delay: 0.1 }}
            >
              <motion.div 
                className="mx-auto mb-6 w-48 h-48 rounded-[28px] bg-white/10 grid place-items-center shadow-[0_0_90px_rgba(255,165,0,.55)]"
                initial={{ y: -20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ duration: 0.6, delay: 0.2 }}
              >
                <motion.img 
                  src={LOGO_URL} 
                  alt="GCS Bank logo" 
                  className="w-40 h-40 rounded drop-shadow-[0_6px_18px_rgba(255,165,0,.35)]"
                  initial={{ scale: 0.5, rotate: -10 }}
                  animate={{ scale: 1, rotate: 0 }}
                  transition={{ duration: 0.7, delay: 0.3 }}
                />
              </motion.div>
              <TypeLabel text={`Welcome to ${APP_NAME}`} />
              <motion.div 
                className="text-white/70 mt-2 mb-6"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.5, delay: 1.2 }}
              >
                Press Enter to continue
              </motion.div>
              <motion.button 
                className="px-4 py-2 rounded-xl bg-white text-black"
                onClick={()=> setShowIntro(false)}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 1.4 }}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
              >
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
            <motion.button
              className={classNames("ml-3 inline-flex items-center gap-1 text-sm px-2 py-1 rounded-lg", neonBtn(theme))}
              onClick={()=> setPortal("home")}
              title="Go Home"
              whileHover={{ scale: 1.05, y: -1 }}
              whileTap={{ scale: 0.95 }}
            >
              <HomeIcon className="w-4 h-4"/> Home
            </motion.button>
          </div>
          <div className="flex items-center gap-3">
            <NotificationsBell theme={theme} unread={unread} onOpenFeed={() => { setPortal("feed"); setUnread(0); }} />
            <span className={classNames("text-xs font-mono", theme==="neon" ? "text-orange-200":"text-slate-600 dark:text-slate-300")}>{dateStr} • {clock}</span>
            <ThemeToggle theme={theme} setTheme={setTheme}/>
            <motion.button 
              className={classNames("px-3 py-1.5 rounded-xl flex items-center gap-2", neonBtn(theme))}
              onClick={()=> setPickerOpen(true)}
              whileHover={{ scale: 1.05, y: -1 }}
              whileTap={{ scale: 0.95 }}
            >
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
            theme={theme}
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
        theme={theme}
      />

      {/* Receipt */}
      <AnimatePresence>
        {receipt && (
          <motion.div 
            className="fixed inset-0 z-50 bg-black/40 grid place-items-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <motion.div 
              className={classNames("rounded-2xl p-5 w-[min(460px,92vw)]", neonBox(theme))}
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              transition={{ duration: 0.3 }}
            >
              <div className="flex items-center justify-between mb-3">
                <motion.div 
                  className="font-semibold flex items-center gap-2"
                  initial={{ x: -10, opacity: 0 }}
                  animate={{ x: 0, opacity: 1 }}
                  transition={{ delay: 0.1 }}
                >
                  <Gift className="w-4 h-4"/> Receipt
                </motion.div>
                <motion.button 
                  className="p-1 rounded hover:bg-black/10 dark:hover:bg-white/10" 
                  onClick={()=>setReceipt(null)}
                  whileHover={{ scale: 1.1, rotate: 90 }}
                  whileTap={{ scale: 0.9 }}
                >
                  <X className="w-4 h-4"/>
                </motion.button>
              </div>
              <motion.div 
                className="text-sm space-y-2"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.15 }}
              >
                <div><b>Order ID:</b> {receipt.id}</div>
                <div><b>Date:</b> {receipt.when}</div>
                <div><b>Buyer:</b> {receipt.buyer}</div>
                <div><b>Prize:</b> {receipt.item}</div>
                <div><b>Amount:</b> {receipt.amount.toLocaleString()} GCSD</div>
              </motion.div>
              <motion.div 
                className="mt-4 text-xs opacity-70"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 0.7, y: 0 }}
                transition={{ delay: 0.3 }}
              >
                Tip: screenshot or print this popup for records.
              </motion.div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Pages */}
      <div className="max-w-6xl mx-auto px-4 py-6">
        <AnimatePresence mode="wait">
          {portal==="home" && (
            <motion.div
              key="home"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.3 }}
            >
              <Home
                theme={theme}
                accounts={accounts}
                txns={txns}
                stock={stock}
                prizes={PRIZE_ITEMS}
                metrics={metrics}
              />
            </motion.div>
          )}

          {portal==="agent" && currentAgentId && (
            <motion.div
              key="agent"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.3 }}
            >
              <AgentPortal
                theme={theme}
                agentId={currentAgentId}
                accounts={accounts}
                txns={txns}
                stock={stock}
                prizes={PRIZE_ITEMS}
                goals={goals}
                onSetGoal={(amt)=> setSavingsGoal(currentAgentId, amt)}
                onRedeem={(k)=>redeemPrize(currentAgentId, k)}
              />
            </motion.div>
          )}

          {portal==="admin" && (
            <motion.div
              key="admin"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.3 }}
            >
              <AdminPortal
                theme={theme}
                isAdmin={isAdmin}
                accounts={accounts}
                txns={txns}
                stock={stock}
                rules={PRODUCT_RULES}
                pins={pins}
                epochs={epochs}
                onCredit={adminCredit}
                onManualTransfer={manualTransfer}
                onUndoSale={undoSale}
                onUndoRedemption={undoRedemption}
                onWithdraw={withdrawAgentCredit}
                onWithdrawManual={withdrawManual}
                onAddAgent={addAgent}
                onSetPin={setAgentPin}
                onResetPin={(id)=>resetPin(id)}
                onResetBalance={(id)=>resetAgentBalance(id)}
                onDeleteAgent={(id)=>deleteAgent(id)}
                onCompleteReset={completeReset}
                onResetMetric={resetMetric}
              />
            </motion.div>
          )}

          {portal==="feed" && (
            <motion.div
              key="feed"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.3 }}
            >
              <FeedPage theme={theme} notifs={notifs} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

/* ===========================
   Pages
   =========================== */

/** HOME: computes 30d stats (never negative daily) & purchased list (active redeems only) */
function Home({
  theme,
  accounts,
  txns,
  stock,
  prizes,
  metrics,
}: {
  theme: Theme;
  accounts: Account[];
  txns: Transaction[];
  stock: Record<string, number>;
  prizes: PrizeItem[];
  metrics: MetricsEpoch;
}) {
  const nonSystemIds = useMemo(() => new Set(accounts.filter((a) => a.role !== "system").map((a) => a.id)), [accounts]);

  // Purchases list – only active redeems (not reversed)
  const purchases = useMemo(() => txns
    .filter((t) => G_isRedeemTxn(t) && t.fromId && nonSystemIds.has(t.fromId))
    .filter((t) => G_isRedeemStillActive(t, txns))
    .map((t) => ({ when: new Date(t.dateISO), memo: t.memo!, amount: t.amount })), [txns, nonSystemIds]);

  // 30-day series - memoized to prevent recalculation
  const days = useMemo(() => Array.from({ length: 30 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (29 - i));
    d.setHours(0, 0, 0, 0);
    return d;
  }), []); // Empty dependency array since we want consistent 30-day period

  const earnedSeries: number[] = useMemo(() => days.map((d) => {
    // Only count active credits (not reversed) for stable calculation
    const activeCredits = sumInRange(
      txns,
      d,
      1,
      (t) => t.kind === "credit" && !!t.toId && nonSystemIds.has(t.toId) && t.memo !== "Mint" && !G_isReversalOfRedemption(t) && G_isSaleStillActive(t, txns) && afterISO(metrics.earned30d, t.dateISO)
    );
    return Math.max(0, activeCredits); // never negative
  }), [txns, metrics.earned30d, days, nonSystemIds]);

  const spentSeries: number[] = useMemo(() => days.map((d) =>
    sumInRange(txns, d, 1, (t) => t.kind === "debit" && !!t.fromId && nonSystemIds.has(t.fromId) && !G_isCorrectionDebit(t) && afterISO(metrics.spent30d, t.dateISO))
  ), [txns, metrics.spent30d, days, nonSystemIds]);

  const totalEarned = useMemo(() => earnedSeries.reduce((a, b) => a + b, 0), [earnedSeries]);
  const totalSpent = useMemo(() => spentSeries.reduce((a, b) => a + b, 0), [spentSeries]);

  // Leaderboard: use current balance (proper banking logic) - memoized for stability
  const balances = useMemo(() => computeBalances(accounts, txns), [accounts, txns]);
  const leaderboard = useMemo(() => Array.from(nonSystemIds)
    .map((id) => {
      const balance = balances.get(id) || 0;
      return { id, name: accounts.find((a) => a.id === id)?.name || "—", balance };
    })
    .sort((a, b) => b.balance - a.balance), [nonSystemIds, balances, accounts]);

  // Simple "star of day" & "leader of month" (apply metric epochs) - memoized for stability
  const { starOfDay, leaderOfMonth } = useMemo(() => {
    const todayKey = new Date().toLocaleDateString();
    const curMonth = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
    const earnedToday: Record<string, number> = {};
    const earnedMonth: Record<string, number> = {};
    
    for (const t of txns) {
      if (t.kind !== "credit" || !t.toId || t.memo === "Mint" || G_isReversalOfRedemption(t) || !nonSystemIds.has(t.toId)) continue;
      const d = new Date(t.dateISO);
      if (afterISO(metrics.starOfDay, t.dateISO) && d.toLocaleDateString() === todayKey) {
        earnedToday[t.toId] = (earnedToday[t.toId] || 0) + t.amount;
      }
      const mk = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      if (afterISO(metrics.leaderOfMonth, t.dateISO) && mk === curMonth) {
        earnedMonth[t.toId] = (earnedMonth[t.toId] || 0) + t.amount;
      }
    }
    
    const starId = Object.entries(earnedToday).sort((a, b) => b[1] - a[1])[0]?.[0];
    const leaderId = Object.entries(earnedMonth).sort((a, b) => b[1] - a[1])[0]?.[0];
    
    return {
      starOfDay: starId ? { name: accounts.find((a) => a.id === starId)?.name || "—", amount: earnedToday[starId] } : null,
      leaderOfMonth: leaderId ? { name: accounts.find((a) => a.id === leaderId)?.name || "—", amount: earnedMonth[leaderId] } : null
    };
  }, [txns, metrics.starOfDay, metrics.leaderOfMonth, accounts, nonSystemIds]);

  return (
    <div>
      <div className="grid md:grid-cols-3 gap-4">
        {/* Dashboard */}
        <div className={classNames("rounded-2xl border p-4 shadow-sm", neonBox(theme))}>
          <div className="text-sm opacity-70 mb-2">Dashboard</div>
          <div className="grid sm:grid-cols-2 gap-4">
            <TileRow label="Total GCSD Earned (30d)" value={totalEarned} />
            <TileRow label="Total GCSD Spent (30d)" value={totalSpent} />
          </div>

          <div className="mt-4">
            <div className="text-sm opacity-70 mb-2">Finance (30 days)</div>
            <LineChart earned={earnedSeries} spent={spentSeries} />
          </div>

          <div className="grid sm:grid-cols-2 gap-4 mt-4">
            <Highlight title="Star of the Day" value={starOfDay ? `${starOfDay.name} • +${starOfDay.amount.toLocaleString()} GCSD` : "—"} />
            <Highlight title="Leader of the Month" value={leaderOfMonth ? `${leaderOfMonth.name} • +${leaderOfMonth.amount.toLocaleString()} GCSD` : "—"} />
          </div>

          <div className="mt-4">
            <div className="text-sm opacity-70 mb-2">Purchased Prizes (Active)</div>
            <div className={classNames("rounded-xl border p-3", neonBox(theme))}>
              <div className="text-sm mb-2">
                Total purchases: <b>{purchases.length}</b>
              </div>
              <div className="space-y-2 max-h-40 overflow-auto pr-1">
                {purchases.map((p, i) => (
                  <motion.div 
                    key={i} 
                    className="flex items-center justify-between text-sm border rounded-lg px-3 py-1.5"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.05, duration: 0.3 }}
                    whileHover={{ scale: 1.02, backgroundColor: "rgba(0,0,0,0.02)" }}
                  >
                    <span>{p.memo.replace("Redeem: ", "")}</span>
                    <span className="opacity-70">{p.when.toLocaleString()}</span>
                  </motion.div>
                ))}
                {purchases.length === 0 && <div className="text-sm opacity-70">No purchases yet.</div>}
              </div>
            </div>
          </div>
        </div>

        {/* Leaderboard */}
        <div className={classNames("rounded-2xl border p-4 shadow-sm", neonBox(theme))}>
          <div className="text-sm opacity-70 mb-2">Leaderboard</div>
          <div className="space-y-2 max-h-[520px] overflow-auto pr-2">
            {leaderboard.map((row, i) => (
              <motion.div 
                key={row.id} 
                className={classNames("flex items-center justify-between border rounded-xl px-3 py-2", neonBox(theme))}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.05, duration: 0.3 }}
                whileHover={{ scale: 1.02, x: 4 }}
              >
                <div className="flex items-center gap-2">
                  <motion.span 
                    className="w-5 text-right"
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ delay: i * 0.05 + 0.1, type: "spring", stiffness: 200 }}
                  >
                    {i + 1}.
                  </motion.span>
                  <span className="font-medium">{row.name}</span>
                </div>
                <div className="text-sm">
                  <NumberFlash value={row.balance} />
                </div>
              </motion.div>
            ))}
            {leaderboard.length === 0 && <div className="text-sm opacity-70">No data yet.</div>}
          </div>
        </div>

        {/* Prizes */}
        <div className={classNames("rounded-2xl border p-4 shadow-sm", neonBox(theme))}>
          <div className="text-sm opacity-70 mb-2">Prizes (Available)</div>
          <div className="space-y-2 max-h-[520px] overflow-auto pr-2">
            {prizes.map((p, i) => (
              <motion.div 
                key={p.key} 
                className={classNames("flex items-center justify-between border rounded-xl px-3 py-2", neonBox(theme))}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.05, duration: 0.3 }}
                whileHover={{ scale: 1.02, x: -4 }}
              >
                <div className="font-medium">{p.label}</div>
                <div className="flex items-center gap-2">
                  <span className="text-sm opacity-80">{p.price.toLocaleString()} GCSD</span>
                  <motion.span 
                    className={theme === "neon" ? "px-2 py-0.5 rounded-md text-xs bg-[#0B0B0B] border border-orange-700 text-orange-200" : "px-2 py-0.5 rounded-md text-xs bg-slate-100 dark:bg-slate-700"}
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ delay: i * 0.05 + 0.15, duration: 0.2 }}
                  >
                    Stock: {stock[p.key] ?? 0}
                  </motion.span>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function Highlight({ title, value }: { title: string; value: string }) {
  return (
    <motion.div 
      className="rounded-xl border p-3"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      whileHover={{ scale: 1.02, y: -2 }}
    >
      <div className="text-xs opacity-70 mb-1">{title}</div>
      <div>{value}</div>
    </motion.div>
  );
}

/** Agent Portal */
function AgentPortal({
  theme,
  agentId,
  accounts,
  txns,
  stock,
  prizes,
  goals,
  onSetGoal,
  onRedeem,
}: {
  theme: Theme;
  agentId: string;
  accounts: Account[];
  txns: Transaction[];
  stock: Record<string, number>;
  prizes: PrizeItem[];
  goals: Record<string, number>;
  onSetGoal: (n: number) => void;
  onRedeem: (k: string) => void;
}) {
  const name = accounts.find((a) => a.id === agentId)?.name || "—";
  const balance = txns.reduce((s, t) => {
    if (t.toId === agentId && t.kind === "credit") s += t.amount;
    if (t.fromId === agentId && t.kind === "debit") s -= t.amount;
    return s;
  }, 0);

  const agentTxns = txns.filter((t) => t.toId === agentId || t.fromId === agentId);
  const lifetimeEarn =
    agentTxns.filter((t) => t.kind === "credit" && t.toId === agentId && t.memo !== "Mint" && !G_isReversalOfRedemption(t)).reduce((a, b) => a + b.amount, 0) -
    agentTxns.filter((t) => G_isCorrectionDebit(t) && t.fromId === agentId).reduce((a, b) => a + b.amount, 0);
  const lifetimeSpend = agentTxns.filter((t) => t.kind === "debit" && t.fromId === agentId && !G_isCorrectionDebit(t)).reduce((a, b) => a + b.amount, 0);
  /** only ACTIVE redeems count towards the 2-prize limit */
  const prizeCount = agentTxns.filter((t) => G_isRedeemTxn(t) && G_isRedeemStillActive(t, txns)).length;

  const goal = goals[agentId] || 0;
  const [goalInput, setGoalInput] = useState(goal ? String(goal) : "");
  const progress = goal > 0 ? Math.min(100, Math.round((balance / goal) * 100)) : 0;

  return (
    <div>
      <div className="grid lg:grid-cols-2 gap-4">
        {/* Summary */}
        <div className={classNames("rounded-2xl border p-4 shadow-sm", neonBox(theme))}>
          <div className="text-sm opacity-70 mb-2">Agent</div>
          <div className="text-xl font-semibold mb-1">{name}</div>
          <div className="grid sm:grid-cols-3 gap-3 mt-3">
            <TileRow label="Balance" value={balance} />
            <TileRow label="Lifetime Earned" value={Math.max(0, lifetimeEarn)} />
            <TileRow label="Lifetime Spent" value={lifetimeSpend} />
          </div>

          <div className="mt-4">
            <div className="text-sm opacity-70 mb-2">Savings goal</div>
            <div className="rounded-xl border p-3">
              <div className="flex items-center gap-3">
                <input className={inputCls(theme)} placeholder="Amount" value={goalInput} onChange={(e) => setGoalInput(e.target.value.replace(/[^\d]/g, ""))} />
                <button className={classNames("px-3 py-1.5 rounded-xl", neonBtn(theme, true))} onClick={() => (goalInput ? onSetGoal(parseInt(goalInput, 10)) : null)}>
                  <Check className="w-4 h-4 inline mr-1" /> Set goal
                </button>
              </div>
              <div className="mt-3 text-sm opacity-70">{goal > 0 ? `${progress}% towards ${goal.toLocaleString()} GCSD` : "No goal set"}</div>
              <div className="mt-2 h-2 rounded-full bg-black/10 dark:bg-white/10 overflow-hidden">
                <motion.div 
                  className="h-2 rounded-full bg-emerald-500" 
                  initial={{ width: 0 }}
                  animate={{ width: `${progress}%` }}
                  transition={{ duration: 0.8, ease: "easeOut" }}
                />
              </div>
            </div>
          </div>

          <div className="mt-4">
            <div className="text-sm opacity-70 mb-2">Recent activity</div>
            <div className="space-y-2 max-h-56 overflow-auto pr-2">
              {agentTxns.slice(0, 60).map((t, i) => (
                <motion.div 
                  key={t.id} 
                  className={classNames("border rounded-xl px-3 py-2 flex items-center justify-between", neonBox(theme))}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.03, duration: 0.3 }}
                  whileHover={{ scale: 1.02, x: 4 }}
                >
                  <div className="text-sm">{t.memo || (t.kind === "credit" ? "Credit" : "Debit")}</div>
                  <motion.div 
                    className={classNames("text-sm", t.kind === "credit" ? "text-emerald-500" : "text-rose-500")}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: i * 0.03 + 0.15, duration: 0.2 }}
                  >
                    {t.kind === "credit" ? "+" : "−"}{t.amount.toLocaleString()}
                  </motion.div>
                </motion.div>
              ))}
              {agentTxns.length === 0 && <div className="text-sm opacity-70">No activity yet.</div>}
            </div>
          </div>
        </div>

        {/* Shop */}
        <div className={classNames("rounded-2xl border p-4 shadow-sm", neonBox(theme))}>
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm opacity-70">Shop (limit {MAX_PRIZES_PER_AGENT}, you have {prizeCount})</div>
            <div className="text-xs opacity-70">Balance: {balance.toLocaleString()} GCSD</div>
          </div>
          <div className="space-y-2 max-h-[560px] overflow-auto pr-2">
            {prizes.map((p, i) => {
              const left = stock[p.key] ?? 0;
              const can = left > 0 && balance >= p.price && prizeCount < MAX_PRIZES_PER_AGENT;
              return (
                <motion.div 
                  key={p.key} 
                  className={classNames("flex items-center justify-between border rounded-xl px-3 py-2", neonBox(theme))}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05, duration: 0.3 }}
                  whileHover={{ scale: can ? 1.02 : 1, x: can ? -4 : 0 }}
                >
                  <div>
                    <div className="font-medium">{p.label}</div>
                    <div className="text-xs opacity-70">{p.price.toLocaleString()} GCSD • Stock {left}</div>
                  </div>
                  <motion.button 
                    disabled={!can} 
                    className={classNames("px-3 py-1.5 rounded-xl disabled:opacity-50", neonBtn(theme, true))} 
                    onClick={() => onRedeem(p.key)}
                    whileHover={can ? { scale: 1.05 } : {}}
                    whileTap={can ? { scale: 0.95 } : {}}
                  >
                    <Gift className="w-4 h-4 inline mr-1" /> Redeem
                  </motion.button>
                </motion.div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Admin */
function AdminPortal({
  theme,
  isAdmin,
  accounts,
  txns,
  stock,
  rules,
  pins,
  epochs,
  onCredit,
  onManualTransfer,
  onUndoSale,
  onUndoRedemption,
  onWithdraw,
  onWithdrawManual,
  onAddAgent,
  onSetPin,
  onResetPin,
  onResetBalance,
  onDeleteAgent,
  onCompleteReset,
  onResetMetric,
}: {
  theme: Theme;
  isAdmin: boolean;
  accounts: Account[];
  txns: Transaction[];
  stock: Record<string, number>;
  rules: ProductRule[];
  pins: Record<string, string>;
  epochs: Record<string, string>;
  onCredit: (agentId: string, ruleKey: string, qty: number) => void;
  onManualTransfer: (agentId: string, amount: number, note: string) => void;
  onUndoSale: (txId: string) => void;
  onUndoRedemption: (txId: string) => void;
  onWithdraw: (agentId: string, txId: string) => void;
  onWithdrawManual: (agentId: string, amount: number, note?: string) => void;
  onAddAgent: (name: string) => void;
  onSetPin: (agentId: string, pin: string) => void;
  onResetPin: (agentId: string) => void;
  onResetBalance: (agentId: string) => void;
  onDeleteAgent: (agentId: string) => void;
  onCompleteReset: () => void;
  onResetMetric: (k: keyof MetricsEpoch) => void;
}) {
  const [adminTab, setAdminTab] = useState<"dashboard" | "addsale" | "transfer" | "corrections" | "history" | "users">("dashboard");
  const [agentId, setAgentId] = useState("");
  const [ruleKey, setRuleKey] = useState(rules[0]?.key || "full_evaluation");
  const [qty, setQty] = useState(1);
  const [xferAmt, setXferAmt] = useState("");
  const [xferNote, setXferNote] = useState("");
  const [manualAmt, setManualAmt] = useState("");
  const [manualNote, setManualNote] = useState("");
  const [newAgent, setNewAgent] = useState("");
  const [pinAgent, setPinAgent] = useState("");
  const [pinVal, setPinVal] = useState("");
  const [showPins, setShowPins] = useState<Record<string, boolean>>({});
  const [editingPin, setEditingPin] = useState<string | null>(null);

  // Ensure ruleKey is set when component mounts
  useEffect(() => {
    if (!ruleKey && rules.length > 0) {
      setRuleKey(rules[0].key);
    }
  }, [ruleKey, rules]);

  if (!isAdmin) {
    return (
      <div className={classNames("rounded-2xl border p-6 text-center", neonBox(theme))}>
        <Lock className="w-5 h-5 mx-auto mb-2" />
        <div>Enter Admin PIN to access the portal.</div>
      </div>
    );
  }

  // Debug: Log admin portal state
  console.log("AdminPortal rendering:", { isAdmin, adminTab, agentId, ruleKey });

  /** show only ACTIVE credits (not already reversed/withdrawn) and NOT reversals themselves */
  const agentCredits = useMemo(() => {
    try {
      if (!agentId || !txns) return [];
      return txns.filter((t) => 
        t.kind === "credit" && 
        t.toId === agentId && 
        t.memo !== "Mint" && 
        !G_isReversalOfRedemption(t) && // Exclude reversal transactions
        !G_isCorrectionDebit(t) && // Exclude corrections
        !t.memo?.startsWith("Manual") && // Exclude manual transactions
        !t.memo?.startsWith("Withdraw") && // Exclude withdrawals
        G_isSaleStillActive(t, txns)
      );
    } catch (error) {
      console.error("Error in agentCredits useMemo:", error);
      return [];
    }
  }, [txns, agentId]);
  
  const agentRedeems = useMemo(() => {
    try {
      if (!agentId || !txns) return [];
      return txns.filter((t)=> 
        G_isRedeemTxn(t) && 
        t.fromId === agentId &&
        !t.memo?.startsWith("Manual") && // Exclude manual withdrawals
        !t.memo?.startsWith("Withdraw") && // Exclude manual withdrawals
        !t.memo?.startsWith("Correction") && // Exclude corrections
        G_isRedeemStillActive(t, txns) // Only show active redeems
      );
    } catch (error) {
      console.error("Error in agentRedeems useMemo:", error);
      return [];
    }
  }, [txns, agentId]);

  try {
    return (
      <div className="grid gap-4">
        {/* Tabs */}
        <div className={classNames("rounded-2xl border p-2 flex flex-wrap gap-2", neonBox(theme))}>
        {[
          ["dashboard", "Dashboard"],
          ["addsale", "Add Sale"],
          ["transfer", "Transfer"],
          ["corrections", "Corrections"],
          ["history", "History"],
          ["users", "Users"],
        ].map(([k, lab]) => (
          <motion.button 
            key={k} 
            onClick={() => setAdminTab(k as any)} 
            className={classNames(
              "px-3 py-1.5 rounded-xl text-sm transition-colors",
              adminTab === k ? neonBtn(theme, true) : neonBtn(theme)
            )}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            {lab}
          </motion.button>
        ))}
      </div>

      {/* Dashboard */}
      {adminTab === "dashboard" && (
        <motion.div 
          className="grid md:grid-cols-3 gap-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3 }}
        >
          <motion.div 
            className={classNames("rounded-2xl border p-4", neonBox(theme))}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.1 }}
          >
            <div className="text-sm opacity-70 mb-2">Balances</div>
            <div className="space-y-2 max-h-[420px] overflow-auto pr-2">
              {accounts
                .filter((a) => a.role !== "system")
                .map((a) => {
                  const bal = txns.reduce((s, t) => {
                    if (t.toId === a.id && t.kind === "credit") s += t.amount;
                    if (t.fromId === a.id && t.kind === "debit") s -= t.amount;
                    return s;
                  }, 0);
                  return (
                    <motion.div 
                      key={a.id} 
                      className={classNames("border rounded-xl px-3 py-2 flex items-center justify-between", neonBox(theme))}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      whileHover={{ scale: 1.01, x: 2 }}
                    >
                      <div className="font-medium">{a.name}</div>
                      <div className="text-sm font-semibold">{bal.toLocaleString()} GCSD</div>
                    </motion.div>
                  );
                })}
            </div>
          </motion.div>
          <motion.div 
            className={classNames("rounded-2xl border p-4", neonBox(theme))}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
          >
            <div className="text-sm opacity-70 mb-2">Prize Stock</div>
            <div className="space-y-2 max-h-[420px] overflow-auto pr-2">
              {PRIZE_ITEMS.map((p, i) => (
                <motion.div 
                  key={p.key} 
                  className={classNames("border rounded-xl px-3 py-2 flex items-center justify-between", neonBox(theme))}
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.03 }}
                  whileHover={{ scale: 1.01, x: -2 }}
                >
                  <div className="font-medium">{p.label}</div>
                  <div className="text-sm font-semibold">Stock: {stock[p.key] ?? 0}</div>
                </motion.div>
              ))}
            </div>
          </motion.div>
          {/* Reset metrics panel */}
          <motion.div 
            className={classNames("rounded-2xl border p-4", neonBox(theme))}
            initial={{ opacity: 0, x: 10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.2 }}
          >
            <div className="text-sm opacity-70 mb-2">Reset metrics</div>
            <div className="grid gap-2">
              <motion.button 
                className={classNames("px-3 py-2 rounded-xl text-sm", neonBtn(theme, true))} 
                onClick={()=> onResetMetric("earned30d")}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
              >
                Reset "Total GCSD Earned (30d)"
              </motion.button>
              <motion.button 
                className={classNames("px-3 py-2 rounded-xl text-sm", neonBtn(theme, true))} 
                onClick={()=> onResetMetric("spent30d")}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
              >
                Reset "Total GCSD Spent (30d)"
              </motion.button>
              <motion.button 
                className={classNames("px-3 py-2 rounded-xl text-sm", neonBtn(theme, true))} 
                onClick={()=> onResetMetric("starOfDay")}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
              >
                Reset "Star of the Day"
              </motion.button>
              <motion.button 
                className={classNames("px-3 py-2 rounded-xl text-sm", neonBtn(theme, true))} 
                onClick={()=> onResetMetric("leaderOfMonth")}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
              >
                Reset "Leader of the Month"
              </motion.button>
            </div>
          </motion.div>
        </motion.div>
      )}

      {/* Add sale */}
      {adminTab === "addsale" && (
        <motion.div 
          className={classNames("rounded-2xl border p-4", neonBox(theme))}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          <div className="grid sm:grid-cols-3 gap-3">
            <motion.div
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.1 }}
            >
              <div className="text-xs opacity-70 mb-1">Agent</div>
              <FancySelect value={agentId} onChange={setAgentId} theme={theme} placeholder="Choose agent…">
                {accounts
                  .filter((a) => a.role !== "system")
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
              </FancySelect>
            </motion.div>
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 }}
            >
              <div className="text-xs opacity-70 mb-1">Product</div>
              <FancySelect value={ruleKey} onChange={setRuleKey} theme={theme}>
                {rules.map((r) => (
                  <option key={r.key} value={r.key}>
                    {r.label} — {r.gcsd}
                  </option>
                ))}
              </FancySelect>
            </motion.div>
            <motion.div
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.2 }}
            >
              <div className="text-xs opacity-70 mb-1">Qty</div>
              <input className={inputCls(theme)} value={qty} onChange={(e) => setQty(Math.max(1, parseInt((e.target.value || "1").replace(/[^\d]/g, ""), 10)))} />
            </motion.div>
            <motion.div 
              className="sm:col-span-3 flex justify-end"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.3 }}
            >
              <motion.button 
                className={classNames("px-4 py-2 rounded-xl", neonBtn(theme, true))} 
                onClick={() => onCredit(agentId, ruleKey, qty)}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
              >
                <Plus className="w-4 h-4 inline mr-1" /> Add Sale
              </motion.button>
            </motion.div>
          </div>
        </motion.div>
      )}

      {/* Transfer */}
      {adminTab === "transfer" && (
        <motion.div 
          className={classNames("rounded-2xl border p-4 grid sm:grid-cols-3 gap-4", neonBox(theme))}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          <motion.div
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.1 }}
          >
            <div className="text-sm opacity-70 mb-2">Agent</div>
            <FancySelect value={agentId} onChange={setAgentId} theme={theme} placeholder="Choose agent…">
              {accounts
                .filter((a) => a.role !== "system")
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
            </FancySelect>
          </motion.div>
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
          >
            <div className="text-sm opacity-70 mb-2">Amount</div>
            <input className={inputCls(theme)} value={xferAmt} onChange={(e) => setXferAmt(e.target.value.replace(/[^\d]/g, ""))} />
          </motion.div>
          <motion.div
            initial={{ opacity: 0, x: 10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.2 }}
          >
            <div className="text-sm opacity-70 mb-2">Note</div>
            <input className={inputCls(theme)} value={xferNote} onChange={(e) => setXferNote(e.target.value)} placeholder="Manual transfer" />
          </motion.div>
          <motion.div 
            className="sm:col-span-3"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
          >
            <motion.button 
              className={classNames("px-4 py-2 rounded-xl", neonBtn(theme, true))} 
              onClick={() => onManualTransfer(agentId, parseInt(xferAmt || "0", 10), xferNote)}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              <Wallet className="w-4 h-4 inline mr-1" /> Transfer
            </motion.button>
          </motion.div>
        </motion.div>
      )}

      {/* Corrections */}
      {adminTab === "corrections" && (
        <div className={classNames("rounded-2xl border p-4 grid gap-4", neonBox(theme))}>
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <div className="text-xs opacity-70 mb-1">Choose agent to withdraw from</div>
              <FancySelect value={agentId} onChange={setAgentId} theme={theme} placeholder="Choose agent…">
                {accounts
                  .filter((a) => a.role !== "system")
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
              </FancySelect>
            </div>
          </div>

          {agentId && (
            <motion.div 
              className="rounded-xl border p-3"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
            >
              <div className="text-sm opacity-70 mb-2">Credits posted to {accounts.find((a) => a.id === agentId)?.name}</div>
              <div className="space-y-2 max-h-[360px] overflow-auto pr-2">
                {agentCredits.length === 0 && <div className="text-sm opacity-70">No active credit transactions found.</div>}
                {agentCredits.map((t, i) => {
                  return (
                    <motion.div 
                      key={t.id} 
                      className={classNames("border rounded-xl px-3 py-2 flex items-center justify-between", neonBox(theme))}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 10 }}
                      transition={{ delay: i * 0.03, duration: 0.2 }}
                    >
                      <div className="text-sm">
                        <div className="font-medium">{t.memo || "Credit"}</div>
                        <div className="opacity-70 text-xs">{new Date(t.dateISO).toLocaleString()}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="text-sm text-emerald-500">+{t.amount.toLocaleString()}</div>
                        <motion.button
                          className={classNames("px-2 py-1 rounded-lg text-xs", neonBtn(theme))}
                          onClick={() => onWithdraw(agentId, t.id)}
                          whileHover={{ scale: 1.05 }}
                          whileTap={{ scale: 0.95 }}
                        >
                          Withdraw
                        </motion.button>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </motion.div>
          )}

          {/* Manual withdraw */}
          <div className="rounded-xl border p-3">
            <div className="text-sm opacity-70 mb-2">Manual withdraw</div>
            <div className="grid sm:grid-cols-3 gap-3">
              <div>
                <div className="text-xs opacity-70 mb-1">Agent</div>
                <FancySelect value={agentId} onChange={setAgentId} theme={theme} placeholder="Choose agent…">
                  {accounts
                    .filter((a) => a.role !== "system")
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                </FancySelect>
              </div>
              <div>
                <div className="text-xs opacity-70 mb-1">Amount</div>
                <input className={inputCls(theme)} value={manualAmt} onChange={(e)=> setManualAmt(e.target.value.replace(/[^\d]/g,""))} placeholder="Amount" />
              </div>
              <div>
                <div className="text-xs opacity-70 mb-1">Note (optional)</div>
                <input className={inputCls(theme)} value={manualNote} onChange={(e)=> setManualNote(e.target.value)} placeholder="Manual correction" />
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
                {agentId && agentRedeems.length > 0 ? 
                  agentRedeems.map((t, i) => {
                    return (
                      <motion.div 
                        key={t.id} 
                        className={classNames("border rounded-xl px-3 py-2 flex items-center justify-between", neonBox(theme))}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 10 }}
                        transition={{ delay: i * 0.03, duration: 0.2 }}
                      >
                        <div className="text-sm">
                          <div>{t.memo!.replace(/^Redeem:\s*/, "")} • −{t.amount.toLocaleString()} GCSD</div>
                        </div>
                        <motion.button 
                          className={classNames("px-3 py-1.5 rounded-xl", neonBtn(theme, true))} 
                          onClick={()=> onUndoRedemption(t.id)}
                          whileHover={{ scale: 1.05 }}
                          whileTap={{ scale: 0.95 }}
                        >
                          <RotateCcw className="w-4 h-4 inline mr-1" />
                          Undo
                        </motion.button>
                      </motion.div>
                    );
                  })
                  : <div className="opacity-60 text-sm">No active redeems.</div>}
              </div>
            </div>
          </div>

          <div className="rounded-xl border p-3">
            <div className="text-sm opacity-70 mb-2">Quick reversals (credits only)</div>
            <div className="space-y-2 max-h-[320px] overflow-auto pr-2">
              {txns
                .filter((t) => 
                  t.kind === "credit" && 
                  t.memo && 
                  t.memo !== "Mint" && 
                  !G_isReversalOfRedemption(t) && // Exclude reversal transactions
                  !t.memo.startsWith("Reversal") && // Exclude all reversals
                  !t.memo.startsWith("Correction") && // Exclude corrections
                  !t.memo.startsWith("Manual") && // Exclude manual transactions
                  !t.memo.startsWith("Withdraw") && // Exclude withdrawals
                  G_isSaleStillActive(t, txns)
                ) // Only show active original sales
                .map((t, i) => {
                  return (
                    <motion.div 
                      key={t.id} 
                      className={classNames("border rounded-xl px-3 py-2 flex items-center justify-between", neonBox(theme))}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 10 }}
                      transition={{ delay: i * 0.03, duration: 0.2 }}
                    >
                      <div className="text-sm">
                        <div className="font-medium">{t.memo}</div>
                        <div className="opacity-70 text-xs">{new Date(t.dateISO).toLocaleString()}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="text-sm text-emerald-500">+{t.amount.toLocaleString()}</div>
                        <motion.button 
                          className={classNames("px-2 py-1 rounded-lg text-xs", neonBtn(theme))} 
                          onClick={() => onUndoSale(t.id)}
                          whileHover={{ scale: 1.05 }}
                          whileTap={{ scale: 0.95 }}
                        >
                          <RotateCcw className="w-4 h-4 inline mr-1" /> 
                          Undo sale
                        </motion.button>
                      </div>
                    </motion.div>
                  );
                })}
              {txns.filter((t) => 
                t.kind === "credit" && 
                t.memo && 
                t.memo !== "Mint" && 
                !G_isReversalOfRedemption(t) && 
                !t.memo.startsWith("Reversal") && 
                !t.memo.startsWith("Correction") && 
                !t.memo.startsWith("Manual") && 
                !t.memo.startsWith("Withdraw") && 
                G_isSaleStillActive(t, txns)
              ).length === 0 && (
                <div className="text-sm opacity-70">No active credits to undo.</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* History (everything) */}
      {adminTab === "history" && (
        <motion.div 
          className={classNames("rounded-2xl border p-4", neonBox(theme))}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          <div className="text-sm opacity-70 mb-2">All activity</div>
          <div className="space-y-2 max-h-[560px] overflow-auto pr-2">
            {txns.map((t, i) => (
              <motion.div 
                key={t.id} 
                className={classNames("border rounded-xl px-3 py-2 flex items-center justify-between", neonBox(theme))}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: Math.min(i * 0.02, 0.5), duration: 0.2 }}
                whileHover={{ scale: 1.01, x: 4 }}
              >
                <div className="text-sm">
                  <div className="font-medium">{t.memo || (t.kind === "credit" ? "Credit" : "Debit")}</div>
                  <div className="opacity-70 text-xs">{new Date(t.dateISO).toLocaleString()}</div>
                </div>
                <div className={classNames("text-sm font-semibold", t.kind === "credit" ? "text-emerald-500" : "text-rose-500")}>{t.kind === "credit" ? "+" : "−"}{t.amount.toLocaleString()}</div>
              </motion.div>
            ))}
            {txns.length === 0 && <div className="text-sm opacity-70">No activity yet.</div>}
          </div>
        </motion.div>
      )}

      {/* Users */}
      {adminTab === "users" && (
        <motion.div 
          className={classNames("rounded-2xl border p-4 grid md:grid-cols-2 gap-4", neonBox(theme))}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          <motion.div 
            className="rounded-xl border p-4"
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.1 }}
          >
            <div className="text-sm opacity-70 mb-2">Add agent</div>
            <div className="flex items-center gap-2">
              <input className={inputCls(theme)} value={newAgent} onChange={(e) => setNewAgent(e.target.value)} placeholder="Full name" />
              <motion.button 
                className={classNames("px-3 py-2 rounded-xl", neonBtn(theme, true))} 
                onClick={() => newAgent && onAddAgent(newAgent)}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
              >
                <Plus className="w-4 h-4 inline mr-1" /> Add
              </motion.button>
            </div>
          </motion.div>

          <motion.div 
            className="rounded-xl border p-4"
            initial={{ opacity: 0, x: 10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.15 }}
          >
            <div className="text-sm opacity-70 mb-2">User settings / PINs</div>
            <div className="space-y-3">
              {accounts
                .filter((a) => a.role === "agent")
                .map((a, i) => (
                  <motion.div 
                    key={a.id} 
                    className="border rounded-xl p-3"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2 + (i * 0.05), duration: 0.3 }}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="font-medium">{a.name}</div>
                      <button 
                        className={classNames("px-3 py-2 rounded-xl bg-rose-600 text-white hover:bg-rose-700")} 
                        onClick={() => onDeleteAgent(a.id)}
                      >
                        🗑️ Delete
                      </button>
                    </div>
                    
                    {/* PIN Management */}
                    <div className="border-t pt-2 mt-2">
                      <div className="text-xs font-medium mb-2">PIN Management</div>
                      
                      {pins[a.id] && editingPin !== a.id ? (
                        // Show existing PIN (masked or visible)
                        <div className="space-y-2">
                          <div className="flex items-center gap-2">
                            <div className={classNames("flex-1 px-3 py-2 rounded-xl border font-mono text-center", neonBox(theme))}>
                              {showPins[a.id] ? pins[a.id] : "*****"}
                            </div>
                            <button 
                              className={classNames("px-3 py-2 rounded-xl", neonBtn(theme))}
                              onClick={() => setShowPins(prev => ({...prev, [a.id]: !prev[a.id]}))}
                            >
                              {showPins[a.id] ? "👁️ Hide" : "👁️ Show"}
                            </button>
                          </div>
                          <div className="flex gap-2">
                            <button 
                              className={classNames("px-3 py-2 rounded-xl flex-1", neonBtn(theme))}
                              onClick={() => { setEditingPin(a.id); setPinAgent(a.id); setPinVal(""); }}
                            >
                              ✏️ Change PIN
                            </button>
                            <button 
                              className={classNames("px-3 py-2 rounded-xl flex-1", neonBtn(theme))}
                              onClick={() => { 
                                onResetPin(a.id); 
                                setEditingPin(null);
                                setShowPins(prev => ({...prev, [a.id]: false}));
                              }}
                            >
                              🔄 Reset PIN
                            </button>
                          </div>
                        </div>
                      ) : (
                        // Show PIN input for new/editing
                        <div className="space-y-2">
                          <input 
                            className={classNames(inputCls(theme), "text-center font-mono")} 
                            placeholder="Enter 5-digit PIN" 
                            type="password"
                            value={pinAgent === a.id ? pinVal : ""} 
                            onChange={(e) => { 
                              setPinAgent(a.id); 
                              setPinVal(e.target.value.replace(/[^\d]/g, "").slice(0, 5)); 
                            }} 
                            maxLength={5}
                          />
                          <div className="flex gap-2">
                            <button 
                              className={classNames("px-3 py-2 rounded-xl flex-1", neonBtn(theme, true))}
                              onClick={() => {
                                if (pinVal.length === 5 && pinAgent === a.id) {
                                  onSetPin(a.id, pinVal);
                                  setEditingPin(null);
                                  setPinAgent("");
                                  setPinVal("");
                                } else {
                                  toast.error("PIN must be 5 digits");
                                }
                              }}
                            >
                              ✓ Save PIN
                            </button>
                            {editingPin === a.id && (
                              <button 
                                className={classNames("px-3 py-2 rounded-xl", neonBtn(theme))}
                                onClick={() => { setEditingPin(null); setPinAgent(""); setPinVal(""); }}
                              >
                                ✗ Cancel
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                    
                    {/* Other Actions */}
                    <div className="border-t pt-2 mt-2">
                      <button className={classNames("w-full px-3 py-2 rounded-xl", neonBtn(theme, true))} onClick={() => onResetBalance(a.id)}>
                        Reset Balance (to 0)
                      </button>
                    </div>
                  </motion.div>
                ))}
            </div>
            <div className="mt-4 border-t pt-4">
              <motion.button 
                className={classNames("px-4 py-2 rounded-xl", neonBtn(theme, true))} 
                onClick={onCompleteReset}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
              >
                🔥 Clear All Transactions
              </motion.button>
              <div className="text-xs opacity-70 mt-2">This will clear all sales/redeems but keep agents and PINs</div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </div>
  );
  } catch (error) {
    console.error("Error in AdminPortal:", error);
    return (
      <div className={classNames("rounded-2xl border p-6 text-center", neonBox(theme))}>
        <div className="text-red-500 mb-2">⚠️ Admin Portal Error</div>
        <div className="text-sm opacity-70">Please refresh the page and try again.</div>
        <div className="text-xs opacity-50 mt-2">Error: {error instanceof Error ? error.message : 'Unknown error'}</div>
      </div>
    );
  }
}

/** Picker */
function Picker({
  theme,
  accounts,
  balances,
  onClose,
  onChooseAdmin,
  onChooseAgent,
}: {
  theme: Theme;
  accounts: Account[];
  balances: Map<string, number>;
  onClose: () => void;
  onChooseAdmin: () => void;
  onChooseAgent: (id: string) => void;
}) {
  return (
    <motion.div 
      className="fixed inset-0 z-40 bg-white/80 backdrop-blur dark:bg-slate-900/70 grid place-items-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
    >
      <motion.div 
        className={classNames("rounded-3xl shadow-xl p-6 w-[min(780px,92vw)]", neonBox(theme))}
        initial={{ scale: 0.9, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.9, opacity: 0, y: 20 }}
        transition={{ duration: 0.3 }}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4" />
            <h2 className="text-xl font-semibold">Switch User</h2>
          </div>
          <motion.button 
            className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800" 
            onClick={onClose}
            whileHover={{ scale: 1.1, rotate: 90 }}
            whileTap={{ scale: 0.9 }}
          >
            <X className="w-4 h-4" />
          </motion.button>
        </div>

        <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-2 max-h-[60vh] overflow-auto pr-2">
          <HoverCard theme={theme} onClick={onChooseAdmin}>
            <div className="font-semibold flex items-center gap-2">
              <Lock className="w-4 h-4" /> Admin Portal
            </div>
            <div className="text-xs opacity-70 mt-1">PIN required</div>
          </HoverCard>

          {accounts
            .filter((a) => a.role !== "system")
            .map((a, i) => (
              <HoverCard key={a.id} theme={theme} delay={0.03 + i * 0.02} onClick={() => onChooseAgent(a.id)}>
                <div className="font-medium">{a.name}</div>
                <div className="text-xs opacity-70">Balance: {(balances.get(a.id) || 0).toLocaleString()} GCSD</div>
              </HoverCard>
            ))}
        </div>
      </motion.div>
    </motion.div>
  );
}


/** Feed */
function FeedPage({ theme, notifs }: { theme: Theme; notifs: Notification[] }) {
  return (
    <div>
      <div className={classNames("rounded-2xl border p-4", neonBox(theme))}>
        <div className="text-sm opacity-70 mb-2">Notifications</div>
        <div className="space-y-2 max-h-[70vh] overflow-auto pr-2">
          {notifs.length === 0 && <div className="text-sm opacity-70">No notifications.</div>}
          {notifs.map((n, i) => (
            <motion.div 
              key={n.id} 
              className="text-sm border rounded-xl px-3 py-2"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.03, duration: 0.3 }}
              whileHover={{ scale: 1.01, x: 4 }}
            >
              <div>{n.text}</div>
              <div className="text-xs opacity-70">{new Date(n.when).toLocaleString()}</div>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ===== Confetti (unchanged) ===== */
function confettiBurst() {
  const el = document.createElement("div");
  el.style.position = "fixed";
  el.style.inset = "0";
  el.style.pointerEvents = "none";
  el.style.zIndex = "60";
  el.innerHTML = `<div style="position:absolute;inset:0;display:grid;place-items:center;font-size:42px;animation:pop .8s ease-out">🎉</div>
  <style>@keyframes pop{0%{transform:scale(.6);opacity:.2}60%{transform:scale(1.2);opacity:1}100%{transform:scale(1);opacity:0}}</style>`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 800);
}
