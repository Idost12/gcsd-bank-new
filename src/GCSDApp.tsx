
import React, { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { Plus, Wallet, Gift, History, Download, Upload, Sparkles, UserCircle2 } from "lucide-react";

type TxnKind = "credit" | "debit" | "transfer";
type Transaction = { id: string; kind: TxnKind; amount: number; memo?: string; dateISO: string; fromId?: string; toId?: string; };
type Account = { id: string; name: string; role?: string; balance: number };
type PrizeItem = { key: string; label: string; price: number };

const AGENT_NAMES = [
  "Ben Mills","Oliver Steele","Maya Graves","Stan Harris","Frank Collins","Michael Wilson",
  "Caitlyn Stone","Rebecca Brooks","Logan Noir","Christopher O'Connor","Viktor Parks",
  "Hope Marshall","Justin Frey","Kevin Nolan","Sofie Roy"
];

const PRIZE_ITEMS: PrizeItem[] = [
  { key: "flight_milan", label: "Flight to Milan", price: 11350 },
  { key: "flight_london", label: "Flight to London", price: 11350 },
  { key: "flight_madrid", label: "Flight to Madrid", price: 11350 },
  { key: "soundbar", label: "Soundbar", price: 2400 },
  { key: "airfryer", label: "Airfryer", price: 1600 },
  { key: "soda_maker", label: "Soda Maker", price: 900 },
  { key: "voucher", label: "Voucher", price: 600 },
  { key: "lunch", label: "Lunch", price: 180 },
  { key: "cinema_tickets", label: "Cinema Tickets (x2)", price: 160 },
];

const PRODUCT_RULES = [
  { key: "full_eval", label: "Full Evaluation", gcsd: 500 },
  { key: "partial_over_400", label: "Partial Evaluation (Over 400)", gcsd: 420 },
  { key: "whv_over_400", label: "Working Holiday Visa (Over 400)", gcsd: 380 },
  { key: "partial_under_400", label: "Partial Evaluation (Under 400)", gcsd: 320 },
  { key: "collection_over_400", label: "Collection (Over 400)", gcsd: 280 },
  { key: "whv_under_400", label: "Working Holiday Visa (Under 400)", gcsd: 200 },
  { key: "collection_under_400", label: "Collection (Under 400)", gcsd: 200 },
  { key: "student_visa", label: "Student Visa", gcsd: 150 },
  { key: "tourist_visa", label: "Tourist Visa", gcsd: 120 },
];

const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
const todayISO = () => new Date().toISOString();
const STORAGE_KEY = "gcsd-bank-v3";
const INTRO_SEEN_KEY = "gcsd-intro-v3";
const CURRENT_AGENT_KEY = "gcsd-current-agent-v3";

function computeBalances(accounts: Account[], txns: Transaction[]) {
  const map = new Map<string, number>(accounts.map(a => [a.id, a.balance]));
  for (const t of txns) {
    if (t.kind === "credit" && t.toId) map.set(t.toId, (map.get(t.toId)||0) + t.amount);
    if (t.kind === "debit" && t.fromId) map.set(t.fromId, (map.get(t.fromId)||0) - t.amount);
    if (t.kind === "transfer") {
      if (t.fromId) map.set(t.fromId, (map.get(t.fromId)||0) - t.amount);
      if (t.toId) map.set(t.toId, (map.get(t.toId)||0) + t.amount);
    }
  }
  return map;
}

function summarizeMonthly(txns: Transaction[]) {
  const byMonth = new Map<string, {credits:number;debits:number;transfers:number;volume:number}>();
  for (const t of txns) {
    const d = new Date(t.dateISO);
    const k = `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,"0")}`;
    const cur = byMonth.get(k) || {credits:0,debits:0,transfers:0,volume:0};
    if (t.kind==="credit") cur.credits+=t.amount;
    if (t.kind==="debit") cur.debits+=t.amount;
    if (t.kind==="transfer") cur.transfers+=t.amount;
    cur.volume+=t.amount;
    byMonth.set(k, cur);
  }
  return Array.from(byMonth, ([month, v]) => ({ month, ...v })).sort((a,b)=>a.month.localeCompare(b.month));
}

function loadState(){ try{const raw=localStorage.getItem(STORAGE_KEY); return raw?JSON.parse(raw):null;}catch{return null;} }
function saveState(state:any){ try{localStorage.setItem(STORAGE_KEY, JSON.stringify(state));}catch{} }

const seedAccounts: Account[] = [
  { id: uid(), name: "Bank Vault", role: "system", balance: 0 },
  ...AGENT_NAMES.map(n => ({ id: uid(), name: n, role: "agent", balance: 0 }))
];
const VAULT_ID = seedAccounts[0].id;
const seedTxns: Transaction[] = [
  { id: uid(), kind: "credit", amount: 8000, memo: "Initial mint", dateISO: todayISO(), toId: VAULT_ID }
];

export default function GCSDApp(){
  const persisted = typeof window !== "undefined" ? loadState() : null;
  const [accounts, setAccounts] = useState<Account[]>(persisted?.accounts || seedAccounts);
  const [txns, setTxns] = useState<Transaction[]>(persisted?.txns || seedTxns);
  const [tab, setTab] = useState<"overview"|"shop"|"activity">("overview");

  const [introSeen, setIntroSeen] = useState<boolean>(Boolean(localStorage.getItem(INTRO_SEEN_KEY)));
  const [currentAgentId, setCurrentAgentId] = useState<string>(localStorage.getItem(CURRENT_AGENT_KEY) || "");

  useEffect(()=>{ saveState({accounts, txns}); },[accounts, txns]);
  useEffect(()=>{ if(currentAgentId) localStorage.setItem(CURRENT_AGENT_KEY, currentAgentId); },[currentAgentId]);

  const balances = useMemo(()=>computeBalances(accounts, txns),[accounts, txns]);
  const monthly = useMemo(()=>summarizeMonthly(txns),[txns]);

  function postTxn(partial: Partial<Transaction> & Pick<Transaction,"kind"|"amount">){
    const t: Transaction = { id: uid(), memo: "", dateISO: todayISO(), ...partial };
    setTxns(prev => [t, ...prev]);
  }
  function creditProduct(agentId:string, key:string){
    const rule = PRODUCT_RULES.find(r=>r.key===key); if(!rule) return;
    postTxn({ kind: "credit", amount: rule.gcsd, toId: agentId, memo: rule.label });
    toast.success(`Credited ${rule.gcsd} GCSD for ${rule.label}`);
  }
  function redeemPrize(agentId:string, prizeKey:string){
    const prize = PRIZE_ITEMS.find(p=>p.key===prizeKey); if(!prize) return;
    const bal = balances.get(agentId)||0;
    if(bal < prize.price) return toast.error("Insufficient balance");
    postTxn({ kind: "debit", amount: prize.price, fromId: agentId, memo: `Redeem: ${prize.label}` });
    toast.success(`Redeemed ${prize.label}`);
  }
  function mintToVault(amount:number){
    if(!amount || amount<=0) return toast.error("Enter amount");
    postTxn({ kind: "credit", amount, toId: VAULT_ID, memo: "Mint" });
  }

  const agent = accounts.find(a=>a.id===currentAgentId);
  const agentBalance = balances.get(currentAgentId)||0;
  const agentTxns = txns.filter(t=> t.fromId===currentAgentId || t.toId===currentAgentId);
  const lifetimeEarn = agentTxns.filter(t=> (t.kind==="credit" && t.toId===currentAgentId) || (t.kind==="transfer" && t.toId===currentAgentId)).reduce((a,b)=>a+b.amount,0);
  const lifetimeSpend = agentTxns.filter(t=> (t.kind==="debit" && t.fromId===currentAgentId) || (t.kind==="transfer" && t.fromId===currentAgentId)).reduce((a,b)=>a+b.amount,0);

  return (
    <div className="min-h-screen overflow-x-hidden bg-gradient-to-b from-slate-50 to-white">
      <AnimatePresence>
        {!introSeen && (
          <motion.div initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} className="fixed inset-0 z-50 grid place-items-center bg-black/80 text-white">
            <motion.div initial={{scale:0.9, y:20}} animate={{scale:1, y:0}} transition={{type:"spring", stiffness:120, damping:14}} className="text-center p-8 max-w-lg">
              <motion.div initial={{opacity:0, y:10}} animate={{opacity:1, y:0}} transition={{delay:0.1}} className="mx-auto mb-4 w-16 h-16 rounded-2xl bg-white/10 grid place-items-center">
                <Sparkles className="w-8 h-8"/>
              </motion.div>
              <h1 className="text-3xl font-bold mb-2">Welcome to GCSD Bank</h1>
              <p className="text-white/80 mb-6">Earn credits for sales. Redeem prizes. Smooth animations, instant joy.</p>
              <motion.button whileHover={{scale:1.03}} whileTap={{scale:0.97}} className="px-5 py-2 rounded-2xl bg-white text-black font-medium" onClick={()=>{ setIntroSeen(true); localStorage.setItem(INTRO_SEEN_KEY, "1"); }}>
                Enter
              </motion.button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

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
                  <motion.button key={a.id} initial={{opacity:0, y:6}} animate={{opacity:1, y:0}} transition={{delay:i*0.03}} whileHover={{y:-2}} whileTap={{scale:0.98}} onClick={()=>setCurrentAgentId(a.id)} className="border rounded-2xl px-3 py-2 text-left bg-white hover:bg-slate-50">
                    <div className="font-medium">{a.name}</div>
                    <div className="text-xs text-slate-500">Balance: {(balances.get(a.id)||0).toLocaleString()} GCSD</div>
                  </motion.button>
                ))}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="sticky top-0 z-10 backdrop-blur bg-white/70 border-b">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
          <motion.div layout className="flex items-center gap-3">
            <Sparkles className="w-5 h-5"/>
            <span className="font-semibold">GCSD Bank</span>
          </motion.div>
          <div className="flex items-center gap-2">
            <ImportExport accounts={accounts} txns={txns} setAll={(a,t)=>{setAccounts(a); setTxns(t);}} />
            <MintPanel onMint={mintToVault} />
            {currentAgentId && (
              <motion.button whileHover={{scale:1.03}} whileTap={{scale:0.97}} className="px-3 py-1.5 rounded-xl border bg-white" onClick={()=>setCurrentAgentId("")}>Switch agent</motion.button>
            )}
          </div>
        </div>
      </div>

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
                  <motion.button key={k} whileHover={{y:-2}} whileTap={{scale:0.98}} className={`px-3 py-1.5 rounded-xl border ${tab===k?"bg-black text-white":"bg-white"}`} onClick={()=>setTab(k)}>
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
                        <motion.span key={m.month} initial={{opacity:0, y:6}} animate={{opacity:1, y:0}} transition={{delay:i*0.03}} className="badge">{m.month}: {m.volume.toLocaleString()}</motion.span>
                      ))}
                    </div>
                  </div>
                </motion.div>
              )}

              {tab==="shop" && (
                <motion.div key="shop" initial={{opacity:0, y:8}} animate={{opacity:1, y:0}} exit={{opacity:0, y:-8}} className="grid sm:grid-cols-2 md:grid-cols-3 gap-3">
                  {PRIZE_ITEMS.map((p,i)=> {
                    const canBuy = agentBalance >= p.price;
                    return (
                      <motion.div key={p.key} initial={{opacity:0, y:10}} animate={{opacity:1, y:0}} transition={{delay:i*0.03}} className={`border rounded-2xl p-4 bg-white ${!canBuy?"opacity-60":""}`}>
                        <div className="font-medium mb-1">{p.label}</div>
                        <div className="text-sm text-slate-500 mb-3">{p.price.toLocaleString()} GCSD</div>
                        <motion.button whileHover={{scale: canBuy?1.03:1}} whileTap={{scale: canBuy?0.97:1}} disabled={!canBuy} onClick={()=>redeemPrize(currentAgentId, p.key)} className={`px-3 py-1.5 rounded-xl border ${canBuy?"bg-black text-white":"bg-white"}`}>
                          {canBuy?"Redeem":"Insufficient balance"}
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
                      <motion.div key={t.id} initial={{opacity:0, y:8}} animate={{opacity:1, y:0}} transition={{delay:i*0.02}} className="grid grid-cols-12 gap-2 items-center border rounded-xl p-3">
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
          <motion.div layout initial={{opacity:0, y:10}} animate={{opacity:1, y:0}} transition={{type:"spring", stiffness:120, damping:16}}>
            <div className="grid md:grid-cols-3 gap-4">
              <Tile icon={<Wallet/>} label="Total Circulating" value={`${Array.from(balances.values()).reduce((a,b)=>a+b,0).toLocaleString()} GCSD`} />
              <div className="card">
                <div className="text-sm text-slate-500 mb-1">Top Balances</div>
                <ul className="space-y-1 max-h-56 overflow-auto pr-1">
                  {[...accounts.filter(a=>a.role!=="system")]
                    .sort((a,b)=>(balances.get(b.id)||0)-(balances.get(a.id)||0)).slice(0,10)
                    .map(a=>(<li key={a.id} className="flex justify-between"><span>{a.name}</span><span className="font-medium">{(balances.get(a.id)||0).toLocaleString()} GCSD</span></li>))}
                </ul>
              </div>
              <div className="card">
                <div className="text-sm text-slate-500 mb-2">Monthly Volume</div>
                <div className="flex flex-wrap gap-2">
                  {monthly.map((m,i)=>(<motion.span key={m.month} initial={{opacity:0, y:6}} animate={{opacity:1, y:0}} transition={{delay:i*0.03}} className="badge">{m.month}: {m.volume.toLocaleString()}</motion.span>))}
                </div>
              </div>
            </div>
            <div className="mt-6 text-sm text-slate-600">Tip: click <b>Switch agent</b> (top-right) to enter the worker portal.</div>
          </motion.div>
        )}
      </div>
    </div>
  );
}

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
      <motion.button whileHover={{scale:1.03}} whileTap={{scale:0.97}} className="px-3 py-1.5 rounded-xl border bg-white" onClick={()=> onMint(amt)}><Plus className="w-4 h-4 mr-1 inline"/> Mint</motion.button>
    </div>
  );
}

function ImportExport({ accounts, txns, setAll }:{accounts:Account[], txns:Transaction[], setAll:(a:Account[], t:Transaction[])=>void}){
  function exportJSON(){
    const blob = new Blob([JSON.stringify({ accounts, txns }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob); const a = document.createElement("a");
    a.href = url; a.download = `gcsd-bank-${Date.now()}.json`; a.click(); URL.revokeObjectURL(url);
  }
  function onImportFile(e: React.ChangeEvent<HTMLInputElement>){
    const file = e.target.files?.[0]; if(!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try { const obj:any = JSON.parse(String(reader.result)); if(obj.accounts && obj.txns) setAll(obj.accounts, obj.txns); else toast.error("Invalid file"); }
      catch { toast.error("Failed to import"); }
    };
    reader.readAsText(file);
  }
  return (
    <div className="flex gap-2">
      <motion.button whileHover={{scale:1.03}} whileTap={{scale:0.97}} className="px-3 py-1.5 rounded-xl border bg-white" onClick={exportJSON}><Download className="w-4 h-4 mr-1 inline"/> Export</motion.button>
      <label className="px-3 py-1.5 rounded-xl border bg-white cursor-pointer">
        <Upload className="w-4 h-4 mr-1 inline"/> Import
        <input type="file" accept="application/json" className="hidden" onChange={onImportFile} />
      </label>
    </div>
  );
}
