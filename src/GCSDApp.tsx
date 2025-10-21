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
  "Caitlyn Stone", "Frank Collins", "Antonio Cortes", "Kevin Nolan", "Daniel Hill"
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

/** Compute balances map for all accounts - properly handles reversals and allows negative balances */
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
      // Allow negative balances for accurate accounting
      map.set(t.fromId, newBalance);
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

/** Liquid Glass containers/buttons/inputs with theme awareness */
const neonBox = (theme: Theme) =>
  "glass-card rounded-xl text-slate-800 dark:text-slate-100";

const neonBtn = (theme: Theme, solid?: boolean) =>
  solid
    ? "glass-btn rounded-xl px-4 py-2 font-medium text-slate-900 dark:text-white transition-all"
    : "glass-btn rounded-xl px-4 py-2 font-medium text-slate-900 dark:text-white transition-all";

const inputCls = (theme: Theme) =>
  "glass border-none rounded-xl px-4 py-2.5 w-full text-slate-900 dark:text-white placeholder-slate-600 dark:placeholder-slate-300 focus:ring-2 focus:ring-blue-400/50 dark:focus:ring-purple-500/50 transition-all";

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

/* Avatar Component with Initials */
function Avatar({ name, size = "md", theme }: { name: string; size?: "sm" | "md" | "lg"; theme?: Theme }) {
  const getInitials = (fullName: string) => {
    const parts = fullName.trim().split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return parts[0].slice(0, 2).toUpperCase();
  };

  const sizeClasses = {
    sm: "w-8 h-8 text-xs",
    md: "w-10 h-10 text-sm",
    lg: "w-12 h-12 text-base"
  };

  const colors = [
    "from-blue-500 to-purple-600",
    "from-pink-500 to-rose-600",
    "from-green-500 to-emerald-600",
    "from-orange-500 to-amber-600",
    "from-cyan-500 to-blue-600",
    "from-violet-500 to-purple-600",
    "from-red-500 to-pink-600",
    "from-teal-500 to-cyan-600",
  ];

  const colorIndex = name.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0) % colors.length;

  return (
    <motion.div
      className={`${sizeClasses[size]} rounded-full bg-gradient-to-br ${colors[colorIndex]} flex items-center justify-center font-bold text-white shadow-lg ring-2 ring-white/30`}
      initial={{ scale: 0, rotate: -180 }}
      animate={{ scale: 1, rotate: 0 }}
      transition={{ type: "spring", stiffness: 200, damping: 15 }}
      whileHover={{ scale: 1.1, rotate: 5 }}
    >
      {getInitials(name)}
    </motion.div>
  );
}

/* Milestone/Achievement System */
type Milestone = {
  id: string;
  title: string;
  description: string;
  emoji: string;
  requirement: (balance: number, earned: number, txns: Transaction[], agentId: string) => boolean;
  tier: "bronze" | "silver" | "gold" | "platinum";
};

const MILESTONES: Milestone[] = [
  { id: "first_100", title: "Getting Started", description: "Earn your first 100 GCSD", emoji: "🌱", requirement: (_, earned) => earned >= 100, tier: "bronze" },
  { id: "first_500", title: "Rising Star", description: "Earn 500 GCSD", emoji: "⭐", requirement: (_, earned) => earned >= 500, tier: "bronze" },
  { id: "first_1000", title: "Achiever", description: "Earn 1,000 GCSD", emoji: "🎯", requirement: (_, earned) => earned >= 1000, tier: "silver" },
  { id: "first_5000", title: "High Performer", description: "Earn 5,000 GCSD", emoji: "🚀", requirement: (_, earned) => earned >= 5000, tier: "gold" },
  { id: "first_10000", title: "Elite", description: "Earn 10,000 GCSD", emoji: "💎", requirement: (_, earned) => earned >= 10000, tier: "platinum" },
  { id: "balance_1000", title: "Wealthy", description: "Have 1,000+ GCSD balance", emoji: "💰", requirement: (balance) => balance >= 1000, tier: "silver" },
  { id: "balance_5000", title: "Rich", description: "Have 5,000+ GCSD balance", emoji: "🏆", requirement: (balance) => balance >= 5000, tier: "gold" },
  { id: "big_spender", title: "Big Spender", description: "Redeem 3+ prizes", emoji: "🛍️", requirement: (_, __, txns, agentId) => {
    return txns.filter(t => t.kind === "debit" && t.fromId === agentId && t.memo?.startsWith("Redeem:")).length >= 3;
  }, tier: "silver" },
  { id: "consistent", title: "Consistent", description: "Earn GCSD 5+ times", emoji: "📈", requirement: (_, __, txns, agentId) => {
    return txns.filter(t => t.kind === "credit" && t.toId === agentId && t.memo !== "Mint").length >= 5;
  }, tier: "bronze" },
  { id: "prolific", title: "Prolific", description: "Complete 20+ transactions", emoji: "⚡", requirement: (_, __, txns, agentId) => {
    return txns.filter(t => t.kind === "credit" && t.toId === agentId && t.memo !== "Mint").length >= 20;
  }, tier: "gold" },
];

function MilestonesCard({ balance, earned, txns, agentId, theme }: { 
  balance: number; 
  earned: number; 
  txns: Transaction[]; 
  agentId: string; 
  theme: Theme 
}) {
  const achievedMilestones = MILESTONES.filter(m => m.requirement(balance, earned, txns, agentId));
  const nextMilestone = MILESTONES.find(m => !m.requirement(balance, earned, txns, agentId));

  const tierColors = {
    bronze: "from-amber-700 to-amber-900",
    silver: "from-gray-400 to-gray-600",
    gold: "from-yellow-400 to-yellow-600",
    platinum: "from-cyan-400 to-blue-600"
  };

  return (
    <motion.div
      className={classNames("rounded-2xl border p-4", neonBox(theme))}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="flex items-center gap-2 mb-3">
        <Sparkles className="w-5 h-5 text-yellow-500" />
        <h3 className="font-semibold text-lg">Achievements</h3>
        <span className="text-sm opacity-70">({achievedMilestones.length}/{MILESTONES.length})</span>
      </div>

      {/* Achieved Milestones */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-4">
        {achievedMilestones.map((milestone, i) => (
          <motion.div
            key={milestone.id}
            className={`glass-card rounded-xl p-3 bg-gradient-to-br ${tierColors[milestone.tier]} relative overflow-hidden`}
            initial={{ scale: 0, rotate: -10 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ delay: i * 0.05, type: "spring", stiffness: 200 }}
            whileHover={{ scale: 1.05, y: -2 }}
          >
            <div className="text-3xl mb-1">{milestone.emoji}</div>
            <div className="text-xs font-semibold text-white drop-shadow-lg">{milestone.title}</div>
            <div className="text-[10px] text-white/80 line-clamp-1">{milestone.description}</div>
            
            {/* Shine effect */}
            <motion.div
              className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent"
              initial={{ x: "-100%" }}
              animate={{ x: "200%" }}
              transition={{ duration: 2, repeat: Infinity, repeatDelay: 3 }}
            />
          </motion.div>
        ))}
      </div>

      {/* Next Milestone */}
      {nextMilestone && (
        <div className="glass rounded-xl p-3 border border-dashed border-white/30">
          <div className="flex items-center gap-2">
            <div className="text-2xl opacity-40">{nextMilestone.emoji}</div>
            <div className="flex-1">
              <div className="text-sm font-medium opacity-70">{nextMilestone.title}</div>
              <div className="text-xs opacity-50">{nextMilestone.description}</div>
            </div>
            <div className="text-xs opacity-50">Locked</div>
          </div>
        </div>
      )}

      {achievedMilestones.length === MILESTONES.length && (
        <motion.div
          className="text-center py-4"
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: "spring", stiffness: 200 }}
        >
          <div className="text-4xl mb-2">🎉</div>
          <div className="font-semibold text-sm">All Achievements Unlocked!</div>
          <div className="text-xs opacity-70">You're a legend!</div>
        </motion.div>
      )}
    </motion.div>
  );
}

/* Enhanced Podium Component with Animated Medals */
function EnhancedPodium({ leaderboard, theme }: { leaderboard: Array<{ name: string; balance: number }>; theme: Theme }) {
  if (leaderboard.length === 0) return <div className="text-center text-sm opacity-60">No data yet</div>;

  const top3 = leaderboard.slice(0, 3);
  const podiumData = [
    { position: 2, agent: top3[1], height: "h-32", color: "from-gray-300 to-gray-500", medal: "🥈", delay: 0.1 },
    { position: 1, agent: top3[0], height: "h-40", color: "from-yellow-400 to-yellow-600", medal: "🥇", delay: 0 },
    { position: 3, agent: top3[2], height: "h-24", color: "from-amber-600 to-amber-800", medal: "🥉", delay: 0.2 }
  ];

  return (
    <div className="flex items-end justify-center gap-4 py-6">
      {podiumData.map(({ position, agent, height, color, medal, delay }) => {
        if (!agent) return null;
        
        return (
          <motion.div 
            key={position}
            className="flex flex-col items-center"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay }}
          >
            {/* Avatar with Medal Badge */}
            <div className="relative mb-2">
              <Avatar name={agent.name} size={position === 1 ? "lg" : "md"} theme={theme} />
              <motion.div 
                className="absolute -top-1 -right-1 text-2xl"
                animate={position === 1 ? { 
                  rotate: [0, -10, 10, -10, 0],
                  scale: [1, 1.1, 1]
                } : {}}
                transition={{ 
                  duration: 2, 
                  repeat: Infinity, 
                  repeatDelay: 3,
                  ease: "easeInOut"
                }}
              >
                {medal}
              </motion.div>
            </div>
            
            {/* Agent Info */}
            <div className="text-center mb-2">
              <div className="font-bold text-lg">{agent.name}</div>
              <div className="text-sm opacity-70">{agent.balance.toLocaleString()} GCSD</div>
            </div>
            
            {/* Animated Podium */}
            <motion.div 
              className={`${height} w-24 rounded-t-xl bg-gradient-to-b ${color} shadow-lg flex items-center justify-center text-white font-bold relative overflow-hidden`}
              initial={{ height: 0 }}
              animate={{ height: position === 1 ? "10rem" : position === 2 ? "8rem" : "6rem" }}
              transition={{ delay: delay + 0.3, type: "spring", stiffness: 100 }}
            >
              {/* Shimmer effect for gold medal */}
              {position === 1 && (
                <motion.div
                  className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent"
                  animate={{ x: ["-100%", "200%"] }}
                  transition={{ duration: 2, repeat: Infinity, repeatDelay: 1 }}
                />
              )}
              <span className="relative z-10">#{position}</span>
            </motion.div>
          </motion.div>
        );
      })}
    </div>
  );
}

/* Performance Chart Component */
function PerformanceChart({ txns, accounts, theme }: { txns: Transaction[]; accounts: Account[]; theme: Theme }) {
  const nonSystemIds = useMemo(() => new Set(accounts.filter((a) => a.role !== "system").map((a) => a.id)), [accounts]);
  
  // Get last 7 days of data
  const last7Days = useMemo(() => {
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (6 - i));
      d.setHours(0, 0, 0, 0);
      return d;
    });
    
    return days.map(day => {
      const dayStart = new Date(day);
      const dayEnd = new Date(day);
      dayEnd.setHours(23, 59, 59, 999);
      
      const dayTxns = txns.filter(t => {
        const txnDate = new Date(t.dateISO);
        return txnDate >= dayStart && txnDate <= dayEnd && 
               t.kind === "credit" && t.toId && nonSystemIds.has(t.toId) && 
               t.memo !== "Mint" && !G_isReversalOfRedemption(t);
      });
      
      const totalEarned = dayTxns.reduce((sum, t) => sum + t.amount, 0);
      
      return {
        date: day,
        earned: totalEarned,
        transactions: dayTxns.length
      };
    });
  }, [txns, nonSystemIds]);

  const maxEarned = Math.max(...last7Days.map(d => d.earned), 1);

  return (
    <div className="space-y-4">
      <div className="text-sm opacity-70">📈 Performance (Last 7 Days)</div>
      <div className="space-y-2">
        {last7Days.map((day, i) => (
          <motion.div
            key={i}
            className="flex items-center gap-3"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.1 }}
          >
            <div className="w-16 text-xs opacity-70">
              {day.date.toLocaleDateString('en-US', { weekday: 'short' })}
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <div 
                  className={classNames(
                    "h-2 rounded-full transition-all duration-500",
                    theme === "neon" ? "bg-orange-500" : "bg-emerald-500"
                  )}
                  style={{ width: `${(day.earned / maxEarned) * 100}%` }}
                />
                <span className="text-xs font-medium">{day.earned.toLocaleString()}</span>
              </div>
              <div className="text-xs opacity-60">{day.transactions} transactions</div>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

/* Live Activity Feed Component */
function LiveActivityFeed({ txns, accounts, theme }: { txns: Transaction[]; accounts: Account[]; theme: Theme }) {
  const recentTxns = useMemo(() => 
    txns.slice(0, 8).map(txn => {
      const isCredit = txn.kind === "credit";
      const agentId = isCredit ? txn.toId : txn.fromId;
      const agentName = accounts.find(a => a.id === agentId)?.name || "System";
      
      const getIcon = () => {
        if (txn.memo?.includes("Redeem")) return "🎁";
        if (txn.memo?.includes("Reversal")) return "↩️";
        if (txn.memo?.includes("Correction")) return "⚠️";
        if (txn.memo?.includes("Withdraw")) return "💸";
        if (isCredit) return "💰";
        return "📤";
      };
      
      return {
        ...txn,
        agentName,
        icon: getIcon(),
        isCredit
      };
    }), [txns, accounts]
  );

  return (
    <div className="space-y-3">
      <div className="text-sm opacity-70">📊 Live Activity</div>
      <div className="space-y-2 max-h-64 overflow-auto pr-2">
        {recentTxns.map((txn, i) => (
          <motion.div
            key={txn.id}
            className={classNames(
              "flex items-center gap-3 p-3 rounded-lg border",
              theme === "neon" 
                ? "bg-[#1a1a1a] border-orange-800 hover:bg-[#2a2a2a]" 
                : "bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700"
            )}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.05 }}
            whileHover={{ scale: 1.02, x: 4 }}
          >
            <div className="text-lg">{txn.icon}</div>
            <div className="flex-1 min-w-0">
              <div className="font-medium text-sm truncate">{txn.agentName}</div>
              <div className="text-xs opacity-70 truncate">{txn.memo || (txn.isCredit ? "Credit" : "Debit")}</div>
            </div>
            <div className={classNames(
              "text-sm font-bold",
              txn.isCredit ? "text-emerald-500" : "text-rose-500"
            )}>
              {txn.isCredit ? "+" : "-"}{txn.amount.toLocaleString()}
            </div>
          </motion.div>
        ))}
      </div>
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
        className="h-8 w-8 grid place-items-center rounded-full glass"
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
        className={isNeon ? "h-8 px-2 rounded-full glass-btn text-orange-600 dark:text-orange-400 inline-flex items-center gap-1 border-orange-500/50" : "h-8 px-2 rounded-full glass inline-flex items-center gap-1"}
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
      className="relative h-8 w-8 grid place-items-center rounded-full glass"
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
  const handleClick = () => {
    // Haptic feedback for mobile
    if ('vibrate' in navigator) {
      navigator.vibrate(50);
    }
    onClick();
  };

  return (
    <motion.button 
      onClick={handleClick} 
      className={classNames("border rounded-2xl px-3 py-3 text-left haptic-feedback hover-lift", neonBox(theme))}
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

/** Glass-style select */
function FancySelect({ value, onChange, children, theme, placeholder }: { value: string; onChange: (v: string) => void; children: React.ReactNode; theme: Theme; placeholder?: string }) {
  return (
    <div className="relative rounded-xl glass">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="appearance-none w-full px-3 py-2.5 pr-8 rounded-xl focus:outline-none focus:ring-2 bg-transparent text-slate-900 dark:text-white focus:ring-blue-400/50 dark:focus:ring-purple-500/50"
        style={theme === "neon" || document.documentElement.classList.contains("dark") ? { colorScheme: "dark" } : {}}
      >
        {placeholder && <option value="">{placeholder}</option>}
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 opacity-60" />
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
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  const handleSubmit = () => {
    if (isSubmitting) return; // Prevent double submission
    
    if (pin.length !== maxLen) {
      toast.error(`PIN must be exactly ${maxLen} digits`);
      return;
    }
    
    // Validate PIN contains only digits
    if (!/^\d+$/.test(pin)) {
      toast.error("PIN must contain only numbers");
      return;
    }
    
    setIsSubmitting(true);
    
    // Call onOk and let it handle validation
    onOk(pin);
    
    // Clear PIN for security
    setPin("");
    
    // Reset submitting state after a brief delay
    setTimeout(() => setIsSubmitting(false), 100);
  };
  
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
          <input 
            className={inputCls(theme)} 
            placeholder="PIN" 
            type="password" 
            value={pin} 
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} 
            maxLength={maxLen}
            onKeyPress={(e) => e.key === "Enter" && handleSubmit()}
          />
          <motion.button 
            className={classNames("px-3 py-1.5 rounded-xl border", neonBtn(theme, true))} 
            onClick={handleSubmit}
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

  // Theme is LOCAL to each browser/device - NEVER synced via KV
  // Each browser tab/device maintains its own theme independently
  const [theme, setTheme] = useState<Theme>("light");
  const [portal, setPortal] = useState<Portal>("home");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
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

  // theme side effect - applies theme to DOM (LOCAL ONLY)
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") root.classList.add("dark"); else root.classList.remove("dark");
    
    // IMPORTANT: Theme is 100% LOCAL - NEVER synced to KV storage
    // Each device/browser maintains its own theme preference
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
        
        // CRITICAL: Theme is STRICTLY LOCAL - load from localStorage ONLY
        // NEVER from KV storage - each browser has its own theme
        const savedTheme = localStorage.getItem("gcsd-theme") as Theme;
        const loadedTheme = savedTheme || "light";
        setTheme(loadedTheme);
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
      
      // CRITICAL: Theme is NEVER synced via KV - ignore any theme-related KV changes
      // Each browser maintains its own theme in localStorage independently
      if (key === "gcs-v4-theme") {
        // DO NOT sync theme from KV - intentionally ignored
      }
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
  
  /* theme persistence - STRICTLY LOCAL to each browser - NOT synced to KV */
  useEffect(() => { 
    if (hydrated) {
      // CRITICAL: Store in localStorage ONLY - NEVER in KV storage
      // Each device/browser has its own independent theme preference
      localStorage.setItem("gcsd-theme", theme);
    }
  }, [hydrated, theme]);

  /* clock + intro */
  useEffect(()=> {
    const t = setInterval(()=> { const d=new Date(); setClock(fmtTime(d)); setDateStr(fmtDate(d)); }, 1000);
    return ()=> clearInterval(t);
  }, []);

  /* close mobile menu on outside click */
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (mobileMenuOpen && !(event.target as Element).closest('.mobile-menu-container')) {
        setMobileMenuOpen(false);
      }
    };
    
    if (mobileMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [mobileMenuOpen]);
  useEffect(()=> {
    if (!showIntro) return;
    const timer = setTimeout(()=> setShowIntro(false), 2500);
    const onKey = (e: KeyboardEvent)=> { if (e.key === "Enter") setShowIntro(false); };
    window.addEventListener("keydown", onKey);
    return ()=> { clearTimeout(timer); window.removeEventListener("keydown", onKey); };
  }, [showIntro]);

  /* theme body class management - applies visual theme to DOM */
  useEffect(() => {
    if (theme === "neon") {
      document.body.classList.add("neon-theme");
    } else {
      document.body.classList.remove("neon-theme");
    }
    
    // Cleanup function
    return () => {
      document.body.classList.remove("neon-theme");
    };
  }, [theme]);


  /* Wrapped setTheme for local-only theme changes */
  const setThemeLocal = (newTheme: Theme) => {
    setTheme(newTheme);
    // Theme is saved to localStorage only - never to KV storage
  };

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
  const lifetimeSpend = txns.filter(t=> {
    if (t.kind !== "debit" || t.fromId !== currentAgentId) return false;
    if (t.memo?.startsWith("Correction") || t.memo?.startsWith("Reversal") || t.memo?.startsWith("Balance reset")) return false;
    
    // For redemptions, check if they've been undone
    if (t.memo?.startsWith("Redeem:")) {
      const redemptionLabel = t.memo.replace("Redeem: ", "");
      const hasBeenUndone = txns.some(reversal => 
        reversal.kind === "credit" && 
        reversal.toId === currentAgentId &&
        reversal.memo === `Reversal of redemption: ${redemptionLabel}` &&
        new Date(reversal.dateISO) > new Date(t.dateISO)
      );
      return !hasBeenUndone;
    }
    
    return true;
  }).reduce((a,b)=>a+b.amount,0);
  const prizeCountActive = txns.filter(t=> {
    if (t.kind !== "debit" || t.fromId !== currentAgentId || !t.memo?.startsWith("Redeem:")) return false;
    
    // Check if this redemption has been undone
    const redemptionLabel = t.memo.replace("Redeem: ", "");
    const hasBeenUndone = txns.some(reversal => 
      reversal.kind === "credit" && 
      reversal.toId === currentAgentId &&
      reversal.memo === `Reversal of redemption: ${redemptionLabel}` &&
      new Date(reversal.dateISO) > new Date(t.dateISO)
    );
    
    return !hasBeenUndone;
  }).length;

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
    
    // CRITICAL: Check if agent has a PIN set
    if (!pins[agentId]) {
      toast.error("⚠️ This agent doesn't have a PIN yet!");
      toast.error("Go to Admin Portal → Users Settings to set a PIN first");
      return;
    }
    
    // CRITICAL: Require PIN verification for setting goals - NO EXCEPTIONS
    openAgentPin(agentId, (ok) => {
      if (!ok) {
        toast.error("❌ Wrong PIN - Goal NOT updated");
        return;
      }
      
      // Only update if PIN was correct
      setGoals(prev=> ({...prev, [agentId]: amount}));
      notify(`🎯 ${getName(agentId)} updated savings goal to ${amount} GCSD`);
      toast.success("✅ Goal updated successfully");
    });
  }

  // Reset agent completely - clear all transactions and history for this agent
  async function resetAgentBalance(agentId:string){
    const agent = accounts.find(a => a.id === agentId);
    if (!agent) return toast.error("Agent not found");
    
    const confirmReset = prompt(`⚠️ WARNING: This will completely reset ${agent.name}!\n\nThis will:\n- Clear ALL transaction history\n- Reset balance to 0\n- Clear all redemptions and activities\n\nType 'RESET' to confirm:`);
    if (!confirmReset || confirmReset.trim().toUpperCase() !== "RESET") {
      return toast.error("Reset cancelled");
    }
    
    // Remove all transactions for this agent (except system transactions)
    const filteredTxns = txns.filter(t => {
      // Keep system transactions (mint to vault)
      if (t.memo === "Mint") return true;
      
      // Remove all transactions involving this agent
      if (t.fromId === agentId || t.toId === agentId) {
        console.log(`Removing transaction for ${agent.name}:`, t);
        return false;
      }
      
      return true;
    });
    
    console.log(`Original transactions: ${txns.length}, Filtered transactions: ${filteredTxns.length}`);
    console.log(`Transactions removed for ${agent.name}:`, txns.length - filteredTxns.length);
    
    // Update transactions
    setTxns(filteredTxns);
    
    // Clear agent's goals and epochs
    setGoals(prev => {
      const newGoals = { ...prev };
      delete newGoals[agentId];
      return newGoals;
    });
    
    setEpochs(prev => {
      const newEpochs = { ...prev };
      delete newEpochs[agentId];
      return newEpochs;
    });
    
    // Save to database
    try {
      await kvSet("gcs-v4-core", { accounts, txns: filteredTxns });
      await kvSet("gcs-v4-goals", goals);
      await kvSet("gcs-v4-epochs", epochs);
    } catch (error) {
      console.warn("Failed to save agent reset:", error);
    }
    
    notify(`🧨 Complete reset of ${agent.name} - all history cleared`);
    toast.success(`${agent.name} completely reset - all history cleared`);
  }

  // Reset all transactions (keep agents, clear all sales/redeems/history)
  async function completeReset(){
    console.log("completeReset called");
    
    // First verify admin PIN
    const adminPin = prompt("Enter admin PIN to proceed:");
    if (adminPin !== "13577531") {
      return toast.error("Invalid admin PIN");
    }
    
    const extra = prompt("⚠️ WARNING: This will clear ALL transactions!\n\nType 'RESET' to confirm:");
    console.log("User input:", extra);
    if (!extra || extra.trim().toUpperCase() !== "RESET") {
      console.log("Reset cancelled - input was:", extra);
      return toast.error("Reset cancelled - you must type 'RESET' exactly");
    }
    
    // Keep existing accounts but clear all transactions except initial mint to vault
    const vaultAccount = accounts.find(a => a.role === "system");
    if (!vaultAccount) return toast.error("System error: vault not found");
    
    // Create fresh transactions with only the initial mint
    const freshTxns: Transaction[] = [
      { id: uid(), kind: "credit", amount: 8000, memo: "Mint", dateISO: nowISO(), toId: vaultAccount.id },
    ];
    
    // Reset all other data
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
    
    notify("🧨 All transactions cleared by admin - all balances reset to 0");
    toast.success("All transactions cleared - all balances reset to 0");
  }

  /** Admin metric resets */
  async function resetMetric(kind: keyof MetricsEpoch){
    console.log("resetMetric called with:", kind);
    console.log("Current metrics:", metrics);
    
    const newMetrics = { ...metrics, [kind]: nowISO() };
    console.log("New metrics:", newMetrics);
    
    setMetrics(newMetrics);
    
    // Save to database
    try {
      await kvSet("gcs-v4-metrics", newMetrics);
      console.log("Metrics saved to database");
    } catch (error) {
      console.warn("Failed to save metric reset:", error);
    }
    
    toast.success(`Reset applied for ${kind}`);
  }

  // Sandbox mode removed - not needed for banking app

  /* ============================ render ============================ */
  return (
    <div
      className="min-h-screen overflow-x-hidden text-slate-900 dark:text-slate-100 transition-colors duration-200 swipe-container"
    >
      <Toaster position="top-center" richColors />

      {/* Intro */}
      <AnimatePresence>
        {showIntro && (
          <motion.div 
            className="fixed inset-0 z-50 flex items-center justify-center bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
          >
            <div className="text-center p-8 max-w-2xl mx-auto">
              {/* Logo */}
              <motion.div 
                className="mx-auto mb-6 w-40 h-40 rounded-3xl glass-card grid place-items-center"
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ 
                  type: "spring",
                  stiffness: 180,
                  damping: 20,
                  delay: 0.2 
                }}
              >
                <motion.img 
                  src={LOGO_URL} 
                  alt="GCS Bank logo" 
                  className="w-32 h-32 rounded"
                  initial={{ scale: 0.5, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ delay: 0.5, duration: 0.5 }}
                />
              </motion.div>

              {/* Title */}
              <motion.div
                className="text-white text-3xl font-bold mb-3"
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.8, duration: 0.5 }}
              >
                Welcome to {APP_NAME}
              </motion.div>

              {/* Subtitle */}
              <motion.div 
                className="text-white/70 text-lg mb-8"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 1.1, duration: 0.5 }}
              >
                Your Performance Hub
              </motion.div>

              {/* Button */}
              <motion.button 
                className="glass-btn text-white px-8 py-3 rounded-xl text-base font-medium"
                onClick={()=> setShowIntro(false)}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 1.4, duration: 0.4 }}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
              >
                Get Started
              </motion.button>

              {/* Hint */}
              <motion.div 
                className="text-white/40 mt-4 text-sm"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 1.7, duration: 0.4 }}
              >
                Press Enter to continue
              </motion.div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <div
        className="sticky top-0 z-20 glass border-b border-white/20 dark:border-white/10 transition-colors duration-200"
      >
        <div className="max-w-6xl mx-auto px-3 sm:px-4 mobile-menu-container">
          {/* Main header row */}
          <div className="h-14 sm:h-16 flex items-center justify-between gap-2">
            {/* Left side - Logo and Title */}
            <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
              <img src={LOGO_URL} alt="GCS Bank logo" className="h-9 w-9 sm:h-12 sm:w-12 rounded drop-shadow-sm flex-shrink-0" />
              <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                <span className="font-semibold text-sm sm:text-base lg:text-lg truncate">{APP_NAME}</span>
                <motion.button
                  className={classNames("hidden sm:inline-flex items-center gap-1 text-xs sm:text-sm px-2 py-1 rounded-lg whitespace-nowrap", neonBtn(theme))}
                  onClick={()=> setPortal("home")}
                  title="Go Home"
                  whileHover={{ scale: 1.05, y: -1 }}
                  whileTap={{ scale: 0.95 }}
                >
                  <HomeIcon className="w-4 h-4"/> <span>Home</span>
                </motion.button>
              </div>
            </div>
            
            {/* Desktop menu */}
            <div className="hidden sm:flex items-center gap-3 flex-shrink-0">
              <NotificationsBell theme={theme} unread={unread} onOpenFeed={() => { setPortal("feed"); setUnread(0); }} />
              <span className={classNames("text-xs font-mono whitespace-nowrap", theme==="neon" ? "text-orange-200":"text-slate-600 dark:text-slate-300")}>{dateStr} • {clock}</span>
              <ThemeToggle theme={theme} setTheme={setThemeLocal}/>
              <motion.button 
                className={classNames("px-3 py-1.5 rounded-xl flex items-center gap-2 text-sm whitespace-nowrap", neonBtn(theme))}
                onClick={()=> setPickerOpen(true)}
                whileHover={{ scale: 1.05, y: -1 }}
                whileTap={{ scale: 0.95 }}
              >
                <Users className="w-4 h-4"/> Switch User
              </motion.button>
            </div>
            
            {/* Mobile menu button */}
            <motion.button 
              className={classNames("sm:hidden p-2 rounded-lg flex-shrink-0", neonBtn(theme))}
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              aria-label="Toggle menu"
            >
              {mobileMenuOpen ? (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              ) : (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              )}
            </motion.button>
          </div>
          
          {/* Mobile menu */}
          <AnimatePresence>
            {mobileMenuOpen && (
              <motion.div 
                className={classNames(
                  "sm:hidden pb-4 overflow-hidden",
                  theme === "neon" 
                    ? "border-t border-orange-800 bg-[#14110B]/95" 
                    : "border-t border-slate-200 dark:border-slate-700 bg-white/95 dark:bg-slate-900/95"
                )}
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2 }}
              >
                <div className="px-3 pt-3 space-y-3">
                  {/* Date and time */}
                  <div className={classNames(
                    "text-center py-2 rounded-lg",
                    theme === "neon" ? "bg-orange-500/10" : "bg-slate-100 dark:bg-slate-800"
                  )}>
                    <span className={classNames("text-xs font-mono font-medium", theme==="neon" ? "text-orange-200":"text-slate-600 dark:text-slate-300")}>{dateStr} • {clock}</span>
                  </div>
                  
                  {/* Notifications */}
                  <div className={classNames(
                    "flex items-center justify-between p-3 rounded-lg",
                    theme === "neon" ? "bg-orange-500/5 border border-orange-800/30" : "bg-slate-50 dark:bg-slate-800/50"
                  )}>
                    <span className="text-sm font-medium">Notifications</span>
                    <NotificationsBell theme={theme} unread={unread} onOpenFeed={() => { setPortal("feed"); setUnread(0); setMobileMenuOpen(false); }} />
                  </div>
                  
                  {/* Theme Toggle */}
                  <div className={classNames(
                    "flex items-center justify-between p-3 rounded-lg",
                    theme === "neon" ? "bg-orange-500/5 border border-orange-800/30" : "bg-slate-50 dark:bg-slate-800/50"
                  )}>
                    <span className="text-sm font-medium">Theme</span>
                    <div className="flex items-center gap-2">
                      <ThemeToggle theme={theme} setTheme={setThemeLocal}/>
                    </div>
                  </div>
                  
                  {/* Home Button (mobile only) */}
                  <motion.button 
                    className={classNames("w-full px-4 py-3 rounded-xl flex items-center justify-center gap-2 text-sm font-medium", neonBtn(theme, true))}
                    onClick={()=> { setPortal("home"); setMobileMenuOpen(false); }}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                  >
                    <HomeIcon className="w-4 h-4"/> Home
                  </motion.button>
                  
                  {/* Switch User Button */}
                  <motion.button 
                    className={classNames("w-full px-4 py-3 rounded-xl flex items-center justify-center gap-2 text-sm font-medium", neonBtn(theme, true))}
                    onClick={()=> { setPickerOpen(true); setMobileMenuOpen(false); }}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                  >
                    <Users className="w-4 h-4"/> Switch User
                  </motion.button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
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
            onClose={() => { 
              setPortal("home"); 
              setIsAdmin(false);
            }}
            onOk={(pin) => {
              // CRITICAL: Only accept the exact admin PIN - NO EXCEPTIONS
              const CORRECT_ADMIN_PIN = "13577531";
              const enteredPin = pin.trim();
              
              // Multiple validation checks to prevent bypass
              const isLengthCorrect = enteredPin.length === 8;
              const isPinMatch = enteredPin === CORRECT_ADMIN_PIN;
              const isNumericOnly = /^\d{8}$/.test(enteredPin);
              
              if (!isLengthCorrect || !isPinMatch || !isNumericOnly) { 
                toast.error("❌ Invalid admin PIN - Access DENIED");
                setPortal("home"); // Close modal and go back to home
                setIsAdmin(false); // Ensure admin state is false
                setAdminPin(""); // Clear any stored PIN
                return; 
              }
              
              // Only set admin if ALL checks pass
              setAdminPin(enteredPin);
              setIsAdmin(true);
              toast.success("✅ Admin unlocked");
            }}
            theme={theme}
          />
        )}
      </AnimatePresence>

      {/* Agent PIN modal */}
      <PinModal
        open={pinModal.open}
        onClose={()=> {
          // When modal is closed without entering PIN, call callback with false
          if (pinModal.onOK) {
            pinModal.onOK(false);
          }
          setPinModal({open:false});
        }}
        onCheck={(pin)=>{
          const aId = pinModal.agentId!;
          // CRITICAL: PIN must exist and match exactly (case-sensitive, no whitespace)
          const storedPin = pins[aId];
          const enteredPin = pin.trim();
          
          if (!storedPin) {
            toast.error("No PIN set for this agent");
            pinModal.onOK?.(false);
            setPinModal({open:false});
            return;
          }
          
          const ok = storedPin === enteredPin;
          
          if (!ok) {
            toast.error("Incorrect PIN");
          }
          
          pinModal.onOK?.(ok);
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
      <div className="max-w-6xl mx-auto px-2 sm:px-4 py-4 sm:py-6">
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

          {portal==="admin" && isAdmin && (
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

  const earnedSeries: number[] = useMemo(() => {
    return days.map((d) => {
      // Only count active credits (not reversed) for stable calculation
      const activeCredits = sumInRange(
        txns,
        d,
        1,
        (t) => {
          return t.kind === "credit" && !!t.toId && nonSystemIds.has(t.toId) && t.memo !== "Mint" && !G_isReversalOfRedemption(t) && G_isSaleStillActive(t, txns) && afterISO(metrics.earned30d, t.dateISO);
        }
      );
      return Math.max(0, activeCredits); // never negative
    });
  }, [txns, metrics.earned30d, days, nonSystemIds]);

  const spentSeries: number[] = useMemo(() => days.map((d) =>
    sumInRange(txns, d, 1, (t) => t.kind === "debit" && !!t.fromId && nonSystemIds.has(t.fromId) && !G_isCorrectionDebit(t) && afterISO(metrics.spent30d, t.dateISO))
  ), [txns, metrics.spent30d, days, nonSystemIds]);

  // Leaderboard: use current balance (proper banking logic) - memoized for stability
  const balances = useMemo(() => computeBalances(accounts, txns), [accounts, txns]);

  // Calculate total accumulated credited balance (all earnings minus withdrawals, not affected by purchases)
  const totalActiveBalance = useMemo(() => {
    const total = Array.from(nonSystemIds).reduce((sum: number, agentId) => {
      // Get all transactions for this agent
      const agentTxns = txns.filter(t => t.toId === agentId || t.fromId === agentId);
      
      // Sum all credits (earnings) - excluding Mint and redemption reversals
      const totalCredits = agentTxns
        .filter(t => t.kind === "credit" && t.toId === agentId && t.memo !== "Mint" && !G_isReversalOfRedemption(t))
        .reduce((acc, t) => acc + t.amount, 0);
      
      // Subtract withdrawals/corrections (admin removing money)
      const totalWithdrawals = agentTxns
        .filter(t => G_isCorrectionDebit(t) && t.fromId === agentId)
        .reduce((acc, t) => acc + t.amount, 0);
      
      const agentEarnings = totalCredits - totalWithdrawals;
      return sum + agentEarnings;
    }, 0);
    
    return Math.max(0, total); // Never negative
  }, [nonSystemIds, txns]);
  
  const totalEarned = useMemo(() => {
    return earnedSeries.reduce((a, b) => a + b, 0);
  }, [earnedSeries]);
  const totalSpent = useMemo(() => spentSeries.reduce((a, b) => a + b, 0), [spentSeries]);
  const leaderboard = useMemo(() => Array.from(nonSystemIds)
    .map((id) => {
      const balance = balances.get(id) || 0;
      return { id, name: accounts.find((a) => a.id === id)?.name || "—", balance };
    })
    .sort((a, b) => b.balance - a.balance), [nonSystemIds, balances, accounts]);

  // Star of day & leader of month - highest accumulated credits (minus withdrawals)
  const { starOfDay, leaderOfMonth } = useMemo(() => {
    const todayKey = new Date().toLocaleDateString();
    const curMonth = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
    const earnedToday: Record<string, number> = {};
    const earnedMonth: Record<string, number> = {};
    
    // Process all transactions - accumulate earnings per agent
    for (const t of txns) {
      const d = new Date(t.dateISO);
      const isToday = d.toLocaleDateString() === todayKey;
      const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const isThisMonth = monthKey === curMonth;
      
      // Add credits (earnings) - exclude Mint and redemption reversals
      if (t.kind === "credit" && t.toId && nonSystemIds.has(t.toId) && t.memo !== "Mint" && !G_isReversalOfRedemption(t)) {
        // Star of the Day - only count credits from today
        if (afterISO(metrics.starOfDay, t.dateISO) && isToday) {
          earnedToday[t.toId] = (earnedToday[t.toId] || 0) + t.amount;
        }
        // Leader of the Month - count all credits from this month
        if (afterISO(metrics.leaderOfMonth, t.dateISO) && isThisMonth) {
          earnedMonth[t.toId] = (earnedMonth[t.toId] || 0) + t.amount;
        }
      }
      
      // Subtract withdrawals/corrections (admin removing money)
      if (t.kind === "debit" && t.fromId && nonSystemIds.has(t.fromId) && G_isCorrectionDebit(t)) {
        if (afterISO(metrics.starOfDay, t.dateISO) && isToday) {
          earnedToday[t.fromId] = (earnedToday[t.fromId] || 0) - t.amount;
        }
        if (afterISO(metrics.leaderOfMonth, t.dateISO) && isThisMonth) {
          earnedMonth[t.fromId] = (earnedMonth[t.fromId] || 0) - t.amount;
        }
      }
    }
    
    // Sort and find top earners with stable sorting
    const todaySorted = Object.entries(earnedToday)
      .map(([id, amount]) => ({
        id,
        name: accounts.find((a) => a.id === id)?.name || "—",
        amount
      }))
      .filter(entry => entry.amount > 0)
      .sort((a, b) => {
        // Primary sort: by amount (descending)
        if (b.amount !== a.amount) return b.amount - a.amount;
        // Secondary sort: by name (alphabetical) for stability
        return a.name.localeCompare(b.name);
      });
    
    const monthSorted = Object.entries(earnedMonth)
      .map(([id, amount]) => ({
        id,
        name: accounts.find((a) => a.id === id)?.name || "—",
        amount
      }))
      .filter(entry => entry.amount > 0)
      .sort((a, b) => {
        // Primary sort: by amount (descending)
        if (b.amount !== a.amount) return b.amount - a.amount;
        // Secondary sort: by name (alphabetical) for stability
        return a.name.localeCompare(b.name);
      });
    
    return {
      starOfDay: todaySorted[0] || null,
      leaderOfMonth: monthSorted[0] || null
    };
  }, [txns, metrics.starOfDay, metrics.leaderOfMonth, accounts, nonSystemIds]);

  return (
    <div className="space-y-6">
      {/* Enhanced Podium Section */}
      <motion.div 
        className={classNames("rounded-2xl border p-6", neonBox(theme))}
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <div className="text-lg font-semibold mb-4 text-center">🏆 Top Performers</div>
        <EnhancedPodium leaderboard={leaderboard} theme={theme} />
      </motion.div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Left Column - Dashboard & Performance */}
        <div className="space-y-6">
          {/* Dashboard Stats */}
          <motion.div 
            className={classNames("rounded-2xl border p-6", neonBox(theme))}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.1 }}
          >
            <div className="text-lg font-semibold mb-4">📊 Dashboard</div>
            <div className="grid sm:grid-cols-2 gap-4 mb-6">
              <TileRow label="Total Active Balance" value={totalActiveBalance} />
              <TileRow label="Total GCSD Spent (30d)" value={totalSpent} />
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              <Highlight title="Star of the Day" value={starOfDay ? `${starOfDay.name} • +${starOfDay.amount.toLocaleString()} GCSD` : "—"} />
              <Highlight title="Leader of the Month" value={leaderOfMonth ? `${leaderOfMonth.name} • +${leaderOfMonth.amount.toLocaleString()} GCSD` : "—"} />
            </div>
          </motion.div>

          {/* Performance Chart */}
          <motion.div 
            className={classNames("rounded-2xl border p-6", neonBox(theme))}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.2 }}
          >
            <PerformanceChart txns={txns} accounts={accounts} theme={theme} />
          </motion.div>

          {/* Finance Chart */}
          <motion.div 
            className={classNames("rounded-2xl border p-6", neonBox(theme))}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.3 }}
          >
            <div className="text-sm opacity-70 mb-3">Finance (30 days)</div>
            <LineChart earned={earnedSeries} spent={spentSeries} />
          </motion.div>
        </div>

        {/* Middle Column - Leaderboard */}
        <motion.div 
          className={classNames("rounded-2xl border p-6", neonBox(theme))}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          <div className="text-lg font-semibold mb-4">🏆 Leaderboard</div>
          <div className="space-y-2 max-h-[600px] overflow-auto pr-2">
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
        </motion.div>

        {/* Right Column - Activity & Prizes */}
        <div className="space-y-6">
          {/* Live Activity Feed */}
          <motion.div 
            className={classNames("rounded-2xl border p-6", neonBox(theme))}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.1 }}
          >
            <LiveActivityFeed txns={txns} accounts={accounts} theme={theme} />
          </motion.div>

          {/* Purchased Prizes */}
          <motion.div 
            className={classNames("rounded-2xl border p-6", neonBox(theme))}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.2 }}
          >
            <div className="text-sm opacity-70 mb-3">🎁 Purchased Prizes (Active)</div>
            <div className="text-sm mb-2">
              Total purchases: <b>{purchases.length}</b>
            </div>
            <div className="space-y-2 max-h-64 overflow-auto pr-2">
              {purchases.map((p, i) => (
                <motion.div 
                  key={i} 
                  className={classNames(
                    "flex flex-col border rounded-lg px-3 py-2",
                    theme === "neon" ? "bg-orange-500/5 border-orange-800/30" : "bg-slate-50 dark:bg-slate-900/50"
                  )}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05, duration: 0.3 }}
                  whileHover={{ scale: 1.02 }}
                >
                  <div className="font-medium text-sm">{p.memo.replace("Redeem: ", "")}</div>
                  <div className="text-xs opacity-60">{p.when.toLocaleString()}</div>
                </motion.div>
              ))}
              {purchases.length === 0 && <div className="text-sm opacity-70 text-center py-4">No purchases yet.</div>}
            </div>
          </motion.div>

          {/* Available Prizes */}
          <motion.div 
            className={classNames("rounded-2xl border p-6", neonBox(theme))}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.3 }}
          >
            <div className="text-sm opacity-70 mb-3">🎯 Available Prizes</div>
            <div className="space-y-2 max-h-64 overflow-auto pr-2">
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
              {prizes.length === 0 && <div className="text-sm opacity-70">No prizes available.</div>}
            </div>
          </motion.div>
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
          <div className="flex items-center gap-3 mb-3">
            <Avatar name={name} size="lg" theme={theme} />
            <div className="text-xl font-semibold">{name}</div>
          </div>
          <div className="grid sm:grid-cols-3 gap-3">
            <TileRow label="Balance" value={balance} />
            <TileRow label="Lifetime Earned" value={Math.max(0, lifetimeEarn)} />
            <TileRow label="Lifetime Spent" value={lifetimeSpend} />
          </div>

          <div className="mt-4">
            <div className="text-sm opacity-70 mb-2">Savings goal</div>
            <div className="rounded-xl border p-3">
              <div className="flex items-center gap-3">
                <input className={inputCls(theme)} placeholder="Amount" value={goalInput} onChange={(e) => setGoalInput(e.target.value.replace(/[^\d]/g, ""))} />
                <button 
                  className={classNames("px-3 py-1.5 rounded-xl haptic-feedback", neonBtn(theme, true))} 
                  onClick={() => {
                    if ('vibrate' in navigator) navigator.vibrate(30);
                    if (goalInput) onSetGoal(parseInt(goalInput, 10));
                  }}
                  title="PIN required to set goal"
                >
                  <Check className="w-4 h-4 inline mr-1" /> Set goal
                </button>
              </div>
              <div className="mt-2 text-xs opacity-60">🔒 PIN required to set goal</div>
              {goal > 0 && (
                <>
                  <div className="mt-3 text-sm opacity-70">{progress}% towards {goal.toLocaleString()} GCSD</div>
                  <div className="mt-2 h-2 rounded-full bg-black/10 dark:bg-white/10 overflow-hidden">
                    <motion.div 
                      className={classNames(
                        "h-2 rounded-full",
                        theme === "neon" ? "bg-orange-500" : "bg-emerald-500"
                      )}
                      initial={{ width: 0 }}
                      animate={{ width: `${progress}%` }}
                      transition={{ duration: 0.8, ease: "easeOut" }}
                    />
                  </div>
                  {progress < 100 && (
                    <div className="mt-2 text-xs opacity-70">
                      💡 Need ~{Math.ceil((goal - balance) / 50)} more evaluations to reach goal
                      <div className="text-xs opacity-60 mt-1">
                        (Current: {balance.toLocaleString()} / {goal.toLocaleString()} GCSD)
                      </div>
                    </div>
                  )}
                  {progress >= 100 && (
                    <motion.div 
                      className="mt-2 text-xs text-emerald-500 font-medium"
                      animate={{ scale: [1, 1.05, 1] }}
                      transition={{ duration: 0.5, repeat: Infinity, repeatDelay: 2 }}
                    >
                      🎉 Goal achieved! Great job!
                    </motion.div>
                  )}
                </>
              )}
              {goal === 0 && (
                <div className="mt-3 text-sm opacity-70">No goal set</div>
              )}
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

      {/* Milestones & Achievements */}
      <div className="mt-4">
        <MilestonesCard 
          balance={balance}
          earned={lifetimeEarn}
          txns={txns}
          agentId={agentId}
          theme={theme}
        />
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
  const agentCredits = !agentId || !txns || txns.length === 0 ? [] : txns.filter((t) => {
    if (t.kind !== "credit" || t.toId !== agentId || t.memo === "Mint") return false;
    if (t.memo?.startsWith("Reversal") || t.memo?.startsWith("Manual") || t.memo?.startsWith("Withdraw") || t.memo?.startsWith("Correction")) return false;
    
    // Check if this credit has been withdrawn by looking for a withdrawal transaction
    const hasBeenWithdrawn = txns.some(withdrawal => 
      withdrawal.kind === "debit" && 
      withdrawal.fromId === agentId &&
      withdrawal.memo === `Withdraw: ${t.memo}` &&
      new Date(withdrawal.dateISO) > new Date(t.dateISO)
    );
    
    return !hasBeenWithdrawn;
  });
  
  const agentRedeems = !agentId || !txns || txns.length === 0 ? [] : txns.filter((t)=> {
    if (t.kind !== "debit" || t.fromId !== agentId || !t.memo?.startsWith("Redeem:")) return false;
    
    // Check if this redemption has been undone by looking for a reversal
    const redemptionLabel = t.memo.replace("Redeem: ", "");
    const hasBeenUndone = txns.some(reversal => 
      reversal.kind === "credit" && 
      reversal.toId === agentId &&
      reversal.memo === `Reversal of redemption: ${redemptionLabel}` &&
      new Date(reversal.dateISO) > new Date(t.dateISO)
    );
    
    return !hasBeenUndone;
  });

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
                Reset "Earned" Chart (30d)
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
                        🧨 Complete Reset
                      </button>
                      <div className="text-xs opacity-70 mt-1">Clears all history & redemptions</div>
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
      className="fixed inset-0 z-40 glass grid place-items-center"
      style={{ backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)' }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
    >
      <motion.div 
        className={classNames("glass-card rounded-3xl shadow-xl p-4 sm:p-6 w-[min(780px,95vw)] max-h-[90vh] overflow-y-auto", neonBox(theme))}
        initial={{ scale: 0.9, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.9, opacity: 0, y: 20 }}
        transition={{ duration: 0.3 }}
      >
        <div className="flex items-center justify-between mb-3 sm:mb-4">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4" />
            <h2 className="text-lg sm:text-xl font-semibold">Switch User</h2>
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

        <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 gap-2 max-h-[60vh] overflow-auto pr-1 sm:pr-2">
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
                <div className="flex items-center gap-2 mb-1">
                  <Avatar name={a.name} size="sm" theme={theme} />
                  <div className="font-medium flex-1 truncate">{a.name}</div>
                </div>
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
