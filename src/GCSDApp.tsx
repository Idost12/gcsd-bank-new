import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Toaster, toast } from "sonner";
import {
  Wallet, Gift, History, Sparkles, UserCircle2, Lock, Check, X, Sun, Moon,
  Users, Home as HomeIcon, RotateCcw, Bell, Flame, Plus, Shield, Zap, ChevronDown
} from "lucide-react";
import { kvGetRemember as kvGet, kvSetIfChanged as kvSet, onKVChange, forceRefresh, testGoogleSheetsConnection } from "./lib/db";
import "./lib/testGoogleSheets"; // Test Google Sheets integration
import "./lib/debug"; // Debug test

// Updated: October 24, 2025 - Google Sheets integration complete

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
type Account = { id: string; name: string; role?: "system"|"agent"; frozen?: boolean; avatar?: string };
type ProductRule = { key: string; label: string; gcsd: number };
type PrizeItem   = { key: string; label: string; price: number };
type Notification = { id: string; when: string; text: string };
type AdminNotification = { id: string; when: string; type: "credit"|"debit"|"redeem_request"|"redeem_approved"|"system"; text: string; agentName?: string; amount?: number };
type RedeemRequest = { id: string; agentId: string; agentName: string; prizeKey: string; prizeLabel: string; price: number; when: string; agentPinVerified: boolean };
type AuditLog = { id: string; when: string; adminName: string; action: string; details: string; agentName?: string; amount?: number };
type Wishlist = Record<string, string[]>; // agentId -> array of prizeKeys
type Backup = { 
  id: string; 
  timestamp: string; 
  label: string;
  data: { 
    accounts: Account[]; 
    txns: Transaction[]; 
    stock: Record<string, number>;
    pins: Record<string, string>;
    goals: Record<string, number>;
    wishlist: Wishlist;
  }; 
};

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
  { key: "meme_generator", label: "Custom Meme Generator",  price: 35    },
  { key: "vip_entrance",   label: "VIP Entrance (Applause)", price: 400  },
  { key: "office_dj",      label: "Office DJ (2 Hours)",    price: 200   },
  { key: "shorts_day",     label: "Shorts Privilege (1 Day)", price: 1000  },
];

const INITIAL_STOCK: Record<string, number> = {
  airfryer: 1, soundbar: 1, burger_lunch: 2, voucher_50: 1, poker: 1,
  soda_maker: 1, magsafe: 1, galaxy_fit3: 1, cinema_tickets: 2, neo_massager: 1, logi_g102: 1,
  flight_madrid: 1, flight_london: 1, flight_milan: 1,
  meme_generator: 100, vip_entrance: 100, // Fun prizes with good stock!
  office_dj: 100, // Office DJ with good availability!
  shorts_day: 100, // Shorts privilege with good stock!
};

/* ===========================
   Helpers (single, canonical versions only)
   =========================== */
const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
const nowISO = () => new Date().toISOString();
const fmtTime = (d: Date) => [d.getHours(), d.getMinutes(), d.getSeconds()].map(n => String(n).padStart(2,"0")).join(":");
const fmtDate = (d: Date) => d.toLocaleDateString(undefined, {year:"numeric", month:"short", day:"2-digit" });
const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;

// Haptic feedback helper - more comprehensive
const haptic = (pattern: number | number[] = 30) => {
  if ('vibrate' in navigator) {
    if (Array.isArray(pattern)) {
      navigator.vibrate(pattern);
    } else {
      navigator.vibrate(pattern);
    }
  }
};

// Push notification helper
const sendPushNotification = async (title: string, body: string, icon?: string) => {
  if (!("Notification" in window)) {
    console.log("This browser does not support notifications");
    return;
  }

  if (Notification.permission === "granted") {
    new Notification(title, {
      body,
      icon: icon || LOGO_URL,
      badge: LOGO_URL,
      tag: uid(),
      requireInteraction: false,
      silent: false
    });
  } else if (Notification.permission !== "denied") {
    const permission = await Notification.requestPermission();
    if (permission === "granted") {
      new Notification(title, {
        body,
        icon: icon || LOGO_URL,
        badge: LOGO_URL
      });
    }
  }
};


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
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      whileHover={{ scale: 1.02, y: -2 }}
      style={{ willChange: "transform" }}
    >
      <div className="text-xs opacity-70 mb-1">{label}</div>
      <div className="text-2xl font-semibold"><NumberFlash value={value} /></div>
    </motion.div>
  );
}
function NumberFlash({ value }:{ value:number }) {
  const prevValue = useRef(value);
  const [isAnimating, setIsAnimating] = useState(false);
  
  useEffect(() => {
    if (prevValue.current !== value) {
      setIsAnimating(true);
      const timer = setTimeout(() => setIsAnimating(false), 300);
      prevValue.current = value;
      return () => clearTimeout(timer);
    }
  }, [value]);
  
  return (
    <motion.span
      animate={isAnimating ? { scale: [1, 1.05, 1] } : { scale: 1 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      style={{ display: "inline-block" }}
    >
      {value.toLocaleString()} GCSD
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
  theme === "neon" 
    ? "glass-card rounded-xl text-orange-100 neon-theme" 
    : "glass-card rounded-xl text-slate-800 dark:text-slate-100";

const neonBtn = (theme: Theme, solid?: boolean) =>
  theme === "neon"
    ? "glass-btn rounded-xl px-4 py-2 font-medium text-orange-100 neon-theme transition-all"
    : solid
    ? "glass-btn rounded-xl px-4 py-2 font-medium text-slate-900 dark:text-white transition-all"
    : "glass-btn rounded-xl px-4 py-2 font-medium text-slate-900 dark:text-white transition-all";

const inputCls = (theme: Theme) =>
  theme === "neon"
    ? "glass border-none rounded-xl px-4 py-2.5 w-full text-orange-100 placeholder-orange-200/60 focus:ring-2 focus:ring-orange-400/50 transition-all neon-theme"
    : "glass border-none rounded-xl px-4 py-2.5 w-full text-slate-900 dark:text-white placeholder-slate-600 dark:placeholder-slate-300 focus:ring-2 focus:ring-blue-400/50 dark:focus:ring-purple-500/50 transition-all";

function TypeLabel({ text }: { text: string }) {
  return (
    <motion.div 
      aria-label={text} 
      className="text-2xl font-semibold"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
    >
      {text}
    </motion.div>
  );
}

/* Avatar Component with Initials or Custom Image */
function Avatar({ name, size = "md", theme, avatarUrl }: { name: string; size?: "sm" | "md" | "lg"; theme?: Theme; avatarUrl?: string }) {
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
      className={`${sizeClasses[size]} rounded-full ${!avatarUrl ? `bg-gradient-to-br ${colors[colorIndex]}` : 'bg-gray-200'} flex items-center justify-center font-bold text-white shadow-lg ring-2 ring-white/30 overflow-hidden`}
      initial={{ scale: 0.8, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ duration: 0.15, ease: "easeOut" }}
      whileHover={{ scale: 1.08 }}
      style={{ willChange: "auto" }}
    >
      {avatarUrl ? (
        <img src={avatarUrl} alt={name} className="w-full h-full object-cover" />
      ) : (
        getInitials(name)
      )}
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
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            whileHover={{ scale: 1.05, y: -2 }}
            style={{ willChange: "auto" }}
          >
            <div className="text-3xl mb-1">{milestone.emoji}</div>
            <div className="text-xs font-semibold text-white drop-shadow-lg">{milestone.title}</div>
            <div className="text-[10px] text-white/80 line-clamp-1">{milestone.description}</div>
            
            {/* Shine effect - disabled for better performance */}
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

/* Race to Redeem Board - Shows who's closest to premium prizes */
function RaceToRedeemBoard({ 
  accounts, 
  balances, 
  stock, 
  theme 
}: { 
  accounts: Account[]; 
  balances: Map<string, number>; 
  stock: Record<string, number>;
  theme: Theme;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  
  // Premium prizes (5000+ GCSD)
  const premiumPrizes = PRIZE_ITEMS.filter(p => p.price >= 5000 && (stock[p.key] ?? 0) > 0);
  
  // Get top contenders for each prize
  const getPrizeRacers = (prize: PrizeItem) => {
    const agents = accounts
      .filter(a => a.role === "agent")
      .map(a => ({
        name: a.name,
        avatar: a.avatar,
        balance: balances.get(a.id) || 0,
        progress: Math.min(100, Math.round(((balances.get(a.id) || 0) / prize.price) * 100)),
        remaining: Math.max(0, prize.price - (balances.get(a.id) || 0))
      }))
      .sort((a, b) => b.progress - a.progress)
      .slice(0, 3); // Top 3 contenders
    
    return agents;
  };

  if (premiumPrizes.length === 0) {
    return (
      <div className={classNames("rounded-2xl border p-6", neonBox(theme))}>
        <div className="text-center opacity-70">No premium prizes available</div>
      </div>
    );
  }

  // Get overall closest contenders across all prizes
  const topContender = premiumPrizes.map(p => {
    const racers = getPrizeRacers(p);
    return { prize: p, racer: racers[0], stock: stock[p.key] ?? 0 };
  }).sort((a, b) => b.racer.progress - a.racer.progress)[0];

  return (
    <motion.div
      className={classNames("rounded-2xl border p-4 sm:p-6 cursor-pointer", neonBox(theme))}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      onClick={() => setIsExpanded(!isExpanded)}
      whileHover={{ scale: 1.01 }}
    >
      {/* Header - Always Visible */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Flame className="w-5 h-5 text-orange-500" />
          <h3 className="font-semibold text-lg sm:text-xl">Race to Redeem</h3>
          <span className="text-xs opacity-70 hidden sm:inline">Live Competition</span>
        </div>
        <motion.div
          animate={{ rotate: isExpanded ? 180 : 0 }}
          transition={{ duration: 0.3 }}
        >
          <ChevronDown className="w-5 h-5 opacity-70" />
        </motion.div>
      </div>

      {/* Minimized Preview */}
      {!isExpanded && topContender && (
        <motion.div
          className="mt-3 glass rounded-xl p-3"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.2 }}
        >
          <div className="flex items-center gap-3">
            <div className="text-2xl">🏆</div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium">
                {topContender.racer.name} leading for <span className="text-orange-500">{topContender.prize.label}</span>
              </div>
              <div className="flex items-center gap-2 mt-1">
                <div className="flex-1 h-2 rounded-full bg-black/10 dark:bg-white/10 overflow-hidden">
                  <div
                    className={classNames(
                      "h-2 rounded-full",
                      topContender.racer.progress >= 100 ? "bg-emerald-500" : "bg-yellow-500"
                    )}
                    style={{ width: `${topContender.racer.progress}%` }}
                  />
                </div>
                <span className="text-xs font-semibold">{topContender.racer.progress}%</span>
              </div>
            </div>
            {topContender.stock === 1 && (
              <div className="text-xs font-medium px-2 py-1 rounded-lg bg-red-500/20 text-red-500 whitespace-nowrap">
                🔥 1 LEFT
              </div>
            )}
          </div>
          <div className="text-xs opacity-60 text-center mt-2">
            Click to see all {premiumPrizes.length} premium prizes
          </div>
        </motion.div>
      )}

      {/* Expanded View */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="overflow-hidden"
          >
            <div className="space-y-4 mt-4" onClick={(e) => e.stopPropagation()}>
              {premiumPrizes.map((prize, idx) => {
                const racers = getPrizeRacers(prize);
                const stockLeft = stock[prize.key] ?? 0;
                
                return (
                  <motion.div
                    key={prize.key}
                    className="glass-card rounded-xl p-4"
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: idx * 0.1 }}
                  >
                    {/* Prize Header */}
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <div className="font-semibold text-lg">{prize.label}</div>
                        <div className="text-xs opacity-70">{prize.price.toLocaleString()} GCSD</div>
                      </div>
                      <div className="text-right">
                        <div className={classNames(
                          "text-xs font-medium px-2 py-1 rounded-lg",
                          stockLeft === 1 ? "bg-red-500/20 text-red-500" : "bg-emerald-500/20 text-emerald-500"
                        )}>
                          {stockLeft === 1 ? "🔥 ONLY 1 LEFT" : `${stockLeft} in stock`}
                        </div>
                      </div>
                    </div>

                    {/* Top Contenders */}
                    <div className="space-y-2">
                      {racers.map((racer, i) => (
                        <motion.div
                          key={racer.name}
                          className="flex items-center gap-3"
                          initial={{ opacity: 0, x: -10 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: idx * 0.1 + i * 0.05 }}
                        >
                          {/* Position Badge */}
                          <div className={classNames(
                            "w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold",
                            i === 0 ? "bg-yellow-500 text-white" : i === 1 ? "bg-gray-400 text-white" : "bg-amber-700 text-white"
                          )}>
                            {i + 1}
                          </div>

                          {/* Avatar */}
                          <Avatar name={racer.name} size="sm" theme={theme} avatarUrl={racer.avatar} />

                          {/* Info */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-sm font-medium truncate">{racer.name}</span>
                              <span className={classNames(
                                "text-xs font-semibold ml-2",
                                racer.progress >= 100 ? "text-emerald-500" : racer.progress >= 75 ? "text-yellow-500" : "text-slate-500"
                              )}>
                                {racer.progress}%
                              </span>
                            </div>
                            
                            {/* Progress Bar */}
                            <div className="h-2 rounded-full bg-black/10 dark:bg-white/10 overflow-hidden">
                              <motion.div
                                className={classNames(
                                  "h-2 rounded-full",
                                  racer.progress >= 100 ? "bg-emerald-500" : racer.progress >= 75 ? "bg-yellow-500" : "bg-blue-500"
                                )}
                                initial={{ width: 0 }}
                                animate={{ width: `${racer.progress}%` }}
                                transition={{ duration: 0.8, delay: idx * 0.1 + i * 0.05 + 0.2 }}
                              />
                            </div>
                            
                            {/* Remaining */}
                            <div className="text-xs opacity-60 mt-1">
                              {racer.progress >= 100 ? (
                                <span className="text-emerald-500 font-medium">✓ Can redeem now!</span>
                              ) : (
                                <span>Need {racer.remaining.toLocaleString()} more GCSD ({Math.ceil(racer.remaining / 500)} Full Evals)</span>
                              )}
                            </div>
                          </div>
                        </motion.div>
                      ))}
                    </div>

                    {/* Winner spotlight if someone can redeem */}
                    {racers[0]?.progress >= 100 && (
                      <motion.div
                        className="mt-3 pt-3 border-t border-white/10"
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ delay: 0.5 }}
                      >
                        <div className="text-center text-sm">
                          <span className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-emerald-500/20 text-emerald-500 font-medium">
                            🎉 {racers[0].name} can claim this prize!
                          </span>
                        </div>
                      </motion.div>
                    )}
                  </motion.div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

/* Enhanced Podium Component with Animated Medals */
// Badge calculation helper
function getBadge(position: number, balance: number): { emoji: string; title: string; color: string } | null {
  if (position === 1 && balance >= 10000) return { emoji: "👑", title: "Royalty", color: "text-yellow-400" };
  if (position === 1) return { emoji: "🥇", title: "Champion", color: "text-yellow-500" };
  if (position === 2) return { emoji: "🥈", title: "Runner-Up", color: "text-gray-400" };
  if (position === 3) return { emoji: "🥉", title: "Bronze Star", color: "text-amber-600" };
  if (balance >= 10000) return { emoji: "💎", title: "Diamond Tier", color: "text-cyan-400" };
  if (balance >= 7500) return { emoji: "💰", title: "Platinum", color: "text-purple-400" };
  if (balance >= 5000) return { emoji: "🔥", title: "On Fire", color: "text-orange-500" };
  if (balance >= 2500) return { emoji: "⭐", title: "Rising Star", color: "text-yellow-300" };
  if (balance >= 1000) return { emoji: "🚀", title: "Ascending", color: "text-blue-400" };
  return null;
}

function EnhancedPodium({ leaderboard, theme }: { leaderboard: Array<{ name: string; balance: number; avatar?: string; bio?: string }>; theme: Theme }) {
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
              <Avatar name={agent.name} size={position === 1 ? "lg" : "md"} theme={theme} avatarUrl={agent.avatar} />
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
              {(() => {
                const badge = getBadge(position, agent.balance);
                return badge ? (
                  <motion.div 
                    className={classNames("text-xs font-semibold mt-1", badge.color)}
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ delay: delay + 0.3, type: "spring" }}
                  >
                    {badge.emoji} {badge.title}
                  </motion.div>
                ) : null;
              })()}
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
      <div className="relative">
        <div className="space-y-2 max-h-64 overflow-auto pr-2 scroll-smooth">
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
        {/* Fade effect at bottom */}
        <div className="absolute bottom-0 left-0 right-2 h-6 bg-gradient-to-t from-slate-50 to-transparent dark:from-slate-900 pointer-events-none"></div>
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

function HoverCard({ children, onClick, delay = 0, theme }: { children: React.ReactNode; onClick: () => void; delay?: number; theme: Theme }) {
  const handleClick = () => {
    // Haptic feedback for mobile
    haptic(40);
    onClick();
  };

  return (
    <motion.button 
      onClick={handleClick} 
      className={classNames("border rounded-2xl px-3 py-3 text-left haptic-feedback", neonBox(theme))}
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.12, ease: "easeOut" }}
      whileHover={{ scale: 1.03, y: -2 }}
      whileTap={{ scale: 0.97 }}
      style={{ willChange: "auto" }}
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
        className={classNames(
          "appearance-none w-full px-3 py-2.5 pr-8 rounded-xl focus:outline-none focus:ring-2 bg-transparent",
          theme === "neon" ? "text-orange-100 focus:ring-orange-400/50" : "text-slate-900 dark:text-white focus:ring-blue-400/50 dark:focus:ring-purple-500/50"
        )}
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

/* Meme Generator Modal */
function MemeModal({ 
  open, 
  agentName, 
  onClose, 
  theme, 
  initialData,
  onSave,
  readOnly = false
}: { 
  open: boolean; 
  agentName: string; 
  onClose: () => void; 
  theme: Theme;
  initialData?: { topText: string; bottomText: string; uploadedImage: string | null; textColor?: string; fontSize?: number };
  onSave?: (data: { topText: string; bottomText: string; uploadedImage: string | null; textColor: string; fontSize: number }) => void;
  readOnly?: boolean;
}) {
  const [topText, setTopText] = useState(initialData?.topText || "");
  const [bottomText, setBottomText] = useState(initialData?.bottomText || "");
  const [uploadedImage, setUploadedImage] = useState<string | null>(initialData?.uploadedImage || null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [textColor, setTextColor] = useState(initialData?.textColor || "#ffffff");
  const [fontSize, setFontSize] = useState(initialData?.fontSize || 48);

  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) { // 5MB limit
        toast.error("Image too large! Please choose an image under 5MB.");
        return;
      }
      
      const reader = new FileReader();
      reader.onload = (e) => {
        setUploadedImage(e.target?.result as string);
        setImageFile(file);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleCloseAttempt = () => {
    setShowCloseConfirm(true);
  };

  const confirmClose = () => {
    // Auto-save the meme before closing
    if (onSave && !readOnly) {
      onSave({
        topText,
        bottomText,
        uploadedImage,
        textColor,
        fontSize
      });
    }
    setShowCloseConfirm(false);
    onClose();
  };

  const downloadMemeAsJPEG = () => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set canvas size
    canvas.width = 600;
    canvas.height = 600;

    // Create gradient background
    const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    gradient.addColorStop(0, '#8B5CF6');
    gradient.addColorStop(1, '#EC4899');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // If custom image uploaded, draw it
    if (uploadedImage) {
      const img = new Image();
      img.onload = () => {
        // Draw image to fill canvas
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        
        // Add semi-transparent overlay for text readability
        ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        // Add text
        addTextToCanvas(ctx, canvas);
        
        // Download
        downloadCanvas(canvas);
      };
      img.src = uploadedImage;
    } else {
      // No custom image, just add text to gradient background
      addTextToCanvas(ctx, canvas);
      downloadCanvas(canvas);
    }
  };

  const addTextToCanvas = (ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement) => {
    // Configure text style
    ctx.fillStyle = textColor;
    ctx.strokeStyle = 'black';
    ctx.lineWidth = Math.max(3, fontSize / 12);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Top text
    if (topText) {
      ctx.font = `bold ${fontSize}px Arial`;
      ctx.strokeText(topText.toUpperCase(), canvas.width / 2, 100);
      ctx.fillText(topText.toUpperCase(), canvas.width / 2, 100);
    }

    // Bottom text
    if (bottomText) {
      ctx.font = `bold ${fontSize}px Arial`;
      ctx.strokeText(bottomText.toUpperCase(), canvas.width / 2, canvas.height - 100);
      ctx.fillText(bottomText.toUpperCase(), canvas.width / 2, canvas.height - 100);
    }
  };

  const downloadCanvas = (canvas: HTMLCanvasElement) => {
    const link = document.createElement('a');
    link.download = `meme-${agentName}-${Date.now()}.jpg`;
    link.href = canvas.toDataURL('image/jpeg', 0.9);
    link.click();
    
    toast.success(`🎉 Meme downloaded! "${topText || 'Top Text'}" / "${bottomText || 'Bottom Text'}"`);
    
    // Save meme data when downloading (only if not read-only)
    if (onSave && !readOnly) {
      onSave({ topText, bottomText, uploadedImage, textColor, fontSize });
    }
  };

  if (!open) return null;

  return (
    <AnimatePresence>
      <motion.div 
        className="fixed inset-0 z-50 glass grid place-items-center"
        style={{ backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)' }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      >
        <motion.div 
          className={classNames("glass-card rounded-3xl shadow-2xl p-6 w-[min(600px,95vw)] max-h-[90vh] overflow-y-auto", neonBox(theme))}
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.9, opacity: 0 }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-2xl font-bold">{readOnly ? "👁️ View Meme" : "🎨 Meme Generator"}</h2>
            <button onClick={readOnly ? onClose : handleCloseAttempt} className="text-2xl opacity-60 hover:opacity-100">×</button>
          </div>
          
          <div className="text-sm opacity-70 mb-4">
            {readOnly 
              ? `Your meme, ${agentName}! Download it anytime. 🎉` 
              : initialData 
                ? `View or download your meme, ${agentName}! 🎉` 
                : `Congrats ${agentName}! Create your custom meme! 🎉`}
          </div>

          {/* Image Upload - disabled in read-only mode */}
          {!readOnly && (
          <div className="mb-4">
            <label className="text-sm font-semibold mb-2 block">Upload Image (Optional):</label>
            <div className="relative">
              <input
                type="file"
                accept="image/*"
                onChange={handleImageUpload}
                className="hidden"
                id="image-upload"
              />
              <label
                htmlFor="image-upload"
                className={classNames(
                  "block w-full px-4 py-3 rounded-xl border-2 border-dashed cursor-pointer transition-all hover:scale-105",
                  uploadedImage ? "border-emerald-500 bg-emerald-500/10" : "border-gray-400 hover:border-purple-500"
                )}
              >
                <div className="text-center">
                  {uploadedImage ? (
                    <div>
                      <div className="text-emerald-500 font-semibold">✅ Image Uploaded!</div>
                      <div className="text-xs opacity-70 mt-1">Click to change image</div>
                    </div>
                  ) : (
                    <div>
                      <div className="text-2xl mb-2">📸</div>
                      <div className="font-semibold">Click to upload image</div>
                      <div className="text-xs opacity-70 mt-1">Max 5MB • JPG, PNG, GIF</div>
                    </div>
                  )}
                </div>
              </label>
            </div>
          </div>
          )}

          {/* Meme Preview */}
          <div className="relative rounded-xl aspect-square mb-4 flex flex-col justify-between p-6 text-white font-bold text-center shadow-xl overflow-hidden">
            {uploadedImage ? (
              <div className="absolute inset-0">
                <img 
                  src={uploadedImage} 
                  alt="Uploaded" 
                  className="w-full h-full object-cover"
                />
                <div className="absolute inset-0 bg-black bg-opacity-30"></div>
              </div>
            ) : (
              <div className="absolute inset-0 bg-gradient-to-br from-purple-500 to-pink-500"></div>
            )}
            
            <div 
              className="relative z-10 drop-shadow-lg" 
              style={{ 
                textShadow: "2px 2px 4px rgba(0,0,0,0.8)", 
                fontSize: `${fontSize * 0.625}px`,
                color: textColor
              }}
            >
              {topText || "TOP TEXT"}
            </div>
            <div className="relative z-10">
              {/* Emoji removed for cleaner memes */}
            </div>
            <div 
              className="relative z-10 drop-shadow-lg" 
              style={{ 
                textShadow: "2px 2px 4px rgba(0,0,0,0.8)", 
                fontSize: `${fontSize * 0.625}px`,
                color: textColor
              }}
            >
              {bottomText || "BOTTOM TEXT"}
            </div>
          </div>

          {/* Text Inputs - disabled in read-only mode */}
          {!readOnly && (
          <div className="space-y-3 mb-4">
            <div>
              <label className="text-sm font-semibold mb-1 block">Top Text:</label>
              <input 
                type="text"
                value={topText}
                onChange={(e) => setTopText(e.target.value.toUpperCase())}
                placeholder="ENTER TOP TEXT"
                className={inputCls(theme)}
                maxLength={40}
              />
            </div>
            <div>
              <label className="text-sm font-semibold mb-1 block">Bottom Text:</label>
              <input 
                type="text"
                value={bottomText}
                onChange={(e) => setBottomText(e.target.value.toUpperCase())}
                placeholder="ENTER BOTTOM TEXT"
                className={inputCls(theme)}
                maxLength={40}
              />
              </div>
              
              {/* Text Customization */}
              <div className="space-y-3">
                <div>
                  <label className="text-sm font-semibold mb-2 block">🎨 Text Color:</label>
                  <div className="flex gap-2 items-center">
                    <input 
                      type="color"
                      value={textColor}
                      onChange={(e) => setTextColor(e.target.value)}
                      className="w-14 h-14 rounded-xl cursor-pointer border-2 border-white/30"
                      title="Custom color picker"
                    />
                    <div className="flex gap-2 flex-wrap flex-1">
                      {[
                        { color: '#ffffff', name: 'White' },
                        { color: '#000000', name: 'Black' },
                        { color: '#ffff00', name: 'Yellow' },
                        { color: '#ff00ff', name: 'Magenta' },
                        { color: '#00ffff', name: 'Cyan' },
                        { color: '#ff0000', name: 'Red' },
                        { color: '#00ff00', name: 'Green' },
                        { color: '#0000ff', name: 'Blue' },
                        { color: '#ffa500', name: 'Orange' },
                      ].map(({ color, name }) => (
                        <motion.button
                          key={color}
                          onClick={() => setTextColor(color)}
                          className={classNames(
                            "w-10 h-10 rounded-lg border-2 transition-all",
                            textColor === color ? "border-purple-500 scale-110 ring-2 ring-purple-400" : "border-white/30"
                          )}
                          style={{ backgroundColor: color }}
                          title={name}
                          whileHover={{ scale: 1.15 }}
                          whileTap={{ scale: 0.95 }}
                        />
                      ))}
                    </div>
            </div>
          </div>
                
                <div>
                  <label className="text-sm font-semibold mb-2 block">📏 Font Size: {fontSize}px</label>
                  <input 
                    type="range"
                    min="24"
                    max="80"
                    value={fontSize}
                    onChange={(e) => setFontSize(Number(e.target.value))}
                    className="w-full h-2 rounded-lg appearance-none cursor-pointer"
                    style={{
                      background: `linear-gradient(to right, #8B5CF6 0%, #EC4899 100%)`
                    }}
                  />
                  <div className="flex justify-between text-xs opacity-60 mt-1">
                    <span>24px</span>
                    <span>52px</span>
                    <span>80px</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3">
            {!readOnly && (
            <motion.button
                className={classNames("flex-1 px-4 py-3 rounded-xl font-semibold bg-emerald-500 text-white hover:bg-emerald-600")}
                onClick={() => {
                  // Save the meme data first
                  if (onSave) {
                    onSave({
                      topText,
                      bottomText,
                      uploadedImage,
                      textColor,
                      fontSize
                    });
                    toast.success("✅ Meme saved successfully!");
                    haptic([30, 20, 30]);
                  }
                  // Then close
                  onClose();
                }}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
                💾 Save & Close
            </motion.button>
            )}
            <motion.button
              className={classNames(readOnly ? "flex-1" : "", "px-4 py-3 rounded-xl font-semibold", neonBtn(theme, true))}
              onClick={() => {
                // Auto-save when downloading (if creating new meme)
                if (onSave && !readOnly) {
                  onSave({
                    topText,
                    bottomText,
                    uploadedImage,
                    textColor,
                    fontSize
                  });
                }
                downloadMemeAsJPEG();
              }}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              📥 Download {readOnly ? "Meme" : "JPEG"}
            </motion.button>
            {readOnly && (
            <motion.button
                className={classNames("px-4 py-3 rounded-xl font-semibold", neonBtn(theme))}
              onClick={onClose}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
              >
                Close
              </motion.button>
            )}
          </div>
        </motion.div>

        {/* Close Confirmation Dialog */}
        {showCloseConfirm && (
          <motion.div
            className="absolute inset-0 flex items-center justify-center z-10"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
          >
            <motion.div
              className={classNames("glass-card rounded-2xl shadow-2xl p-6 max-w-md mx-4", neonBox(theme))}
              initial={{ scale: 0.9 }}
              animate={{ scale: 1 }}
            >
              <h3 className="text-xl font-bold mb-3">Close Meme Generator?</h3>
              <p className="text-sm opacity-70 mb-4">
                {readOnly 
                  ? "Are you sure you want to exit?" 
                  : "Your meme will be auto-saved. You can view and download it anytime from My Purchases!"}
              </p>
              <div className="flex gap-3">
                <motion.button
                  className={classNames("flex-1 px-4 py-2 rounded-xl", neonBtn(theme, true))}
                  onClick={() => setShowCloseConfirm(false)}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              Cancel
            </motion.button>
                <motion.button
                  className="flex-1 px-4 py-2 rounded-xl bg-red-500 text-white font-semibold"
                  onClick={confirmClose}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                >
                  Yes, Exit
            </motion.button>
          </div>
        </motion.div>
          </motion.div>
        )}
      </motion.div>
    </AnimatePresence>
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
  const [adminNotifs, setAdminNotifs] = useState<AdminNotification[]>([]);
  const [redeemRequests, setRedeemRequests] = useState<RedeemRequest[]>([]);
  const [activeUsers, setActiveUsers] = useState<Set<string>>(new Set());
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [wishlist, setWishlist] = useState<Wishlist>({});
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
  const [receipt, setReceipt] = useState<{id:string; when:string; buyer:string; item:string; amount:number; buyerId:string} | null>(null);
  const [memeModal, setMemeModal] = useState<{
    open: boolean; 
    agentName: string; 
    initialData?: { topText: string; bottomText: string; uploadedImage: string | null; textColor?: string; fontSize?: number };
    onSave?: (data: { topText: string; bottomText: string; uploadedImage: string | null; textColor: string; fontSize: number }) => void;
    readOnly?: boolean;
  } | null>(null);
  const [pinModal, setPinModal] = useState<{open:boolean; agentId?:string; onOK?:(good:boolean)=>void}>({open:false});
  const [unread, setUnread] = useState(0);
  const [epochs, setEpochs] = useState<Record<string,string>>({}); // for "erase history from" timestamps

  /** metric epochs */
  const [metrics, setMetrics] = useState<MetricsEpoch>({});
  
  /** notification permission */
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [showNotifBanner, setShowNotifBanner] = useState(false);
  
  /** backup system */
  const [backups, setBackups] = useState<Backup[]>([]);
  const [autoBackupEnabled, setAutoBackupEnabled] = useState(false);
  const [lastAutoBackup, setLastAutoBackup] = useState<string>("");
  
  // Batch updates to reduce Supabase writes
  const [pendingUpdates, setPendingUpdates] = useState<Map<string, any>>(new Map());
  const updateTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  

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
        
        console.log("📦 Loading data from storage...", core);
        
        // Check if we have valid data
        if (core?.accounts && Array.isArray(core.accounts) && core.accounts.length > 0 && core?.txns && Array.isArray(core.txns)) {
          console.log("✅ Found valid data:", core.accounts.length, "accounts,", core.txns.length, "transactions");
          setAccounts(core.accounts);
          
          // Decompress transactions if they're compressed
          const decompressedTxns = core.txns.map((txn: any) => 
            txn.i ? decompressTransaction(txn) : txn
          );
          setTxns(decompressedTxns);
        } else {
          console.log("⚠️ No valid data found, using seed data");
          setAccounts(seedAccounts);
          setTxns(seedTxns);
          await kvSet("gcs-v4-core", { accounts: seedAccounts, txns: seedTxns });
        }
        
        // Test Google Sheets connection and force refresh
        setTimeout(() => {
          testGoogleSheetsConnection().then(() => {
            forceRefresh().then(() => {
              console.log("🔄 Initial data refresh completed");
            });
          });
        }, 1000);
        setStock((await kvGet<Record<string, number>>("gcs-v4-stock")) ?? INITIAL_STOCK);
        setPins((await kvGet<Record<string, string>>("gcs-v4-pins")) ?? {});
        setGoals((await kvGet<Record<string, number>>("gcs-v4-goals")) ?? {});
        // Load notifications from KV storage instead of starting empty
        const rawNotifs = await kvGet<Notification[]>("gcs-v4-notifs");
        const decompressedNotifs = rawNotifs?.map((notif: any) => 
          notif.i ? decompressNotification(notif) : notif
        ) ?? [];
        setNotifs(decompressedNotifs);
        setAdminNotifs((await kvGet<AdminNotification[]>("gcs-v4-admin-notifs")) ?? []);
        setRedeemRequests((await kvGet<RedeemRequest[]>("gcs-v4-redeem-requests")) ?? []);
        setAuditLogs((await kvGet<AuditLog[]>("gcs-v4-audit-logs")) ?? []);
        setWishlist((await kvGet<Wishlist>("gcs-v4-wishlist")) ?? {});
        setEpochs((await kvGet<Record<string,string>>("gcs-v4-epochs")) ?? {});
        setMetrics((await kvGet<MetricsEpoch>("gcs-v4-metrics")) ?? {});
        // Clear existing backups to save Supabase quota
        setBackups([]);
        await kvSet("gcs-v4-backups", []);
        setAutoBackupEnabled((await kvGet<boolean>("gcs-v4-auto-backup")) ?? true);
        setLastAutoBackup((await kvGet<string>("gcs-v4-last-auto-backup")) ?? "");
        
        // CRITICAL: Theme is STRICTLY LOCAL - load from localStorage ONLY
        // NEVER from KV storage - each browser has its own theme
        const savedTheme = localStorage.getItem("gcsd-theme") as Theme;
        const loadedTheme = savedTheme || "light";
        setTheme(loadedTheme);
        
        // Load UI state from localStorage to save Supabase quota
        const savedPortal = localStorage.getItem("gcsd-portal") as Portal | null;
        if (savedPortal) setPortal(savedPortal);
        
        const savedPickerOpen = localStorage.getItem("gcsd-picker-open");
        if (savedPickerOpen) setPickerOpen(savedPickerOpen === "true");
        
        const savedMobileMenuOpen = localStorage.getItem("gcsd-mobile-menu-open");
        if (savedMobileMenuOpen) setMobileMenuOpen(savedMobileMenuOpen === "true");
        
        const savedIsAdmin = localStorage.getItem("gcsd-is-admin");
        if (savedIsAdmin) setIsAdmin(savedIsAdmin === "true");
      } finally {
        setHydrated(true);
      }
    })();
  }, []);

  /* realtime sync: merge (do not overwrite local) */
  useEffect(() => {
    const off = onKVChange(async ({ key, val, event }) => {
      if (!key) return;
      
      // Show live update notification for core data changes
      if (key === "gcs-v4-core" && event === "UPDATE") {
        console.log("🔄 Live update: Core data changed - refreshing UI");
        toast.success("🔄 Live update received!", { duration: 2000 });
      }
      
      if (key === "gcs-v4-core") {
        const remote = (val ?? (await kvGet("gcs-v4-core"))) as {accounts: Account[]; txns: Transaction[]} | null;
        if (!remote) return;
        
        // Use remote data directly - simpler and more reliable
        if (remote.accounts && remote.accounts.length > 0) {
          setAccounts(remote.accounts);
        }
        if (remote.txns && remote.txns.length > 0) {
          // Decompress transactions if they're compressed
          const decompressedTxns = remote.txns.map((txn: any) => 
            txn.i ? decompressTransaction(txn) : txn
          );
          setTxns(decompressedTxns);
        }
        return;
      }
      if (key === "gcs-v4-stock")  setStock(val ?? (await kvGet("gcs-v4-stock")) ?? {});
      if (key === "gcs-v4-pins")   setPins(val ?? (await kvGet("gcs-v4-pins")) ?? {});
      if (key === "gcs-v4-goals")  setGoals(val ?? (await kvGet("gcs-v4-goals")) ?? {});
      // Notifications now sync live
      if (key === "gcs-v4-notifs") {
        const rawNotifs = val ?? (await kvGet("gcs-v4-notifs")) ?? [];
        const decompressedNotifs = rawNotifs.map((notif: any) => 
          notif.i ? decompressNotification(notif) : notif
        );
        setNotifs(decompressedNotifs);
      }
      if (key === "gcs-v4-admin-notifs") setAdminNotifs(val ?? (await kvGet("gcs-v4-admin-notifs")) ?? []);
      if (key === "gcs-v4-redeem-requests") setRedeemRequests(val ?? (await kvGet("gcs-v4-redeem-requests")) ?? []);
      if (key === "gcs-v4-audit-logs") setAuditLogs(val ?? (await kvGet("gcs-v4-audit-logs")) ?? []);
      if (key === "gcs-v4-wishlist") setWishlist(val ?? (await kvGet("gcs-v4-wishlist")) ?? {});
      if (key === "gcs-v4-epochs") setEpochs(val ?? (await kvGet("gcs-v4-epochs")) ?? {});
      if (key === "gcs-v4-metrics") setMetrics(val ?? (await kvGet("gcs-v4-metrics")) ?? {});
      if (key === "gcs-v4-backups") setBackups(val ?? (await kvGet("gcs-v4-backups")) ?? []);
      if (key === "gcs-v4-auto-backup") setAutoBackupEnabled(val ?? (await kvGet("gcs-v4-auto-backup")) ?? true);
      if (key === "gcs-v4-last-auto-backup") setLastAutoBackup(val ?? (await kvGet("gcs-v4-last-auto-backup")) ?? "");
      
      // CRITICAL: Theme is NEVER synced via KV - ignore any theme-related KV changes
      // Each browser maintains its own theme in localStorage independently
      if (key === "gcs-v4-theme") {
        // DO NOT sync theme from KV - intentionally ignored
      }
    });
    return off;
  }, []);

  /* persist on changes */
  useEffect(() => { 
    if (hydrated) {
      // Compress transactions before storing to reduce data size
      const compressedTxns = txns.map(compressTransaction);
      kvSet("gcs-v4-core", { accounts, txns: compressedTxns }); 
    }
  }, [hydrated, accounts, txns]);
  useEffect(() => { if (hydrated) kvSet("gcs-v4-stock", stock);             }, [hydrated, stock]);
  useEffect(() => { if (hydrated) kvSet("gcs-v4-pins",  pins);              }, [hydrated, pins]);
  useEffect(() => { if (hydrated) kvSet("gcs-v4-goals", goals);             }, [hydrated, goals]);
  // Notifications now persist to KV storage
  // Use batched updates for less critical data to reduce Supabase writes
  useEffect(() => { if (hydrated) batchedKvSet("gcs-v4-notifs", notifs);           }, [hydrated, notifs]);
  useEffect(() => { if (hydrated) batchedKvSet("gcs-v4-admin-notifs", adminNotifs); }, [hydrated, adminNotifs]);
  useEffect(() => { if (hydrated) batchedKvSet("gcs-v4-redeem-requests", redeemRequests); }, [hydrated, redeemRequests]);
  useEffect(() => { if (hydrated) batchedKvSet("gcs-v4-audit-logs", auditLogs); }, [hydrated, auditLogs]);
  useEffect(() => { if (hydrated) batchedKvSet("gcs-v4-wishlist", wishlist); }, [hydrated, wishlist]);
  useEffect(() => { if (hydrated) batchedKvSet("gcs-v4-epochs", epochs);           }, [hydrated, epochs]);
  useEffect(() => { if (hydrated) batchedKvSet("gcs-v4-metrics", metrics);         }, [hydrated, metrics]);
  useEffect(() => { if (hydrated) batchedKvSet("gcs-v4-backups", backups);         }, [hydrated, backups]);
  useEffect(() => { if (hydrated) batchedKvSet("gcs-v4-auto-backup", autoBackupEnabled); }, [hydrated, autoBackupEnabled]);
  useEffect(() => { if (hydrated) batchedKvSet("gcs-v4-last-auto-backup", lastAutoBackup); }, [hydrated, lastAutoBackup]);
  
  /* theme persistence - STRICTLY LOCAL to each browser - NOT synced to KV */
  useEffect(() => { 
    if (hydrated) {
      // CRITICAL: Store in localStorage ONLY - NEVER in KV storage
      // Each device/browser has its own independent theme preference
      localStorage.setItem("gcsd-theme", theme);
    }
  }, [hydrated, theme]);

  /* UI state persistence - LOCAL ONLY to save Supabase quota */
  useEffect(() => {
    if (hydrated) {
      localStorage.setItem("gcsd-portal", portal);
      localStorage.setItem("gcsd-picker-open", pickerOpen.toString());
      localStorage.setItem("gcsd-mobile-menu-open", mobileMenuOpen.toString());
      localStorage.setItem("gcsd-is-admin", isAdmin.toString());
    }
  }, [hydrated, portal, pickerOpen, mobileMenuOpen, isAdmin]);

  // Cleanup batching timeout on unmount
  useEffect(() => {
    return () => {
      if (updateTimeoutRef.current) {
        clearTimeout(updateTimeoutRef.current);
      }
    };
  }, []);

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
  
  /* Check notification permission on mount */
  useEffect(() => {
    if ("Notification" in window && hydrated) {
      const permission = Notification.permission;
      setNotificationsEnabled(permission === "granted");
      
      // Show banner if not granted and not denied
      if (permission === "default") {
        setTimeout(() => setShowNotifBanner(true), 5000);
      }
    }
  }, [hydrated]);
  
  /* Auto-backup every 6 hours */
  /* Auto-backup DISABLED to save Supabase quota */
  // useEffect(() => {
  //   if (!hydrated || !autoBackupEnabled) return;
  //   
  //   const performAutoBackup = () => {
  //     const now = new Date();
  //     const lastBackup = lastAutoBackup ? new Date(lastAutoBackup) : null;
  //     
  //     // Check if 6 hours have passed
  //     if (!lastBackup || (now.getTime() - lastBackup.getTime()) > 6 * 60 * 60 * 1000) {
  //       console.log("🔄 Performing auto-backup...");
  //       
  //       const backup: Backup = {
  //         id: uid(),
  //         timestamp: nowISO(),
  //         label: `Auto-backup ${now.toLocaleString()}`,
  //         data: {
  //           accounts,
  //           txns,
  //           stock,
  //           pins,
  //           goals,
  //           wishlist
  //         }
  //       };
  //       
  //       setBackups(prev => [backup, ...prev].slice(0, 20)); // Keep last 20 backups
  //       setLastAutoBackup(nowISO());
  //       console.log("✅ Auto-backup complete");
  //     }
  //   };
  //   
  //   // Run immediately on mount if needed
  //   performAutoBackup();
  //   
  //   // Then check every hour
  //   const interval = setInterval(performAutoBackup, 60 * 60 * 1000);
  //   return () => clearInterval(interval);
  // }, [hydrated, autoBackupEnabled, accounts, txns, stock, pins, goals, wishlist, lastAutoBackup]);
  
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
  const postTxn = (partial: Partial<Transaction> & Pick<Transaction,"kind"|"amount">) => {
    // Validate transaction data
    if (!partial.amount || partial.amount <= 0) {
      console.error("Invalid transaction: amount must be positive", partial);
      return;
    }
    if (partial.amount > 1000000) {
      console.error("Invalid transaction: amount too large", partial);
      toast.error("Transaction amount too large");
      return;
    }
    if (partial.kind === "credit" && !partial.toId) {
      console.error("Invalid credit transaction: missing toId", partial);
      return;
    }
    if (partial.kind === "debit" && !partial.fromId) {
      console.error("Invalid debit transaction: missing fromId", partial);
      return;
    }
    
    const txn = { id: uid(), dateISO: nowISO(), memo: "", ...partial };
    setTxns(prev => [txn, ...prev ]);
    
    // Create admin notification for significant transactions
    if (txn.kind === "credit" && txn.toId && txn.memo !== "Mint") {
      const agentName = getName(txn.toId);
      const adminNotif: AdminNotification = {
        id: uid(),
        when: nowISO(),
        type: "credit",
        text: `Credit: ${agentName} +${txn.amount} GCSD${txn.memo ? ` (${txn.memo})` : ''}`,
        agentName,
        amount: txn.amount
      };
      notifyAdmin(adminNotif);
    }
    
    if (txn.kind === "debit" && txn.fromId && !txn.memo?.startsWith("Redeem:")) {
      const agentName = getName(txn.fromId);
      const adminNotif: AdminNotification = {
        id: uid(),
        when: nowISO(),
        type: "debit",
        text: `Debit: ${agentName} -${txn.amount} GCSD${txn.memo ? ` (${txn.memo})` : ''}`,
        agentName,
        amount: txn.amount
      };
      notifyAdmin(adminNotif);
    }
    
    // Force refresh data after transaction to ensure sync
    setTimeout(() => {
      forceRefresh().then(() => {
        console.log("🔄 Data refreshed after transaction");
      });
    }, 2000);
  };
  
  const notify = (text:string, pushTitle?: string) => {
    const newNotif = { id: uid(), when: nowISO(), text };
    setNotifs(prev => [newNotif, ...prev].slice(0,200));
    setUnread(c => c + 1);
    
    // Auto-expire notification after 10 minutes
    setTimeout(() => {
      setNotifs(prev => prev.filter(n => n.id !== newNotif.id));
    }, 10 * 60 * 1000); // 10 minutes
    
    // Send push notification if enabled
    if (notificationsEnabled && pushTitle) {
      sendPushNotification(pushTitle, text);
    }
  };

  const notifyAdmin = (adminNotif: AdminNotification) => {
    setAdminNotifs(prev => [...prev, adminNotif].slice(0, 200));
    
    // Auto-expire admin notification after 10 minutes
    setTimeout(() => {
      setAdminNotifs(prev => prev.filter(n => n.id !== adminNotif.id));
    }, 10 * 60 * 1000); // 10 minutes
  };

  // Data compression functions to reduce Supabase storage
  const compressTransaction = (txn: Transaction) => ({
    i: txn.id,
    k: txn.kind,
    a: txn.amount,
    m: txn.memo,
    d: txn.dateISO,
    f: txn.fromId,
    t: txn.toId,
    x: txn.meta
  });

  const decompressTransaction = (compressed: any): Transaction => ({
    id: compressed.i,
    kind: compressed.k,
    amount: compressed.a,
    memo: compressed.m,
    dateISO: compressed.d,
    fromId: compressed.f,
    toId: compressed.t,
    meta: compressed.x
  });

  const compressNotification = (notif: Notification) => ({
    i: notif.id,
    w: notif.when,
    t: notif.text
  });

  const decompressNotification = (compressed: any): Notification => ({
    id: compressed.i,
    when: compressed.w,
    text: compressed.t
  });

  // Batched update function to reduce Google Sheets writes
  const batchedKvSet = (key: string, value: any) => {
    // Compress data before storing to reduce size
    let compressedValue = value;
    if (key === "gcs-v4-core" && value?.txns) {
      compressedValue = {
        ...value,
        txns: value.txns.map(compressTransaction)
      };
    } else if (key === "gcs-v4-notifs" && Array.isArray(value)) {
      compressedValue = value.map(compressNotification);
    }
    
    setPendingUpdates(prev => new Map(prev).set(key, compressedValue));
    
    // Clear existing timeout
    if (updateTimeoutRef.current) {
      clearTimeout(updateTimeoutRef.current);
    }
    
    // Set new timeout to batch updates
    updateTimeoutRef.current = setTimeout(async () => {
      const updates = pendingUpdates;
      setPendingUpdates(new Map());
      
      // Write all pending updates at once
      for (const [k, v] of updates) {
        await kvSet(k, v);
      }
      
      console.log("📦 Batched", updates.size, "updates to Google Sheets");
    }, 1000); // Batch every 1 second
  };
  const getName = (id:string) => accounts.find(a=>a.id===id)?.name || "—";
  const openAgentPin = (agentId:string, cb:(ok:boolean)=>void) => setPinModal({open:true, agentId, onOK:cb});
  
  // Audit logging helper - only log important actions to save Supabase quota
  const logAudit = (action: string, details: string, agentName?: string, amount?: number) => {
    // Only log important actions to reduce database writes
    const importantActions = [
      "Credit Added", "Manual Transfer", "Redeem Approved", "Redeem Rejected",
      "Account Frozen", "Account Unfrozen", "Sale Undone", "Redemption Undone",
      "Manual Withdrawal", "PIN Updated", "PIN Reset", "Data Restored",
      "Cleanup Duplicates", "Backup Imported", "Data Backup"
    ];
    
    // Skip logging if not an important action
    if (!importantActions.includes(action)) {
      console.log("📝 Skipping audit log for:", action, details);
      return;
    }
    
    const log: AuditLog = {
      id: uid(),
      when: nowISO(),
      adminName: "Admin", // Could be enhanced to track which admin if multiple admins
      action,
      details,
      agentName,
      amount
    };
    setAuditLogs(prev => [log, ...prev].slice(0, 500)); // Keep last 500 logs
  };

  /* actions */
  function adminCredit(agentId:string, ruleKey:string, qty:number){
    const rule = PRODUCT_RULES.find(r=>r.key===ruleKey); 
    if (!rule) return toast.error("Invalid product rule");
    if (!agentId) return toast.error("Choose agent");
    if (!qty || qty <= 0) return toast.error("Quantity must be positive");
    if (qty > 100) return toast.error("Quantity too large (max 100)");
    
    const agent = accounts.find(a => a.id === agentId);
    if (!agent) return toast.error("Agent not found");
    if (agent.frozen) return toast.error("Cannot credit frozen account");
    
    const amount = rule.gcsd * Math.max(1, qty||1);
    if (amount > 1000000) return toast.error("Amount too large (max 1,000,000 GCSD)");
    
    postTxn({ kind:"credit", amount, toId: agentId, memo:`${rule.label}${qty>1?` x${qty}`:""}`, meta:{product:rule.key, qty} });
    notify(`➕ ${getName(agentId)} credited +${amount} GCSD for ${rule.label}${qty>1?` ×${qty}`:""}`, `💰 GCSD Earned!`);
    toast.success(`Added ${amount} GCSD to ${getName(agentId)}`);
    haptic(50);
    logAudit("Credit Added", `${rule.label}${qty>1?` x${qty}`:""}`, getName(agentId), amount);
    
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
    if (amount > 1000000) return toast.error("Amount too large (max 1,000,000 GCSD)");
    
    const agent = accounts.find(a => a.id === agentId);
    if (!agent) return toast.error("Agent not found");
    if (agent.frozen) return toast.error("Cannot transfer to frozen account");
    
    const trimmedNote = note?.trim() || "Manual transfer";
    logAudit("Manual Transfer", trimmedNote, getName(agentId), amount);
    
    postTxn({ kind:"credit", amount, toId: agentId, memo: trimmedNote });
    notify(`➕ ${getName(agentId)} credited +${amount} GCSD (manual)`);
    toast.success(`Transferred ${amount} GCSD to ${getName(agentId)}`);
    
    // Update metrics when manual transfer occurs
    setMetrics(prev => ({
      ...prev,
      starOfDay: nowISO(), // Reset star of the day
      leaderOfMonth: nowISO() // Reset leader of the month
    }));
  }

  // Two-step redemption: Agent PIN → Admin Approval
  // ⚠️ IMPORTANT: This function ONLY creates a request. Actual redemption happens in approveRedeem()
  function redeemPrize(agentId:string, prizeKey:string){
    const agent = accounts.find(a => a.id === agentId);
    const prize = PRIZE_ITEMS.find(p=>p.key===prizeKey); if(!prize) return;
    const left = stock[prizeKey] ?? 0;
    const bal  = balances.get(agentId)||0;
    /** count only ACTIVE redeems towards the limit */
    const count= txns.filter(t=> t.fromId===agentId && G_isRedeemTxn(t) && G_isRedeemStillActive(t, txns)).length;

    // Special prizes that bypass the 2-prize limit
    const unlimitedPrizes = ["meme_generator", "office_dj"];
    const isUnlimitedPrize = unlimitedPrizes.includes(prizeKey);

    if (agent?.frozen) return toast.error("Account is frozen. Contact admin.");
    if (!isUnlimitedPrize && count >= MAX_PRIZES_PER_AGENT) return toast.error(`Limit reached (${MAX_PRIZES_PER_AGENT})`);
    if (left <= 0) return toast.error("Out of stock");
    if (bal  < prize.price) return toast.error("Insufficient balance");

    // Step 1: Verify agent PIN
    openAgentPin(agentId, (ok)=>{
      if (!ok) return toast.error("Wrong PIN");
      
      // Step 2: Create redeem request for admin approval (NO transaction yet!)
      const request: RedeemRequest = {
        id: uid(),
        agentId,
        agentName: getName(agentId),
        prizeKey,
        prizeLabel: prize.label,
        price: prize.price,
        when: nowISO(),
        agentPinVerified: true
      };
      
      setRedeemRequests(prev => [...prev, request]);
      
      // Create admin notification
      const adminNotif: AdminNotification = {
        id: uid(),
        when: nowISO(),
        type: "redeem_request",
        text: `${getName(agentId)} requesting ${prize.label}`,
        agentName: getName(agentId),
        amount: prize.price
      };
      notifyAdmin(adminNotif);
      
      toast.success("Request sent to admin for approval!");
      notify(`⏳ ${getName(agentId)} requesting ${prize.label} (${prize.price.toLocaleString()} GCSD)`);
    });
  }

  // Approve redeem request (admin only)
  function approveRedeem(requestId: string) {
    const request = redeemRequests.find(r => r.id === requestId);
    if (!request) {
      toast.error("Request not found");
      return;
    }
    
    const agent = accounts.find(a => a.id === request.agentId);
    if (!agent) {
      toast.error("Agent not found");
      return;
    }
    
    if (agent.frozen) {
      toast.error("Cannot approve - account is frozen");
      return;
    }
    
    const bal = balances.get(request.agentId) || 0;
    if (bal < request.price) {
      toast.error("Insufficient balance");
      return;
    }
    
    // Check stock availability
    const currentStock = stock[request.prizeKey] ?? 0;
    if (currentStock <= 0) {
      toast.error("Out of stock");
      return;
    }
    
    // Check if the prize still exists
    const prize = PRIZE_ITEMS.find(p => p.key === request.prizeKey);
    if (!prize) {
      toast.error("Prize no longer available");
      return;
    }
    
    // Process the redemption
    const txnId = uid();
    const receiptId = "ORD-" + Math.random().toString(36).slice(2,7).toUpperCase();
    postTxn({ 
      id: txnId,
      kind:"debit", 
      amount: request.price, 
      fromId: request.agentId, 
      memo:`Redeem: ${request.prizeLabel}`,
      meta: { 
        prizeKey: request.prizeKey, 
        prizeLabel: request.prizeLabel,
        receiptId: receiptId
      }
    });
    setStock(s=> ({...s, [request.prizeKey]: Math.max(0, (s[request.prizeKey] ?? 0) - 1)}));
    notify(`🎁 ${request.agentName} redeemed ${request.prizeLabel} (−${request.price} GCSD)`, `🎁 Prize Approved!`);
      setReceipt({
        id: receiptId,
      when: new Date().toLocaleString(), buyer: request.agentName, item: request.prizeLabel, amount: request.price, buyerId: request.agentId
    });
    
    // Create admin notification
    const adminNotif: AdminNotification = {
      id: uid(),
      when: nowISO(),
      type: "redeem_approved",
      text: `Approved: ${request.agentName} → ${request.prizeLabel}`,
      agentName: request.agentName,
      amount: request.price
    };
    notifyAdmin(adminNotif);
    
    // Remove from requests
    setRedeemRequests(prev => prev.filter(r => r.id !== requestId));
    
    logAudit("Redeem Approved", `${request.prizeLabel}`, request.agentName, request.price);
    toast.success(`Redemption approved for ${request.agentName}!`);
    confettiBurst();
    
    // Note: Meme generator can only be accessed from "My Purchases" tab
    // Users need to pay each time to generate a new meme
  }

  // Reject redeem request
  function rejectRedeem(requestId: string) {
    const request = redeemRequests.find(r => r.id === requestId);
    if (!request) {
      toast.error("Request not found");
      return;
    }
    
    setRedeemRequests(prev => prev.filter(r => r.id !== requestId));
    logAudit("Redeem Rejected", `${request.prizeLabel}`, request.agentName, request.price);
    toast.success("Request rejected");
    notify(`❌ Rejected redemption request from ${request.agentName}`);
    
    // Notify the admin
    const adminNotif: AdminNotification = {
      id: uid(),
      when: nowISO(),
      type: "redeem_rejected",
      text: `Rejected: ${request.agentName} → ${request.prizeLabel}`,
      agentName: request.agentName,
      amount: request.price
    };
    setAdminNotifs(prev => [...prev, adminNotif].slice(0, 200));
  }

  // Freeze agent account
  function freezeAgent(agentId: string) {
    const agent = accounts.find(a => a.id === agentId);
    if (!agent) return toast.error("Agent not found");
    if (agent.frozen) return toast.error("Account already frozen");
    
    setAccounts(prev => prev.map(a => a.id === agentId ? {...a, frozen: true} : a));
    logAudit("Account Frozen", "Account access restricted", getName(agentId));
    toast.success(`${getName(agentId)} account frozen`);
    notify(`❄️ ${getName(agentId)} account frozen by admin`);
    
    const adminNotif: AdminNotification = {
      id: uid(),
      when: nowISO(),
      type: "system",
      text: `Frozen account: ${getName(agentId)}`,
      agentName: getName(agentId)
    };
    notifyAdmin(adminNotif);
  }

  // Unfreeze agent account
  function unfreezeAgent(agentId: string) {
    const agent = accounts.find(a => a.id === agentId);
    if (!agent) return toast.error("Agent not found");
    if (!agent.frozen) return toast.error("Account is not frozen");
    
    setAccounts(prev => prev.map(a => a.id === agentId ? {...a, frozen: false} : a));
    logAudit("Account Unfrozen", "Account access restored", getName(agentId));
    toast.success(`${getName(agentId)} account unfrozen`);
    notify(`✓ ${getName(agentId)} account unfrozen by admin`);
    
    const adminNotif: AdminNotification = {
      id: uid(),
      when: nowISO(),
      type: "system",
      text: `Unfrozen account: ${getName(agentId)}`,
      agentName: getName(agentId)
    };
    notifyAdmin(adminNotif);
  }

  // Track active users (when they switch to agent portal)
  useEffect(() => {
    if (portal === "agent" && currentAgentId) {
      setActiveUsers(prev => new Set(prev).add(currentAgentId));
      
      // Remove from active after 5 minutes of inactivity
      const timeout = setTimeout(() => {
        setActiveUsers(prev => {
          const next = new Set(prev);
          next.delete(currentAgentId);
          return next;
        });
      }, 5 * 60 * 1000);
      
      return () => clearTimeout(timeout);
    }
  }, [portal, currentAgentId]);

  function undoSale(txId:string){
    const t = txns.find(x=>x.id===txId); 
    if (!t || t.kind!=="credit" || !t.toId) {
      toast.error("Invalid transaction");
      return;
    }
    
    const agent = accounts.find(a => a.id === t.toId);
    if (!agent) {
      toast.error("Agent not found");
      return;
    }
    
    // Check if already undone
    if (G_isTransactionUndone(t, txns)) {
      toast.error("This transaction has already been undone");
      return;
    }
    
    // Check if agent has sufficient balance
    const bal = balances.get(t.toId) || 0;
    if (bal < t.amount) {
      toast.error("Cannot undo - insufficient balance");
      return;
    }
    
    postTxn({ kind:"debit", amount: t.amount, fromId: t.toId, memo:`Reversal of sale: ${t.memo ?? "Sale"}`, meta:{reversesTxnId: t.id} });
    notify(`↩️ Reversed sale for ${getName(t.toId)} (−${t.amount})`);
    toast.success("Sale reversed");
    logAudit("Sale Undone", t.memo ?? "Sale", getName(t.toId), t.amount);
    
    // Update metrics when sale is undone
    setMetrics(prev => ({
      ...prev,
      starOfDay: nowISO(), // Reset star of the day
      leaderOfMonth: nowISO() // Reset leader of the month
    }));
  }

  function undoRedemption(txId:string){
    const t = txns.find(x=>x.id===txId); 
    if (!t || t.kind!=="debit" || !t.fromId) {
      toast.error("Invalid transaction");
      return;
    }
    
    const agent = accounts.find(a => a.id === t.fromId);
    if (!agent) {
      toast.error("Agent not found");
      return;
    }
    
    // Check if already undone
    if (G_isTransactionUndone(t, txns)) {
      toast.error("This redemption has already been undone");
      return;
    }
    
    const label = (t.memo||"").replace("Redeem: ","");
    const prize = PRIZE_ITEMS.find(p=>p.label===label);
    
    postTxn({ kind:"credit", amount: t.amount, toId: t.fromId, memo:`Reversal of redemption: ${label}`, meta:{reversesTxnId: t.id} });
    if (prize) {
      setStock(s=> ({...s, [prize.key]: Math.min(999, (s[prize.key]??0)+1)})); // Cap at 999 to prevent overflow
    }
    notify(`↩️ Reversed redemption for ${getName(t.fromId)} (+${t.amount})`);
    toast.success("Redemption reversed & stock restored");
    logAudit("Redemption Undone", label, getName(t.fromId), t.amount);
    
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
    if (amount > 1000000) return toast.error("Amount too large (max 1,000,000 GCSD)");
    
    const agent = accounts.find(a => a.id === agentId);
    if (!agent) return toast.error("Agent not found");
    
    const bal = balances.get(agentId)||0;
    if (bal < amount) return toast.error("Cannot withdraw more than current balance");
    
    postTxn({ kind:"debit", amount, fromId: agentId, memo:`Correction (withdraw): ${note?.trim() || "Manual correction"}` });
    notify(`🧾 Withdrawn ${amount} GCSD from ${getName(agentId)} (manual correction)`);
    toast.success("Credits withdrawn");
    logAudit("Manual Withdrawal", note?.trim() || "Manual correction", getName(agentId), amount);
    
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
    const agent = accounts.find(a => a.id === agentId);
    if (!agent) return toast.error("Agent not found");
    if (!/^\d{5}$/.test(pin)) return toast.error("PIN must be 5 digits");
    
    setPins(prev=> ({...prev, [agentId]: pin}));
    notify(`🔐 PIN set/reset for ${getName(agentId)}`);
    toast.success("PIN updated");
    logAudit("PIN Updated", "PIN changed", getName(agentId));
  }

  function resetPin(agentId:string){
    const agent = accounts.find(a => a.id === agentId);
    if (!agent) return toast.error("Agent not found");
    
    setPins(prev=> { const next = {...prev}; delete next[agentId]; return next; });
    notify(`🔐 PIN cleared for ${getName(agentId)}`);
    toast.success("PIN reset (cleared)");
    logAudit("PIN Reset", "PIN cleared", getName(agentId));
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


  // Backup all live data
  // Restore from backup
  function restoreFromBackup(backupId: string) {
    const backup = backups.find(b => b.id === backupId);
    if (!backup) {
      toast.error("Backup not found");
      return;
    }
    
    const confirmMsg = `⚠️ RESTORE DATA FROM:\n${backup.label}\n\nThis will overwrite ALL current data!\n\nType 'RESTORE' to confirm:`;
    const confirmation = prompt(confirmMsg);
    
    if (confirmation !== "RESTORE") {
      toast.error("Restore cancelled");
      return;
    }
    
    // Restore all data
    setAccounts(backup.data.accounts);
    setTxns(backup.data.txns);
    setStock(backup.data.stock);
    setPins(backup.data.pins);
    setGoals(backup.data.goals);
    setWishlist(backup.data.wishlist);
    
    logAudit("Data Restored", `Restored from: ${backup.label}`);
    toast.success("✅ Data restored successfully!");
    haptic([100, 50, 100, 50, 100]);
    confettiBurst();
  }
  
  // Clean up duplicate agents - ONE-TIME FIX
  async function cleanupDuplicates() {
    console.log("🧹 cleanupDuplicates function called");
    const confirmed = confirm("⚠️ This will remove duplicate agents and preserve the first occurrence of each. Continue?");
    if (!confirmed) return;
    
    const vault = accounts.find(a => a.role === "system");
    if (!vault) {
      toast.error("System error: vault not found");
      return;
    }
    
    const seenNames = new Set<string>();
    const cleanedAgents: Account[] = [];
    
    // Keep first occurrence of each agent
    accounts.filter(a => a.role === "agent").forEach(agent => {
      const normalizedName = agent.name.trim().toLowerCase();
      if (!seenNames.has(normalizedName)) {
        cleanedAgents.push(agent);
        seenNames.add(normalizedName);
      }
    });
    
    const cleanedAccounts = [vault, ...cleanedAgents];
    
    setAccounts(cleanedAccounts);
    await kvSet("gcs-v4-core", { accounts: cleanedAccounts, txns });
    
    logAudit("Cleanup Duplicates", `Removed ${accounts.length - cleanedAccounts.length} duplicate agents`);
    toast.success(`✅ Cleaned up! Removed ${accounts.length - cleanedAccounts.length} duplicates`);
    haptic([50, 30, 50]);
  }
  
  // Emergency: Clear all KV storage and reset to fresh state
  async function emergencyReset() {
    console.log("🚨 emergencyReset function called");
    const confirmed = confirm("⚠️ EMERGENCY RESET\n\nThis will:\n- Clear ALL corrupted data\n- Create fresh accounts for all agents\n- Reset vault to 8000 GCSD\n- LOSE all transaction history\n\nType 'RESET' to confirm");
    if (!confirmed) return;
    
    try {
      // Clear all KV storage
      await kvSet("gcs-v4-core", null);
      await kvSet("gcs-v4-stock", null);
      await kvSet("gcs-v4-pins", null);
      await kvSet("gcs-v4-goals", null);
      await kvSet("gcs-v4-notifs", null);
      await kvSet("gcs-v4-admin-notifs", null);
      await kvSet("gcs-v4-redeem-requests", null);
      await kvSet("gcs-v4-audit-logs", null);
      await kvSet("gcs-v4-wishlist", null);
      await kvSet("gcs-v4-epochs", null);
      await kvSet("gcs-v4-metrics", null);
      await kvSet("gcs-v4-backups", null);
      
      // Create fresh data
      const freshAccounts: Account[] = [
        { id: uid(), name: "Bank Vault", role: "system" },
        ...AGENT_NAMES.map(n => ({ id: uid(), name: n, role: "agent" as const })),
      ];
      
      const vaultId = freshAccounts[0].id;
      const freshTxns: Transaction[] = [
        { id: uid(), kind: "credit", amount: 8000, memo: "Mint", dateISO: nowISO(), toId: vaultId },
      ];
      
      // Save fresh data
      await kvSet("gcs-v4-core", { accounts: freshAccounts, txns: freshTxns });
      await kvSet("gcs-v4-stock", INITIAL_STOCK);
      
      // Update state
      setAccounts(freshAccounts);
      setTxns(freshTxns);
      setStock(INITIAL_STOCK);
      setPins({});
      setGoals({});
      setNotifs([]);
      setAdminNotifs([]);
      setRedeemRequests([]);
      setAuditLogs([]);
      setWishlist({});
      setEpochs({});
      setMetrics({});
      setBackups([]);
      
      toast.success("✅ Emergency reset complete! All data restored to fresh state");
      haptic([100, 50, 100]);
      confettiBurst();
    } catch (error) {
      console.error("Emergency reset failed:", error);
      toast.error("❌ Reset failed");
    }
  }
  
  // Import backup from JSON file
  async function importBackup(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    
    try {
      const text = await file.text();
      const backupData = JSON.parse(text);
      
      // Validate backup data
      if (!backupData.accounts || !backupData.transactions) {
        toast.error("❌ Invalid backup file format");
        return;
      }
      
      // Restore all data from backup
      const restoredAccounts = backupData.accounts;
      const restoredTxns = backupData.transactions;
      
      setAccounts(restoredAccounts);
      setTxns(restoredTxns);
      setStock(backupData.stock || INITIAL_STOCK);
      setPins(backupData.pins || {});
      setGoals(backupData.goals || {});
      setNotifs(backupData.notifications || []);
      setAdminNotifs(backupData.adminNotifications || []);
      setRedeemRequests(backupData.redeemRequests || []);
      setAuditLogs(backupData.auditLogs || []);
      setWishlist(backupData.wishlist || {});
      setEpochs(backupData.epochs || {});
      setMetrics(backupData.metrics || {});
      
      // Save to KV storage
      await kvSet("gcs-v4-core", { accounts: restoredAccounts, txns: restoredTxns });
      await kvSet("gcs-v4-stock", backupData.stock || INITIAL_STOCK);
      await kvSet("gcs-v4-pins", backupData.pins || {});
      await kvSet("gcs-v4-goals", backupData.goals || {});
      await kvSet("gcs-v4-notifs", backupData.notifications || []);
      await kvSet("gcs-v4-admin-notifs", backupData.adminNotifications || []);
      await kvSet("gcs-v4-redeem-requests", backupData.redeemRequests || []);
      await kvSet("gcs-v4-audit-logs", backupData.auditLogs || []);
      await kvSet("gcs-v4-wishlist", backupData.wishlist || {});
      await kvSet("gcs-v4-epochs", backupData.epochs || {});
      await kvSet("gcs-v4-metrics", backupData.metrics || {});
      
      logAudit("Backup Imported", `Restored from file: ${file.name} (${backupData.timestamp || 'unknown date'})`);
      toast.success("✅ Backup restored successfully!");
      haptic([100, 50, 100, 50, 100]);
      confettiBurst();
      
      // Clear the file input
      event.target.value = '';
    } catch (error) {
      console.error("Import failed:", error);
      toast.error("❌ Failed to import backup - invalid file");
    }
  }
  
  async function backupAllData(){
    console.log("backupAllData called");
    
    // First verify admin PIN
    const adminPin = prompt("Enter admin PIN to proceed:");
    if (adminPin !== "13577531") {
      return toast.error("Invalid admin PIN");
    }
    
    try {
      // Create comprehensive backup object
      const backupData = {
        timestamp: nowISO(),
        version: "v4",
        accounts: accounts,
        transactions: txns,
        stock: stock,
        pins: pins,
        goals: goals,
        notifications: notifs,
        adminNotifications: adminNotifs,
        redeemRequests: redeemRequests,
        auditLogs: auditLogs,
        wishlist: wishlist,
        epochs: epochs,
        metrics: metrics,
        activeUsers: Array.from(activeUsers), // Convert Set to Array for JSON
      };
      
      // Convert to JSON string
      const backupJson = JSON.stringify(backupData, null, 2);
      
      // Create filename with timestamp
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const filename = `gcsd-backup-${timestamp}.json`;
      
      // Create and download file
      const blob = new Blob([backupJson], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      // Save to backup history for point-in-time restore
      const backupEntry: Backup = {
        id: uid(),
        timestamp: nowISO(),
        label: `Manual backup ${new Date().toLocaleString()}`,
        data: {
          accounts,
          txns,
          stock,
          pins,
          goals,
          wishlist
        }
      };
      setBackups(prev => [backupEntry, ...prev].slice(0, 50)); // Keep last 50 backups
      
      // Log the backup
      logAudit("Data Backup", `Complete system backup created: ${filename}`);
      
      toast.success(`✅ Backup saved as ${filename}`);
      haptic([50, 30, 50]);
      console.log("Backup completed:", backupData);
      
    } catch (error) {
      console.error("Backup failed:", error);
      toast.error("❌ Backup failed - check console for details");
    }
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
      className={classNames(
        "min-h-screen overflow-x-hidden transition-colors duration-200 swipe-container",
        theme === "neon" ? "text-orange-100" : "text-slate-900 dark:text-slate-100"
      )}
    >
      <Toaster position="top-center" richColors />

      {/* Intro */}
      <AnimatePresence>
        {showIntro && (
          <motion.div 
            className="fixed inset-0 z-50 flex items-center justify-center bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 p-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.25, ease: "easeInOut" }}
          >
            <div className="text-center w-full max-w-md">
              {/* Logo */}
            <motion.div 
                className="mx-auto mb-6 w-36 h-36 sm:w-40 sm:h-40 rounded-3xl glass-card grid place-items-center"
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
                  className="w-28 h-28 sm:w-32 sm:h-32 rounded object-contain"
                  initial={{ scale: 0.5, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ delay: 0.5, duration: 0.5 }}
                />
              </motion.div>

              {/* Title */}
              <motion.div 
                className="text-white text-2xl sm:text-3xl font-bold mb-3"
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.8, duration: 0.5 }}
              >
                Welcome to {APP_NAME}
              </motion.div>

              {/* Subtitle */}
              <motion.div 
                className="text-white/70 text-base sm:text-lg mb-8"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 1.1, duration: 0.5 }}
              >
                Your Performance Hub
              </motion.div>

              {/* Button */}
              <motion.button 
                className="glass-btn text-white px-8 py-3 rounded-xl text-base font-medium w-full sm:w-auto"
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

      {/* Notification Permission Banner */}
      <AnimatePresence>
        {showNotifBanner && !notificationsEnabled && (
          <motion.div
            className="fixed top-4 left-1/2 -translate-x-1/2 z-50 max-w-md mx-4"
            initial={{ y: -100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -100, opacity: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
          >
            <div className={classNames("rounded-2xl p-4 shadow-2xl border-2", neonBox(theme))}>
              <div className="flex items-start gap-3">
                <Bell className="w-6 h-6 text-blue-500 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <h3 className="font-semibold mb-1">Enable Notifications?</h3>
                  <p className="text-sm opacity-70 mb-3">
                    Get notified when you earn GCSD, redemptions are approved, and more!
                  </p>
                  <div className="flex gap-2">
                    <motion.button
                      className={classNames("flex-1 px-3 py-2 rounded-lg text-sm font-medium", neonBtn(theme, true))}
                      onClick={async () => {
                        haptic([30, 50, 30]);
                        const permission = await Notification.requestPermission();
                        if (permission === "granted") {
                          setNotificationsEnabled(true);
                          toast.success("🔔 Notifications enabled!");
                          sendPushNotification("🎉 Notifications Enabled!", "You'll now receive updates from GCS Bank");
                        }
                        setShowNotifBanner(false);
                      }}
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                    >
                      Enable
                    </motion.button>
                    <motion.button
                      className="px-3 py-2 rounded-lg text-sm opacity-60 hover:opacity-100"
                      onClick={() => {
                        haptic(20);
                        setShowNotifBanner(false);
                      }}
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                    >
                      Later
                    </motion.button>
                  </div>
                </div>
                <button
                  onClick={() => {
                    haptic(20);
                    setShowNotifBanner(false);
                  }}
                  className="text-sm opacity-50 hover:opacity-100"
                >
                  ✕
                </button>
              </div>
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

      {/* Meme Generator Modal */}
      {memeModal?.open && (
        <MemeModal
          open={memeModal.open}
          agentName={memeModal.agentName}
          onClose={() => setMemeModal(null)}
          theme={theme}
          initialData={memeModal.initialData}
          onSave={memeModal.onSave}
          readOnly={memeModal.readOnly}
        />
      )}

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

      {/* Receipt - only show for the buyer or if viewing as that agent */}
      <AnimatePresence>
        {receipt && (portal === "agent" && currentAgentId === receipt.buyerId) && (
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
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
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
              key={`agent-${currentAgentId}`}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
            >
              <AgentPortal
                theme={theme}
                agentId={currentAgentId}
                accounts={accounts}
                txns={txns}
                stock={stock}
                prizes={PRIZE_ITEMS}
                goals={goals}
                wishlist={wishlist[currentAgentId] || []}
                pins={pins}
                onSetGoal={(amt)=> setSavingsGoal(currentAgentId, amt)}
                onRedeem={(k)=>redeemPrize(currentAgentId, k)}
                onToggleWishlist={(prizeKey) => {
                  setWishlist(prev => {
                    const current = prev[currentAgentId] || [];
                    const has = current.includes(prizeKey);
                    return {
                      ...prev,
                      [currentAgentId]: has ? current.filter(k => k !== prizeKey) : [...current, prizeKey]
                    };
                  });
                }}
                onOpenMeme={(txn) => {
                  const agentName = accounts.find(a => a.id === currentAgentId)?.name || "Agent";
                  const memeData = txn.meta?.memeData as { topText: string; bottomText: string; uploadedImage: string | null; textColor?: string; fontSize?: number } | undefined;
                  setMemeModal({
                    open: true,
                    agentName,
                    initialData: memeData,
                    readOnly: !!memeData, // Read-only if meme already exists
                    onSave: (newMemeData) => {
                      // Update the transaction with new meme data (only when creating for first time)
                      setTxns(prev => prev.map(t => 
                        t.id === txn.id 
                          ? { ...t, meta: { ...t.meta, memeData: newMemeData } }
                          : t
                      ));
                    }
                  });
                }}
                onUpdateAccount={(updates) => {
                  console.log("Updating account:", currentAgentId, "with updates:", updates);
                  setAccounts(prev => {
                    const updated = prev.map(a => 
                      a.id === currentAgentId ? { ...a, ...updates } : a
                    );
                    console.log("Updated accounts:", updated.find(a => a.id === currentAgentId));
                    return updated;
                  });
                }}
              />
            </motion.div>
          )}

          {portal==="admin" && isAdmin && (
            <motion.div
              key="admin"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
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
                goals={goals}
                adminNotifs={adminNotifs}
                redeemRequests={redeemRequests}
                activeUsers={activeUsers}
                auditLogs={auditLogs}
                wishlist={wishlist}
                onToggleWishlist={(agentId, prizeKey) => {
                  setWishlist(prev => {
                    const current = prev[agentId] || [];
                    const has = current.includes(prizeKey);
                    return {
                      ...prev,
                      [agentId]: has ? current.filter(k => k !== prizeKey) : [...current, prizeKey]
                    };
                  });
                }}
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
                onBackupData={backupAllData}
                onResetMetric={resetMetric}
                onFreezeAgent={freezeAgent}
                onUnfreezeAgent={unfreezeAgent}
                onApproveRedeem={approveRedeem}
                onRejectRedeem={rejectRedeem}
                onCleanupDuplicates={cleanupDuplicates}
                onEmergencyReset={emergencyReset}
                onImportBackup={importBackup}
                backups={backups}
                autoBackupEnabled={autoBackupEnabled}
                onToggleAutoBackup={() => setAutoBackupEnabled(prev => !prev)}
                onRestoreBackup={restoreFromBackup}
              />
            </motion.div>
          )}

          {portal==="feed" && (
            <motion.div
              key="feed"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
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
    sumInRange(txns, d, 1, (t) => {
      // Only count debits from agents that are NOT corrections AND have NOT been undone (reversed)
      if (t.kind !== "debit" || !t.fromId || !nonSystemIds.has(t.fromId)) return false;
      if (G_isCorrectionDebit(t)) return false;
      if (!afterISO(metrics.spent30d, t.dateISO)) return false;
      // Check if this debit has been reversed (e.g., redemption undone)
      if (G_isTransactionUndone(t, txns)) return false;
      return true;
    })
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
      const account = accounts.find((a) => a.id === id);
      return { id, name: account?.name || "—", balance, avatar: account?.avatar };
    })
    .sort((a, b) => b.balance - a.balance), [nonSystemIds, balances, accounts]);


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

      {/* Race to Redeem Board */}
      <RaceToRedeemBoard 
        accounts={accounts}
        balances={balances}
        stock={stock}
        theme={theme}
      />

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
            <div className="text-lg font-semibold mb-6">📊 Dashboard</div>
            <div className="grid gap-6">
              <motion.div 
                className="rounded-xl border p-4 text-center"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.3 }}
              >
                <div className="text-sm opacity-70 mb-2">Total Active Balance</div>
                <div className="text-4xl font-bold text-emerald-500">
                  {totalActiveBalance.toLocaleString()}
            </div>
                <div className="text-xs opacity-60 mt-1">GCSD</div>
              </motion.div>
              
              <motion.div 
                className="rounded-xl border p-4 text-center"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.3, delay: 0.1 }}
              >
                <div className="text-sm opacity-70 mb-2">Total GCSD Spent (30d)</div>
                <div className="text-4xl font-bold text-rose-500">
                  {totalSpent.toLocaleString()}
                </div>
                <div className="text-xs opacity-60 mt-1">GCSD</div>
              </motion.div>
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
          <div className="relative">
            <div className="space-y-2 max-h-[800px] overflow-auto pr-2 scroll-smooth">
            {leaderboard.map((row, i) => {
              const badge = getBadge(i + 1, row.balance);
              return (
              <motion.div 
                key={row.id} 
                className={classNames("flex items-center justify-between border rounded-xl px-3 py-2", neonBox(theme))}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.2 }}
                whileHover={{ scale: 1.02, x: 4 }}
              >
                <div className="flex items-center gap-2">
                    <span className="w-5 text-right font-semibold opacity-70">
                    {i + 1}.
                    </span>
                  <span className="font-medium">{row.name}</span>
                    {badge && (
                      <span className={classNames("text-xs px-1.5 py-0.5 rounded", badge.color, "bg-black/5 dark:bg-white/5")}>
                        {badge.emoji} {badge.title}
                      </span>
                    )}
                </div>
                  <div className="text-sm font-semibold">
                  <NumberFlash value={row.balance} />
                </div>
              </motion.div>
              );
            })}
            {leaderboard.length === 0 && <div className="text-sm opacity-70">No data yet.</div>}
            </div>
            {/* Fade effect at bottom */}
            <div className="absolute bottom-0 left-0 right-2 h-8 bg-gradient-to-t from-slate-50 to-transparent dark:from-slate-900 pointer-events-none"></div>
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
            <div className="relative">
              <div className="space-y-2 max-h-64 overflow-auto pr-2 scroll-smooth">
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
              {/* Fade effect at bottom */}
              <div className="absolute bottom-0 left-0 right-2 h-6 bg-gradient-to-t from-slate-50 to-transparent dark:from-slate-900 pointer-events-none"></div>
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
            <div className="relative">
              <div className="space-y-2 max-h-64 overflow-auto pr-2 scroll-smooth">
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
              {/* Fade effect at bottom */}
              <div className="absolute bottom-0 left-0 right-2 h-6 bg-gradient-to-t from-slate-50 to-transparent dark:from-slate-900 pointer-events-none"></div>
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
  wishlist,
  onSetGoal,
  onRedeem,
  onToggleWishlist,
  onOpenMeme,
  pins,
  onUpdateAccount,
}: {
  theme: Theme;
  agentId: string;
  accounts: Account[];
  txns: Transaction[];
  stock: Record<string, number>;
  prizes: PrizeItem[];
  goals: Record<string, number>;
  wishlist: string[];
  onSetGoal: (n: number) => void;
  onRedeem: (k: string) => void;
  onToggleWishlist: (prizeKey: string) => void;
  onOpenMeme: (txn: Transaction) => void;
  pins: Record<string, string>;
  onUpdateAccount: (updates: Partial<Account>) => void;
}) {
  const [agentTab, setAgentTab] = useState<"overview" | "purchases">("overview");
  const [purchasesPinVerified, setPurchasesPinVerified] = useState(false);
  const [showPurchasesPin, setShowPurchasesPin] = useState(false);
  
  const name = accounts.find((a) => a.id === agentId)?.name || "—";
  
  // Handle tab switch - require PIN for purchases
  const handleTabChange = (tab: "overview" | "purchases") => {
    if (tab === "purchases" && !purchasesPinVerified) {
      setShowPurchasesPin(true);
    } else {
      setAgentTab(tab);
    }
  };
  
  // Reset PIN verification when agent changes
  useEffect(() => {
    setPurchasesPinVerified(false);
    setAgentTab("overview");
  }, [agentId]);
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

  // Get redeemed prizes (only active ones, not reversed)
  const redeemedPrizes = agentTxns.filter((t) => G_isRedeemTxn(t) && G_isRedeemStillActive(t, txns));

  // Receipt modal state
  const [selectedReceipt, setSelectedReceipt] = useState<{
    id: string;
    when: string;
    buyer: string;
    item: string;
    amount: number;
  } | null>(null);

  // Avatar upload
  const currentAgent = accounts.find(a => a.id === agentId);
  const [showAvatarCropper, setShowAvatarCropper] = useState(false);
  const [avatarImageSrc, setAvatarImageSrc] = useState<string | null>(null);
  
  
  const handleAvatarUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) {
        toast.error("Image too large! Max 5MB");
        return;
      }
      
      const reader = new FileReader();
      reader.onload = (e) => {
        const imageUrl = e.target?.result as string;
        setAvatarImageSrc(imageUrl);
        setShowAvatarCropper(true);
      };
      reader.readAsDataURL(file);
    }
    // Reset input so same file can be selected again
    event.target.value = '';
  };
  
  const saveAvatar = (croppedImageUrl: string) => {
    console.log("🔵 saveAvatar called!");
    console.log("🔵 Agent ID:", agentId);
    console.log("🔵 Cropped image URL length:", croppedImageUrl.length);
    console.log("🔵 Cropped image preview:", croppedImageUrl.substring(0, 100));
    
    if (!croppedImageUrl || croppedImageUrl.length < 100) {
      console.error("❌ Invalid image data");
      toast.error("Failed to create avatar image");
      return;
    }
    
    console.log("🔵 About to call onUpdateAccount...");
    
    try {
      // Update the account with the new avatar
      onUpdateAccount({ avatar: croppedImageUrl });
      console.log("✅ onUpdateAccount called successfully");
    } catch (error) {
      console.error("❌ Error calling onUpdateAccount:", error);
      toast.error("Failed to update account");
      return;
    }
    
    // Close the modal
    console.log("🔵 Closing modal...");
    setShowAvatarCropper(false);
    setAvatarImageSrc(null);
    
    // Success feedback
    haptic([30, 20, 30]);
    toast.success("✅ Profile picture updated!");
    console.log("✅ Avatar save complete!");
  };
  

  return (
    <div>
      {/* Tab Navigation */}
      <div className="mb-4 flex gap-2 overflow-x-auto pb-2">
        {[
          { key: "overview", label: "Overview", icon: Wallet },
          { key: "purchases", label: "My Purchases", icon: Gift }
        ].map((tab) => (
          <motion.button
            key={tab.key}
            onClick={() => {
              haptic(30);
              handleTabChange(tab.key as typeof agentTab);
            }}
            className={classNames(
              "flex items-center gap-2 px-4 py-2 rounded-xl font-medium whitespace-nowrap transition-all",
              agentTab === tab.key 
                ? classNames(neonBtn(theme, true), "ring-2 ring-blue-400/50") 
                : "glass opacity-70 hover:opacity-100"
            )}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
            {tab.key === "purchases" && <Lock className="w-3 h-3 opacity-50" />}
          </motion.button>
        ))}
      </div>
      
      {/* PIN Modal for Purchases */}
      <AnimatePresence>
        {showPurchasesPin && (
          <PinModal
            open={showPurchasesPin}
            onClose={() => setShowPurchasesPin(false)}
            onCheck={(pin) => {
              const agentPin = pins[agentId];
              if (!agentPin) {
                toast.error("No PIN set for this agent");
                return false;
              }
              if (pin === agentPin) {
                setPurchasesPinVerified(true);
                setAgentTab("purchases");
                setShowPurchasesPin(false);
                toast.success("✅ Access granted");
                return true;
              }
              toast.error("❌ Incorrect PIN");
              return false;
            }}
            theme={theme}
          />
        )}
      </AnimatePresence>

      {/* Tab Content */}
      <AnimatePresence mode="wait">
        {agentTab === "overview" && (
          <motion.div
            key="overview"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
          >
      
      <div className="grid lg:grid-cols-2 gap-4">
        {/* Summary */}
        <div className={classNames("rounded-2xl border p-4 shadow-sm", neonBox(theme))}>
          <div className="text-sm opacity-70 mb-2">Agent</div>
          <div className="flex items-center gap-3 mb-3">
                  <div className="relative">
                    <Avatar name={name} size="lg" theme={theme} avatarUrl={currentAgent?.avatar} />
                    <label 
                      htmlFor="avatar-upload"
                      className="absolute -bottom-1 -right-1 bg-purple-500 text-white rounded-full p-1.5 cursor-pointer hover:bg-purple-600 transition-all hover:scale-110 shadow-lg"
                      title="Upload profile picture"
                      onClick={() => haptic(20)}
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                    </label>
                    <input
                      type="file"
                      id="avatar-upload"
                      accept="image/*"
                      onChange={handleAvatarUpload}
                      className="hidden"
                    />
                  </div>
                  <div className="flex-1">
            <div className="text-xl font-semibold">{name}</div>
                    <div className="text-xs opacity-60">Click camera to upload photo</div>
          </div>
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
                          haptic(50);
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
                      💡 Need ~{Math.ceil((goal - balance) / 500)} more Full Evaluations to reach goal
                      <div className="text-xs opacity-60 mt-1">
                        (Current: {balance.toLocaleString()} / {goal.toLocaleString()} GCSD • Full Eval = 500 GCSD)
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
                        transition={{ duration: 0.15, ease: "easeOut" }}
                  whileHover={{ scale: 1.02, x: 4 }}
                        style={{ willChange: "auto" }}
                >
                  <div className="text-sm">{t.memo || (t.kind === "credit" ? "Credit" : "Debit")}</div>
                        <div className={classNames("text-sm", t.kind === "credit" ? "text-emerald-500" : "text-rose-500")}>
                    {t.kind === "credit" ? "+" : "−"}{t.amount.toLocaleString()}
                        </div>
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
          <div className="relative">
            <div className="space-y-2 max-h-[560px] overflow-auto pr-2 scroll-smooth">
              {prizes.map((p, i) => {
              const left = stock[p.key] ?? 0;
              // Special prizes that bypass the 2-prize limit
              const unlimitedPrizes = ["meme_generator", "office_dj"];
              const isUnlimitedPrize = unlimitedPrizes.includes(p.key);
              const can = left > 0 && balance >= p.price && (isUnlimitedPrize || prizeCount < MAX_PRIZES_PER_AGENT);
              return (
                <motion.div 
                  key={p.key} 
                  className={classNames("flex items-center justify-between border rounded-xl px-3 py-2", neonBox(theme))}
                        initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.15, ease: "easeOut" }}
                  whileHover={{ scale: can ? 1.02 : 1, x: can ? -4 : 0 }}
                        style={{ willChange: "auto" }}
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                    <div className="font-medium">{p.label}</div>
                      {isUnlimitedPrize && (
                        <span className="px-2 py-0.5 text-xs bg-emerald-500 text-white rounded-full font-semibold">
                          ∞ UNLIMITED
                        </span>
                      )}
                      <motion.button
                        className="text-xl"
                        onClick={(e) => {
                          e.stopPropagation();
                                haptic(20);
                          onToggleWishlist(p.key);
                        }}
                        whileHover={{ scale: 1.2 }}
                        whileTap={{ scale: 0.9 }}
                      >
                        {wishlist.includes(p.key) ? "⭐" : "☆"}
                      </motion.button>
                    </div>
                    <div className="text-xs opacity-70">{p.price.toLocaleString()} GCSD • Stock {left}</div>
                    {wishlist.includes(p.key) && balance < p.price && (
                      <div className="text-xs text-blue-500 mt-1">
                        🎯 {Math.ceil((p.price - balance) / 500)} Full Evals needed
                      </div>
                    )}
                  </div>
                  <motion.button 
                    disabled={!can} 
                    className={classNames("px-3 py-1.5 rounded-xl disabled:opacity-50", neonBtn(theme, true))} 
                          onClick={() => {
                            haptic([40, 20, 60]);
                            onRedeem(p.key);
                          }}
                    whileHover={can ? { scale: 1.05 } : {}}
                    whileTap={can ? { scale: 0.95 } : {}}
                  >
                    <Gift className="w-4 h-4 inline mr-1" /> Redeem
                  </motion.button>
                </motion.div>
              );
            })}
            </div>
            {/* Fade effect at bottom */}
            <div className="absolute bottom-0 left-0 right-2 h-8 bg-gradient-to-t from-slate-50 to-transparent dark:from-slate-900 pointer-events-none"></div>
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
          </motion.div>
        )}

        {agentTab === "purchases" && (
          <motion.div
            key="purchases"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
          >
            <div className={classNames("rounded-2xl border p-4 shadow-sm", neonBox(theme))}>
              <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
                <Gift className="w-6 h-6" />
                My Purchases
              </h3>
              
              {redeemedPrizes.length === 0 ? (
                <div className="text-center py-12 opacity-70">
                  <Gift className="w-16 h-16 mx-auto mb-4 opacity-30" />
                  <p>No purchases yet</p>
                  <p className="text-sm mt-2">Start redeeming prizes to see them here!</p>
    </div>
              ) : (
                <>
                  <div className="mb-3 p-3 rounded-xl bg-blue-500/10 border border-blue-500/30">
                    <p className="text-sm opacity-80">
                      💡 <strong>Meme Generator:</strong> Each purchase allows creating ONE meme. Buy again to create more!
                    </p>
                  </div>
                <div className="space-y-3">
                  {redeemedPrizes.map((t, i) => {
                    const prizeLabel = t.meta?.prizeLabel || t.memo?.replace("Redeem: ", "") || "Prize";
                    const prizeKey = t.meta?.prizeKey;
                    const receiptId = t.meta?.receiptId || "N/A";
                    const date = new Date(t.dateISO);
                    const isMeme = prizeKey === "meme_generator";
                    const memeData = t.meta?.memeData as { topText: string; bottomText: string; uploadedImage: string | null; textColor?: string; fontSize?: number } | undefined;

                    return (
                      <motion.div
                        key={t.id}
                        className={classNames("border rounded-xl p-4", neonBox(theme))}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.15, ease: "easeOut" }}
                        whileHover={{ scale: 1.01 }}
                        style={{ willChange: "auto" }}
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-2">
                              <h4 className="font-semibold text-lg">{prizeLabel}</h4>
                              {isMeme && !memeData && (
                                <span className="px-2 py-0.5 text-xs bg-purple-500 text-white rounded-full font-semibold">
                                  🎨 MEME
                                </span>
                              )}
                              {isMeme && memeData && (
                                <span className="px-2 py-0.5 text-xs bg-emerald-500 text-white rounded-full font-semibold">
                                  ✅ CREATED
                                </span>
                              )}
                            </div>
                            <div className="text-sm opacity-70 space-y-1">
                              <div className="flex items-center gap-2">
                                <span className="font-medium">Receipt:</span>
                                <code className="px-2 py-0.5 bg-black/10 dark:bg-white/10 rounded">{receiptId}</code>
                              </div>
                              <div><span className="font-medium">Date:</span> {date.toLocaleString()}</div>
                              <div><span className="font-medium">Amount:</span> <span className="text-rose-500">−{t.amount.toLocaleString()} GCSD</span></div>
                            </div>
                          </div>
                          
                          <div className="flex flex-col gap-2">
                            <motion.button
                              className={classNames("px-4 py-2 rounded-xl font-semibold whitespace-nowrap", neonBtn(theme, true))}
                              onClick={() => {
                                haptic(30);
                                setSelectedReceipt({
                                  id: receiptId,
                                  when: date.toLocaleString(),
                                  buyer: name,
                                  item: prizeLabel,
                                  amount: t.amount
                                });
                              }}
                              whileHover={{ scale: 1.05 }}
                              whileTap={{ scale: 0.95 }}
                            >
                              📄 View Receipt
                            </motion.button>
                            
                            {isMeme && !memeData && (
                              <motion.button
                                className={classNames("px-4 py-2 rounded-xl font-semibold whitespace-nowrap", neonBtn(theme))}
                                onClick={() => {
                                  haptic([30, 20, 40]);
                                  onOpenMeme(t);
                                }}
                                whileHover={{ scale: 1.05 }}
                                whileTap={{ scale: 0.95 }}
                              >
                                🎨 Create Meme
                              </motion.button>
                            )}
                            
                            {isMeme && memeData && (
                              <motion.button
                                className={classNames("px-4 py-2 rounded-xl font-semibold whitespace-nowrap", neonBtn(theme))}
                                onClick={() => {
                                  haptic(30);
                                  onOpenMeme(t);
                                }}
                                whileHover={{ scale: 1.05 }}
                                whileTap={{ scale: 0.95 }}
                              >
                                👁️ View Meme
                              </motion.button>
                            )}
                          </div>
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      
      {/* Avatar Cropper Modal */}
      <AnimatePresence>
        {showAvatarCropper && avatarImageSrc && (
          <AvatarCropperModal
            imageSrc={avatarImageSrc}
            theme={theme}
            onSave={saveAvatar}
            onClose={() => {
              setShowAvatarCropper(false);
              setAvatarImageSrc(null);
            }}
          />
        )}
      </AnimatePresence>
      
      
      {/* Receipt Modal */}
      <AnimatePresence>
        {selectedReceipt && (
          <ReceiptModal
            receipt={selectedReceipt}
            theme={theme}
            onClose={() => setSelectedReceipt(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

/** Avatar Cropper Modal */
function AvatarCropperModal({ 
  imageSrc, 
  theme, 
  onSave, 
  onClose 
}: { 
  imageSrc: string; 
  theme: Theme; 
  onSave: (croppedImage: string) => void; 
  onClose: () => void;
}) {
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [imageLoaded, setImageLoaded] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  
  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      console.log("Image loaded successfully", img.width, "x", img.height);
      imageRef.current = img;
      setImageLoaded(true);
    };
    img.onerror = () => {
      console.error("Failed to load image");
      toast.error("Failed to load image");
    };
    img.src = imageSrc;
  }, [imageSrc]);

  const handleCrop = () => {
    console.log("handleCrop called");
    
    if (!imageRef.current) {
      console.error("Image not loaded");
      toast.error("Image not loaded yet, please wait...");
      return;
    }
    
    if (!canvasRef.current) {
      console.error("Canvas ref not available");
      toast.error("Canvas error");
      return;
    }
    
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      console.error("Could not get canvas context");
      toast.error("Canvas error");
      return;
    }

    const img = imageRef.current;
    console.log("Image dimensions:", img.width, "x", img.height);
    console.log("Scale:", scale, "Position:", position);

    // Set canvas to 300x300 for high quality avatar
    const size = 300;
    canvas.width = size;
    canvas.height = size;

    // Clear canvas
    ctx.clearRect(0, 0, size, size);
    
    // Create circular clipping path
    ctx.save();
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();

    // Calculate dimensions to cover the circle (not contain)
    const imgAspect = img.width / img.height;
    let drawWidth, drawHeight;
    
    // Always cover the canvas
    if (imgAspect > 1) {
      // Landscape - make height = size, width proportional
      drawHeight = size;
      drawWidth = size * imgAspect;
    } else {
      // Portrait or square - make width = size, height proportional  
      drawWidth = size;
      drawHeight = size / imgAspect;
    }
    
    // Apply user scale
    drawWidth *= scale;
    drawHeight *= scale;
    
    // Center and apply position offset
    const x = (size - drawWidth) / 2 + (position.x * 2);
    const y = (size - drawHeight) / 2 + (position.y * 2);

    console.log("Drawing at:", x, y, "with size:", drawWidth, "x", drawHeight);

    // Draw image
    ctx.drawImage(img, x, y, drawWidth, drawHeight);
    
    ctx.restore();

    // Get the cropped image as data URL
    const croppedImageUrl = canvas.toDataURL('image/jpeg', 0.92);
    
    console.log("✅ Cropped image created!");
    console.log("URL length:", croppedImageUrl.length);
    console.log("First 100 chars:", croppedImageUrl.substring(0, 100));
    
    if (croppedImageUrl.length < 100) {
      toast.error("Failed to create image");
      return;
    }
    
    console.log("Calling onSave with cropped image...");
    onSave(croppedImageUrl);
  };

  return (
    <motion.div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{ 
        backdropFilter: 'blur(12px)', 
        WebkitBackdropFilter: 'blur(12px)',
        backgroundColor: 'rgba(0, 0, 0, 0.5)'
      }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        className={classNames("glass-card rounded-3xl shadow-2xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto", neonBox(theme))}
        initial={{ scale: 0.9, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.9, opacity: 0, y: 20 }}
        transition={{ type: "spring", stiffness: 300, damping: 30 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold">📸 Crop Profile Picture</h2>
          <button onClick={onClose} className="text-2xl opacity-60 hover:opacity-100">×</button>
        </div>
        
        <div className="text-sm opacity-70 mb-4">
          Adjust the position and zoom to frame your photo perfectly. It will appear as a circle.
        </div>

        {/* Preview Area */}
        <div className="mb-4 grid gap-4">
          {/* Main editing view */}
          <div>
          <div className="relative w-full aspect-square rounded-xl overflow-hidden border-4 border-dashed border-purple-400/50 bg-black/10">
            {!imageLoaded && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="text-center">
                  <div className="text-4xl mb-2">⏳</div>
                  <div className="text-sm opacity-70">Loading image...</div>
                </div>
              </div>
            )}
            {imageLoaded && (
              <>
                <div 
                  className="absolute inset-0 flex items-center justify-center"
                  style={{
                    transform: `translate(${position.x}px, ${position.y}px)`
                  }}
                >
                  <img
                    src={imageSrc}
                    alt="Preview"
                    className="max-w-full max-h-full object-contain"
                    style={{
                      transform: `scale(${scale})`,
                      transformOrigin: 'center'
                    }}
                    draggable={false}
                  />
                </div>
                {/* Circular mask overlay */}
                <div className="absolute inset-0 pointer-events-none">
                  <svg viewBox="0 0 100 100" className="w-full h-full">
                    <defs>
                      <mask id="circle-mask">
                        <rect width="100" height="100" fill="white"/>
                        <circle cx="50" cy="50" r="45" fill="black"/>
                      </mask>
                    </defs>
                    <rect width="100" height="100" fill="rgba(0,0,0,0.6)" mask="url(#circle-mask)"/>
                    <circle cx="50" cy="50" r="45" fill="none" stroke="white" strokeWidth="0.5" strokeDasharray="2,2"/>
                  </svg>
                </div>
              </>
            )}
          </div>
          <p className="text-xs opacity-70 mt-2 text-center">Drag sliders below to adjust • Circle shows cropped area</p>
          </div>
          
          {/* Final Preview Circle */}
          {imageLoaded && (
            <div className="flex items-center justify-center">
              <div className="text-center">
                <p className="text-xs font-semibold mb-2">Final Preview:</p>
                <div className="w-24 h-24 rounded-full overflow-hidden border-4 border-purple-400 shadow-xl mx-auto bg-black/10">
                  <div 
                    className="w-full h-full flex items-center justify-center"
                    style={{
                      transform: `translate(${position.x * 0.24}px, ${position.y * 0.24}px)`
                    }}
                  >
                    <img
                      src={imageSrc}
                      alt="Final preview"
                      className="min-w-full min-h-full object-cover"
                      style={{
                        transform: `scale(${scale})`,
                        transformOrigin: 'center'
                      }}
                    />
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Controls */}
        <div className="space-y-4 mb-4">
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-semibold">🔍 Zoom: {Math.round(scale * 100)}%</label>
              <motion.button
                className={classNames("text-xs px-2 py-1 rounded", neonBtn(theme))}
                onClick={() => {
                  setScale(1);
                  setPosition({ x: 0, y: 0 });
                  haptic(20);
                  toast.success("Reset to center");
                }}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
              >
                ↺ Reset
              </motion.button>
            </div>
            <input
              type="range"
              min="0.5"
              max="3"
              step="0.05"
              value={scale}
              onChange={(e) => setScale(Number(e.target.value))}
              className="w-full"
            />
            <div className="flex justify-between text-xs opacity-60 mt-1">
              <span>50%</span>
              <span>300%</span>
            </div>
          </div>
          
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-semibold mb-2 block">↔️ Horizontal</label>
              <input
                type="range"
                min="-100"
                max="100"
                value={position.x}
                onChange={(e) => setPosition(prev => ({ ...prev, x: Number(e.target.value) }))}
                className="w-full"
              />
            </div>
            <div>
              <label className="text-sm font-semibold mb-2 block">↕️ Vertical</label>
              <input
                type="range"
                min="-100"
                max="100"
                value={position.y}
                onChange={(e) => setPosition(prev => ({ ...prev, y: Number(e.target.value) }))}
                className="w-full"
              />
            </div>
          </div>
        </div>

        {/* Hidden canvas for cropping */}
        <canvas ref={canvasRef} className="hidden" />

        {/* Actions */}
        <div className="flex gap-3">
          <button
            type="button"
            disabled={!imageLoaded}
            className={classNames(
              "flex-1 px-4 py-3 rounded-xl font-semibold transition-transform active:scale-95 hover:scale-102",
              neonBtn(theme, true),
              !imageLoaded && "opacity-50 cursor-not-allowed"
            )}
            onClick={(e) => {
              console.log("🟢 Button clicked event fired!");
              e.preventDefault();
              e.stopPropagation();
              if (!imageLoaded) {
                console.log("⚠️ Image not loaded yet");
                toast.error("Please wait for image to load");
                return;
              }
              console.log("🟢 Calling handleCrop...");
              haptic([30, 20, 30]);
              handleCrop();
            }}
          >
            {imageLoaded ? "✅ Save Picture" : "⏳ Loading..."}
          </button>
          <motion.button
            className={classNames("px-4 py-3 rounded-xl", neonBtn(theme))}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              haptic(20);
              onClose();
            }}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            Cancel
          </motion.button>
        </div>
      </motion.div>
    </motion.div>
  );
}

/** Receipt Modal Component */
function ReceiptModal({ receipt, theme, onClose }: { receipt: { id: string; when: string; buyer: string; item: string; amount: number }; theme: Theme; onClose: () => void }) {
  return (
    <motion.div
      className="fixed inset-0 z-50 glass grid place-items-center"
      style={{ backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)' }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        className={classNames("glass-card rounded-3xl shadow-2xl p-8 w-[min(500px,90vw)]", neonBox(theme))}
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="text-center mb-6">
          <div className="text-4xl mb-3">🧾</div>
          <h2 className="text-2xl font-bold mb-1">{APP_NAME}</h2>
          <p className="text-sm opacity-70">Purchase Receipt</p>
        </div>

        {/* Receipt Details */}
        <div className="space-y-4 mb-6">
          <div className="border-b border-dashed pb-3">
            <div className="flex justify-between items-center">
              <span className="text-sm opacity-70">Receipt ID</span>
              <code className="font-mono font-semibold">{receipt.id}</code>
            </div>
          </div>

          <div className="border-b border-dashed pb-3">
            <div className="flex justify-between items-center">
              <span className="text-sm opacity-70">Date & Time</span>
              <span className="font-medium">{receipt.when}</span>
            </div>
          </div>

          <div className="border-b border-dashed pb-3">
            <div className="flex justify-between items-center">
              <span className="text-sm opacity-70">Customer</span>
              <span className="font-medium">{receipt.buyer}</span>
            </div>
          </div>

          <div className="border-b border-dashed pb-3">
            <div className="flex justify-between items-center">
              <span className="text-sm opacity-70">Item</span>
              <span className="font-medium">{receipt.item}</span>
            </div>
          </div>

          <div className="pt-2">
            <div className="flex justify-between items-center text-lg">
              <span className="font-bold">Total Amount</span>
              <span className="font-bold text-rose-500">{receipt.amount.toLocaleString()} GCSD</span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="text-center text-xs opacity-50 mb-4">
          Thank you for your purchase! ✨
        </div>

        {/* Close Button */}
        <motion.button
          className={classNames("w-full px-4 py-3 rounded-xl font-semibold", neonBtn(theme, true))}
          onClick={onClose}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
        >
          Close
        </motion.button>
      </motion.div>
    </motion.div>
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
  goals,
  adminNotifs,
  redeemRequests,
  activeUsers,
  auditLogs,
  wishlist,
  onToggleWishlist,
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
  onBackupData,
  onResetMetric,
  onFreezeAgent,
  onUnfreezeAgent,
  onApproveRedeem,
  onRejectRedeem,
  onCleanupDuplicates,
  onEmergencyReset,
  onImportBackup,
  backups,
  autoBackupEnabled,
  onToggleAutoBackup,
  onRestoreBackup,
}: {
  theme: Theme;
  isAdmin: boolean;
  accounts: Account[];
  txns: Transaction[];
  stock: Record<string, number>;
  rules: ProductRule[];
  pins: Record<string, string>;
  epochs: Record<string, string>;
  goals: Record<string, number>;
  adminNotifs: AdminNotification[];
  redeemRequests: RedeemRequest[];
  activeUsers: Set<string>;
  auditLogs: AuditLog[];
  wishlist: Wishlist;
  onToggleWishlist: (agentId: string, prizeKey: string) => void;
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
  onBackupData: () => void;
  onResetMetric: (k: keyof MetricsEpoch) => void;
  onFreezeAgent: (agentId: string) => void;
  onUnfreezeAgent: (agentId: string) => void;
  onApproveRedeem: (requestId: string) => void;
  onRejectRedeem: (requestId: string) => void;
  backups: Backup[];
  autoBackupEnabled: boolean;
  onToggleAutoBackup: () => void;
  onRestoreBackup: (backupId: string) => void;
  onCleanupDuplicates: () => void;
  onEmergencyReset: () => void;
  onImportBackup: (event: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  const [adminTab, setAdminTab] = useState<"dashboard" | "addsale" | "transfer" | "corrections" | "history" | "users" | "notifications" | "goals" | "requests" | "audit" | "export">("dashboard");
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
    
    // Use the proper helper function to check if transaction has been undone
    return !G_isTransactionUndone(t, txns);
  });
  
  const agentRedeems = !agentId || !txns || txns.length === 0 ? [] : txns.filter((t)=> {
    if (t.kind !== "debit" || t.fromId !== agentId || !t.memo?.startsWith("Redeem:")) return false;
    
    // Use the proper helper function to check if redemption has been undone
    return !G_isTransactionUndone(t, txns);
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
          ["notifications", "🔔 Notifications"],
          ["goals", "🎯 Goals"],
          ["requests", "⏳ Requests"],
          ["audit", "📋 Audit Log"],
          ["export", "📥 Export Data"],
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
          className="grid gap-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3 }}
        >
          {/* Real-Time Stats */}
          <div className="grid md:grid-cols-4 gap-4">
            <motion.div 
              className={classNames("rounded-xl border p-4 text-center", neonBox(theme))}
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <div className="text-3xl font-bold text-emerald-500">{activeUsers.size}</div>
              <div className="text-xs opacity-70 mt-1">Active Users</div>
            </motion.div>
            
            <motion.div 
              className={classNames("rounded-xl border p-4 text-center", neonBox(theme))}
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05 }}
            >
              <div className="text-3xl font-bold text-blue-500">{redeemRequests.length}</div>
              <div className="text-xs opacity-70 mt-1">Pending Requests</div>
            </motion.div>
            
            <motion.div 
              className={classNames("rounded-xl border p-4 text-center", neonBox(theme))}
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
            >
              <div className="text-3xl font-bold text-orange-500">{accounts.filter(a => a.frozen).length}</div>
              <div className="text-xs opacity-70 mt-1">Frozen Accounts</div>
            </motion.div>
            
            <motion.div 
              className={classNames("rounded-xl border p-4 text-center", neonBox(theme))}
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 }}
            >
              <div className="text-3xl font-bold text-purple-500">{txns.filter(t => {
                const today = new Date();
                const txDate = new Date(t.dateISO);
                return txDate.toDateString() === today.toDateString();
              }).length}</div>
              <div className="text-xs opacity-70 mt-1">Transactions Today</div>
            </motion.div>
          </div>


          {/* Agent Balances with Freeze Controls */}
          <div className="grid md:grid-cols-3 gap-4">
          <motion.div 
            className={classNames("rounded-2xl border p-4", neonBox(theme))}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.1 }}
          >
              <div className="text-sm opacity-70 mb-2">Agent Status & Balances</div>
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
                        className={classNames(
                          "border rounded-xl px-3 py-2",
                          a.frozen ? "bg-red-500/10 border-red-500/30" : neonBox(theme)
                        )}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      whileHover={{ scale: 1.01, x: 2 }}
                    >
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-2">
                            {a.frozen && <span className="text-xs px-1.5 py-0.5 rounded bg-red-500 text-white">🔒 FROZEN</span>}
                      <div className="font-medium">{a.name}</div>
                          </div>
                      <div className="text-sm font-semibold">{bal.toLocaleString()} GCSD</div>
                        </div>
                        <div className="flex gap-1 mt-2">
                          {a.frozen ? (
                            <button
                              className="text-xs px-2 py-1 rounded bg-emerald-500 text-white hover:bg-emerald-600"
                              onClick={() => onUnfreezeAgent(a.id)}
                            >
                              ✓ Unfreeze
                            </button>
                          ) : (
                            <button
                              className="text-xs px-2 py-1 rounded bg-orange-500 text-white hover:bg-orange-600"
                              onClick={() => onFreezeAgent(a.id)}
                            >
                              ❄️ Freeze
                            </button>
                          )}
                        </div>
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
                  transition={{ duration: 0.15, ease: "easeOut" }}
                  whileHover={{ scale: 1.01, x: -2 }}
                  style={{ willChange: "auto" }}
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
          </div>
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
                      transition={{ duration: 0.12, ease: "easeOut" }}
                      style={{ willChange: "auto" }}
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
                        transition={{ duration: 0.12, ease: "easeOut" }}
                      style={{ willChange: "auto" }}
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
                      transition={{ duration: 0.12, ease: "easeOut" }}
                      style={{ willChange: "auto" }}
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

      {/* Notifications Tab */}
      {adminTab === "notifications" && (
        <motion.div
          className={classNames("rounded-2xl border p-6", neonBox(theme))}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold">Admin Notifications</h3>
            <div className="text-sm opacity-70">{adminNotifs.length} total</div>
          </div>
          
          <div className="space-y-2 max-h-[600px] overflow-auto pr-2">
            {adminNotifs.slice(0, 50).reverse().map((notif, i) => (
              <motion.div
                key={notif.id}
                className={classNames(
                  "p-3 rounded-xl border",
                  notif.type === "redeem_request" ? "bg-yellow-500/10 border-yellow-500/30" :
                  notif.type === "credit" ? "bg-emerald-500/10 border-emerald-500/30" :
                  notif.type === "debit" ? "bg-rose-500/10 border-rose-500/30" :
                  "bg-blue-500/10 border-blue-500/30"
                )}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.02 }}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium">{notif.text}</div>
                    <div className="text-xs opacity-70 mt-1">{new Date(notif.when).toLocaleString()}</div>
                  </div>
                  {notif.amount && (
                    <div className={classNames("text-sm font-bold", notif.type === "credit" ? "text-emerald-500" : "text-rose-500")}>
                      {notif.type === "credit" ? "+" : "-"}{notif.amount.toLocaleString()} GCSD
                    </div>
                  )}
                </div>
              </motion.div>
            ))}
            {adminNotifs.length === 0 && (
              <div className="text-center py-8 opacity-70">No notifications yet</div>
            )}
          </div>
        </motion.div>
      )}

      {/* Goals Dashboard Tab */}
      {adminTab === "goals" && (
        <motion.div
          className={classNames("rounded-2xl border p-6", neonBox(theme))}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          <h3 className="text-lg font-semibold mb-4">Agent Goals Dashboard</h3>
          
          <div className="space-y-3">
            {accounts
              .filter(a => a.role === "agent")
              .map((agent, i) => {
                const balance = txns.reduce((s, t) => {
                  if (t.toId === agent.id && t.kind === "credit") s += t.amount;
                  if (t.fromId === agent.id && t.kind === "debit") s -= t.amount;
                  return s;
                }, 0);
                const goal = goals[agent.id] || 0;
                const progress = goal > 0 ? Math.min(100, Math.round((balance / goal) * 100)) : 0;
                
                return (
                  <motion.div
                    key={agent.id}
                    className="glass-card rounded-xl p-4"
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.05 }}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Avatar name={agent.name} size="sm" theme={theme} />
                        <div className="font-medium">{agent.name}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm opacity-70">Balance: {balance.toLocaleString()} GCSD</div>
                        {goal > 0 && <div className="text-xs opacity-60">Goal: {goal.toLocaleString()} GCSD</div>}
                      </div>
                    </div>
                    
                    {goal > 0 ? (
                      <>
                        <div className="h-3 rounded-full bg-black/10 dark:bg-white/10 overflow-hidden mb-2">
                          <div
                            className={classNames(
                              "h-3 rounded-full transition-all",
                              progress >= 100 ? "bg-emerald-500" : progress >= 75 ? "bg-yellow-500" : "bg-blue-500"
                            )}
                            style={{ width: `${progress}%` }}
                          />
                        </div>
                        <div className="flex items-center justify-between text-xs">
                          <span className={progress >= 100 ? "text-emerald-500 font-medium" : "opacity-70"}>
                            {progress >= 100 ? "✓ Goal Achieved!" : `${progress}% Complete`}
                          </span>
                          {progress < 100 && (
                            <span className="opacity-60">
                              {Math.ceil((goal - balance) / 500)} Full Evals needed
                            </span>
                          )}
                        </div>
                      </>
                    ) : (
                      <div className="text-sm opacity-60 text-center py-2">No goal set</div>
                    )}
                  </motion.div>
                );
              })}
          </div>
        </motion.div>
      )}

      {/* Redeem Requests Tab */}
      {adminTab === "requests" && (
        <motion.div
          className={classNames("rounded-2xl border p-6", neonBox(theme))}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold">Pending Redeem Requests</h3>
            <div className={classNames(
              "text-sm font-medium px-3 py-1 rounded-lg",
              redeemRequests.length > 0 ? "bg-yellow-500/20 text-yellow-500" : "bg-gray-500/20"
            )}>
              {redeemRequests.length} pending
            </div>
          </div>
          
          <div className="space-y-3">
            {redeemRequests.map((req, i) => (
              <motion.div
                key={req.id}
                className="glass-card rounded-xl p-4"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: i * 0.05 }}
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Avatar name={req.agentName} size="sm" theme={theme} />
                    <div>
                      <div className="font-semibold">{req.agentName}</div>
                      <div className="text-xs opacity-70">{new Date(req.when).toLocaleString()}</div>
                    </div>
                  </div>
                  <div className="text-xs px-2 py-1 rounded-lg bg-emerald-500/20 text-emerald-500">
                    ✓ PIN Verified
                  </div>
                </div>
                
                <div className="mb-3">
                  <div className="text-lg font-semibold">{req.prizeLabel}</div>
                  <div className="text-sm opacity-70">{req.price.toLocaleString()} GCSD</div>
                </div>
                
                <div className="flex gap-2">
                  <motion.button
                    className={classNames("flex-1 px-4 py-2 rounded-xl bg-emerald-600 text-white hover:bg-emerald-700")}
                    onClick={() => onApproveRedeem(req.id)}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                  >
                    ✓ Approve & Complete
                  </motion.button>
                  <motion.button
                    className={classNames("flex-1 px-4 py-2 rounded-xl bg-rose-600 text-white hover:bg-rose-700")}
                    onClick={() => onRejectRedeem(req.id)}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                  >
                    ✗ Reject
                  </motion.button>
                </div>
              </motion.div>
            ))}
            {redeemRequests.length === 0 && (
              <div className="text-center py-12 opacity-70">
                <div className="text-4xl mb-2">✅</div>
                <div className="text-sm">No pending requests</div>
              </div>
            )}
          </div>
        </motion.div>
      )}

      {/* Audit Log Tab */}
      {adminTab === "audit" && (
        <motion.div
          className={classNames("rounded-2xl border p-6", neonBox(theme))}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold">📋 Admin Audit Log</h3>
            <div className="text-sm opacity-70">{auditLogs.length} total actions</div>
          </div>
          
          <div className="space-y-2 max-h-[600px] overflow-auto pr-2">
            {auditLogs.slice(0, 100).map((log, i) => (
              <motion.div
                key={log.id}
                className={classNames(
                  "p-3 rounded-xl border",
                  log.action.includes("Frozen") ? "bg-orange-500/10 border-orange-500/30" :
                  log.action.includes("Approved") ? "bg-emerald-500/10 border-emerald-500/30" :
                  log.action.includes("Rejected") ? "bg-rose-500/10 border-rose-500/30" :
                  "bg-blue-500/10 border-blue-500/30"
                )}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.01 }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <div className="text-sm font-semibold">{log.action}</div>
                      {log.agentName && (
                        <div className="text-xs px-2 py-0.5 rounded bg-white/10">
                          {log.agentName}
                        </div>
                      )}
                    </div>
                    <div className="text-xs opacity-70">{log.details}</div>
                    <div className="text-xs opacity-50 mt-1">
                      by {log.adminName} • {new Date(log.when).toLocaleString()}
                    </div>
                  </div>
                  {log.amount && (
                    <div className="text-sm font-bold whitespace-nowrap">
                      {log.amount.toLocaleString()} GCSD
                    </div>
                  )}
                </div>
              </motion.div>
            ))}
            {auditLogs.length === 0 && (
              <div className="text-center py-12 opacity-70">
                <div className="text-4xl mb-2">📋</div>
                <div className="text-sm">No audit logs yet</div>
              </div>
            )}
          </div>
        </motion.div>
      )}

      {/* Export Data Tab */}
      {adminTab === "export" && (
        <motion.div
          className={classNames("rounded-2xl border p-6", neonBox(theme))}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          <h3 className="text-lg font-semibold mb-4">📥 Export Data</h3>
          
          {/* Import Backup - RESTORE FROM FILE */}
          <motion.div 
            className="glass-card rounded-xl p-4 mb-6 border-2 border-blue-500/50 bg-blue-500/5"
            whileHover={{ scale: 1.02 }}
          >
            <h4 className="font-semibold mb-2 text-blue-500">📂 Import Backup File</h4>
            <p className="text-sm opacity-70 mb-3">
              Restore from a previously downloaded backup JSON file
            </p>
            <label className="w-full px-4 py-3 rounded-xl bg-blue-500 text-white hover:bg-blue-600 font-semibold cursor-pointer block text-center transition-colors">
              📂 Choose Backup File to Restore
              <input
                type="file"
                accept=".json"
                onChange={onImportBackup}
                className="hidden"
              />
            </label>
            <div className="text-xs opacity-60 mt-2 text-center">
              Select your backup JSON file from 11:20 or any other backup
            </div>
          </motion.div>
          
          {/* Cleanup Duplicates - ONE-TIME FIX */}
          <motion.div 
            className="glass-card rounded-xl p-4 mb-6 border-2 border-orange-500/50 bg-orange-500/5"
            whileHover={{ scale: 1.02 }}
          >
            <h4 className="font-semibold mb-2 text-orange-500">🧹 Clean Up Duplicates</h4>
            <p className="text-sm opacity-70 mb-3">Remove duplicate agents and restore clean data (one-time fix)</p>
            <motion.button
              className="w-full px-4 py-3 rounded-xl bg-orange-500 text-white hover:bg-orange-600 font-semibold"
              onClick={onCleanupDuplicates}
              whileTap={{ scale: 0.95 }}
            >
              🧹 Remove Duplicate Agents
            </motion.button>
            <div className="text-xs opacity-60 mt-2 text-center">
              This will keep the first occurrence of each agent and remove duplicates
            </div>
          </motion.div>
          
          {/* Complete System Backup */}
          <motion.div 
            className="glass-card rounded-xl p-4 mb-6 border-2 border-emerald-500/50 bg-emerald-500/5"
            whileHover={{ scale: 1.02 }}
          >
            <h4 className="font-semibold mb-2 text-emerald-500">💾 Complete System Backup</h4>
            <p className="text-sm opacity-70 mb-3">Download ALL data: accounts, transactions, pins, goals, notifications, audit logs, and more</p>
            <motion.button
              className="w-full px-4 py-3 rounded-xl bg-emerald-500 text-white hover:bg-emerald-600 font-semibold"
              onClick={onBackupData}
              whileTap={{ scale: 0.95 }}
            >
              💾 Download Complete Backup
            </motion.button>
            <div className="text-xs opacity-60 mt-2 text-center">
              This creates a JSON file with everything - use for disaster recovery
            </div>
          </motion.div>
          
          {/* Auto-Backup Settings & History */}
          <motion.div 
            className="glass-card rounded-xl p-4 mb-6"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
          >
            <div className="flex items-center justify-between mb-4">
              <div>
                <h4 className="font-semibold mb-1">🔄 Auto-Backup System</h4>
                <p className="text-xs opacity-70">Automatically backup every 6 hours</p>
              </div>
              <motion.button
                className={classNames(
                  "px-4 py-2 rounded-xl font-semibold transition-colors",
                  autoBackupEnabled 
                    ? "bg-emerald-500 text-white" 
                    : "bg-gray-500 text-white opacity-50"
                )}
                onClick={onToggleAutoBackup}
                whileTap={{ scale: 0.95 }}
              >
                {autoBackupEnabled ? "✅ Enabled" : "❌ Disabled"}
              </motion.button>
            </div>
            
            <div className="border-t pt-4 mt-4">
              <h4 className="font-semibold mb-3 flex items-center gap-2">
                <History className="w-4 h-4" />
                Backup History (Point-in-Time Restore)
              </h4>
              
              {backups.length === 0 ? (
                <div className="text-center py-6 opacity-60">
                  <p className="text-sm">No backups yet</p>
                  <p className="text-xs mt-1">Create a manual backup or wait for auto-backup</p>
                </div>
              ) : (
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {backups.map((backup, idx) => (
                    <motion.div
                      key={backup.id}
                      className="flex items-center justify-between p-3 rounded-lg bg-black/5 dark:bg-white/5 border"
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: idx * 0.05 }}
                    >
                      <div className="flex-1">
                        <div className="font-medium text-sm">{backup.label}</div>
                        <div className="text-xs opacity-60">
                          {new Date(backup.timestamp).toLocaleString()}
                        </div>
                        <div className="text-xs opacity-50 mt-1">
                          {backup.data.accounts.length} accounts • {backup.data.txns.length} transactions
                        </div>
                      </div>
                      <motion.button
                        className={classNames(
                          "px-3 py-1.5 rounded-lg text-xs font-semibold",
                          neonBtn(theme, true)
                        )}
                        onClick={() => onRestoreBackup(backup.id)}
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                      >
                        ⏮️ Restore
                      </motion.button>
                    </motion.div>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
          
          <div className="grid md:grid-cols-2 gap-4">
            <motion.div 
              className="glass-card rounded-xl p-4"
              whileHover={{ scale: 1.02 }}
            >
              <h4 className="font-semibold mb-2">💰 Transactions</h4>
              <p className="text-sm opacity-70 mb-3">Export all transactions (credits & debits)</p>
              <motion.button
                className={classNames("w-full px-4 py-2 rounded-xl", neonBtn(theme, true))}
                onClick={() => {
                  const csv = [
                    ["Date", "Type", "Agent", "Amount", "Memo", "ID"],
                    ...txns.map(t => [
                      new Date(t.dateISO).toLocaleString(),
                      t.kind,
                      t.toId ? accounts.find(a => a.id === (t.toId || t.fromId))?.name || "—" : accounts.find(a => a.id === t.fromId)?.name || "—",
                      t.amount,
                      t.memo || "",
                      t.id
                    ])
                  ].map(row => row.join(",")).join("\\n");
                  
                  const blob = new Blob([csv], { type: "text/csv" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `gcsd-transactions-${new Date().toISOString().split("T")[0]}.csv`;
                  a.click();
                  toast.success("Transactions exported!");
                }}
                whileTap={{ scale: 0.95 }}
              >
                Download CSV
              </motion.button>
            </motion.div>

            <motion.div 
              className="glass-card rounded-xl p-4"
              whileHover={{ scale: 1.02 }}
            >
              <h4 className="font-semibold mb-2">👥 Agent Balances</h4>
              <p className="text-sm opacity-70 mb-3">Current balance for all agents</p>
              <motion.button
                className={classNames("w-full px-4 py-2 rounded-xl", neonBtn(theme, true))}
                onClick={() => {
                  const balances = accounts.filter(a => a.role === "agent").map(a => {
                    const bal = txns.reduce((s, t) => {
                      if (t.toId === a.id && t.kind === "credit") s += t.amount;
                      if (t.fromId === a.id && t.kind === "debit") s -= t.amount;
                      return s;
                    }, 0);
                    return [a.name, bal, a.frozen ? "Frozen" : "Active"];
                  });
                  
                  const csv = [
                    ["Agent", "Balance", "Status"],
                    ...balances
                  ].map(row => row.join(",")).join("\\n");
                  
                  const blob = new Blob([csv], { type: "text/csv" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `gcsd-balances-${new Date().toISOString().split("T")[0]}.csv`;
                  a.click();
                  toast.success("Balances exported!");
                }}
                whileTap={{ scale: 0.95 }}
              >
                Download CSV
              </motion.button>
            </motion.div>

            <motion.div 
              className="glass-card rounded-xl p-4"
              whileHover={{ scale: 1.02 }}
            >
              <h4 className="font-semibold mb-2">📋 Audit Log</h4>
              <p className="text-sm opacity-70 mb-3">Complete admin action history</p>
              <motion.button
                className={classNames("w-full px-4 py-2 rounded-xl", neonBtn(theme, true))}
                onClick={() => {
                  const csv = [
                    ["Date", "Admin", "Action", "Details", "Agent", "Amount"],
                    ...auditLogs.map(log => [
                      new Date(log.when).toLocaleString(),
                      log.adminName,
                      log.action,
                      log.details,
                      log.agentName || "",
                      log.amount || ""
                    ])
                  ].map(row => row.join(",")).join("\\n");
                  
                  const blob = new Blob([csv], { type: "text/csv" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `gcsd-audit-log-${new Date().toISOString().split("T")[0]}.csv`;
                  a.click();
                  toast.success("Audit log exported!");
                }}
                whileTap={{ scale: 0.95 }}
              >
                Download CSV
              </motion.button>
            </motion.div>

            <motion.div 
              className="glass-card rounded-xl p-4"
              whileHover={{ scale: 1.02 }}
            >
              <h4 className="font-semibold mb-2">🎯 Goals</h4>
              <p className="text-sm opacity-70 mb-3">Agent goals and progress</p>
              <motion.button
                className={classNames("w-full px-4 py-2 rounded-xl", neonBtn(theme, true))}
                onClick={() => {
                  const goalsData = accounts.filter(a => a.role === "agent").map(a => {
                    const bal = txns.reduce((s, t) => {
                      if (t.toId === a.id && t.kind === "credit") s += t.amount;
                      if (t.fromId === a.id && t.kind === "debit") s -= t.amount;
                      return s;
                    }, 0);
                    const goal = goals[a.id] || 0;
                    const progress = goal > 0 ? Math.round((bal / goal) * 100) : 0;
                    return [a.name, bal, goal, `${progress}%`];
                  });
                  
                  const csv = [
                    ["Agent", "Current Balance", "Goal", "Progress"],
                    ...goalsData
                  ].map(row => row.join(",")).join("\\n");
                  
                  const blob = new Blob([csv], { type: "text/csv" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `gcsd-goals-${new Date().toISOString().split("T")[0]}.csv`;
                  a.click();
                  toast.success("Goals exported!");
                }}
                whileTap={{ scale: 0.95 }}
              >
                Download CSV
              </motion.button>
            </motion.div>
          </div>
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
      style={{ backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.12 }}
      onClick={onClose}
    >
      <motion.div 
        className={classNames("glass-card rounded-3xl shadow-xl p-4 sm:p-6 w-[min(780px,95vw)] max-h-[90vh] overflow-y-auto", neonBox(theme))}
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        transition={{ duration: 0.15, ease: "easeOut" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3 sm:mb-4">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4" />
            <h2 className="text-lg sm:text-xl font-semibold">Switch User</h2>
          </div>
          <button 
            className={classNames("p-2 rounded-lg glass-btn")}
            onClick={onClose}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 gap-2 max-h-[60vh] overflow-auto pr-1 sm:pr-2">
          <HoverCard theme={theme} onClick={onChooseAdmin} delay={0}>
            <div className="font-semibold flex items-center gap-2">
              <Lock className="w-4 h-4" /> Admin Portal
            </div>
            <div className="text-xs opacity-70 mt-1">PIN required</div>
          </HoverCard>

          {accounts
            .filter((a) => a.role !== "system")
            .map((a, index) => (
              <HoverCard key={a.id} theme={theme} onClick={() => { haptic(40); onChooseAgent(a.id); }} delay={0}>
                <div className="flex items-center gap-2 mb-1">
                  <Avatar name={a.name} size="sm" theme={theme} avatarUrl={a.avatar} />
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
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.12, ease: "easeOut" }}
              whileHover={{ scale: 1.01, x: 4 }}
              style={{ willChange: "auto" }}
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

/* ===== Confetti with haptic feedback ===== */
function confettiBurst() {
  haptic([50, 30, 100, 30, 50]); // Success pattern
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
