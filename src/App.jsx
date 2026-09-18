import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  Users, Calendar, Wallet, MapPin, Settings as SettingsIcon, LogOut, Plus,
  Check, X, RotateCcw, Clock, Building2, ShieldCheck, ChevronRight, Search,
  Trash2, Edit2, ArrowLeft, TrendingUp, TrendingDown, AlertTriangle,
  CalendarCheck, UserCheck, Home, CreditCard, Phone, ChevronDown, Loader2,
  Navigation, CheckCircle2, XCircle, RefreshCcw, Gift, Briefcase, Award,
  MessageCircle, Snowflake, PlayCircle, PauseCircle, FileSpreadsheet,
  PlaneTakeoff, CalendarDays, CalendarClock, Download, Sparkles, BarChart3, Upload, Wrench
} from "lucide-react";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid
} from "recharts";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { supabase } from "./supabaseClient";

/* ============================= YARDIMCI FONKSİYONLAR ============================= */

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

function seedDB() {
  return {
    studio: { name: "Reformer Pilates Stüdyosu", address: "", lat: null, lng: null, radius: 150 },
    staff: [
      { id: uid(), name: "Kurucu Yönetici", role: "admin", pin: "1234", active: true, annualLeaveDays: 14 },
    ],
    members: [],
    packages: [],
    attendance: [],
    checkins: [],
    expenses: [],
    classes: [],
    leaveRecords: [],
    notes: [],
    deletionRequests: [],
    activityLog: [],
    taskDefinitions: [
      { id: uid(), name: "Üye Fotoğrafı Gönderimi" },
      { id: uid(), name: "Üye Videosu Gönderimi" },
    ],
    taskLogs: [],
    performanceNotes: [],
  };
}

function migrateDB(d) {
  if (!d.studio) d.studio = { name: "Reformer Pilates Stüdyosu", address: "", lat: null, lng: null, radius: 150 };
  if (!d.lastAutoBackup) d.lastAutoBackup = null;
  if (!Array.isArray(d.staff)) d.staff = [];
  if (!Array.isArray(d.members)) d.members = [];
  if (!Array.isArray(d.packages)) d.packages = [];
  if (!Array.isArray(d.attendance)) d.attendance = [];
  if (!Array.isArray(d.checkins)) d.checkins = [];
  if (!Array.isArray(d.expenses)) d.expenses = [];
  if (!d.classes) d.classes = [];
  d.classes.forEach((c) => {
    if (!c.roomId) c.roomId = "oda1";
    if (!c.serviceType) c.serviceType = "Reformer Pilates";
    if (!c.timeSlot) c.timeSlot = c.startTime && c.endTime ? `${c.startTime}-${c.endTime}` : TIME_SLOTS[0];
    if (!c.weekStart) c.weekStart = getMonday(todayISO());
  });
  if (!d.leaveRecords) d.leaveRecords = [];
  if (!d.notes) d.notes = [];
  if (!d.deletionRequests) d.deletionRequests = [];
  if (!Array.isArray(d.spotAlerts)) d.spotAlerts = [];
  if (!Array.isArray(d.prospects)) d.prospects = [];
  if (!Array.isArray(d.maintenanceTasks)) d.maintenanceTasks = [];
  if (!d.activityLog) d.activityLog = [];
  if (!d.taskDefinitions) d.taskDefinitions = [{ id: uid(), name: "Üye Fotoğrafı Gönderimi" }, { id: uid(), name: "Üye Videosu Gönderimi" }];
  if (!d.taskLogs) d.taskLogs = [];
  if (!d.performanceNotes) d.performanceNotes = [];
  d.staff.forEach((s) => { if (s.annualLeaveDays == null) s.annualLeaveDays = 14; });
  d.members.forEach((m) => {
    if (m.freeze === undefined) m.freeze = null;
    if (!m.freezeHistory) m.freezeHistory = [];
  });
  d.packages.forEach((p) => {
    if (!p.payments) {
      const legacyPrice = p.price != null ? Number(p.price) : 0;
      p.totalPrice = p.totalPrice != null ? Number(p.totalPrice) : legacyPrice;
      p.payments = legacyPrice > 0 ? [{ id: uid(), amount: legacyPrice, method: p.paymentMethod || "Nakit", date: p.purchaseDate }] : [];
    }
    if (!p.extras) p.extras = [];
    if (!p.serviceType) p.serviceType = "Reformer Pilates";
    else if (p.extras.length && typeof p.extras[0] === "object") {
      p.extras = p.extras.map((ex) => `${ex.name}${ex.duration ? ` (${ex.duration})` : ""}`);
    }
  });
  return d;
}
function paidAmount(pkg) {
  return (pkg.payments || []).reduce((s, p) => s + Number(p.amount || 0), 0);
}
function debtAmount(pkg) {
  return Math.max(Number(pkg.totalPrice || 0) - paidAmount(pkg), 0);
}
function logActivity(d, currentUser, description) {
  d.activityLog = d.activityLog || [];
  d.activityLog.push({ id: uid(), timestamp: new Date().toISOString(), actorId: currentUser.id, actorName: currentUser.name, description });
  if (d.activityLog.length > 500) d.activityLog = d.activityLog.slice(-500);
}

function showToast(message) {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("app-toast", { detail: message }));
}

function requestDeletion(mutate, currentUser, type, payload, description) {
  mutate((d) => {
    d.deletionRequests = d.deletionRequests || [];
    d.deletionRequests.push({ id: uid(), type, payload, description, requestedBy: currentUser.id, requestedByName: currentUser.name, createdAt: new Date().toISOString() });
    return d;
  });
  showToast("Silme talebi yöneticiye gönderildi, onay bekleniyor.");
}

// Bir derste yer açıldığında bekleme listesindeki üyeyi OTOMATİK almak yerine
// bir bildirim oluşturur — kadroya alma kararı personelde kalır.
function notifySpotOpened(d, classObj, members) {
  if (classObj.memberIds.length < classObj.capacity && classObj.waitlistIds.length > 0) {
    const waitingMember = members.find((m) => m.id === classObj.waitlistIds[0]);
    d.spotAlerts = d.spotAlerts || [];
    d.spotAlerts.push({
      id: uid(),
      classId: classObj.id,
      classTitle: classObj.title,
      dayOfWeek: classObj.dayOfWeek,
      timeSlot: classObj.timeSlot,
      waitlistMemberId: classObj.waitlistIds[0],
      waitlistMemberName: waitingMember?.name || "Bilinmeyen üye",
      createdAt: new Date().toISOString(),
    });
  }
}

function memberStatus(m, today) {
  const t = today || todayISO();
  if (m.freeze && t >= m.freeze.startDate && t <= m.freeze.endDate) return "frozen";
  if (!m.active) return "inactive";
  return "active";
}
const MEMBER_STATUS_META = {
  active: { label: "Aktif", color: "#3E6B52", bg: "#E7F0EA" },
  inactive: { label: "Pasif", color: "#8B8168", bg: "#EFE8D5" },
  frozen: { label: "Dondurulmuş", color: "#2F6F8F", bg: "#E4EEF2" },
};

async function loadDB() {
  try {
    const { data, error } = await supabase.from("app_state").select("data").eq("id", 1).single();
    if (error || !data) return null;
    return data.data;
  } catch (e) {
    return null;
  }
}
async function saveDB(db) {
  try {
    const { error } = await supabase.from("app_state").update({ data: db, updated_at: new Date().toISOString() }).eq("id", 1);
    if (error) throw error;
    return true;
  } catch (e) {
    console.error("Kayıt hatası", e);
    return false;
  }
}
async function attemptMutation(updater) {
  let latest = await loadDB();
  latest = latest ? migrateDB(latest) : seedDB();
  const draft = JSON.parse(JSON.stringify(latest));
  const next = updater(draft) || draft;
  const ok = await saveDB(next);
  return { ok, next };
}

function distanceMeters(lat1, lon1, lat2, lon2) {
  if ([lat1, lon1, lat2, lon2].some((v) => v === null || v === undefined || Number.isNaN(v))) return null;
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function fmtDate(d) {
  const date = typeof d === "string" ? new Date(d) : d;
  if (isNaN(date)) return "-";
  return date.toLocaleDateString("tr-TR", { day: "2-digit", month: "2-digit", year: "numeric" });
}
function fmtDateTime(d) {
  const date = typeof d === "string" ? new Date(d) : d;
  if (isNaN(date)) return "-";
  return date.toLocaleString("tr-TR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
function todayISO() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}
function fmtMoney(n) {
  return (Number(n) || 0).toLocaleString("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 });
}
function daysBetweenInclusive(start, end) {
  const s = new Date(start), e = new Date(end);
  return Math.round((e - s) / 86400000) + 1;
}
function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + n);
  const yy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}
function getMonday(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const jsDay = new Date(y, m - 1, d).getDay();
  const ourIndex = (jsDay + 6) % 7; // 0=Pazartesi
  return addDays(dateStr, -ourIndex);
}

const STATUS_META = {
  attended: { label: "Geldi", short: "Geldi", color: "#3E6B52", bg: "#E7F0EA" },
  burned: { label: "Gelmedi (Yandı)", short: "Yandı", color: "#B14A3A", bg: "#F7E7E2" },
  excused: { label: "Mazaretli İptal", short: "Mazaretli", color: "#A98330", bg: "#F5EDDA" },
  makeup: { label: "Telafi Seansı", short: "Telafi", color: "#2F6F8F", bg: "#E4EEF2" },
};

const WEEKDAYS = ["Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi", "Pazar"];

const ROOMS = [
  { id: "oda1", name: "Oda 1", capacity: 5, note: "5 Reformer" },
  { id: "oda2", name: "Oda 2", capacity: 2, note: "2 Reformer" },
  { id: "oda3", name: "Oda 3", capacity: 2, note: "2 Reformer" },
  { id: "oda4", name: "Oda 4", capacity: 1, note: "Masaj / Esnek Destek" },
];
const ROOM_COLORS = {
  oda1: { bg: "#E4EEF2", text: "#2F6F8F", solid: "#2F6F8F" },
  oda2: { bg: "#E7F0EA", text: "#3E6B52", solid: "#3E6B52" },
  oda3: { bg: "#F3E3DC", text: "#B96A4A", solid: "#B96A4A" },
  oda4: { bg: "#F5EDDA", text: "#A98330", solid: "#A98330" },
};
const SERVICE_TYPES = ["Reformer Pilates", "Masaj"];
const TIME_SLOTS = ["09:00-10:00", "10:00-11:00", "11:00-12:00", "12:30-13:30", "14:30-15:30", "16:30-17:30", "18:30-19:30"];
const SCHEDULE_DAYS = [0, 1, 2, 3, 4, 5];

const PROFESSION_LIST = [
  "Öğretmen", "Doktor", "Hemşire", "Avukat", "Eczacı", "Polis", "Mali Müşavir",
  "Mühendis", "Mimar", "Gazeteci", "Veteriner", "Bankacı", "Diğer",
];
const PROFESSION_DAYS = {
  "öğretmen": { month: 11, day: 24, label: "Öğretmenler Günü" },
  "doktor": { month: 3, day: 14, label: "Tıp Bayramı" },
  "hemşire": { month: 5, day: 12, label: "Hemşireler Günü" },
  "avukat": { month: 4, day: 5, label: "Avukatlar Günü" },
  "eczacı": { month: 9, day: 25, label: "Dünya Eczacılar Günü" },
  "polis": { month: 4, day: 10, label: "Polis Teşkilatı Kuruluş Yıldönümü" },
  "mali müşavir": { month: 6, day: 1, label: "Muhasebe ve Mali Müşavirler Günü" },
  "mühendis": { month: 3, day: 22, label: "Mühendislik ve Mimarlık Haftası" },
  "mimar": { month: 3, day: 22, label: "Mühendislik ve Mimarlık Haftası" },
  "gazeteci": { month: 1, day: 10, label: "Çalışan Gazeteciler Günü" },
  "veteriner": { month: 4, day: 26, label: "Dünya Veterinerlik Günü" },
  "bankacı": { month: 12, day: 1, label: "Bankacılık Günü" },
};
function matchProfessionDay(profession) {
  if (!profession) return null;
  const norm = profession.trim().toLowerCase();
  const found = Object.entries(PROFESSION_DAYS).find(([k]) => norm.includes(k));
  return found ? { key: found[0], ...found[1] } : null;
}
function isBirthdayToday(birthDate) {
  if (!birthDate) return false;
  const d = new Date(birthDate), t = new Date();
  return d.getDate() === t.getDate() && d.getMonth() === t.getMonth();
}
function isProfessionDayToday(profession) {
  const p = matchProfessionDay(profession);
  if (!p) return false;
  const t = new Date();
  return t.getMonth() + 1 === p.month && t.getDate() === p.day;
}
function isAnniversaryToday(createdAt) {
  if (!createdAt) return false;
  const d = new Date(createdAt), t = new Date();
  const years = t.getFullYear() - d.getFullYear();
  return years >= 1 && d.getDate() === t.getDate() && d.getMonth() === t.getMonth();
}
function anniversaryYears(createdAt) {
  const d = new Date(createdAt), t = new Date();
  return t.getFullYear() - d.getFullYear();
}
function waLink(phone, text) {
  let num = (phone || "").replace(/\D/g, "");
  if (num.startsWith("0")) num = "90" + num.slice(1);
  else if (!num.startsWith("90")) num = "90" + num;
  return `https://wa.me/${num}?text=${encodeURIComponent(text)}`;
}

/* ============================= KÜÇÜK UI PARÇALARI ============================= */

function StyleTag() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600;9..144,700&family=Inter:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@500;600&display=swap');
      .studio-root { font-family: 'Inter', system-ui, sans-serif; background:#EFE9D8; color:#20241D; }
      .font-display { font-family: 'Fraunces', serif; }
      .font-mono { font-family: 'IBM Plex Mono', monospace; }
      .rail-track { position:relative; height:10px; border-radius:999px; background:#DED6C2; overflow:hidden; }
      .rail-fill { position:absolute; inset:0; border-radius:999px; background: linear-gradient(90deg,#3E6B52,#6C8F72); transition: width .5s ease; }
      .rail-carriage { position:absolute; top:50%; width:18px; height:18px; border-radius:5px; background:#20241D; border:2px solid #F4F0E6; transform:translate(-50%,-50%); box-shadow:0 1px 3px rgba(0,0,0,.4); transition:left .5s ease; }
      .scrollbar-thin::-webkit-scrollbar{height:6px;width:6px;}
      .scrollbar-thin::-webkit-scrollbar-thumb{background:#C9BFA4;border-radius:99px;}
      .card-surface { background:#FFFEFB; border:1px solid #E7DFC9; box-shadow: 0 1px 2px rgba(32,41,31,0.04), 0 6px 16px -8px rgba(32,41,31,0.10); }
      .card-surface-flat { background:#FFFEFB; border:1px solid #E7DFC9; }
      .btn-primary { background:#20291F; color:#F4F0E6; box-shadow: 0 2px 6px -2px rgba(32,41,31,0.35); }
      .btn-primary:hover { background:#3E4A38; }
      .btn-clay { background:#B96A4A; color:#FCFAF4; box-shadow: 0 2px 6px -2px rgba(185,106,74,0.45); }
      .btn-clay:hover { background:#A2593D; }
      .btn-teal { background:#2F6F8F; color:#FCFAF4; box-shadow: 0 2px 6px -2px rgba(47,111,143,0.45); }
      .btn-teal:hover { background:#285F7A; }
      .zebra-row:nth-child(even) { background: #FBF7EC; }
      input[type=text], input[type=tel], input[type=number], input[type=date], input[type=password], input[type=email], input[type=time], input[type=month], select, textarea {
        background:#FFFEFB; border:1px solid #D9CFB2; border-radius:10px; padding:9px 12px; font-size:14px; width:100%;
      }
      input:focus, select:focus, textarea:focus { outline:2px solid #3E6B52; outline-offset:1px; border-color:#3E6B52; }
      ::selection { background:#C9BFA4; }
      @keyframes toastIn { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }
      @keyframes modalIn { from { opacity:0; transform:scale(0.97) translateY(6px); } to { opacity:1; transform:scale(1) translateY(0); } }
    `}</style>
  );
}

const SOLID_FOR_PALE = {
  "#E7F0EA": "#3E6B52",
  "#F7E7E2": "#B14A3A",
  "#F5EDDA": "#A98330",
  "#E4EEF2": "#2F6F8F",
};

function StatCard({ icon: Icon, label, value, sub, accent }) {
  const solid = SOLID_FOR_PALE[accent] || "#5B5340";
  const valueStr = String(value);
  const sizeClass = valueStr.length > 10 ? "text-base" : valueStr.length > 7 ? "text-lg" : "text-2xl";
  return (
    <div className="card-surface rounded-2xl p-4 flex flex-col gap-2 min-w-0" style={{ borderLeft: `3px solid ${solid}` }}>
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-wide text-[#6B6250] font-semibold">{label}</span>
        <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: solid }}>
          <Icon size={16} color="#FFFEFB" />
        </div>
      </div>
      <div className={`font-display font-semibold truncate ${sizeClass}`} title={valueStr}>{value}</div>
      {sub ? <div className="text-xs text-[#8B8168]">{sub}</div> : null}
    </div>
  );
}

function ProgressRail({ used, total, small }) {
  const t = Math.max(total, 1);
  const pct = Math.min(100, Math.max(0, (used / t) * 100));
  return (
    <div className="flex items-center gap-2 w-full">
      <div className={`rail-track ${small ? "flex-1" : "flex-1"}`}>
        <div className="rail-fill" style={{ width: `${pct}%` }} />
        <div className="rail-carriage" style={{ left: `${pct}%` }} />
      </div>
      <span className="font-mono text-xs text-[#5B5340] whitespace-nowrap">{Math.max(total - used, 0)}/{total} kalan</span>
    </div>
  );
}

function ToastHost() {
  const [toasts, setToasts] = useState([]);

  useEffect(() => {
    const onToast = (e) => {
      const id = uid();
      setToasts((prev) => [...prev, { id, message: e.detail }]);
      setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3500);
    };
    window.addEventListener("app-toast", onToast);
    return () => window.removeEventListener("app-toast", onToast);
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-20 md:bottom-6 left-0 right-0 z-[10000] flex flex-col items-center gap-2 px-4 pointer-events-none">
      {toasts.map((t) => (
        <div key={t.id} className="bg-[#20291F] text-[#F4F0E6] text-sm font-medium px-4 py-3 rounded-xl shadow-lg max-w-sm text-center" style={{ animation: "toastIn 0.25s ease-out" }}>
          {t.message}
        </div>
      ))}
    </div>
  );
}

function Modal({ title, onClose, children, footer, wide }) {
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prevOverflow; };
  }, []);

  const content = (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: "rgba(26,23,16,0.62)",
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-[#FCFAF4] w-full rounded-2xl shadow-2xl"
        style={{ maxWidth: wide ? 640 : 420, maxHeight: "85vh", display: "flex", flexDirection: "column", animation: "modalIn 0.18s ease-out" }}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#E7DFC9] shrink-0">
          <h3 className="font-display text-lg font-semibold">{title}</h3>
          <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-[#EFE8D5]">
            <X size={18} />
          </button>
        </div>
        <div className="p-5 scrollbar-thin" style={{ overflowY: "auto", flex: 1 }}>{children}</div>
        {footer && (
          <div className="px-5 py-4 border-t border-[#E7DFC9] shrink-0" style={{ background: "#FCFAF4" }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  );

  if (typeof window !== "undefined" && window.ReactDOM && typeof window.ReactDOM.createPortal === "function" && typeof document !== "undefined" && document.body) {
    try {
      return window.ReactDOM.createPortal(content, document.body);
    } catch (e) {
      return content;
    }
  }
  return content;
}

function Field({ label, children }) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="text-[#5B5340] font-medium">{label}</span>
      {children}
    </label>
  );
}

function Badge({ children, color, bg }) {
  return (
    <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ color: color || "#20291F", background: bg || "#EFE8D5" }}>
      {children}
    </span>
  );
}

function EmptyState({ icon: Icon, title, sub }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-14 gap-2 text-[#8B8168]">
      <Icon size={30} />
      <p className="font-display text-base text-[#3B3626]">{title}</p>
      {sub ? <p className="text-sm max-w-xs">{sub}</p> : null}
    </div>
  );
}

/* ============================= GİRİŞ EKRANI ============================= */

function LoginScreen({ db, onLogin }) {
  const [selected, setSelected] = useState(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");

  const staff = db.staff.filter((s) => s.active);
  const admins = staff.filter((s) => s.role === "admin");
  const instructors = staff.filter((s) => s.role === "instructor");

  const tryLogin = (p) => {
    if (!selected) return;
    if (p === selected.pin) {
      onLogin(selected);
    } else {
      setError("PIN hatalı, tekrar deneyin.");
      setPin("");
    }
  };

  const press = (d) => {
    setError("");
    const next = (pin + d).slice(0, 4);
    setPin(next);
    if (next.length === 4) setTimeout(() => tryLogin(next), 120);
  };

  return (
    <div className="studio-root min-h-screen flex items-center justify-center p-4">
      <StyleTag />
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-[#20291F] mx-auto mb-4 flex items-center justify-center">
            <div className="rail-track w-8" style={{ background: "#59614F" }}>
              <div className="rail-fill" style={{ width: "60%" }} />
            </div>
          </div>
          <h1 className="font-display text-2xl font-semibold">{db.studio.name}</h1>
          <p className="text-sm text-[#8B8168] mt-1">Stüdyo Yönetim Sistemi</p>
        </div>

        {!selected ? (
          <div className="card-surface rounded-2xl p-4">
            <p className="text-xs uppercase tracking-wide text-[#8B8168] font-semibold mb-2">Yöneticiler</p>
            <div className="flex flex-col gap-2 mb-4">
              {admins.length === 0 && <p className="text-sm text-[#8B8168]">Kayıtlı yönetici yok.</p>}
              {admins.map((s) => (
                <button key={s.id} onClick={() => setSelected(s)} className="flex items-center justify-between px-4 py-3 rounded-xl bg-[#F4F0E6] hover:bg-[#EFE8D5] text-left">
                  <span className="flex items-center gap-2 font-medium"><ShieldCheck size={16} className="text-[#3E6B52]" />{s.name}</span>
                  <ChevronRight size={16} className="text-[#8B8168]" />
                </button>
              ))}
            </div>
            <p className="text-xs uppercase tracking-wide text-[#8B8168] font-semibold mb-2">Hocalar</p>
            <div className="flex flex-col gap-2">
              {instructors.length === 0 && <p className="text-sm text-[#8B8168]">Kayıtlı hoca yok.</p>}
              {instructors.map((s) => (
                <button key={s.id} onClick={() => setSelected(s)} className="flex items-center justify-between px-4 py-3 rounded-xl bg-[#F4F0E6] hover:bg-[#EFE8D5] text-left">
                  <span className="flex items-center gap-2 font-medium"><UserCheck size={16} className="text-[#2F6F8F]" />{s.name}</span>
                  <ChevronRight size={16} className="text-[#8B8168]" />
                </button>
              ))}
            </div>
            {admins.length === 1 && admins[0].pin === "1234" && (
              <p className="text-xs text-[#8B8168] mt-4 text-center">İlk kurulum: Kurucu Yönetici → PIN <b className="font-mono">1234</b></p>
            )}
          </div>
        ) : (
          <div className="card-surface rounded-2xl p-6 text-center">
            <button onClick={() => { setSelected(null); setPin(""); setError(""); }} className="flex items-center gap-1 text-sm text-[#8B8168] mb-4">
              <ArrowLeft size={14} /> Geri
            </button>
            <p className="font-display text-lg font-semibold mb-1">{selected.name}</p>
            <p className="text-xs text-[#8B8168] mb-5">{selected.role === "admin" ? "Yönetici" : "Hoca"} · 4 haneli PIN girin</p>
            <div className="flex justify-center gap-3 mb-5">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className={`w-3.5 h-3.5 rounded-full ${pin.length > i ? "bg-[#20291F]" : "bg-[#DED6C2]"}`} />
              ))}
            </div>
            {error && <p className="text-xs text-[#B14A3A] mb-3">{error}</p>}
            <div className="grid grid-cols-3 gap-3 max-w-[240px] mx-auto">
              {["1","2","3","4","5","6","7","8","9"].map((d) => (
                <button key={d} onClick={() => press(d)} className="h-14 rounded-xl bg-[#F4F0E6] hover:bg-[#EFE8D5] font-display text-lg font-semibold">{d}</button>
              ))}
              <button onClick={() => { setPin(""); setError(""); }} className="h-14 rounded-xl bg-[#F4F0E6] hover:bg-[#EFE8D5] text-xs font-semibold text-[#8B8168]">Temizle</button>
              <button onClick={() => press("0")} className="h-14 rounded-xl bg-[#F4F0E6] hover:bg-[#EFE8D5] font-display text-lg font-semibold">0</button>
              <button onClick={() => setPin(pin.slice(0, -1))} className="h-14 rounded-xl bg-[#F4F0E6] hover:bg-[#EFE8D5] flex items-center justify-center text-[#8B8168]">⌫</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ============================= KUTLAMALAR & UYARILAR ============================= */

function CelebrationsCard({ db }) {
  const todays = useMemo(() => {
    const items = [];
    db.members.filter((m) => m.active).forEach((m) => {
      if (isBirthdayToday(m.birthDate)) items.push({ member: m, type: "birthday", text: `Sevgili ${m.name}, doğum gününü kutlarız! 🎉 Reformer Pilates ailesi olarak seninle gurur duyuyoruz.` });
      const pd = matchProfessionDay(m.profession);
      if (pd && isProfessionDayToday(m.profession)) items.push({ member: m, type: "profession", label: pd.label, text: `Sevgili ${m.name}, ${pd.label} kutlu olsun! 🎊` });
      if (isAnniversaryToday(m.createdAt)) items.push({ member: m, type: "anniversary", years: anniversaryYears(m.createdAt), text: `Sevgili ${m.name}, bizimle ${anniversaryYears(m.createdAt)}. yılın kutlu olsun! Seninle çalışmaktan mutluyuz 💚` });
    });
    return items;
  }, [db.members]);

  if (todays.length === 0) {
    return (
      <div className="card-surface rounded-2xl p-4" style={{ borderLeft: "3px solid #B96A4A" }}>
        <p className="text-sm font-semibold mb-1 flex items-center gap-1.5"><Sparkles size={15} /> Bugün Kutlama Yok</p>
        <p className="text-xs text-[#8B8168]">Doğum günü, meslek günü veya üyelik yıldönümü olan üye bulunmuyor.</p>
      </div>
    );
  }

  const ICONS = { birthday: Gift, profession: Briefcase, anniversary: Award };
  const LABELS = { birthday: "Doğum Günü", profession: "Meslek Günü", anniversary: "Üyelik Yıldönümü" };

  return (
    <div className="card-surface rounded-2xl p-4" style={{ borderLeft: "3px solid #B96A4A" }}>
      <p className="text-sm font-semibold mb-3 flex items-center gap-1.5"><Sparkles size={15} className="text-[#B96A4A]" /> Bugün Kutlanacaklar</p>
      <div className="flex flex-col gap-2.5">
        {todays.map((item, i) => {
          const Icon = ICONS[item.type];
          return (
            <div key={i} className="flex items-center justify-between gap-2 bg-[#F4F0E6] rounded-xl p-2.5">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-8 h-8 rounded-lg bg-[#FCFAF4] flex items-center justify-center shrink-0"><Icon size={15} className="text-[#B96A4A]" /></div>
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{item.member.name}</p>
                  <p className="text-xs text-[#8B8168]">{item.type === "profession" ? item.label : item.type === "anniversary" ? `${item.years}. yıl` : LABELS[item.type]}</p>
                </div>
              </div>
              {item.member.phone ? (
                <a href={waLink(item.member.phone, item.text)} target="_blank" rel="noreferrer" className="btn-teal px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 shrink-0">
                  <MessageCircle size={13} /> Kutla
                </a>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MaintenanceAlertsCard({ db }) {
  const today = todayISO();
  const overdue = (db.maintenanceTasks || []).filter((t) => maintenanceNextDue(t) < today);
  if (overdue.length === 0) return null;
  return (
    <div className="card-surface rounded-2xl p-4" style={{ borderLeft: "3px solid #A98330" }}>
      <p className="text-sm font-semibold mb-3 flex items-center gap-1.5"><Wrench size={15} className="text-[#A98330]" /> Bakım Zamanı Geldi ({overdue.length})</p>
      <div className="flex flex-col gap-1.5">
        {overdue.map((t) => {
          const room = ROOMS.find((r) => r.id === t.roomId);
          return (
            <div key={t.id} className="flex items-center justify-between text-sm">
              <span>{t.title}{room ? ` · ${room.name}` : ""}</span>
              <span className="font-mono text-xs text-[#A98330]">{fmtDate(maintenanceNextDue(t))}</span>
            </div>
          );
        })}
      </div>
      <p className="text-xs text-[#8B8168] mt-2">Ayarlar → Ekipman & Oda Bakımı bölümünden "Yapıldı" işaretleyebilirsin.</p>
    </div>
  );
}

function SpotAlertsCard({ db, mutate }) {
  const alerts = db.spotAlerts || [];
  if (alerts.length === 0) return null;
  const dismiss = (id) => mutate((d) => { d.spotAlerts = (d.spotAlerts || []).filter((a) => a.id !== id); return d; });
  return (
    <div className="card-surface rounded-2xl p-4" style={{ borderLeft: "3px solid #2F6F8F" }}>
      <p className="text-sm font-semibold mb-3 flex items-center gap-1.5"><RefreshCcw size={15} className="text-[#2F6F8F]" /> Derste Yer Açıldı ({alerts.length})</p>
      <div className="flex flex-col gap-2">
        {alerts.map((a) => (
          <div key={a.id} className="flex items-center justify-between gap-2 flex-wrap bg-[#E4EEF2] rounded-xl p-2.5">
            <p className="text-sm">
              <b>{a.classTitle}</b> ({WEEKDAYS[a.dayOfWeek]} {a.timeSlot}) — bekleme listesinde <b>{a.waitlistMemberName}</b> var, kadroya almak ister misin?
            </p>
            <button onClick={() => dismiss(a.id)} className="text-xs font-semibold px-2.5 py-1.5 rounded-lg shrink-0" style={{ background: "#FCFAF4", color: "#2F6F8F" }}>Gördüm</button>
          </div>
        ))}
      </div>
    </div>
  );
}

function AlertsCard({ db }) {
  const lowSessions = db.members.filter((m) => m.active && db.packages.some((p) => p.memberId === m.id && p.remainingSessions > 0 && p.remainingSessions <= 2));
  const inactive = db.members.filter((m) => {
    if (!m.active) return false;
    const pkgs = db.packages.filter((p) => p.memberId === m.id && p.remainingSessions > 0);
    if (pkgs.length === 0) return false;
    const lastAtt = db.attendance.filter((a) => a.memberId === m.id).sort((a, b) => new Date(b.date) - new Date(a.date))[0];
    const refDate = lastAtt ? new Date(lastAtt.date) : new Date(pkgs.sort((a, b) => new Date(a.purchaseDate) - new Date(b.purchaseDate))[0].purchaseDate);
    return (Date.now() - refDate.getTime()) / 86400000 >= 14;
  });

  if (lowSessions.length === 0 && inactive.length === 0) return null;

  return (
    <div className="card-surface rounded-2xl p-4" style={{ borderLeft: "3px solid #B14A3A" }}>
      <p className="text-sm font-semibold mb-3 flex items-center gap-1.5"><AlertTriangle size={15} className="text-[#B14A3A]" /> Dikkat Gerektirenler</p>
      {lowSessions.length > 0 && (
        <div className="mb-3">
          <p className="text-xs font-semibold text-[#8B8168] mb-1.5">Paketi bitmek üzere</p>
          <div className="flex flex-col gap-1.5">
            {lowSessions.map((m) => (
              <div key={m.id} className="flex items-center justify-between text-sm"><span>{m.name}</span><Badge color="#A98330" bg="#F5EDDA">Son seanslar</Badge></div>
            ))}
          </div>
        </div>
      )}
      {inactive.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-[#8B8168] mb-1.5">14+ gündür gelmedi</p>
          <div className="flex flex-col gap-1.5">
            {inactive.map((m) => (
              <div key={m.id} className="flex items-center justify-between text-sm">
                <span>{m.name}</span>
                {m.phone ? (
                  <a href={waLink(m.phone, `Merhaba ${m.name}, seni derslerimizde özledik! Uygun olduğun bir zamanı bize iletir misin? 🙂`)} target="_blank" rel="noreferrer" className="text-xs font-semibold text-[#2F6F8F] flex items-center gap-1"><MessageCircle size={12} /> Yaz</a>
                ) : <Badge color="#B14A3A" bg="#F7E7E2">Uzun süredir yok</Badge>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ============================= NOTLAR / YAPILACAKLAR ============================= */

function PendingDeletionsCard({ db, mutate, currentUser }) {
  const requests = db.deletionRequests || [];
  if (requests.length === 0) return null;

  const approve = (req) => {
    mutate((d) => {
      if (req.type === "attendance") {
        const rec = d.attendance.find((a) => a.id === req.payload.recordId);
        if (rec) {
          const toRemoveIds = rec.linkGroup ? d.attendance.filter((a) => a.linkGroup === rec.linkGroup).map((a) => a.id) : [rec.id];
          d.attendance.forEach((a) => {
            if (toRemoveIds.includes(a.id) && a.packageId && (a.status === "attended" || a.status === "burned")) {
              const p = d.packages.find((pp) => pp.id === a.packageId);
              if (p) p.remainingSessions = Math.min(p.totalSessions, p.remainingSessions + 1);
            }
          });
          d.attendance = d.attendance.filter((a) => !toRemoveIds.includes(a.id));
        }
      } else if (req.type === "note") {
        d.notes = d.notes.filter((n) => n.id !== req.payload.noteId);
      } else if (req.type === "classMember") {
        const c = d.classes.find((x) => x.id === req.payload.classId);
        if (c) {
          c.memberIds = c.memberIds.filter((id) => id !== req.payload.memberId);
          c.waitlistIds = c.waitlistIds.filter((id) => id !== req.payload.memberId);
          notifySpotOpened(d, c, d.members);
        }
      } else if (req.type === "classDelete") {
        d.classes = d.classes.filter((c) => c.id !== req.payload.classId);
      }
      d.deletionRequests = d.deletionRequests.filter((r) => r.id !== req.id);
      logActivity(d, currentUser, `Silme onaylandı (talep eden: ${req.requestedByName}): ${req.description}`);
      return d;
    });
  };
  const reject = (req) => mutate((d) => { d.deletionRequests = d.deletionRequests.filter((r) => r.id !== req.id); logActivity(d, currentUser, `Silme talebi reddedildi (talep eden: ${req.requestedByName}): ${req.description}`); return d; });

  return (
    <div className="card-surface rounded-2xl p-4" style={{ borderLeft: "3px solid #B14A3A" }}>
      <p className="text-sm font-semibold mb-3 flex items-center gap-1.5"><AlertTriangle size={15} className="text-[#B14A3A]" /> Silme Onayı Bekleyenler ({requests.length})</p>
      <div className="flex flex-col gap-2">
        {requests.map((req) => (
          <div key={req.id} className="flex items-center justify-between gap-2 bg-[#F4F0E6] rounded-xl p-2.5 flex-wrap">
            <div className="min-w-0">
              <p className="text-sm">{req.description}</p>
              <p className="text-xs text-[#8B8168]">{req.requestedByName} · {fmtDateTime(req.createdAt)}</p>
            </div>
            <div className="flex gap-1.5 shrink-0">
              <button onClick={() => approve(req)} className="text-xs font-semibold px-2.5 py-1.5 rounded-lg" style={{ background: "#E7F0EA", color: "#3E6B52" }}>Onayla</button>
              <button onClick={() => reject(req)} className="text-xs font-semibold px-2.5 py-1.5 rounded-lg" style={{ background: "#F7E7E2", color: "#B14A3A" }}>Reddet</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function NotesCard({ db, mutate, currentUser, isAdmin }) {
  const [text, setText] = useState("");
  const notes = [...(db.notes || [])].sort((a, b) => (a.done === b.done ? new Date(b.createdAt) - new Date(a.createdAt) : a.done ? 1 : -1));

  const addNote = () => {
    if (!text.trim()) return;
    mutate((d) => {
      d.notes = d.notes || [];
      d.notes.push({ id: uid(), text: text.trim(), done: false, authorId: currentUser.id, authorName: currentUser.name, createdAt: new Date().toISOString() });
      return d;
    });
    setText("");
  };
  const toggleDone = (id) => mutate((d) => { const n = d.notes.find((x) => x.id === id); if (n) n.done = !n.done; return d; });
  const deleteNote = (id) => {
    if (!isAdmin) {
      const n = (db.notes || []).find((x) => x.id === id);
      requestDeletion(mutate, currentUser, "note", { noteId: id }, `Not silme: "${n?.text || ""}"`);
      return;
    }
    mutate((d) => {
      const n = d.notes.find((x) => x.id === id);
      d.notes = d.notes.filter((x) => x.id !== id);
      logActivity(d, currentUser, `Not silindi: "${n?.text || ""}"`);
      return d;
    });
  };

  return (
    <div className="card-surface rounded-2xl p-4">
      <p className="text-sm font-semibold mb-3 flex items-center gap-1.5"><CheckCircle2 size={15} /> Notlar & Yapılacaklar</p>
      <div className="flex items-center gap-2 mb-3">
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") addNote(); }}
          placeholder="Örn. Ekipman bakımı çağır..."
        />
        <button onClick={addNote} className="btn-primary rounded-xl px-3 py-2 shrink-0"><Plus size={16} /></button>
      </div>
      {notes.length === 0 ? (
        <p className="text-sm text-[#8B8168]">Henüz not yok.</p>
      ) : (
        <div className="flex flex-col gap-1.5 max-h-64 overflow-y-auto scrollbar-thin pr-1">
          {notes.map((n) => (
            <div key={n.id} className="flex items-center justify-between gap-2 bg-[#F4F0E6] rounded-xl px-3 py-2">
              <button onClick={() => toggleDone(n.id)} className="flex items-center gap-2 text-left min-w-0 flex-1">
                <span className="w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center" style={{ borderColor: n.done ? "#3E6B52" : "#B9AF8F", background: n.done ? "#3E6B52" : "transparent" }}>
                  {n.done && <Check size={11} color="#FCFAF4" />}
                </span>
                <span className={`text-sm truncate ${n.done ? "line-through text-[#8B8168]" : ""}`}>{n.text}</span>
              </button>
              <button onClick={() => deleteNote(n.id)} className="text-[#8B8168] hover:text-[#B14A3A] shrink-0"><Trash2 size={13} /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ============================= GENEL BAKIŞ ============================= */

function OverviewTab({ db, mutate, isAdmin, currentUser, setActiveTab }) {
  const today = todayISO();
  const activeMembers = db.members.filter((m) => memberStatus(m, today) === "active").length;
  const todayAttendance = db.attendance.filter((a) => a.date === today);
  const frozenCount = db.members.filter((m) => m.freeze && today >= m.freeze.startDate && today <= m.freeze.endDate).length;

  const monthlyData = useMemo(() => {
    const months = [];
    const now = new Date();
    const allPayments = db.packages.flatMap((p) => p.payments || []);
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      const label = d.toLocaleDateString("tr-TR", { month: "short" });
      const income = allPayments
        .filter((pay) => { const pd = new Date(pay.date); return `${pd.getFullYear()}-${pd.getMonth()}` === key; })
        .reduce((s, pay) => s + Number(pay.amount || 0), 0);
      const expense = db.expenses
        .filter((e) => { const ed = new Date(e.date); return `${ed.getFullYear()}-${ed.getMonth()}` === key; })
        .reduce((s, e) => s + Number(e.amount || 0), 0);
      months.push({ label, Gelir: income, Gider: expense });
    }
    return months;
  }, [db.packages, db.expenses]);

  const myCheckinToday = db.checkins.filter((c) => c.staffId === currentUser.id && c.timestamp.slice(0, 10) === today).slice(-1)[0];

  const myLeave = useMemo(() => {
    if (isAdmin) return null;
    const used = db.leaveRecords.filter((l) => l.staffId === currentUser.id).reduce((s, l) => s + l.days, 0);
    const remaining = Math.max((currentUser.annualLeaveDays || 14) - used, 0);
    return { remaining, remainingHours: remaining * 8 };
  }, [db.leaveRecords, currentUser, isAdmin]);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="font-display text-xl font-semibold">Merhaba, {currentUser.name.split(" ")[0]}</h2>
        <p className="text-sm text-[#8B8168]">{new Date().toLocaleDateString("tr-TR", { weekday: "long", day: "numeric", month: "long" })}</p>
      </div>

      <div className="flex gap-2 overflow-x-auto scrollbar-thin -mx-1 px-1">
        <button onClick={() => setActiveTab("members")} className="btn-primary shrink-0 px-4 py-2.5 rounded-xl text-sm font-semibold flex items-center gap-1.5"><Plus size={15} /> Yeni Üye</button>
        <button onClick={() => setActiveTab("attendance")} className="shrink-0 px-4 py-2.5 rounded-xl text-sm font-semibold flex items-center gap-1.5" style={{ background: "#E7F0EA", color: "#3E6B52" }}><CalendarCheck size={15} /> Yoklama Al</button>
        {isAdmin ? (
          <button onClick={() => setActiveTab("schedule")} className="shrink-0 px-4 py-2.5 rounded-xl text-sm font-semibold flex items-center gap-1.5" style={{ background: "#E4EEF2", color: "#2F6F8F" }}><CalendarDays size={15} /> Yeni Ders</button>
        ) : (
          <button onClick={() => setActiveTab("checkin")} className="shrink-0 px-4 py-2.5 rounded-xl text-sm font-semibold flex items-center gap-1.5" style={{ background: "#E4EEF2", color: "#2F6F8F" }}><MapPin size={15} /> Giriş / Çıkış</button>
        )}
        {isAdmin && (
          <button onClick={() => setActiveTab("finance")} className="shrink-0 px-4 py-2.5 rounded-xl text-sm font-semibold flex items-center gap-1.5" style={{ background: "#F5EDDA", color: "#A98330" }}><Wallet size={15} /> Gider Ekle</button>
        )}
      </div>

      {!isAdmin && (
        <div className="card-surface rounded-2xl p-4 flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold">Bugünkü giriş/çıkış durumun</p>
            <p className="text-xs text-[#8B8168] mt-0.5">
              {myCheckinToday
                ? `${myCheckinToday.type === "out" ? "Çıkış" : "Giriş"} · ${fmtDateTime(myCheckinToday.timestamp)} · ${myCheckinToday.verified ? "Konum doğrulandı" : "Konum doğrulanamadı"}`
                : "Henüz kayıt yok"}
            </p>
          </div>
          <button onClick={() => setActiveTab("checkin")} className="btn-clay px-4 py-2 rounded-xl text-sm font-semibold shrink-0">Giriş / Çıkış</button>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard icon={Users} label="Aktif Üye" value={activeMembers} />
        <StatCard icon={CalendarCheck} label="Bugünkü Seans" value={todayAttendance.length} />
        <StatCard icon={Snowflake} label="Dondurulan Üye" value={frozenCount} accent="#E4EEF2" />
        {isAdmin ? (
          <StatCard icon={Wallet} label="Bu Ay Gelir" value={fmtMoney(monthlyData[5]?.Gelir || 0)} accent="#F5EDDA" />
        ) : (
          <StatCard icon={PlaneTakeoff} label="Kalan Yıllık İzin" value={`${myLeave.remaining} gün`} sub={`${myLeave.remainingHours} saat`} accent="#E4EEF2" />
        )}
      </div>

      {isAdmin && <PendingDeletionsCard db={db} mutate={mutate} currentUser={currentUser} />}
      {isAdmin && <SpotAlertsCard db={db} mutate={mutate} />}
      {isAdmin && <MaintenanceAlertsCard db={db} />}
      <NotesCard db={db} mutate={mutate} currentUser={currentUser} isAdmin={isAdmin} />
      <CelebrationsCard db={db} />
      <AlertsCard db={db} />

      {isAdmin && (
        <div className="card-surface rounded-2xl p-4">
          <p className="text-sm font-semibold mb-3">Son 6 Ay Gelir / Gider</p>
          <div style={{ width: "100%", height: 220 }}>
            <ResponsiveContainer>
              <BarChart data={monthlyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E7DFC9" />
                <XAxis dataKey="label" tick={{ fontSize: 12, fill: "#8B8168" }} axisLine={{ stroke: "#DED6C2" }} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "#8B8168" }} axisLine={false} tickLine={false} width={36} />
                <Tooltip formatter={(v) => fmtMoney(v)} contentStyle={{ background: "#FCFAF4", border: "1px solid #E7DFC9", borderRadius: 10, fontSize: 12 }} />
                <Bar dataKey="Gelir" fill="#3E6B52" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Gider" fill="#B96A4A" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <div className="card-surface rounded-2xl p-4">
        <p className="text-sm font-semibold mb-3">Bugünün Yoklaması ({todayAttendance.length})</p>
        {todayAttendance.length === 0 ? (
          <p className="text-sm text-[#8B8168]">Bugün için henüz yoklama girilmedi.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {todayAttendance.map((a) => {
              const member = db.members.find((m) => m.id === a.memberId);
              const meta = STATUS_META[a.status];
              return (
                <div key={a.id} className="flex items-center justify-between text-sm">
                  <span>{member?.name || "Silinmiş üye"}</span>
                  <Badge color={meta.color} bg={meta.bg}>{meta.short}</Badge>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {!isAdmin && (
        <div className="card-surface rounded-2xl p-4">
          <p className="text-sm font-semibold mb-3 flex items-center gap-1.5"><PlaneTakeoff size={15} /> İzin Geçmişim</p>
          {db.leaveRecords.filter((l) => l.staffId === currentUser.id).length === 0 ? (
            <p className="text-sm text-[#8B8168]">Henüz izin kaydın yok.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {db.leaveRecords.filter((l) => l.staffId === currentUser.id).sort((a, b) => new Date(b.startDate) - new Date(a.startDate)).map((l) => (
                <div key={l.id} className="flex items-center justify-between text-sm">
                  <span>{l.type === "hourly" ? `${fmtDate(l.startDate)} · Saatlik` : `${fmtDate(l.startDate)} – ${fmtDate(l.endDate)}`}</span>
                  <span className="font-mono text-xs text-[#8B8168]">{l.type === "hourly" ? `${l.hours} saat` : `${l.days} gün`}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ============================= ÜYELER ============================= */

function MemberFormModal({ onClose, onSave, initial }) {
  const [name, setName] = useState(initial?.name || "");
  const [phone, setPhone] = useState(initial?.phone || "");
  const [email, setEmail] = useState(initial?.email || "");
  const [birthDate, setBirthDate] = useState(initial?.birthDate || "");
  const [profession, setProfession] = useState(initial?.profession || "");
  const [goal, setGoal] = useState(initial?.goal || "");
  const [notes, setNotes] = useState(initial?.notes || "");

  return (
    <Modal
      title={initial ? "Üyeyi Düzenle" : "Yeni Üye Ekle"}
      onClose={onClose}
      wide
      footer={
        <button
          disabled={!name.trim()}
          onClick={() => onSave({ name: name.trim(), phone: phone.trim(), email: email.trim(), birthDate, profession: profession.trim(), goal: goal.trim(), notes: notes.trim() })}
          className="btn-primary rounded-xl py-3 font-semibold w-full disabled:opacity-40"
        >
          Kaydet
        </button>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="Ad Soyad *">
          <input
            type="text"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Örn. Ayşe Yılmaz"
          />
        </Field>

        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Telefon"><input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="05xx xxx xx xx" /></Field>
          <Field label="E-posta (opsiyonel)"><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <Field label="Doğum Tarihi (opsiyonel)"><input type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} /></Field>
          <Field label="Meslek (opsiyonel)"><input type="text" value={profession} onChange={(e) => setProfession(e.target.value)} placeholder="Örn. Öğretmen, Doktor..." /></Field>
        </div>

        <Field label="Hedef (opsiyonel)"><input type="text" value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="Örn. Duruş düzeltme, esneklik" /></Field>
        <Field label="Notlar (opsiyonel)"><textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Sağlık durumu, tercihler vb." /></Field>
      </div>
    </Modal>
  );
}

/* ============================= PAKET FORMU ============================= */

const PACKAGE_NAME_SUGGESTIONS = ["4 Seans Paketi", "8 Seans Paketi", "12 Seans Paketi", "16 Seans Paketi", "20 Seans Paketi", "Aylık Sınırsız", "Tekli Seans"];
const EXTRA_SUGGESTIONS = ["Diyet Danışmanlığı", "Vücut Analizi", "Beslenme Programı", "Kişisel Antrenman", "Masaj"];

function PackageFormModal({ onClose, onSave }) {
  const [name, setName] = useState("8 Seans Paketi");
  const [serviceType, setServiceType] = useState("Reformer Pilates");
  const [customServiceType, setCustomServiceType] = useState("");
  const [totalSessions, setTotalSessions] = useState(8);
  const [totalPrice, setTotalPrice] = useState("");
  const [paidNow, setPaidNow] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("Kredi Kartı");
  const [purchaseDate, setPurchaseDate] = useState(todayISO());
  const [extras, setExtras] = useState([]);
  const [customExtra, setCustomExtra] = useState("");

  const total = Number(totalPrice) || 0;
  const paid = Math.min(Number(paidNow) || 0, total);
  const remainingDebt = Math.max(total - paid, 0);
  const finalServiceType = serviceType === "Diğer" ? customServiceType.trim() : serviceType;

  const toggleSuggestion = (label) => setExtras((prev) => (prev.includes(label) ? prev.filter((e) => e !== label) : [...prev, label]));
  const addCustomExtra = () => {
    if (!customExtra.trim()) return;
    setExtras((prev) => [...prev, customExtra.trim()]);
    setCustomExtra("");
  };
  const removeExtra = (label) => setExtras((prev) => prev.filter((e) => e !== label));

  const save = () => {
    const payments = paid > 0 ? [{ id: uid(), amount: paid, method: paymentMethod, date: purchaseDate }] : [];
    onSave({ name: name.trim(), serviceType: finalServiceType, totalSessions: Number(totalSessions), remainingSessions: Number(totalSessions), totalPrice: total, payments, purchaseDate, extras });
  };

  return (
    <Modal
      title="Yeni Paket / Ödeme Ekle"
      onClose={onClose}
      footer={
        <button
          disabled={!total || totalSessions < 1 || !name.trim() || !finalServiceType}
          onClick={save}
          className="btn-primary rounded-xl py-3 font-semibold w-full disabled:opacity-40"
        >
          Paketi Kaydet
        </button>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="Paket Türü">
          <select value={serviceType} onChange={(e) => { setServiceType(e.target.value); setName(e.target.value === "Masaj" ? "5 Masaj Seansı" : e.target.value === "Diğer" ? "" : "8 Seans Paketi"); }}>
            {SERVICE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            <option value="Diğer">Diğer</option>
          </select>
        </Field>
        {serviceType === "Diğer" && (
          <Field label="Paket Türü Adı">
            <input type="text" value={customServiceType} onChange={(e) => setCustomServiceType(e.target.value)} placeholder="Örn. Yoga, Grup Dersi..." />
          </Field>
        )}
        <Field label="Paket Adı (kampanya için serbest yazabilirsin)">
          <input list="package-name-suggestions" type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Örn. 8 Seans Reformer + 1 Aylık Diyet" />
          <datalist id="package-name-suggestions">{PACKAGE_NAME_SUGGESTIONS.map((p) => <option key={p} value={p} />)}</datalist>
        </Field>
        <Field label="Toplam Seans Sayısı"><input type="number" min={1} value={totalSessions} onChange={(e) => setTotalSessions(Number(e.target.value))} /></Field>
        <Field label="Paketin Toplam Ücreti (₺)"><input type="number" min={0} value={totalPrice} onChange={(e) => setTotalPrice(e.target.value)} placeholder="Örn. 3500" /></Field>

        <div className="bg-[#F4F0E6] rounded-xl p-3 flex flex-col gap-2.5">
          <p className="text-xs font-semibold text-[#5B5340]">Ek Hizmetler (opsiyonel — kampanya paketiyse)</p>
          <div className="flex flex-wrap gap-1.5">
            {EXTRA_SUGGESTIONS.map((label) => {
              const active = extras.includes(label);
              return (
                <button
                  key={label}
                  onClick={() => toggleSuggestion(label)}
                  className="text-xs font-semibold px-3 py-1.5 rounded-full"
                  style={{ background: active ? "#2F6F8F" : "#FCFAF4", color: active ? "#FCFAF4" : "#5B5340", border: `1px solid ${active ? "#2F6F8F" : "#D9CFB2"}` }}
                >
                  {active ? "✓ " : "+ "}{label}
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-2">
            <input type="text" value={customExtra} onChange={(e) => setCustomExtra(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCustomExtra(); } }} placeholder="Özel ekle (örn. 1 Aylık Diyet)" />
            <button onClick={addCustomExtra} className="btn-teal rounded-xl px-3 py-2 shrink-0"><Plus size={15} /></button>
          </div>
          {extras.filter((e) => !EXTRA_SUGGESTIONS.includes(e)).length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {extras.filter((e) => !EXTRA_SUGGESTIONS.includes(e)).map((e, i) => (
                <span key={i} className="text-xs rounded-full px-2.5 py-1 flex items-center gap-1" style={{ background: "#F5EDDA", color: "#A98330" }}>
                  {e}
                  <button onClick={() => removeExtra(e)}><X size={11} /></button>
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="bg-[#F4F0E6] rounded-xl p-3 flex flex-col gap-2">
          <p className="text-xs font-semibold text-[#5B5340]">Şimdi Yapılan Ödeme</p>
          <p className="text-xs text-[#8B8168]">Üye tutarın tamamını ödemediyse, sadece şu an aldığınız kısmı girin. Kalanı daha sonra üye sayfasından ekleyebilirsiniz.</p>
          <Field label="Şimdi Ödenen Tutar (₺)"><input type="number" min={0} max={total || undefined} value={paidNow} onChange={(e) => setPaidNow(e.target.value)} placeholder="0" /></Field>
          <Field label="Ödeme Yöntemi">
            <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
              <option>Kredi Kartı</option>
              <option>Nakit</option>
              <option>Havale/EFT</option>
            </select>
          </Field>
          {total > 0 && (
            <p className="text-xs font-semibold" style={{ color: remainingDebt > 0 ? "#B14A3A" : "#3E6B52" }}>
              {remainingDebt > 0 ? `Kalan borç: ${fmtMoney(remainingDebt)}` : "Tamamı ödenmiş"}
            </p>
          )}
        </div>

        <Field label="Satın Alma Tarihi"><input type="date" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

function AddPaymentModal({ onClose, onSave, debt }) {
  const [amount, setAmount] = useState(debt);
  const [method, setMethod] = useState("Kredi Kartı");
  const [date, setDate] = useState(todayISO());
  return (
    <Modal
      title="Ödeme Ekle"
      onClose={onClose}
      footer={
        <button
          disabled={!amount || Number(amount) <= 0}
          onClick={() => onSave({ amount: Number(amount), method, date })}
          className="btn-clay rounded-xl py-3 font-semibold w-full disabled:opacity-40"
        >
          Ödemeyi Kaydet
        </button>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-sm text-[#5B5340]">Kalan borç: <b className="font-mono">{fmtMoney(debt)}</b></p>
        <Field label="Ödenen Tutar (₺)"><input type="number" min={0} max={debt} value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field label="Ödeme Yöntemi">
          <select value={method} onChange={(e) => setMethod(e.target.value)}>
            <option>Kredi Kartı</option>
            <option>Nakit</option>
            <option>Havale/EFT</option>
          </select>
        </Field>
        <Field label="Tarih"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

function FreezeFormModal({ onClose, onSave }) {
  const [startDate, setStartDate] = useState(todayISO());
  const [endDate, setEndDate] = useState(todayISO());
  const [reason, setReason] = useState("");
  return (
    <Modal
      title="Üyeliği Dondur"
      onClose={onClose}
      footer={<button onClick={() => onSave({ startDate, endDate, reason })} className="btn-clay rounded-xl py-3 font-semibold w-full">Dondur</button>}
    >
      <div className="flex flex-col gap-3">
        <Field label="Başlangıç Tarihi"><input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></Field>
        <Field label="Bitiş Tarihi"><input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></Field>
        <Field label="Sebep (opsiyonel)"><input type="text" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Örn. sağlık, tatil" /></Field>
      </div>
    </Modal>
  );
}

function MemberDetail({ db, member, mutate, isAdmin, onBack, currentUser }) {
  const [showPkgForm, setShowPkgForm] = useState(false);
  const [showEditForm, setShowEditForm] = useState(false);
  const [showFreezeForm, setShowFreezeForm] = useState(false);
  const [payingPkg, setPayingPkg] = useState(null);
  const packages = db.packages.filter((p) => p.memberId === member.id).sort((a, b) => new Date(b.purchaseDate) - new Date(a.purchaseDate));
  const attendance = db.attendance.filter((a) => a.memberId === member.id).sort((a, b) => new Date(b.date) - new Date(a.date));

  const counts = attendance.reduce((acc, a) => { acc[a.status] = (acc[a.status] || 0) + 1; return acc; }, {});
  const isFrozen = member.freeze && todayISO() >= member.freeze.startDate && todayISO() <= member.freeze.endDate;

  const deleteMemberCompletely = () => {
    if (!window.confirm(`${member.name} adlı üyeyi ve TÜM paket/ödeme/yoklama kayıtlarını kalıcı olarak silmek istediğine emin misin? Bu işlem geri alınamaz.`)) return;
    mutate((d) => {
      d.members = d.members.filter((m) => m.id !== member.id);
      d.packages = d.packages.filter((p) => p.memberId !== member.id);
      d.attendance = d.attendance.filter((a) => a.memberId !== member.id);
      d.classes.forEach((c) => {
        c.memberIds = (c.memberIds || []).filter((id) => id !== member.id);
        c.waitlistIds = (c.waitlistIds || []).filter((id) => id !== member.id);
      });
      logActivity(d, currentUser, `Üye ve tüm kayıtları silindi: ${member.name}`);
      return d;
    });
    onBack();
  };

  const addPackage = (pkg) => {
    mutate((d) => {
      d.packages.push({ id: uid(), memberId: member.id, ...pkg, expiryDate: null, note: "" });
      return d;
    });
    setShowPkgForm(false);
  };

  const addPayment = (pkgId, payment) => {
    mutate((d) => {
      const p = d.packages.find((x) => x.id === pkgId);
      if (p) { p.payments = p.payments || []; p.payments.push({ id: uid(), ...payment }); }
      return d;
    });
    setPayingPkg(null);
  };

  const saveEdit = (data) => {
    mutate((d) => {
      const idx = d.members.findIndex((m) => m.id === member.id);
      d.members[idx] = { ...d.members[idx], ...data };
      return d;
    });
    setShowEditForm(false);
  };

  const startFreeze = (data) => {
    mutate((d) => {
      const m = d.members.find((x) => x.id === member.id);
      m.freeze = data;
      m.freezeHistory = m.freezeHistory || [];
      return d;
    });
    setShowFreezeForm(false);
  };

  const endFreeze = () => {
    mutate((d) => {
      const m = d.members.find((x) => x.id === member.id);
      if (m.freeze) { m.freezeHistory = [...(m.freezeHistory || []), { ...m.freeze, endDate: todayISO() }]; }
      m.freeze = null;
      return d;
    });
  };

  const toggleActive = () => {
    mutate((d) => {
      const m = d.members.find((x) => x.id === member.id);
      m.active = !m.active;
      return d;
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <button onClick={onBack} className="flex items-center gap-1 text-sm text-[#8B8168] w-fit"><ArrowLeft size={14} /> Üyelere dön</button>

      <div className="card-surface rounded-2xl p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="font-display text-xl font-semibold">{member.name}</h2>
              {(() => { const st = memberStatus(member, todayISO()); const meta = MEMBER_STATUS_META[st]; return st !== "active" ? <Badge color={meta.color} bg={meta.bg}>{meta.label}</Badge> : null; })()}
            </div>
            <div className="flex flex-col gap-0.5 mt-1 text-sm text-[#8B8168]">
              {member.phone && <span className="flex items-center gap-1.5"><Phone size={13} />{member.phone}</span>}
              {member.email && <span>{member.email}</span>}
              {member.birthDate && <span className="flex items-center gap-1.5"><Gift size={13} />{fmtDate(member.birthDate)}</span>}
              {member.profession && <span className="flex items-center gap-1.5"><Briefcase size={13} />{member.profession}</span>}
              {member.goal && <span>Hedef: {member.goal}</span>}
              {member.createdAt && <span>Üyelik başlangıcı: {fmtDate(member.createdAt)}</span>}
            </div>
          </div>
          <div className="flex flex-col gap-2 items-end shrink-0">
            <button onClick={() => setShowPkgForm(true)} className="btn-clay px-3 py-2 rounded-xl text-sm font-semibold flex items-center gap-1"><Plus size={15} /> Paket</button>
            {isAdmin && <button onClick={() => setShowEditForm(true)} className="text-xs text-[#8B8168] flex items-center gap-1 hover:text-[#20291F]"><Edit2 size={12} /> Düzenle</button>}
          </div>
        </div>
        {member.notes && <p className="text-sm text-[#5B5340] mt-3 bg-[#F4F0E6] rounded-xl p-3">{member.notes}</p>}

        {isAdmin && (
          <div className="mt-4 pt-4 border-t border-[#E7DFC9] flex flex-col gap-2">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-1.5 text-sm text-[#5B5340]"><Snowflake size={15} /> Dondurma (tarihli, resmi)</div>
              {isFrozen ? (
                <button onClick={endFreeze} className="text-xs font-semibold px-3 py-1.5 rounded-lg flex items-center gap-1" style={{ background: "#E7F0EA", color: "#3E6B52" }}><PlayCircle size={13} /> Dondurmayı Kaldır</button>
              ) : (
                <button onClick={() => setShowFreezeForm(true)} className="text-xs font-semibold px-3 py-1.5 rounded-lg flex items-center gap-1" style={{ background: "#E4EEF2", color: "#2F6F8F" }}><PauseCircle size={13} /> Üyeliği Dondur</button>
              )}
            </div>
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-1.5 text-sm text-[#5B5340]"><UserCheck size={15} /> Pasif (uzun süredir gelmiyor, tarihsiz)</div>
              {member.active ? (
                <button onClick={toggleActive} className="text-xs font-semibold px-3 py-1.5 rounded-lg" style={{ background: "#EFE8D5", color: "#8B8168" }}>Pasife Al</button>
              ) : (
                <button onClick={toggleActive} className="text-xs font-semibold px-3 py-1.5 rounded-lg" style={{ background: "#E7F0EA", color: "#3E6B52" }}>Aktife Al</button>
              )}
            </div>
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-1.5 text-sm text-[#5B5340]"><Trash2 size={15} /> Üyeyi ve Tüm Kayıtlarını Sil</div>
              <button onClick={deleteMemberCompletely} className="text-xs font-semibold px-3 py-1.5 rounded-lg" style={{ background: "#F7E7E2", color: "#B14A3A" }}>Kalıcı Olarak Sil</button>
            </div>
          </div>
        )}
        {(member.freezeHistory || []).length > 0 && (
          <div className="mt-2 text-xs text-[#8B8168]">
            {member.freezeHistory.map((f, i) => <p key={i}>Dondurma: {fmtDate(f.startDate)} – {fmtDate(f.endDate)}{f.reason ? ` (${f.reason})` : ""}</p>)}
          </div>
        )}
      </div>

      <div className="grid grid-cols-4 gap-2">
        <StatCard icon={CheckCircle2} label="Geldi" value={counts.attended || 0} accent="#E7F0EA" />
        <StatCard icon={XCircle} label="Yandı" value={counts.burned || 0} accent="#F7E7E2" />
        <StatCard icon={AlertTriangle} label="Mazaretli" value={counts.excused || 0} accent="#F5EDDA" />
        <StatCard icon={RefreshCcw} label="Telafi" value={counts.makeup || 0} accent="#E4EEF2" />
      </div>

      <div className="card-surface rounded-2xl p-4">
        <p className="text-sm font-semibold mb-3">Seans Paketleri</p>
        {packages.length === 0 ? (
          <p className="text-sm text-[#8B8168]">Henüz paket tanımlanmadı.</p>
        ) : (
          <div className="flex flex-col gap-4">
            {packages.map((p) => {
              const paid = paidAmount(p);
              const debt = debtAmount(p);
              return (
                <div key={p.id} className="flex flex-col gap-2 pb-3 border-b border-[#E7DFC9] last:border-0 last:pb-0">
                  <div className="flex items-center justify-between text-sm flex-wrap gap-1">
                    <span className="font-medium">{p.name}</span>
                    {debt > 0 ? <Badge color="#B14A3A" bg="#F7E7E2">Borç: {fmtMoney(debt)}</Badge> : <Badge color="#3E6B52" bg="#E7F0EA">Ödendi</Badge>}
                  </div>
                  <ProgressRail used={p.totalSessions - p.remainingSessions} total={p.totalSessions} />
                  <span className="text-xs text-[#8B8168]">Satın alma: {fmtDate(p.purchaseDate)}</span>
                  {(p.extras || []).length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {p.extras.map((ex, i) => (
                        <span key={i} className="text-xs rounded-full px-2.5 py-1" style={{ background: "#F5EDDA", color: "#A98330" }}>
                          + {typeof ex === "string" ? ex : `${ex.name}${ex.duration ? ` (${ex.duration})` : ""}`}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <span className="font-mono text-xs text-[#8B8168]">Toplam {fmtMoney(p.totalPrice)} · Ödenen {fmtMoney(paid)}</span>
                    {debt > 0 && (
                      <button onClick={() => setPayingPkg(p)} className="btn-teal text-xs font-semibold px-2.5 py-1.5 rounded-lg flex items-center gap-1"><Plus size={12} /> Ödeme Ekle</button>
                    )}
                  </div>
                  {(p.payments || []).length > 0 && (
                    <div className="flex flex-col gap-1 mt-1">
                      {p.payments.map((pay) => (
                        <div key={pay.id} className="flex items-center justify-between text-xs text-[#8B8168]">
                          <span>{fmtDate(pay.date)} · {pay.method}</span>
                          <span className="font-mono">{fmtMoney(pay.amount)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="card-surface rounded-2xl p-4">
        <p className="text-sm font-semibold mb-3">Seans Geçmişi</p>
        {attendance.length === 0 ? (
          <p className="text-sm text-[#8B8168]">Kayıt yok.</p>
        ) : (
          <div className="flex flex-col gap-2 max-h-72 overflow-y-auto scrollbar-thin pr-1">
            {attendance.map((a) => {
              const meta = STATUS_META[a.status];
              return (
                <div key={a.id} className="flex items-center justify-between text-sm gap-2">
                  <div className="min-w-0">
                    <span className="text-[#5B5340]">{fmtDate(a.date)}</span>
                    {a.note && <p className="text-xs text-[#8B8168] truncate">{a.note}</p>}
                  </div>
                  <Badge color={meta.color} bg={meta.bg}>{meta.short}</Badge>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {showPkgForm && <PackageFormModal onClose={() => setShowPkgForm(false)} onSave={addPackage} />}
      {showEditForm && <MemberFormModal initial={member} onClose={() => setShowEditForm(false)} onSave={saveEdit} />}
      {showFreezeForm && <FreezeFormModal onClose={() => setShowFreezeForm(false)} onSave={startFreeze} />}
      {payingPkg && <AddPaymentModal debt={debtAmount(payingPkg)} onClose={() => setPayingPkg(null)} onSave={(payment) => addPayment(payingPkg.id, payment)} />}
    </div>
  );
}

function MembersTab({ db, mutate, isAdmin, currentUser }) {
  const [query, setQuery] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [filterMode, setFilterMode] = useState("all");

  const today = todayISO();
  const statusCounts = db.members.reduce((acc, m) => { const s = memberStatus(m, today); acc[s] = (acc[s] || 0) + 1; return acc; }, {});

  const filtered = db.members
    .filter((m) => m.name.toLowerCase().includes(query.toLowerCase()) || (m.phone || "").includes(query))
    .filter((m) => (filterMode === "all" ? true : memberStatus(m, today) === filterMode));
  const selected = db.members.find((m) => m.id === selectedId);

  if (selected) {
    return <MemberDetail db={db} member={selected} mutate={mutate} isAdmin={isAdmin} onBack={() => setSelectedId(null)} currentUser={currentUser} />;
  }

  const saveMember = (data) => {
    mutate((d) => {
      d.members.push({ id: uid(), ...data, active: true, freeze: null, freezeHistory: [], createdAt: new Date().toISOString() });
      logActivity(d, currentUser, `Üye eklendi: ${data.name}`);
      return d;
    });
    setShowForm(false);
  };

  const FILTERS = [
    { id: "all", label: "Tümü" },
    { id: "active", label: `Aktif (${statusCounts.active || 0})` },
    { id: "inactive", label: `Pasif (${statusCounts.inactive || 0})` },
    { id: "frozen", label: `Dondurulmuş (${statusCounts.frozen || 0})` },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-xl font-semibold">Üyeler</h2>
        <button onClick={() => setShowForm(true)} className="btn-primary px-4 py-2 rounded-xl text-sm font-semibold flex items-center gap-1.5">
          <Plus size={16} /> Yeni Üye
        </button>
      </div>

      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8B8168]" />
        <input type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="İsim veya telefon ara..." className="!pl-9" />
      </div>

      <div className="flex gap-2 flex-wrap">
        {FILTERS.map((f) => (
          <button key={f.id} onClick={() => setFilterMode(f.id)} className="text-xs font-semibold px-3 py-1.5 rounded-lg" style={{ background: filterMode === f.id ? "#20291F" : "#F4F0E6", color: filterMode === f.id ? "#F4F0E6" : "#5B5340" }}>
            {f.label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={Users} title="Üye bulunamadı" sub={filterMode !== "all" ? "Bu durumda üye yok." : "Yeni Üye butonuyla ilk üyeni ekle."} />
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map((m) => {
            const pkgs = db.packages.filter((p) => p.memberId === m.id && p.remainingSessions > 0);
            const totalRemaining = pkgs.reduce((s, p) => s + p.remainingSessions, 0);
            const totalOf = pkgs.reduce((s, p) => s + p.totalSessions, 0);
            const status = memberStatus(m, today);
            const statusMeta = MEMBER_STATUS_META[status];
            const lastAttendance = db.attendance.filter((a) => a.memberId === m.id && (a.status === "attended" || a.status === "burned")).sort((a, b) => new Date(b.date) - new Date(a.date))[0];
            const initials = m.name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
            return (
              <button key={m.id} onClick={() => setSelectedId(m.id)} className="card-surface rounded-2xl p-4 text-left hover:border-[#B9AF8F] transition-colors">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold shrink-0" style={{ background: "#E4EEF2", color: "#2F6F8F" }}>{initials}</div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium flex items-center gap-2 truncate">{m.name} {status !== "active" && <Badge color={statusMeta.color} bg={statusMeta.bg}>{statusMeta.label}</Badge>}</p>
                    <p className="text-xs text-[#8B8168] truncate">
                      {m.phone || "Telefon yok"}{lastAttendance ? ` · Son katılım: ${fmtDate(lastAttendance.date)}` : ""}
                    </p>
                  </div>
                  <ChevronRight size={16} className="text-[#8B8168] shrink-0" />
                </div>
                {pkgs.length > 0 ? (
                  <ProgressRail used={totalOf - totalRemaining} total={totalOf} small />
                ) : (
                  <span className="text-xs text-[#B14A3A]">Aktif paket yok</span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {showForm && <MemberFormModal onClose={() => setShowForm(false)} onSave={saveMember} />}
    </div>
  );
}

/* ============================= YOKLAMA ============================= */

function AttendanceTab({ db, mutate, currentUser, isAdmin }) {
  const [date, setDate] = useState(todayISO());
  const [query, setQuery] = useState("");

  const dayRecords = db.attendance.filter((a) => a.date === date);
  const jsDay = new Date(date + "T00:00:00").getDay();
  const ourIndex = (jsDay + 6) % 7;
  const dateWeekStart = getMonday(date);
  const classesForDay = db.classes
    .filter((c) => c.dayOfWeek === ourIndex && c.weekStart === dateWeekStart && (isAdmin || c.instructorId === currentUser.id))
    .sort((a, b) => a.timeSlot.localeCompare(b.timeSlot));
  const scheduledMemberIds = new Set(classesForDay.flatMap((c) => c.memberIds || []));

  const membersWithActivePkg = db.members.filter((m) => m.active && db.packages.some((p) => p.memberId === m.id && p.remainingSessions > 0));
  const filtered = membersWithActivePkg.filter((m) => m.name.toLowerCase().includes(query.toLowerCase()));

  const mark = (member, status, serviceType) => {
    const pkgs = db.packages.filter((p) => p.memberId === member.id && p.remainingSessions > 0).sort((a, b) => new Date(a.purchaseDate) - new Date(b.purchaseDate));
    const pkg = (serviceType && pkgs.find((p) => (p.serviceType || "Reformer Pilates") === serviceType)) || pkgs[0];
    if (!pkg) return;
    mutate((d) => {
      if (status === "makeup") {
        const linkGroup = uid();
        const targetDate = addDays(date, 1);
        const originalRecord = { id: uid(), memberId: member.id, packageId: pkg.id, instructorId: currentUser.id, date, status: "makeup", linkGroup, note: `Telafi hakkı — ${fmtDate(targetDate)} tarihine planlandı`, createdAt: new Date().toISOString() };
        d.attendance.push(originalRecord);
        const alreadyLinked = d.attendance.some((a) => a.memberId === member.id && a.date === targetDate && a.status === "makeup");
        if (!alreadyLinked) {
          d.attendance.push({ id: uid(), memberId: member.id, packageId: pkg.id, instructorId: currentUser.id, date: targetDate, status: "makeup", linkGroup, note: `${fmtDate(date)} tarihli devamsızlığın telafisi`, createdAt: new Date().toISOString() });
        }
        // Telafi seans hakkından düşmez.
      } else {
        const record = { id: uid(), memberId: member.id, packageId: pkg.id, instructorId: currentUser.id, date, status, createdAt: new Date().toISOString() };
        d.attendance.push(record);
        if (status === "attended" || status === "burned") {
          const p = d.packages.find((pp) => pp.id === pkg.id);
          if (p) p.remainingSessions = Math.max(0, p.remainingSessions - 1);
        }
      }
      return d;
    });
  };

  const undo = (record) => {
    if (!isAdmin) {
      const member = db.members.find((m) => m.id === record.memberId);
      requestDeletion(mutate, currentUser, "attendance", { recordId: record.id }, `${member?.name || "Üye"} · ${fmtDate(record.date)} · ${STATUS_META[record.status].label} kaydının silinmesi`);
      return;
    }
    mutate((d) => {
      const toRemoveIds = record.linkGroup ? d.attendance.filter((a) => a.linkGroup === record.linkGroup).map((a) => a.id) : [record.id];
      d.attendance.forEach((a) => {
        if (toRemoveIds.includes(a.id) && a.packageId && (a.status === "attended" || a.status === "burned")) {
          const p = d.packages.find((pp) => pp.id === a.packageId);
          if (p) p.remainingSessions = Math.min(p.totalSessions, p.remainingSessions + 1);
        }
      });
      d.attendance = d.attendance.filter((a) => !toRemoveIds.includes(a.id));
      const member = db.members.find((m) => m.id === record.memberId);
      logActivity(d, currentUser, `Yoklama kaydı silindi: ${member?.name || "Üye"} · ${fmtDate(record.date)} · ${STATUS_META[record.status].label}`);
      return d;
    });
  };

  const MarkRow = ({ m, serviceType }) => {
    const already = dayRecords.find((r) => r.memberId === m.id);
    const relevantPkgs = db.packages.filter((p) => p.memberId === m.id && p.remainingSessions > 0);
    const hasActivePkg = serviceType ? relevantPkgs.some((p) => (p.serviceType || "Reformer Pilates") === serviceType) : relevantPkgs.length > 0;
    return (
      <div className="flex items-center justify-between gap-2 flex-wrap py-1.5">
        <span className="font-medium text-sm">{m.name}</span>
        {already ? (
          <div className="flex items-center gap-2">
            <Badge color={STATUS_META[already.status].color} bg={STATUS_META[already.status].bg}>{STATUS_META[already.status].short}</Badge>
            <button onClick={() => undo(already)} className="text-[#8B8168] hover:text-[#B14A3A]"><Trash2 size={14} /></button>
          </div>
        ) : !hasActivePkg ? (
          <Badge color="#B14A3A" bg="#F7E7E2">{serviceType ? `Aktif ${serviceType} paketi yok` : "Aktif paketi yok"}</Badge>
        ) : (
          <div className="flex gap-1.5 flex-wrap">
            <button onClick={() => mark(m, "attended", serviceType)} className="text-xs font-semibold px-2.5 py-1.5 rounded-lg" style={{ background: STATUS_META.attended.bg, color: STATUS_META.attended.color }}>Geldi</button>
            <button onClick={() => mark(m, "burned", serviceType)} className="text-xs font-semibold px-2.5 py-1.5 rounded-lg" style={{ background: STATUS_META.burned.bg, color: STATUS_META.burned.color }}>Gelmedi</button>
            <button onClick={() => mark(m, "makeup", serviceType)} className="text-xs font-semibold px-2.5 py-1.5 rounded-lg" style={{ background: STATUS_META.makeup.bg, color: STATUS_META.makeup.color }}>Telafi (sağlık/mazaret)</button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-xl font-semibold">Yoklama</h2>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="!w-auto" />
      </div>

      <div className="card-surface rounded-2xl p-4">
        <p className="text-sm font-semibold mb-3">{fmtDate(date)} · İşaretlenenler ({dayRecords.length})</p>
        {dayRecords.length === 0 ? (
          <p className="text-sm text-[#8B8168]">Bu tarih için henüz kayıt yok.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {dayRecords.map((r) => {
              const member = db.members.find((m) => m.id === r.memberId);
              const meta = STATUS_META[r.status];
              return (
                <div key={r.id} className="flex items-center justify-between text-sm">
                  <span>{member?.name || "Silinmiş üye"}</span>
                  <div className="flex items-center gap-2">
                    <Badge color={meta.color} bg={meta.bg}>{meta.short}</Badge>
                    <button onClick={() => undo(r)} className="text-[#8B8168] hover:text-[#B14A3A]"><Trash2 size={14} /></button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {classesForDay.length === 0 ? (
        <div className="card-surface rounded-2xl p-4">
          <p className="text-sm text-[#8B8168]">{fmtDate(date)} için ({WEEKDAYS[ourIndex]}) planlanmış ders bulunmuyor.</p>
        </div>
      ) : (
        classesForDay.map((c) => {
          const roster = (c.memberIds || []).map((id) => db.members.find((m) => m.id === id)).filter(Boolean);
          return (
            <div key={c.id} className="card-surface rounded-2xl p-4">
              <div className="flex items-center justify-between mb-2 flex-wrap gap-1">
                <p className="text-sm font-semibold flex items-center gap-1.5">{c.title} <Badge color={c.serviceType === "Masaj" ? "#A98330" : "#2F6F8F"} bg={c.serviceType === "Masaj" ? "#F5EDDA" : "#E4EEF2"}>{c.serviceType}</Badge></p>
                <span className="text-xs text-[#8B8168] font-mono">{c.timeSlot}</span>
              </div>
              {roster.length === 0 ? (
                <p className="text-xs text-[#8B8168]">Bu derste kayıtlı üye yok. Ders Programı sekmesinden üye ekleyebilirsin.</p>
              ) : (
                <div className="flex flex-col divide-y divide-[#EFE8D5]">
                  {roster.map((m) => <MarkRow key={m.id} m={m} serviceType={c.serviceType} />)}
                </div>
              )}
            </div>
          );
        })
      )}

      <div className="flex flex-col gap-2">
        <p className="text-sm font-semibold text-[#5B5340]">Üye Ara ve İşaretle</p>
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8B8168]" />
          <input type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Üye ara..." className="!pl-9" />
        </div>
        {filtered.length === 0 ? (
          <EmptyState icon={CalendarCheck} title="Uygun üye yok" sub="Aktif paketli üye bulunamadı." />
        ) : (
          filtered.map((m) => (
            <div key={m.id} className="card-surface rounded-2xl p-3">
              <MarkRow m={m} />
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/* ============================= TELAFİLER ============================= */

function MakeupsTab({ db, mutate, isAdmin, currentUser }) {
  const myMakeups = db.attendance.filter((a) => a.status === "makeup" && (isAdmin || a.instructorId === currentUser.id));
  const groups = {};
  myMakeups.forEach((a) => {
    const key = a.linkGroup || a.id;
    if (!groups[key]) groups[key] = [];
    groups[key].push(a);
  });
  const today = todayISO();
  const list = Object.values(groups).map((recs) => {
    const sorted = [...recs].sort((a, b) => new Date(a.date) - new Date(b.date));
    return { original: sorted[0], target: sorted[1] || sorted[0] };
  }).sort((a, b) => new Date(b.original.date) - new Date(a.original.date));

  const upcoming = list.filter((g) => g.target.date >= today);
  const past = list.filter((g) => g.target.date < today);

  const deleteMakeup = (g) => {
    const member = db.members.find((m) => m.id === g.original.memberId);
    const desc = `${member?.name || "Üye"} · ${fmtDate(g.original.date)} → ${fmtDate(g.target.date)} telafi kaydının silinmesi`;
    if (isAdmin) {
      mutate((d) => {
        const toRemoveIds = g.original.linkGroup ? d.attendance.filter((a) => a.linkGroup === g.original.linkGroup).map((a) => a.id) : [g.original.id];
        d.attendance = d.attendance.filter((a) => !toRemoveIds.includes(a.id));
        logActivity(d, currentUser, `Telafi kaydı silindi: ${desc}`);
        return d;
      });
    } else {
      requestDeletion(mutate, currentUser, "attendance", { recordId: g.original.id }, desc);
    }
  };

  const Row = ({ g }) => {
    const member = db.members.find((m) => m.id === g.original.memberId);
    const pkg = db.packages.find((p) => p.id === g.original.packageId);
    return (
      <div className="card-surface rounded-2xl p-3 flex items-center justify-between gap-2 flex-wrap">
        <div>
          <p className="text-sm font-medium">{member?.name || "Silinmiş üye"}</p>
          <p className="text-xs text-[#8B8168]">
            Devamsızlık: {fmtDate(g.original.date)} → Telafi: {fmtDate(g.target.date)}
            {pkg?.serviceType ? ` · ${pkg.serviceType}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge color={g.target.date >= today ? "#2F6F8F" : "#8B8168"} bg={g.target.date >= today ? "#E4EEF2" : "#EFE8D5"}>
            {g.target.date >= today ? "Yaklaşan" : "Geçmiş"}
          </Badge>
          <button onClick={() => deleteMakeup(g)} className="text-[#8B8168] hover:text-[#B14A3A]"><Trash2 size={15} /></button>
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <h2 className="font-display text-xl font-semibold">Telafiler</h2>
      <p className="text-xs text-[#8B8168]">Sağlık/mazaret nedeniyle telafi hakkı tanınan tüm devamsızlıklar ve planlanan telafi tarihleri.{!isAdmin && " Silme işlemleri yöneticinin onayına gönderilir."}</p>

      <div className="flex flex-col gap-2">
        <p className="text-sm font-semibold text-[#5B5340]">Yaklaşan Telafiler ({upcoming.length})</p>
        {upcoming.length === 0 ? (
          <EmptyState icon={RefreshCcw} title="Yaklaşan telafi yok" />
        ) : (
          upcoming.map((g) => <Row key={g.original.id} g={g} />)
        )}
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-sm font-semibold text-[#5B5340]">Geçmiş Telafiler ({past.length})</p>
        {past.length === 0 ? (
          <p className="text-sm text-[#8B8168]">Henüz geçmiş telafi yok.</p>
        ) : (
          past.map((g) => <Row key={g.original.id} g={g} />)
        )}
      </div>
    </div>
  );
}

/* ============================= BEKLEYEN ADAYLAR ============================= */

function ProspectFormModal({ onClose, onSave, initial }) {
  const [name, setName] = useState(initial?.name || "");
  const [phone, setPhone] = useState(initial?.phone || "");
  const [visitDate, setVisitDate] = useState(initial?.visitDate || todayISO());
  const [visitTime, setVisitTime] = useState(initial?.visitTime || "");
  const [desiredSlots, setDesiredSlots] = useState(initial?.desiredSlots || []);
  const [notes, setNotes] = useState(initial?.notes || "");

  const toggleSlot = (slot) => setDesiredSlots((prev) => (prev.includes(slot) ? prev.filter((s) => s !== slot) : [...prev, slot]));

  const save = () => {
    onSave({ name: name.trim(), phone: phone.trim(), visitDate, visitTime, desiredSlots, notes: notes.trim() });
  };

  return (
    <Modal
      title={initial ? "Adayı Düzenle" : "Yeni Aday Ekle"}
      onClose={onClose}
      footer={<button disabled={!name.trim()} onClick={save} className="btn-primary rounded-xl py-3 font-semibold w-full disabled:opacity-40">Kaydet</button>}
    >
      <div className="flex flex-col gap-3">
        <Field label="Ad Soyad"><input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Örn. Ayşe Yılmaz" /></Field>
        <Field label="İletişim Numarası"><input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="05xx xxx xx xx" /></Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Görüşme Tarihi"><input type="date" value={visitDate} onChange={(e) => setVisitDate(e.target.value)} /></Field>
          <Field label="Görüşme Saati"><input type="time" value={visitTime} onChange={(e) => setVisitTime(e.target.value)} /></Field>
        </div>
        <Field label="İstediği Saat(ler) — birden fazla seçebilirsin">
          <div className="flex flex-wrap gap-1.5">
            {TIME_SLOTS.map((slot) => {
              const active = desiredSlots.includes(slot);
              return (
                <button
                  key={slot}
                  onClick={() => toggleSlot(slot)}
                  className="text-xs font-semibold px-3 py-1.5 rounded-full font-mono"
                  style={{ background: active ? "#2F6F8F" : "#F4F0E6", color: active ? "#FCFAF4" : "#5B5340" }}
                >
                  {slot}
                </button>
              );
            })}
          </div>
        </Field>
        <Field label="Not (opsiyonel)"><input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Örn. Sabah saatlerini de değerlendirebilir" /></Field>
      </div>
    </Modal>
  );
}

function ProspectsTab({ db, mutate, currentUser }) {
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [filterSlot, setFilterSlot] = useState("all");

  const prospects = db.prospects || [];
  const filtered = filterSlot === "all" ? prospects : prospects.filter((p) => (p.desiredSlots || []).includes(filterSlot));
  const sorted = [...filtered].sort((a, b) => new Date(b.visitDate) - new Date(a.visitDate));

  const slotCounts = {};
  prospects.forEach((p) => (p.desiredSlots || []).forEach((s) => { slotCounts[s] = (slotCounts[s] || 0) + 1; }));

  const addProspect = (data) => {
    mutate((d) => {
      d.prospects = d.prospects || [];
      d.prospects.push({ id: uid(), ...data, addedBy: currentUser.id, addedByName: currentUser.name, createdAt: new Date().toISOString() });
      return d;
    });
    setShowForm(false);
  };
  const editProspect = (data) => {
    mutate((d) => {
      const idx = (d.prospects || []).findIndex((p) => p.id === editing.id);
      if (idx > -1) d.prospects[idx] = { ...d.prospects[idx], ...data };
      return d;
    });
    setEditing(null);
  };
  const removeProspect = (id) => {
    const p = prospects.find((x) => x.id === id);
    if (!window.confirm(`"${p?.name || "Bu aday"}" kaydını silmek istediğine emin misin?`)) return;
    mutate((d) => { d.prospects = (d.prospects || []).filter((x) => x.id !== id); return d; });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="font-display text-xl font-semibold">Bekleyen Adaylar</h2>
        <button onClick={() => setShowForm(true)} className="btn-primary px-4 py-2 rounded-xl text-sm font-semibold flex items-center gap-1.5"><Plus size={16} /> Yeni Aday</button>
      </div>
      <p className="text-xs text-[#8B8168]">Görüşmeye gelip istediği saat dolu olduğu için beklettiğin kişiler. Bir dersten yer açıldığında ilgili saati isteyenleri buradan bulup dönüş yapabilirsin.</p>

      <div className="flex flex-wrap gap-2">
        <button onClick={() => setFilterSlot("all")} className="text-xs font-semibold px-3 py-1.5 rounded-lg" style={{ background: filterSlot === "all" ? "#20291F" : "#F4F0E6", color: filterSlot === "all" ? "#F4F0E6" : "#5B5340" }}>
          Tümü ({prospects.length})
        </button>
        {TIME_SLOTS.filter((s) => slotCounts[s]).map((slot) => (
          <button key={slot} onClick={() => setFilterSlot(slot)} className="text-xs font-semibold px-3 py-1.5 rounded-lg font-mono" style={{ background: filterSlot === slot ? "#2F6F8F" : "#F4F0E6", color: filterSlot === slot ? "#FCFAF4" : "#5B5340" }}>
            {slot} ({slotCounts[slot]})
          </button>
        ))}
      </div>

      {sorted.length === 0 ? (
        <EmptyState icon={Users} title="Aday yok" sub={filterSlot === "all" ? "Yeni Aday butonuyla ilk kaydı ekle." : "Bu saati isteyen aday yok."} />
      ) : (
        <div className="flex flex-col gap-2">
          {sorted.map((p) => (
            <div key={p.id} className="card-surface rounded-2xl p-3 flex flex-col gap-2">
              <div className="flex items-start justify-between gap-2 flex-wrap">
                <div>
                  <p className="text-sm font-semibold">{p.name}</p>
                  <p className="text-xs text-[#8B8168]">Görüşme: {fmtDate(p.visitDate)}{p.visitTime ? ` · ${p.visitTime}` : ""}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {p.phone && (
                    <a href={waLink(p.phone, `Merhaba ${p.name}, istediğin saatte yer açıldı! `)} target="_blank" rel="noreferrer" className="text-xs font-semibold px-2.5 py-1.5 rounded-lg flex items-center gap-1" style={{ background: "#E7F0EA", color: "#3E6B52" }}>
                      <MessageCircle size={12} /> Yaz
                    </a>
                  )}
                  <button onClick={() => setEditing(p)} className="text-[#8B8168] hover:text-[#20291F]"><Edit2 size={14} /></button>
                  <button onClick={() => removeProspect(p.id)} className="text-[#8B8168] hover:text-[#B14A3A]"><Trash2 size={14} /></button>
                </div>
              </div>
              {p.phone && <p className="text-xs text-[#8B8168] font-mono">{p.phone}</p>}
              {(p.desiredSlots || []).length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {p.desiredSlots.map((s) => (
                    <span key={s} className="text-xs font-mono rounded-full px-2.5 py-1" style={{ background: "#E4EEF2", color: "#2F6F8F" }}>{s}</span>
                  ))}
                </div>
              )}
              {p.notes && <p className="text-xs text-[#8B8168] italic">{p.notes}</p>}
            </div>
          ))}
        </div>
      )}

      {showForm && <ProspectFormModal onClose={() => setShowForm(false)} onSave={addProspect} />}
      {editing && <ProspectFormModal initial={editing} onClose={() => setEditing(null)} onSave={editProspect} />}
    </div>
  );
}

/* ============================= DERS PROGRAMI ============================= */

function ClassFormModal({ onClose, onSave, instructors, initialDay, initialSlot, weekStart, isAdmin, currentUser, initial }) {
  const initialIsCustomType = initial?.serviceType && !SERVICE_TYPES.includes(initial.serviceType);
  const [title, setTitle] = useState(initial?.title || "Reformer Grup Dersi");
  const [serviceType, setServiceType] = useState(initialIsCustomType ? "Diğer" : (initial?.serviceType || "Reformer Pilates"));
  const [customServiceType, setCustomServiceType] = useState(initialIsCustomType ? initial.serviceType : "");
  const [roomId, setRoomId] = useState(initial?.roomId || ROOMS[0].id);
  const [dayOfWeek, setDayOfWeek] = useState(initial ? initial.dayOfWeek : (initialDay != null ? initialDay : 0));
  const [timeSlot, setTimeSlot] = useState(initial?.timeSlot || initialSlot || TIME_SLOTS[0]);
  const [instructorId, setInstructorId] = useState(initial ? initial.instructorId : (isAdmin ? (instructors[0]?.id || "") : currentUser.id));
  const [capacity, setCapacity] = useState(initial?.capacity || 5);

  const room = ROOMS.find((r) => r.id === roomId);
  const finalServiceType = serviceType === "Diğer" ? customServiceType.trim() : serviceType;

  const handleRoomChange = (id) => {
    setRoomId(id);
    const r = ROOMS.find((x) => x.id === id);
    if (r) setCapacity(r.capacity);
  };

  const save = () => {
    onSave({ title: title.trim(), serviceType: finalServiceType, roomId, dayOfWeek, timeSlot, instructorId, capacity: Number(capacity), weekStart: initial?.weekStart || weekStart });
  };

  return (
    <Modal
      title={initial ? "Dersi Düzenle" : "Yeni Ders Ekle"}
      onClose={onClose}
      footer={<button disabled={!title.trim() || !instructorId || !finalServiceType} onClick={save} className="btn-primary rounded-xl py-3 font-semibold w-full disabled:opacity-40">Kaydet</button>}
    >
      <div className="flex flex-col gap-3">
        <Field label="Ders Adı"><input type="text" value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        <Field label="Hizmet Türü">
          <select value={serviceType} onChange={(e) => setServiceType(e.target.value)}>
            {SERVICE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            <option value="Diğer">Diğer</option>
          </select>
        </Field>
        {serviceType === "Diğer" && (
          <Field label="Hizmet Türü Adı">
            <input type="text" value={customServiceType} onChange={(e) => setCustomServiceType(e.target.value)} placeholder="Örn. Yoga, Grup Dersi..." />
          </Field>
        )}
        <Field label="Oda">
          <select value={roomId} onChange={(e) => handleRoomChange(e.target.value)}>
            {ROOMS.map((r) => <option key={r.id} value={r.id}>{r.name} ({r.note})</option>)}
          </select>
        </Field>
        <Field label="Gün">
          <select value={dayOfWeek} onChange={(e) => setDayOfWeek(Number(e.target.value))}>
            {SCHEDULE_DAYS.map((i) => <option key={i} value={i}>{WEEKDAYS[i]}</option>)}
          </select>
        </Field>
        <Field label="Saat Aralığı">
          <select value={timeSlot} onChange={(e) => setTimeSlot(e.target.value)}>
            {TIME_SLOTS.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </Field>
        <Field label="Hoca">
          {isAdmin ? (
            <select value={instructorId} onChange={(e) => setInstructorId(e.target.value)}>
              {instructors.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          ) : (
            <input type="text" value={currentUser.name} disabled />
          )}
        </Field>
        <Field label="Kontenjan">
          <input type="number" min={1} value={capacity} onChange={(e) => setCapacity(Number(e.target.value))} />
        </Field>
        {room && capacity > room.capacity && (
          <p className="text-xs text-[#B14A3A]">Uyarı: {room.name}'da en fazla {room.capacity} kişilik yer var, girdiğin kontenjan bunu aşıyor.</p>
        )}
      </div>
    </Modal>
  );
}

function ClassDetailModal({ cls, db, mutate, isAdmin, currentUser, onClose }) {
  const [query, setQuery] = useState("");
  const [movingMemberId, setMovingMemberId] = useState(null);
  const [showEdit, setShowEdit] = useState(false);
  const instructor = db.staff.find((s) => s.id === cls.instructorId);
  const roster = (cls.memberIds || []).map((id) => db.members.find((m) => m.id === id)).filter(Boolean);
  const waitlist = (cls.waitlistIds || []).map((id) => db.members.find((m) => m.id === id)).filter(Boolean);
  const room = ROOMS.find((r) => r.id === cls.roomId);
  const isOwnClass = cls.instructorId === currentUser.id;
  const canManageRoster = isAdmin || isOwnClass;

  const sameDayOtherClasses = db.classes.filter((c) => c.id !== cls.id && c.dayOfWeek === cls.dayOfWeek);
  const sameDayBusyIds = new Set(sameDayOtherClasses.flatMap((c) => [...(c.memberIds || []), ...(c.waitlistIds || [])]));
  const candidates = db.members.filter((m) => !cls.memberIds.includes(m.id) && !cls.waitlistIds.includes(m.id) && !sameDayBusyIds.has(m.id) && memberStatus(m, todayISO()) !== "frozen" && m.name.toLowerCase().includes(query.toLowerCase()));
  const otherClasses = db.classes.filter((c) => c.id !== cls.id);

  const enroll = (memberId) => {
    mutate((d) => {
      const c = d.classes.find((x) => x.id === cls.id);
      if (!c) return d;
      if (c.memberIds.length < c.capacity) c.memberIds.push(memberId);
      else c.waitlistIds.push(memberId);
      return d;
    });
  };
  const removeDirectly = (memberId) => {
    mutate((d) => {
      const c = d.classes.find((x) => x.id === cls.id);
      if (!c) return d;
      c.memberIds = c.memberIds.filter((id) => id !== memberId);
      c.waitlistIds = c.waitlistIds.filter((id) => id !== memberId);
      notifySpotOpened(d, c, d.members);
      const member = db.members.find((m) => m.id === memberId);
      logActivity(d, currentUser, `${member?.name || "Üye"} "${cls.title}" dersinden çıkarıldı`);
      return d;
    });
  };
  const handleRemove = (memberId) => {
    if (isAdmin) { removeDirectly(memberId); return; }
    if (!isOwnClass) return;
    const member = db.members.find((m) => m.id === memberId);
    requestDeletion(mutate, currentUser, "classMember", { classId: cls.id, memberId }, `${member?.name || "Üye"} adlı üyenin "${cls.title}" dersinden çıkarılması`);
  };
  const promoteFromWaitlist = (memberId) => {
    mutate((d) => {
      const c = d.classes.find((x) => x.id === cls.id);
      if (!c || c.memberIds.length >= c.capacity) return d;
      c.waitlistIds = c.waitlistIds.filter((id) => id !== memberId);
      c.memberIds.push(memberId);
      d.spotAlerts = (d.spotAlerts || []).filter((a) => !(a.classId === c.id && a.waitlistMemberId === memberId));
      const member = db.members.find((m) => m.id === memberId);
      logActivity(d, currentUser, `${member?.name || "Üye"} bekleme listesinden "${cls.title}" kadrosuna alındı`);
      return d;
    });
  };
  const moveMember = (memberId, targetClassId) => {
    if (!targetClassId) return;
    mutate((d) => {
      const from = d.classes.find((c) => c.id === cls.id);
      const to = d.classes.find((c) => c.id === targetClassId);
      if (!from || !to) return d;
      from.memberIds = from.memberIds.filter((id) => id !== memberId);
      from.waitlistIds = from.waitlistIds.filter((id) => id !== memberId);
      notifySpotOpened(d, from, d.members);
      if (!to.memberIds.includes(memberId) && !to.waitlistIds.includes(memberId)) {
        if (to.memberIds.length < to.capacity) to.memberIds.push(memberId);
        else to.waitlistIds.push(memberId);
      }
      return d;
    });
    setMovingMemberId(null);
  };
  const deleteClass = () => { mutate((d) => { d.classes = d.classes.filter((c) => c.id !== cls.id); logActivity(d, currentUser, `Ders silindi: "${cls.title}" (${WEEKDAYS[cls.dayOfWeek]} ${cls.timeSlot})`); return d; }); onClose(); };
  const editClass = (data) => {
    mutate((d) => {
      const c = d.classes.find((x) => x.id === cls.id);
      if (c) Object.assign(c, data);
      logActivity(d, currentUser, `Ders düzenlendi: "${data.title}"`);
      return d;
    });
    setShowEdit(false);
  };

  return (
    <>
    <Modal
      title={cls.title}
      onClose={onClose}
      footer={
        <div className="flex flex-col gap-2">
          {canManageRoster && (
            <button onClick={() => setShowEdit(true)} className="rounded-xl py-3 font-semibold w-full" style={{ background: "#E4EEF2", color: "#2F6F8F" }}>Dersi Düzenle</button>
          )}
          {isAdmin ? (
            <button onClick={deleteClass} className="rounded-xl py-3 font-semibold w-full" style={{ background: "#F7E7E2", color: "#B14A3A" }}>Dersi Sil</button>
          ) : isOwnClass ? (
            <button
              onClick={() => requestDeletion(mutate, currentUser, "classDelete", { classId: cls.id }, `"${cls.title}" (${WEEKDAYS[cls.dayOfWeek]} ${cls.timeSlot}) dersinin silinmesi`)}
              className="rounded-xl py-3 font-semibold w-full"
              style={{ background: "#F5EDDA", color: "#A98330" }}
            >
              Silme Talebi Gönder
            </button>
          ) : null}
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge color="#5B5340" bg="#F4F0E6">{WEEKDAYS[cls.dayOfWeek]} · {cls.timeSlot}</Badge>
          {room && <Badge color="#5B5340" bg="#F4F0E6">{room.name}</Badge>}
          <Badge color={cls.serviceType === "Masaj" ? "#A98330" : "#2F6F8F"} bg={cls.serviceType === "Masaj" ? "#F5EDDA" : "#E4EEF2"}>{cls.serviceType}</Badge>
        </div>
        <p className="text-sm text-[#5B5340]">Hoca: <b>{instructor?.name || "Atanmadı"}</b></p>
        <div className="flex items-center gap-2">
          <Badge color={roster.length >= cls.capacity ? "#B14A3A" : "#3E6B52"} bg={roster.length >= cls.capacity ? "#F7E7E2" : "#E7F0EA"}>{roster.length}/{cls.capacity} dolu</Badge>
        </div>
        {!canManageRoster && <p className="text-xs text-[#8B8168]">Bu, başka bir hocanın dersi — sadece görüntüleyebilirsin.</p>}
        {isOwnClass && !isAdmin && <p className="text-xs text-[#8B8168]">Üye çıkarma işlemleri yöneticinin onayına gönderilir.</p>}

        {roster.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-[#5B5340] mb-1.5">Kayıtlı Üyeler</p>
            <div className="flex flex-col gap-1.5">
              {roster.map((m) => (
                <div key={m.id} className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-xs bg-[#F4F0E6] rounded-full px-2.5 py-1 flex items-center gap-1.5">
                    {m.name}
                    {canManageRoster && <button onClick={() => handleRemove(m.id)} className="text-[#8B8168] hover:text-[#B14A3A]"><X size={11} /></button>}
                  </span>
                  {isAdmin && (
                    <button onClick={() => setMovingMemberId(movingMemberId === m.id ? null : m.id)} className="text-[#2F6F8F] hover:text-[#20291F]" title="Başka derse taşı"><RefreshCcw size={13} /></button>
                  )}
                  {isAdmin && movingMemberId === m.id && (
                    <select onChange={(e) => moveMember(m.id, e.target.value)} defaultValue="" className="!w-auto !py-1 !px-2 !text-xs">
                      <option value="" disabled>Taşınacak ders...</option>
                      {otherClasses.map((c) => (
                        <option key={c.id} value={c.id}>{WEEKDAYS[c.dayOfWeek]} {c.timeSlot} · {c.title}</option>
                      ))}
                    </select>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
        {waitlist.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-[#A98330] mb-1">Bekleme Listesi</p>
            <div className="flex flex-wrap gap-1.5">
              {waitlist.map((m) => (
                <span key={m.id} className="text-xs rounded-full px-2.5 py-1 flex items-center gap-1.5" style={{ background: "#F5EDDA", color: "#A98330" }}>
                  {m.name}
                  {canManageRoster && roster.length < cls.capacity && (
                    <button onClick={() => promoteFromWaitlist(m.id)} title="Kadroya Al" className="hover:text-[#3E6B52]"><Check size={11} /></button>
                  )}
                  {canManageRoster && <button onClick={() => handleRemove(m.id)} title="Listeden Çıkar" className="hover:text-[#B14A3A]"><X size={11} /></button>}
                </span>
              ))}
            </div>
          </div>
        )}

        {canManageRoster && (
          <div className="flex flex-col gap-2 pt-1">
            <p className="text-xs font-semibold text-[#5B5340]">Üye Ekle</p>
            <input type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Üye ara..." />
            <div className="max-h-40 overflow-y-auto scrollbar-thin flex flex-col gap-1">
              {candidates.slice(0, 10).map((m) => {
                const st = memberStatus(m, todayISO());
                return (
                  <button key={m.id} onClick={() => { enroll(m.id); setQuery(""); }} className="flex items-center justify-between gap-2 text-left text-sm px-2.5 py-1.5 rounded-lg hover:bg-[#F4F0E6]">
                    <span>{m.name}</span>
                    {st !== "active" && <Badge color={MEMBER_STATUS_META[st].color} bg={MEMBER_STATUS_META[st].bg}>{MEMBER_STATUS_META[st].label}</Badge>}
                  </button>
                );
            })}
            {candidates.length === 0 && <p className="text-xs text-[#8B8168] px-2.5">Sonuç yok</p>}
            </div>
          </div>
        )}
      </div>
    </Modal>
    {showEdit && (
      <ClassFormModal
        onClose={() => setShowEdit(false)}
        onSave={editClass}
        instructors={db.staff.filter((s) => s.active && (s.role === "instructor" || s.role === "admin"))}
        isAdmin={isAdmin}
        currentUser={currentUser}
        initial={cls}
      />
    )}
    </>
  );
}

function WeekGrid({ title, weekStart, isCurrentOrFuture, visibleClasses, db, isAdmin, currentUser, onOpenClass, onQuickAdd }) {
  const weekClasses = visibleClasses.filter((c) => c.weekStart === weekStart);
  const weekEnd = addDays(weekStart, 5);
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-semibold text-[#5B5340]">{title} <span className="font-mono text-xs text-[#8B8168]">({fmtDate(weekStart)} – {fmtDate(weekEnd)})</span></p>
      <div className="card-surface rounded-2xl overflow-hidden">
        <div className="overflow-x-auto scrollbar-thin">
          <table className="border-collapse text-sm" style={{ minWidth: 780 }}>
            <thead>
              <tr>
                <th className="sticky left-0 z-10 bg-[#20291F] p-2 text-xs font-semibold text-[#F4F0E6] border-b-2 border-[#20291F]" style={{ minWidth: 84 }}>Saat</th>
                {SCHEDULE_DAYS.map((dayIdx) => (
                  <th key={dayIdx} className="p-2 text-xs font-semibold text-[#F4F0E6] bg-[#20291F] border-b-2 border-[#20291F]" style={{ minWidth: 112 }}>{WEEKDAYS[dayIdx]}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {TIME_SLOTS.map((slot) => (
                <tr key={slot} className="zebra-row">
                  <td className="sticky left-0 z-10 p-2 text-xs font-mono font-semibold text-[#5B5340] border-r-2 border-b border-[#E7DFC9] whitespace-nowrap align-top" style={{ background: "inherit" }}>{slot}</td>
                  {SCHEDULE_DAYS.map((dayIdx) => {
                    const cellClasses = weekClasses.filter((c) => c.dayOfWeek === dayIdx && c.timeSlot === slot);
                    return (
                      <td key={dayIdx} className="p-1 border-b border-r border-[#EFE8D5] align-top last:border-r-0">
                        <div className="flex flex-col gap-1">
                          {cellClasses.map((c) => {
                            const instr = db.staff.find((s) => s.id === c.instructorId);
                            const room = ROOMS.find((r) => r.id === c.roomId);
                            const colors = ROOM_COLORS[c.roomId] || ROOM_COLORS.oda1;
                            const full = (c.memberIds || []).length >= c.capacity;
                            return (
                              <button
                                key={c.id}
                                onClick={() => onOpenClass(c.id)}
                                className="text-left rounded-lg p-1.5 w-full"
                                style={{ background: colors.bg, borderLeft: `3px solid ${colors.solid}` }}
                              >
                                <p className="text-xs font-semibold truncate" style={{ color: colors.text }}>{c.title}</p>
                                <p className="text-[10px] text-[#8B8168] truncate">{room?.name} · {instr?.name?.split(" ")[0] || "?"}{c.serviceType === "Masaj" ? " · 💆" : ""}</p>
                                <p className="text-[10px] font-mono font-semibold" style={{ color: full ? "#B14A3A" : "#8B8168" }}>{(c.memberIds || []).length}/{c.capacity}</p>
                              </button>
                            );
                          })}
                          {isCurrentOrFuture && (
                            <button onClick={() => onQuickAdd(dayIdx, slot)} className="text-[#B9AF8F] hover:text-[#5B5340] hover:bg-[#F4F0E6] text-xs w-full text-center py-1.5 rounded-lg">+</button>
                          )}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function ScheduleTab({ db, mutate, isAdmin, currentUser }) {
  const [showForm, setShowForm] = useState(false);
  const [prefill, setPrefill] = useState(null);
  const [activeClassId, setActiveClassId] = useState(null);
  const [showArchive, setShowArchive] = useState(false);
  const instructors = db.staff.filter((s) => s.active && (s.role === "instructor" || s.role === "admin"));
  const [filterIds, setFilterIds] = useState(() => new Set(isAdmin ? instructors.map((i) => i.id) : [currentUser.id]));

  const toggleFilter = (id) => {
    setFilterIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      if (next.size === 0) return new Set(instructors.map((i) => i.id));
      return next;
    });
  };
  const selectAll = () => setFilterIds(new Set(instructors.map((i) => i.id)));
  const allSelected = filterIds.size === instructors.length;

  const thisMonday = getMonday(todayISO());
  const nextMonday = addDays(thisMonday, 7);

  const visibleClasses = db.classes.filter((c) => filterIds.has(c.instructorId));
  const activeClass = db.classes.find((c) => c.id === activeClassId);

  const addClass = (data) => { mutate((d) => { d.classes.push({ id: uid(), ...data, memberIds: [], waitlistIds: [] }); return d; }); setShowForm(false); setPrefill(null); };
  const openQuickAdd = (weekStart) => (dayIdx, slot) => { setPrefill({ day: dayIdx, slot, weekStart }); setShowForm(true); };

  const copyToNextWeek = () => {
    const thisWeekClasses = db.classes.filter((c) => c.weekStart === thisMonday);
    if (thisWeekClasses.length === 0) { window.alert("Bu hafta kopyalanacak ders bulunmuyor."); return; }
    if (!window.confirm(`Bu haftadaki ${thisWeekClasses.length} ders, üye listeleri boş olarak gelecek haftaya kopyalanacak. Devam edilsin mi?`)) return;
    mutate((d) => {
      thisWeekClasses.forEach((c) => {
        d.classes.push({ ...c, id: uid(), weekStart: nextMonday, memberIds: [], waitlistIds: [] });
      });
      logActivity(d, currentUser, `Bu haftanın programı gelecek haftaya kopyalandı (${thisWeekClasses.length} ders)`);
      return d;
    });
  };

  const downloadPdf = (weekStart, label) => {
    const weekClasses = visibleClasses.filter((c) => c.weekStart === weekStart);
    const docPdf = new jsPDF({ orientation: "landscape" });
    docPdf.setFontSize(14);
    docPdf.text(`${db.studio.name} - ${label} (${fmtDate(weekStart)} - ${fmtDate(addDays(weekStart, 5))})`, 14, 12);
    const head = [["Saat", ...SCHEDULE_DAYS.map((i) => WEEKDAYS[i])]];
    const body = TIME_SLOTS.map((slot) => {
      const row = [slot];
      SCHEDULE_DAYS.forEach((dayIdx) => {
        const cellClasses = weekClasses.filter((c) => c.dayOfWeek === dayIdx && c.timeSlot === slot);
        row.push(cellClasses.map((c) => {
          const instr = db.staff.find((s) => s.id === c.instructorId);
          const room = ROOMS.find((r) => r.id === c.roomId);
          return `${c.title} (${room?.name || ""} · ${instr?.name || ""} · ${(c.memberIds || []).length}/${c.capacity})`;
        }).join("\n") || "-");
      });
      return row;
    });
    autoTable(docPdf, { head, body, startY: 18, styles: { fontSize: 8, cellPadding: 2 }, headStyles: { fillColor: [32, 41, 31] } });
    docPdf.save(`ders-programi-${weekStart}.pdf`);
  };

  const pastWeeks = [...new Set(db.classes.filter((c) => c.weekStart < thisMonday).map((c) => c.weekStart))].sort((a, b) => new Date(b) - new Date(a));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="font-display text-xl font-semibold">Ders Programı</h2>
        {isAdmin && (
          <button onClick={copyToNextWeek} className="text-xs font-semibold px-3 py-2 rounded-xl flex items-center gap-1.5" style={{ background: "#F5EDDA", color: "#A98330" }}>
            <RefreshCcw size={14} /> Bu Haftayı Gelecek Haftaya Kopyala
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <button onClick={selectAll} className="text-xs font-semibold px-3 py-1.5 rounded-lg" style={{ background: allSelected ? "#20291F" : "#F4F0E6", color: allSelected ? "#F4F0E6" : "#5B5340" }}>Tüm Hocalar</button>
        {instructors.map((ins) => {
          const active = filterIds.has(ins.id);
          return (
            <button key={ins.id} onClick={() => toggleFilter(ins.id)} className="text-xs font-semibold px-3 py-1.5 rounded-lg" style={{ background: active ? "#2F6F8F" : "#F4F0E6", color: active ? "#FCFAF4" : "#5B5340" }}>
              {ins.name}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-3 -mt-1">
        {ROOMS.map((r) => (
          <span key={r.id} className="flex items-center gap-1.5 text-xs text-[#5B5340]">
            <span className="w-2.5 h-2.5 rounded-full" style={{ background: ROOM_COLORS[r.id].solid }} />
            {r.name}
          </span>
        ))}
      </div>

      <div className="flex items-center justify-between">
        <p className="text-xs text-[#8B8168]">Boş bir hücreye dokunarak o haftaya ders ekleyebilirsin.</p>
        <button onClick={() => downloadPdf(thisMonday, "Bu Hafta")} className="btn-teal px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5"><FileSpreadsheet size={13} /> Bu Haftayı PDF İndir</button>
      </div>
      <WeekGrid title="Bu Hafta" weekStart={thisMonday} isCurrentOrFuture={true} visibleClasses={visibleClasses} db={db} isAdmin={isAdmin} currentUser={currentUser} onOpenClass={setActiveClassId} onQuickAdd={openQuickAdd(thisMonday)} />

      <div className="flex items-center justify-between mt-2">
        <p className="text-xs text-[#8B8168]">Gelecek haftanın programını şimdiden hazırlayabilirsin.</p>
        <button onClick={() => downloadPdf(nextMonday, "Gelecek Hafta")} className="btn-teal px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5"><FileSpreadsheet size={13} /> Gelecek Haftayı PDF İndir</button>
      </div>
      <WeekGrid title="Gelecek Hafta" weekStart={nextMonday} isCurrentOrFuture={true} visibleClasses={visibleClasses} db={db} isAdmin={isAdmin} currentUser={currentUser} onOpenClass={setActiveClassId} onQuickAdd={openQuickAdd(nextMonday)} />

      {pastWeeks.length > 0 && (
        <div className="flex flex-col gap-2 mt-2">
          <button onClick={() => setShowArchive((v) => !v)} className="text-sm font-semibold text-[#5B5340] flex items-center gap-1.5 w-fit">
            <ChevronDown size={16} style={{ transform: showArchive ? "rotate(180deg)" : "none" }} /> Geçmiş Haftalık Programlar ({pastWeeks.length})
          </button>
          {showArchive && pastWeeks.map((ws) => (
            <WeekGrid key={ws} title="Geçmiş Program" weekStart={ws} isCurrentOrFuture={false} visibleClasses={visibleClasses} db={db} isAdmin={isAdmin} currentUser={currentUser} onOpenClass={setActiveClassId} onQuickAdd={() => {}} />
          ))}
        </div>
      )}

      {showForm && <ClassFormModal onClose={() => { setShowForm(false); setPrefill(null); }} onSave={addClass} instructors={instructors} initialDay={prefill?.day} initialSlot={prefill?.slot} weekStart={prefill?.weekStart} isAdmin={isAdmin} currentUser={currentUser} />}
      {activeClass && <ClassDetailModal cls={activeClass} db={db} mutate={mutate} isAdmin={isAdmin} currentUser={currentUser} onClose={() => setActiveClassId(null)} />}
    </div>
  );
}

/* ============================= PAKETLER & ÖDEMELER (ADMIN) ============================= */

function PackagesTab({ db }) {
  const [query, setQuery] = useState("");
  const rows = db.packages
    .map((p) => ({ ...p, memberName: db.members.find((m) => m.id === p.memberId)?.name || "Silinmiş üye", paid: paidAmount(p), debt: debtAmount(p) }))
    .filter((p) => p.memberName.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => new Date(b.purchaseDate) - new Date(a.purchaseDate));

  const totalIncome = db.packages.reduce((s, p) => s + paidAmount(p), 0);
  const totalDebt = db.packages.reduce((s, p) => s + debtAmount(p), 0);

  return (
    <div className="flex flex-col gap-4">
      <h2 className="font-display text-xl font-semibold">Paketler & Ödemeler</h2>
      <div className="grid grid-cols-2 gap-3">
        <StatCard icon={Wallet} label="Toplam Tahsilat" value={fmtMoney(totalIncome)} accent="#E7F0EA" />
        <StatCard icon={AlertTriangle} label="Toplam Alacak" value={fmtMoney(totalDebt)} accent="#F7E7E2" />
      </div>
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8B8168]" />
        <input type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Üye adına göre ara..." className="!pl-9" />
      </div>
      <div className="card-surface rounded-2xl overflow-hidden">
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full text-sm min-w-[680px]">
            <thead>
              <tr className="text-left text-xs uppercase text-[#8B8168] border-b border-[#E7DFC9]">
                <th className="p-3 font-semibold">Üye</th>
                <th className="p-3 font-semibold">Paket</th>
                <th className="p-3 font-semibold">Kalan</th>
                <th className="p-3 font-semibold">Toplam</th>
                <th className="p-3 font-semibold">Ödenen</th>
                <th className="p-3 font-semibold">Borç</th>
                <th className="p-3 font-semibold">Tarih</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className="border-b border-[#EFE8D5] last:border-0">
                  <td className="p-3 font-medium">{p.memberName}</td>
                  <td className="p-3">{p.name}</td>
                  <td className="p-3 font-mono">{p.remainingSessions}/{p.totalSessions}</td>
                  <td className="p-3 font-mono">{fmtMoney(p.totalPrice)}</td>
                  <td className="p-3 font-mono">{fmtMoney(p.paid)}</td>
                  <td className="p-3 font-mono" style={{ color: p.debt > 0 ? "#B14A3A" : "#3E6B52" }}>{p.debt > 0 ? fmtMoney(p.debt) : "—"}</td>
                  <td className="p-3 text-[#8B8168]">{fmtDate(p.purchaseDate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && <EmptyState icon={CreditCard} title="Paket kaydı yok" />}
        </div>
      </div>
    </div>
  );
}

/* ============================= MUHASEBE (SADECE ADMIN) ============================= */

function ExpenseFormModal({ onClose, onSave }) {
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("Kira");
  const [customCategory, setCustomCategory] = useState("");
  const [date, setDate] = useState(todayISO());
  const finalCategory = category === "Diğer" ? customCategory.trim() : category;
  const canSave = description.trim() && amount && (category !== "Diğer" || customCategory.trim());
  return (
    <Modal
      title="Yeni Gider Ekle"
      onClose={onClose}
      footer={<button disabled={!canSave} onClick={() => onSave({ description: description.trim(), amount: Number(amount), category: finalCategory, date })} className="btn-primary rounded-xl py-3 font-semibold w-full disabled:opacity-40">Kaydet</button>}
    >
      <div className="flex flex-col gap-3">
        <Field label="Açıklama"><input type="text" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Örn. Elektrik faturası" /></Field>
        <Field label="Tutar (₺)"><input type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field label="Kategori">
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option>Kira</option><option>Personel Maaşı</option><option>Fatura</option><option>Ekipman</option><option>Temizlik</option><option>Pazarlama</option><option>Diğer</option>
          </select>
        </Field>
        {category === "Diğer" && (
          <Field label="Kategori Adı">
            <input type="text" value={customCategory} onChange={(e) => setCustomCategory(e.target.value)} placeholder="Örn. Vergi, Aidat..." />
          </Field>
        )}
        <Field label="Tarih"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

function FinanceTab({ db, mutate, currentUser }) {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [showExpenseForm, setShowExpenseForm] = useState(false);
  const [payingPkg, setPayingPkg] = useState(null);

  const allPayments = db.packages.flatMap((p) => (p.payments || []).map((pay) => ({ ...pay, memberName: db.members.find((m) => m.id === p.memberId)?.name || "Silinmiş üye", packageName: p.name })));
  const income = allPayments.filter((pay) => pay.date.slice(0, 7) === month);
  const expenses = db.expenses.filter((e) => e.date.slice(0, 7) === month);
  const totalIncome = income.reduce((s, p) => s + Number(p.amount || 0), 0);
  const totalExpense = expenses.reduce((s, e) => s + Number(e.amount || 0), 0);

  const byMethod = income.reduce((acc, p) => { acc[p.method] = (acc[p.method] || 0) + Number(p.amount || 0); return acc; }, {});

  const debtors = db.packages
    .map((p) => ({ ...p, memberName: db.members.find((m) => m.id === p.memberId)?.name || "Silinmiş üye", debt: debtAmount(p) }))
    .filter((p) => p.debt > 0)
    .sort((a, b) => b.debt - a.debt);
  const totalDebt = debtors.reduce((s, p) => s + p.debt, 0);

  const addExpense = (exp) => {
    mutate((d) => { d.expenses.push({ id: uid(), ...exp }); return d; });
    setShowExpenseForm(false);
  };
  const deleteExpense = (id) => {
    const e = db.expenses.find((x) => x.id === id);
    if (!window.confirm(`"${e?.description || "Bu gider"}" (${fmtMoney(e?.amount || 0)}) kaydını silmek istediğine emin misin?`)) return;
    mutate((d) => {
      const ex = d.expenses.find((x) => x.id === id);
      d.expenses = d.expenses.filter((x) => x.id !== id);
      logActivity(d, currentUser, `Gider silindi: ${ex?.description || ""} (${fmtMoney(ex?.amount || 0)})`);
      return d;
    });
  };
  const addPayment = (pkgId, payment) => {
    mutate((d) => {
      const p = d.packages.find((x) => x.id === pkgId);
      if (p) { p.payments = p.payments || []; p.payments.push({ id: uid(), ...payment }); }
      return d;
    });
    setPayingPkg(null);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="font-display text-xl font-semibold">Muhasebe</h2>
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="!w-auto" />
      </div>

      <div className="grid grid-cols-3 gap-3">
        <StatCard icon={TrendingUp} label="Tahsilat" value={fmtMoney(totalIncome)} accent="#E7F0EA" />
        <StatCard icon={TrendingDown} label="Gider" value={fmtMoney(totalExpense)} accent="#F7E7E2" />
        <StatCard icon={Wallet} label="Net" value={fmtMoney(totalIncome - totalExpense)} accent="#F5EDDA" />
      </div>

      <div className="card-surface rounded-2xl p-4">
        <p className="text-sm font-semibold mb-3">Ödeme Yöntemine Göre Tahsilat</p>
        {Object.keys(byMethod).length === 0 ? <p className="text-sm text-[#8B8168]">Bu ay tahsilat yok.</p> : (
          <div className="flex flex-col gap-2">
            {Object.entries(byMethod).map(([k, v]) => (
              <div key={k} className="flex items-center justify-between text-sm"><span>{k}</span><span className="font-mono">{fmtMoney(v)}</span></div>
            ))}
          </div>
        )}
      </div>

      <div className="card-surface rounded-2xl p-4">
        <div className="flex items-center justify-between mb-1">
          <p className="text-sm font-semibold flex items-center gap-1.5"><AlertTriangle size={15} className="text-[#B14A3A]" /> Alacaklar</p>
          <span className="font-mono text-sm text-[#B14A3A]">{fmtMoney(totalDebt)}</span>
        </div>
        <p className="text-xs text-[#8B8168] mb-3">Ödemesi tamamlanmamış paketler (tüm zamanlar).</p>
        {debtors.length === 0 ? <p className="text-sm text-[#8B8168]">Şu an borcu olan üye yok.</p> : (
          <div className="flex flex-col gap-2">
            {debtors.map((p) => (
              <div key={p.id} className="flex items-center justify-between text-sm">
                <div>
                  <p className="font-medium">{p.memberName}</p>
                  <p className="text-xs text-[#8B8168]">{p.name}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[#B14A3A]">{fmtMoney(p.debt)}</span>
                  <button onClick={() => setPayingPkg(p)} className="btn-teal text-xs font-semibold px-2.5 py-1.5 rounded-lg">Ödeme Al</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card-surface rounded-2xl p-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-semibold">Giderler</p>
          <button onClick={() => setShowExpenseForm(true)} className="btn-clay px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1"><Plus size={14} /> Gider Ekle</button>
        </div>
        {expenses.length === 0 ? <p className="text-sm text-[#8B8168]">Bu ay gider girilmedi.</p> : (
          <div className="flex flex-col gap-2">
            {expenses.map((e) => (
              <div key={e.id} className="flex items-center justify-between text-sm">
                <div>
                  <p className="font-medium">{e.description}</p>
                  <p className="text-xs text-[#8B8168]">{e.category} · {fmtDate(e.date)}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-mono">{fmtMoney(e.amount)}</span>
                  <button onClick={() => deleteExpense(e.id)} className="text-[#8B8168] hover:text-[#B14A3A]"><Trash2 size={14} /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showExpenseForm && <ExpenseFormModal onClose={() => setShowExpenseForm(false)} onSave={addExpense} />}
      {payingPkg && <AddPaymentModal debt={payingPkg.debt} onClose={() => setPayingPkg(null)} onSave={(payment) => addPayment(payingPkg.id, payment)} />}
    </div>
  );
}

/* ============================= PERSONEL, İZİN & GİRİŞ KAYITLARI (ADMIN) ============================= */

function StaffFormModal({ onClose, onSave }) {
  const [name, setName] = useState("");
  const [role, setRole] = useState("instructor");
  const [pin, setPin] = useState("");
  const [annualLeaveDays, setAnnualLeaveDays] = useState(14);
  return (
    <Modal
      title="Yeni Personel Ekle"
      onClose={onClose}
      footer={<button disabled={!name.trim() || pin.length !== 4} onClick={() => onSave({ name: name.trim(), role, pin, annualLeaveDays: Number(annualLeaveDays) })} className="btn-primary rounded-xl py-3 font-semibold w-full disabled:opacity-40">Kaydet</button>}
    >
      <div className="flex flex-col gap-3">
        <Field label="Ad Soyad"><input type="text" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Rol">
          <select value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="instructor">Hoca</option>
            <option value="admin">Yönetici</option>
          </select>
        </Field>
        <Field label="4 Haneli PIN"><input type="text" maxLength={4} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="1234" /></Field>
        {role === "instructor" && <Field label="Yıllık İzin Hakkı (gün)"><input type="number" min={0} value={annualLeaveDays} onChange={(e) => setAnnualLeaveDays(Number(e.target.value))} /></Field>}
      </div>
    </Modal>
  );
}

function LeaveFormModal({ onClose, onSave, staffName }) {
  const [mode, setMode] = useState("daily");
  const [startDate, setStartDate] = useState(todayISO());
  const [endDate, setEndDate] = useState(todayISO());
  const [hourDate, setHourDate] = useState(todayISO());
  const [hours, setHours] = useState(2);
  const [note, setNote] = useState("");
  const dailyDays = Math.max(daysBetweenInclusive(startDate, endDate), 1);
  const hourlyDays = Math.round((Number(hours) / 8) * 100) / 100;

  const save = () => {
    if (mode === "daily") {
      onSave({ type: "daily", startDate, endDate, days: dailyDays, note });
    } else {
      onSave({ type: "hourly", startDate: hourDate, endDate: hourDate, hours: Number(hours), days: hourlyDays, note });
    }
  };

  return (
    <Modal
      title={`${staffName} · İzin Ekle`}
      onClose={onClose}
      footer={<button onClick={save} className="btn-clay rounded-xl py-3 font-semibold w-full">Kaydet</button>}
    >
      <div className="flex flex-col gap-3">
        <div className="flex gap-2">
          <button onClick={() => setMode("daily")} className="flex-1 text-xs font-semibold py-2 rounded-lg" style={{ background: mode === "daily" ? "#20291F" : "#F4F0E6", color: mode === "daily" ? "#F4F0E6" : "#5B5340" }}>Günlük İzin</button>
          <button onClick={() => setMode("hourly")} className="flex-1 text-xs font-semibold py-2 rounded-lg" style={{ background: mode === "hourly" ? "#20291F" : "#F4F0E6", color: mode === "hourly" ? "#F4F0E6" : "#5B5340" }}>Saatlik İzin</button>
        </div>

        {mode === "daily" ? (
          <>
            <Field label="Başlangıç"><input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></Field>
            <Field label="Bitiş"><input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></Field>
            <p className="text-xs text-[#8B8168]">Toplam <b className="font-mono">{dailyDays}</b> gün ({dailyDays * 8} saat)</p>
          </>
        ) : (
          <>
            <Field label="Tarih"><input type="date" value={hourDate} onChange={(e) => setHourDate(e.target.value)} /></Field>
            <Field label="Saat Sayısı"><input type="number" min={1} max={8} step={1} value={hours} onChange={(e) => setHours(e.target.value)} /></Field>
            <p className="text-xs text-[#8B8168]">Yıllık izinden <b className="font-mono">{hourlyDays}</b> gün karşılığı düşülecek.</p>
          </>
        )}

        <Field label="Not (opsiyonel)"><input type="text" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

function PinChangeModal({ staffName, onClose, onSave }) {
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const mismatch = confirmPin.length === 4 && pin !== confirmPin;
  return (
    <Modal
      title={`${staffName} · PIN Değiştir`}
      onClose={onClose}
      footer={
        <button
          disabled={pin.length !== 4 || pin !== confirmPin}
          onClick={() => onSave(pin)}
          className="btn-primary rounded-xl py-3 font-semibold w-full disabled:opacity-40"
        >
          PIN'i Kaydet
        </button>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="Yeni 4 Haneli PIN">
          <input type="text" inputMode="numeric" maxLength={4} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="••••" />
        </Field>
        <Field label="Yeni PIN (tekrar)">
          <input type="text" inputMode="numeric" maxLength={4} value={confirmPin} onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="••••" />
        </Field>
        {mismatch && <p className="text-xs text-[#B14A3A]">PIN'ler eşleşmiyor.</p>}
      </div>
    </Modal>
  );
}

function computePunctuality(db, periodPrefix) {
  const instructors = db.staff.filter((s) => s.role === "instructor");
  return instructors.map((ins) => {
    const checkins = db.checkins.filter((c) => c.staffId === ins.id && c.type !== "out" && c.timestamp.startsWith(periodPrefix));
    const byDate = {};
    checkins.forEach((c) => {
      const dstr = c.timestamp.slice(0, 10);
      if (!byDate[dstr] || new Date(c.timestamp) < new Date(byDate[dstr].timestamp)) byDate[dstr] = c;
    });
    let onTime = 0, late = 0;
    const lateDetails = [];
    Object.entries(byDate).forEach(([dateStr, checkin]) => {
      const jsDay = new Date(dateStr + "T00:00:00").getDay();
      const ourIndex = (jsDay + 6) % 7;
      const classesThatDay = db.classes.filter((c) => c.instructorId === ins.id && c.dayOfWeek === ourIndex && c.weekStart === getMonday(dateStr)).sort((a, b) => a.timeSlot.localeCompare(b.timeSlot));
      if (classesThatDay.length === 0) return;
      const firstClass = classesThatDay[0];
      const firstStart = firstClass.timeSlot.split("-")[0];
      const checkinDate = new Date(checkin.timestamp);
      const checkinMinutes = checkinDate.getHours() * 60 + checkinDate.getMinutes();
      const [ch, cm] = firstStart.split(":").map(Number);
      const classMinutes = ch * 60 + cm;
      const diff = checkinMinutes - classMinutes;
      if (diff > 5) {
        late++;
        lateDetails.push({
          date: dateStr,
          classTitle: firstClass.title,
          classStart: firstStart,
          checkinTime: checkinDate.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" }),
          lateMinutes: diff,
        });
      } else {
        onTime++;
      }
    });
    return { staffId: ins.id, name: ins.name, totalMatched: onTime + late, onTime, late, lateDetails: lateDetails.sort((a, b) => new Date(b.date) - new Date(a.date)) };
  });
}

/* ============================= HOCA DETAY (GÖREVLER & PERFORMANS) ============================= */

function InstructorDetail({ db, mutate, staffMember, onBack, currentUser }) {
  const [taskDate, setTaskDate] = useState(todayISO());
  const [newTaskName, setNewTaskName] = useState("");
  const [noteType, setNoteType] = useState("positive");
  const [noteText, setNoteText] = useState("");
  const [periodMode, setPeriodMode] = useState("month");
  const [monthValue, setMonthValue] = useState(new Date().toISOString().slice(0, 7));
  const [yearValue, setYearValue] = useState(String(new Date().getFullYear()));

  const taskDefs = db.taskDefinitions || [];
  const logsForDate = db.taskLogs.filter((l) => l.staffId === staffMember.id && l.date === taskDate);
  const myNotes = (db.performanceNotes || []).filter((n) => n.staffId === staffMember.id).sort((a, b) => new Date(b.date) - new Date(a.date));

  const periodPrefix = periodMode === "month" ? monthValue : yearValue;

  const setTaskStatus = (taskId, done) => {
    mutate((d) => {
      const existing = d.taskLogs.find((l) => l.staffId === staffMember.id && l.taskId === taskId && l.date === taskDate);
      if (existing) existing.done = done;
      else d.taskLogs.push({ id: uid(), staffId: staffMember.id, taskId, date: taskDate, done });
      return d;
    });
  };
  const addTaskDefinition = () => {
    if (!newTaskName.trim()) return;
    mutate((d) => { d.taskDefinitions = d.taskDefinitions || []; d.taskDefinitions.push({ id: uid(), name: newTaskName.trim() }); return d; });
    setNewTaskName("");
  };
  const removeTaskDefinition = (id) => {
    const t = db.taskDefinitions.find((x) => x.id === id);
    if (!window.confirm(`"${t?.name || "Bu görev"}" görev tanımını silmek istediğine emin misin? Bu göreve ait tüm geçmiş kayıtlar da silinecek.`)) return;
    mutate((d) => {
      const td = d.taskDefinitions.find((x) => x.id === id);
      d.taskDefinitions = d.taskDefinitions.filter((x) => x.id !== id);
      d.taskLogs = d.taskLogs.filter((l) => l.taskId !== id);
      logActivity(d, currentUser, `Görev tanımı silindi: ${td?.name || ""}`);
      return d;
    });
  };

  const addNote = () => {
    if (!noteText.trim()) return;
    mutate((d) => { d.performanceNotes = d.performanceNotes || []; d.performanceNotes.push({ id: uid(), staffId: staffMember.id, type: noteType, text: noteText.trim(), date: todayISO() }); return d; });
    setNoteText("");
  };
  const deleteNote = (id) => {
    const n = db.performanceNotes.find((x) => x.id === id);
    if (!window.confirm(`Bu performans notunu silmek istediğine emin misin? "${n?.text || ""}"`)) return;
    mutate((d) => {
      const pn = d.performanceNotes.find((x) => x.id === id);
      d.performanceNotes = d.performanceNotes.filter((x) => x.id !== id);
      logActivity(d, currentUser, `Performans notu silindi: ${staffMember.name} · "${pn?.text || ""}"`);
      return d;
    });
  };

  const tasksInPeriod = db.taskLogs.filter((l) => l.staffId === staffMember.id && l.date.startsWith(periodPrefix));
  const doneCount = tasksInPeriod.filter((l) => l.done).length;
  const notDoneCount = tasksInPeriod.filter((l) => !l.done).length;
  const notesInPeriod = myNotes.filter((n) => n.date.startsWith(periodPrefix));
  const positiveCount = notesInPeriod.filter((n) => n.type === "positive").length;
  const negativeCount = notesInPeriod.filter((n) => n.type === "negative").length;
  const punctualityAll = useMemo(() => computePunctuality(db, periodPrefix), [db.checkins, db.classes, periodPrefix]);
  const myPunctuality = punctualityAll.find((p) => p.staffId === staffMember.id) || { onTime: 0, late: 0, totalMatched: 0 };

  return (
    <div className="flex flex-col gap-4">
      <button onClick={onBack} className="flex items-center gap-1 text-sm text-[#8B8168] w-fit"><ArrowLeft size={14} /> Personele dön</button>

      <div className="card-surface rounded-2xl p-5">
        <h2 className="font-display text-xl font-semibold">{staffMember.name}</h2>
        <p className="text-sm text-[#8B8168]">Hoca</p>
      </div>

      <div className="card-surface rounded-2xl p-4">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-1">
          <p className="text-sm font-semibold">Performans Özeti</p>
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={() => setPeriodMode("month")} className="text-xs font-semibold px-2.5 py-1.5 rounded-lg" style={{ background: periodMode === "month" ? "#20291F" : "#F4F0E6", color: periodMode === "month" ? "#F4F0E6" : "#5B5340" }}>Aylık</button>
            <button onClick={() => setPeriodMode("year")} className="text-xs font-semibold px-2.5 py-1.5 rounded-lg" style={{ background: periodMode === "year" ? "#20291F" : "#F4F0E6", color: periodMode === "year" ? "#F4F0E6" : "#5B5340" }}>Yıllık</button>
            {periodMode === "month" ? (
              <input type="month" value={monthValue} onChange={(e) => setMonthValue(e.target.value)} className="!w-auto" />
            ) : (
              <input type="number" value={yearValue} onChange={(e) => setYearValue(e.target.value)} className="!w-24" />
            )}
          </div>
        </div>
        <p className="text-xs text-[#8B8168] mb-3">Yıl sonu değerlendirmesi için hızlı özet.</p>
        <div className="grid grid-cols-2 gap-3 mb-3">
          <StatCard icon={CheckCircle2} label="Yapılan Görev" value={doneCount} accent="#E7F0EA" />
          <StatCard icon={XCircle} label="Yapılmayan Görev" value={notDoneCount} accent="#F7E7E2" />
          <StatCard icon={TrendingUp} label="Olumlu Not" value={positiveCount} accent="#E7F0EA" />
          <StatCard icon={TrendingDown} label="Olumsuz Not" value={negativeCount} accent="#F7E7E2" />
        </div>
        <div className="flex items-center gap-2">
          <Badge color="#3E6B52" bg="#E7F0EA">{myPunctuality.onTime} gün zamanında</Badge>
          <Badge color="#B14A3A" bg="#F7E7E2">{myPunctuality.late} gün geç kaldı</Badge>
        </div>
      </div>

      <div className="card-surface rounded-2xl p-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-semibold">Günlük Görevler</p>
          <input type="date" value={taskDate} onChange={(e) => setTaskDate(e.target.value)} className="!w-auto" />
        </div>
        {taskDefs.length === 0 ? (
          <p className="text-sm text-[#8B8168]">Henüz görev tanımlanmadı, aşağıdan ekleyebilirsin.</p>
        ) : (
          <div className="flex flex-col gap-2 mb-3">
            {taskDefs.map((t) => {
              const log = logsForDate.find((l) => l.taskId === t.id);
              return (
                <div key={t.id} className="flex items-center justify-between gap-2 bg-[#F4F0E6] rounded-xl px-3 py-2 flex-wrap">
                  <span className="text-sm">{t.name}</span>
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => setTaskStatus(t.id, true)} className="text-xs font-semibold px-2.5 py-1.5 rounded-lg" style={{ background: log?.done === true ? "#3E6B52" : "#FCFAF4", color: log?.done === true ? "#FCFAF4" : "#5B5340" }}>Yaptı</button>
                    <button onClick={() => setTaskStatus(t.id, false)} className="text-xs font-semibold px-2.5 py-1.5 rounded-lg" style={{ background: log?.done === false ? "#B14A3A" : "#FCFAF4", color: log?.done === false ? "#FCFAF4" : "#5B5340" }}>Yapmadı</button>
                    <button onClick={() => removeTaskDefinition(t.id)} className="text-[#8B8168] hover:text-[#B14A3A]"><X size={14} /></button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <div className="flex items-center gap-2">
          <input type="text" value={newTaskName} onChange={(e) => setNewTaskName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addTaskDefinition(); }} placeholder="Yeni görev tanımla (örn. Üye Videosu Gönderimi)" />
          <button onClick={addTaskDefinition} className="btn-primary rounded-xl px-3 py-2 shrink-0"><Plus size={16} /></button>
        </div>
        <p className="text-xs text-[#8B8168] mt-2">Not: Görev tanımları tüm hocalar için ortaktır, burada eklediğin herkeste görünür.</p>
      </div>

      <div className="card-surface rounded-2xl p-4">
        <p className="text-sm font-semibold mb-3">Performans Notu (olumlu / olumsuz)</p>
        <div className="flex flex-col gap-2 mb-3">
          <div className="flex gap-2">
            <button onClick={() => setNoteType("positive")} className="flex-1 text-xs font-semibold py-2 rounded-lg" style={{ background: noteType === "positive" ? "#3E6B52" : "#F4F0E6", color: noteType === "positive" ? "#FCFAF4" : "#5B5340" }}>Olumlu</button>
            <button onClick={() => setNoteType("negative")} className="flex-1 text-xs font-semibold py-2 rounded-lg" style={{ background: noteType === "negative" ? "#B14A3A" : "#F4F0E6", color: noteType === "negative" ? "#FCFAF4" : "#5B5340" }}>Olumsuz</button>
          </div>
          <textarea rows={2} value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="Örn. Üyelerle ilişkileri çok iyi, ekstra çaba gösteriyor..." />
          <button onClick={addNote} className="btn-clay rounded-xl py-2.5 text-sm font-semibold">Notu Kaydet</button>
        </div>
        {myNotes.length === 0 ? (
          <p className="text-sm text-[#8B8168]">Henüz not eklenmedi.</p>
        ) : (
          <div className="flex flex-col gap-2 max-h-72 overflow-y-auto scrollbar-thin pr-1">
            {myNotes.map((n) => (
              <div key={n.id} className="flex items-start justify-between gap-2 bg-[#F4F0E6] rounded-xl px-3 py-2">
                <div className="min-w-0">
                  <Badge color={n.type === "positive" ? "#3E6B52" : "#B14A3A"} bg={n.type === "positive" ? "#E7F0EA" : "#F7E7E2"}>{n.type === "positive" ? "Olumlu" : "Olumsuz"}</Badge>
                  <p className="text-sm mt-1">{n.text}</p>
                  <p className="text-xs text-[#8B8168] mt-0.5">{fmtDate(n.date)}</p>
                </div>
                <button onClick={() => deleteNote(n.id)} className="text-[#8B8168] hover:text-[#B14A3A] shrink-0"><Trash2 size={14} /></button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StaffTab({ db, mutate, currentUser }) {
  const [showForm, setShowForm] = useState(false);
  const [leaveFor, setLeaveFor] = useState(null);
  const [pinFor, setPinFor] = useState(null);
  const [punctualityMonth, setPunctualityMonth] = useState(new Date().toISOString().slice(0, 7));
  const [selectedStaffId, setSelectedStaffId] = useState(null);

  const addStaff = (data) => { mutate((d) => { d.staff.push({ id: uid(), ...data, active: true }); return d; }); setShowForm(false); };
  const toggleActive = (id) => mutate((d) => { const s = d.staff.find((x) => x.id === id); if (s) s.active = !s.active; return d; });
  const updateLeaveDays = (id, val) => mutate((d) => { const s = d.staff.find((x) => x.id === id); if (s) s.annualLeaveDays = Number(val) || 0; return d; });
  const changePin = (id, newPin) => {
    mutate((d) => {
      const s = d.staff.find((x) => x.id === id);
      if (s) s.pin = newPin;
      logActivity(d, currentUser, `PIN değiştirildi: ${s?.name || "Personel"}`);
      return d;
    });
    setPinFor(null);
  };
  const addLeave = (staffId, data) => { mutate((d) => { d.leaveRecords.push({ id: uid(), staffId, ...data }); return d; }); setLeaveFor(null); };
  const deleteLeave = (id) => {
    const l = db.leaveRecords.find((x) => x.id === id);
    const s = db.staff.find((x) => x.id === l?.staffId);
    const desc = l ? (l.type === "hourly" ? `${fmtDate(l.startDate)} (Saatlik, ${l.hours} saat)` : `${fmtDate(l.startDate)} – ${fmtDate(l.endDate)}`) : "";
    if (!window.confirm(`${s?.name || "Bu personel"} için ${desc} izin kaydını silmek istediğine emin misin?`)) return;
    mutate((d) => {
      const rec = d.leaveRecords.find((x) => x.id === id);
      const st = d.staff.find((x) => x.id === rec?.staffId);
      d.leaveRecords = d.leaveRecords.filter((x) => x.id !== id);
      logActivity(d, currentUser, `İzin kaydı silindi: ${st?.name || "Personel"} · ${rec ? fmtDate(rec.startDate) + " – " + fmtDate(rec.endDate) : ""}`);
      return d;
    });
  };

  const recentCheckins = [...db.checkins].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)).slice(0, 30);
  const punctuality = useMemo(() => computePunctuality(db, punctualityMonth), [db.checkins, db.classes, db.staff, punctualityMonth]);

  const selectedStaff = db.staff.find((s) => s.id === selectedStaffId);
  if (selectedStaff) {
    return <InstructorDetail db={db} mutate={mutate} staffMember={selectedStaff} onBack={() => setSelectedStaffId(null)} currentUser={currentUser} />;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-xl font-semibold">Personel</h2>
        <button onClick={() => setShowForm(true)} className="btn-primary px-4 py-2 rounded-xl text-sm font-semibold flex items-center gap-1.5"><Plus size={16} /> Yeni Personel</button>
      </div>

      <div className="card-surface rounded-2xl p-4">
        <div className="flex flex-col gap-3">
          {db.staff.map((s) => {
            const used = db.leaveRecords.filter((l) => l.staffId === s.id).reduce((sum, l) => sum + l.days, 0);
            const remaining = Math.max((s.annualLeaveDays || 0) - used, 0);
            return (
              <div key={s.id} className="flex flex-col gap-2 pb-3 border-b border-[#EFE8D5] last:border-0 last:pb-0">
                <div className="flex items-center justify-between text-sm flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    {s.role === "admin" ? <ShieldCheck size={15} className="text-[#3E6B52]" /> : <UserCheck size={15} className="text-[#2F6F8F]" />}
                    <span className={!s.active ? "line-through text-[#8B8168]" : "font-medium"}>{s.name}</span>
                    <span className="text-xs text-[#8B8168] font-mono">PIN ••••</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => setPinFor(s)} className="text-xs font-semibold px-2.5 py-1 rounded-lg" style={{ background: "#F5EDDA", color: "#A98330" }}>
                      PIN Değiştir
                    </button>
                    <button onClick={() => toggleActive(s.id)} className="text-xs font-semibold px-2.5 py-1 rounded-lg" style={{ background: s.active ? "#F7E7E2" : "#E7F0EA", color: s.active ? "#B14A3A" : "#3E6B52" }}>
                      {s.active ? "Pasifleştir" : "Aktifleştir"}
                    </button>
                    {s.role === "instructor" && (
                      <button onClick={() => setSelectedStaffId(s.id)} className="text-xs font-semibold px-2.5 py-1 rounded-lg flex items-center gap-1" style={{ background: "#E4EEF2", color: "#2F6F8F" }}>
                        Detaylar <ChevronRight size={13} />
                      </button>
                    )}
                  </div>
                </div>
                {s.role === "instructor" && (
                  <div className="flex items-center justify-between gap-2 bg-[#F4F0E6] rounded-xl p-2.5 flex-wrap">
                    <div className="flex items-center gap-2 text-xs">
                      <PlaneTakeoff size={13} className="text-[#2F6F8F]" />
                      <span>Yıllık izin hakkı: </span>
                      <input type="number" defaultValue={s.annualLeaveDays} onBlur={(e) => updateLeaveDays(s.id, e.target.value)} className="!w-16 !py-1 !px-2" />
                      <span>gün</span>
                      <span className="text-[#8B8168]">· Kalan: <b>{remaining} gün</b> ({remaining * 8} saat)</span>
                    </div>
                    <button onClick={() => setLeaveFor(s)} className="btn-teal text-xs font-semibold px-2.5 py-1.5 rounded-lg flex items-center gap-1"><Plus size={12} /> İzin Ekle</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {db.leaveRecords.length > 0 && (
        <div className="card-surface rounded-2xl p-4">
          <p className="text-sm font-semibold mb-3">İzin Kayıtları</p>
          <div className="flex flex-col gap-2 max-h-64 overflow-y-auto scrollbar-thin pr-1">
            {[...db.leaveRecords].sort((a, b) => new Date(b.startDate) - new Date(a.startDate)).map((l) => {
              const s = db.staff.find((x) => x.id === l.staffId);
              return (
                <div key={l.id} className="flex items-center justify-between text-sm">
                  <span>{s?.name || "Silinmiş personel"} · {l.type === "hourly" ? `${fmtDate(l.startDate)} (Saatlik)` : `${fmtDate(l.startDate)} – ${fmtDate(l.endDate)}`}</span>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-[#8B8168]">{l.type === "hourly" ? `${l.hours} saat` : `${l.days} gün`}</span>
                    <button onClick={() => deleteLeave(l.id)} className="text-[#8B8168] hover:text-[#B14A3A]"><Trash2 size={13} /></button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="card-surface rounded-2xl p-4">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-1">
          <p className="text-sm font-semibold flex items-center gap-1.5"><Clock size={15} /> Hoca Devam & Dakiklik Raporu</p>
          <input type="month" value={punctualityMonth} onChange={(e) => setPunctualityMonth(e.target.value)} className="!w-auto" />
        </div>
        <p className="text-xs text-[#8B8168] mb-3">Giriş saati, o günkü ilk dersin başlama saatiyle karşılaştırılır (5 dakika tolerans). Ders programı olmayan günler hesaba katılmaz.</p>
        {punctuality.every((p) => p.totalMatched === 0) ? (
          <p className="text-sm text-[#8B8168]">Bu ay için karşılaştırılabilir veri yok.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {punctuality.filter((p) => p.totalMatched > 0).map((p) => (
              <div key={p.staffId} className="pb-3 border-b border-[#EFE8D5] last:border-0 last:pb-0">
                <div className="flex items-center justify-between text-sm mb-1.5">
                  <span className="font-medium">{p.name}</span>
                  <span className="text-xs text-[#8B8168]">{p.totalMatched} gün karşılaştırıldı</span>
                </div>
                <div className="flex items-center gap-2 mb-2">
                  <Badge color="#3E6B52" bg="#E7F0EA">{p.onTime} zamanında</Badge>
                  <Badge color="#B14A3A" bg="#F7E7E2">{p.late} geç kaldı</Badge>
                </div>
                {p.lateDetails.length > 0 && (
                  <div className="flex flex-col gap-1">
                    {p.lateDetails.map((l, i) => (
                      <div key={i} className="flex items-center justify-between text-xs text-[#8B8168] flex-wrap gap-1">
                        <span>{fmtDate(l.date)} · {l.classTitle} ({l.classStart})</span>
                        <span className="font-mono text-[#B14A3A]">{l.checkinTime} · +{l.lateMinutes} dk</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card-surface rounded-2xl p-4">
        <p className="text-sm font-semibold mb-3">Giriş Kayıtları (Konum Doğrulama)</p>
        {recentCheckins.length === 0 ? <p className="text-sm text-[#8B8168]">Henüz giriş kaydı yok.</p> : (
          <div className="flex flex-col gap-2 max-h-96 overflow-y-auto scrollbar-thin pr-1">
            {recentCheckins.map((c) => {
              const s = db.staff.find((x) => x.id === c.staffId);
              return (
                <div key={c.id} className="flex items-center justify-between text-sm border-b border-[#EFE8D5] pb-2 last:border-0">
                  <div>
                    <p className="font-medium">{s?.name || "Silinmiş personel"}</p>
                    <p className="text-xs text-[#8B8168] font-mono flex items-center gap-1.5">
                      <Badge color={c.type === "out" ? "#2F6F8F" : "#3E6B52"} bg={c.type === "out" ? "#E4EEF2" : "#E7F0EA"}>{c.type === "out" ? "Çıkış" : "Giriş"}</Badge>
                      {fmtDateTime(c.timestamp)}
                    </p>
                  </div>
                  <div className="text-right">
                    <Badge color={c.verified ? "#3E6B52" : "#B14A3A"} bg={c.verified ? "#E7F0EA" : "#F7E7E2"}>
                      {c.verified ? "Doğrulandı" : "Konum Uyumsuz"}
                    </Badge>
                    {c.distance != null && <p className="text-xs text-[#8B8168] mt-0.5 font-mono">{Math.round(c.distance)} m</p>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {showForm && <StaffFormModal onClose={() => setShowForm(false)} onSave={addStaff} />}
      {leaveFor && <LeaveFormModal staffName={leaveFor.name} onClose={() => setLeaveFor(null)} onSave={(data) => addLeave(leaveFor.id, data)} />}
      {pinFor && <PinChangeModal staffName={pinFor.name} onClose={() => setPinFor(null)} onSave={(newPin) => changePin(pinFor.id, newPin)} />}
    </div>
  );
}

/* ============================= GİRİŞ YAP (KONUM) ============================= */

function CheckinTab({ db, mutate, currentUser }) {
  const [status, setStatus] = useState("idle");
  const [warning, setWarning] = useState("");
  const [lastResult, setLastResult] = useState(null);

  const myCheckins = db.checkins.filter((c) => c.staffId === currentUser.id).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)).slice(0, 15);
  const studio = db.studio;
  const studioSet = studio.lat != null && studio.lng != null;

  const finish = (record, warn) => {
    mutate((d) => { d.checkins.push(record); return d; });
    setLastResult(record);
    setWarning(warn || "");
    setStatus("done");
  };

  const doCheckin = (type) => {
    setStatus("loading");
    setWarning("");
    if (!navigator.geolocation) {
      finish(
        { id: uid(), staffId: currentUser.id, type, timestamp: new Date().toISOString(), lat: null, lng: null, distance: null, verified: false },
        "Bu cihaz konum servisini desteklemiyor, kayıt konum doğrulanmadan alındı."
      );
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        if (!studioSet) {
          finish(
            { id: uid(), staffId: currentUser.id, type, timestamp: new Date().toISOString(), lat: latitude, lng: longitude, distance: null, verified: false },
            "Yönetici henüz stüdyo konumunu tanımlamadı, kayıt konum doğrulanmadan alındı."
          );
          return;
        }
        const dist = distanceMeters(latitude, longitude, studio.lat, studio.lng);
        const verified = dist !== null && dist <= studio.radius;
        finish({ id: uid(), staffId: currentUser.id, type, timestamp: new Date().toISOString(), lat: latitude, lng: longitude, distance: dist, verified });
      },
      (err) => {
        finish(
          { id: uid(), staffId: currentUser.id, type, timestamp: new Date().toISOString(), lat: null, lng: null, distance: null, verified: false },
          err.code === 1 ? "Konum izni verilmedi, kayıt konum doğrulanmadan alındı." : "Konum alınamadı, kayıt konum doğrulanmadan alındı."
        );
      },
      { enableHighAccuracy: true, timeout: 12000 }
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <h2 className="font-display text-xl font-semibold">Giriş / Çıkış</h2>

      <div className="card-surface rounded-2xl p-6 flex flex-col items-center text-center gap-4">
        <div className="w-16 h-16 rounded-2xl bg-[#20291F] flex items-center justify-center">
          <Navigation size={26} color="#F4F0E6" />
        </div>
        <div>
          <p className="font-display text-lg font-semibold">{studio.name}</p>
          <p className="text-sm text-[#8B8168]">İşe gelirken "Giriş", öğle arası veya gün sonunda ayrılırken "Çıkış" yap.</p>
        </div>
        <div className="flex gap-2 w-full">
          <button onClick={() => doCheckin("in")} disabled={status === "loading"} className="btn-clay flex-1 py-3.5 rounded-xl font-semibold flex items-center justify-center gap-2 disabled:opacity-60">
            {status === "loading" ? <Loader2 size={18} className="animate-spin" /> : <><MapPin size={18} /> Giriş Yap</>}
          </button>
          <button onClick={() => doCheckin("out")} disabled={status === "loading"} className="btn-teal flex-1 py-3.5 rounded-xl font-semibold flex items-center justify-center gap-2 disabled:opacity-60">
            {status === "loading" ? <Loader2 size={18} className="animate-spin" /> : <><LogOut size={18} /> Çıkış Yap</>}
          </button>
        </div>

        {status === "done" && lastResult && (
          <div className={`w-full text-sm rounded-xl p-3 flex items-start gap-2 text-left ${lastResult.verified ? "bg-[#E7F0EA] text-[#3E6B52]" : "bg-[#F5EDDA] text-[#A98330]"}`}>
            {lastResult.verified ? <CheckCircle2 size={16} className="shrink-0 mt-0.5" /> : <AlertTriangle size={16} className="shrink-0 mt-0.5" />}
            <span>
              {warning
                ? warning
                : lastResult.verified
                  ? `${lastResult.type === "out" ? "Çıkış" : "Giriş"} kaydedildi — stüdyo konumundan ${Math.round(lastResult.distance)} m mesafedesin.`
                  : `${lastResult.type === "out" ? "Çıkış" : "Giriş"} kaydedildi ancak stüdyodan ${Math.round(lastResult.distance)} m uzaktasın, konum doğrulanamadı.`}
            </span>
          </div>
        )}
      </div>

      <div className="card-surface rounded-2xl p-4">
        <p className="text-sm font-semibold mb-3">Geçmiş Kayıtlarım</p>
        {myCheckins.length === 0 ? <p className="text-sm text-[#8B8168]">Henüz kaydın yok.</p> : (
          <div className="flex flex-col gap-2">
            {myCheckins.map((c) => (
              <div key={c.id} className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2">
                  <Badge color={c.type === "out" ? "#2F6F8F" : "#3E6B52"} bg={c.type === "out" ? "#E4EEF2" : "#E7F0EA"}>{c.type === "out" ? "Çıkış" : "Giriş"}</Badge>
                  <span className="font-mono text-xs">{fmtDateTime(c.timestamp)}</span>
                </span>
                <Badge color={c.verified ? "#3E6B52" : "#B14A3A"} bg={c.verified ? "#E7F0EA" : "#F7E7E2"}>{c.verified ? "Doğrulandı" : "Uyumsuz"}</Badge>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
function ReportsTab({ db }) {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));

  const newMembersData = useMemo(() => {
    const months = [];
    const now = new Date();
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      const label = d.toLocaleDateString("tr-TR", { month: "short", year: "2-digit" });
      const count = db.members.filter((m) => { if (!m.createdAt) return false; const cd = new Date(m.createdAt); return `${cd.getFullYear()}-${cd.getMonth()}` === key; }).length;
      months.push({ label, "Yeni Üye": count });
    }
    return months;
  }, [db.members]);

  const riskMembers = db.members.filter((m) => {
    if (!m.active) return false;
    const pkgs = db.packages.filter((p) => p.memberId === m.id);
    if (pkgs.length === 0) return false;
    const totalRemaining = pkgs.reduce((s, p) => s + p.remainingSessions, 0);
    const lastPurchase = pkgs.map((p) => new Date(p.purchaseDate)).sort((a, b) => b - a)[0];
    const daysSince = (Date.now() - lastPurchase.getTime()) / 86400000;
    return totalRemaining === 0 && daysSince > 30;
  });

  const packagesByType = useMemo(() => {
    const map = {};
    db.packages.forEach((p) => {
      if (!p.purchaseDate || p.purchaseDate.slice(0, 7) !== month) return;
      const t = p.serviceType || "Reformer Pilates";
      if (!map[t]) map[t] = { count: 0, revenue: 0 };
      map[t].count += 1;
      map[t].revenue += p.totalPrice;
    });
    return Object.entries(map).map(([type, v]) => ({ type, ...v })).sort((a, b) => b.revenue - a.revenue);
  }, [db.packages, month]);

  const sessionsByInstructor = useMemo(() => {
    const map = {};
    db.attendance.forEach((a) => {
      if (a.date.slice(0, 7) !== month) return;
      if (a.status !== "attended" && a.status !== "burned") return;
      const ins = db.staff.find((s) => s.id === a.instructorId);
      const name = ins?.name || "Bilinmeyen";
      map[name] = (map[name] || 0) + 1;
    });
    return Object.entries(map).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
  }, [db.attendance, db.staff, month]);

  const exportMonthlyReport = () => {
    const wb = XLSX.utils.book_new();
    const income = db.packages.flatMap((p) => (p.payments || [])
      .filter((pay) => pay.date.slice(0, 7) === month)
      .map((pay) => ({
        Üye: db.members.find((m) => m.id === p.memberId)?.name || "", Paket: p.name, Tutar: pay.amount, Ödeme: pay.method, Tarih: pay.date,
      })));
    const expenses = db.expenses.filter((e) => e.date.slice(0, 7) === month).map((e) => ({ Açıklama: e.description, Tutar: e.amount, Kategori: e.category, Tarih: e.date }));
    const attendance = db.attendance.filter((a) => a.date.slice(0, 7) === month).map((a) => ({ Üye: db.members.find((m) => m.id === a.memberId)?.name || "", Durum: STATUS_META[a.status].label, Tarih: a.date }));
    const newMembers = db.members.filter((m) => m.createdAt && m.createdAt.slice(0, 7) === month).map((m) => ({ Ad: m.name, Telefon: m.phone, "Kayıt Tarihi": m.createdAt?.slice(0, 10) }));
    const receivables = db.packages.filter((p) => debtAmount(p) > 0).map((p) => ({ Üye: db.members.find((m) => m.id === p.memberId)?.name || "", Paket: p.name, Toplam: p.totalPrice, Ödenen: paidAmount(p), Borç: debtAmount(p) }));

    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(income), "Gelir");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(expenses), "Gider");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(attendance), "Yoklama");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(newMembers), "Yeni Üyeler");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(receivables), "Alacaklar");
    XLSX.writeFile(wb, `rapor-${month}.xlsx`);
  };

  return (
    <div className="flex flex-col gap-4">
      <h2 className="font-display text-xl font-semibold">Raporlar</h2>

      <div className="card-surface rounded-2xl p-4">
        <p className="text-sm font-semibold mb-3">Son 12 Ay Yeni Üye Trendi</p>
        <div style={{ width: "100%", height: 200 }}>
          <ResponsiveContainer>
            <LineChart data={newMembersData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E7DFC9" />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#8B8168" }} axisLine={{ stroke: "#DED6C2" }} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: "#8B8168" }} axisLine={false} tickLine={false} width={28} allowDecimals={false} />
              <Tooltip contentStyle={{ background: "#FCFAF4", border: "1px solid #E7DFC9", borderRadius: 10, fontSize: 12 }} />
              <Line type="monotone" dataKey="Yeni Üye" stroke="#3E6B52" strokeWidth={2.5} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="card-surface rounded-2xl p-4">
        <p className="text-sm font-semibold mb-2 flex items-center gap-1.5"><AlertTriangle size={15} className="text-[#B14A3A]" /> Risk Altındaki Üyeler</p>
        <p className="text-xs text-[#8B8168] mb-3">Paketi tamamen bitmiş ve 30 gündür yeni paket almamış üyeler.</p>
        {riskMembers.length === 0 ? <p className="text-sm text-[#8B8168]">Şu an risk altında üye yok.</p> : (
          <div className="flex flex-col gap-1.5">
            {riskMembers.map((m) => <div key={m.id} className="flex items-center justify-between text-sm"><span>{m.name}</span>{m.phone && <a href={waLink(m.phone, `Merhaba ${m.name}, paketin sona ermiş görünüyor. Yeni bir paket için seni bekleriz! 🙂`)} target="_blank" rel="noreferrer" className="text-xs font-semibold text-[#2F6F8F] flex items-center gap-1"><MessageCircle size={12} /> Yaz</a>}</div>)}
          </div>
        )}
      </div>

      <div className="card-surface rounded-2xl p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <p className="text-sm font-semibold">Dönem</p>
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="!w-auto" />
        </div>
      </div>

      <div className="card-surface rounded-2xl p-4">
        <p className="text-sm font-semibold mb-1">Paket Türüne Göre Satış</p>
        <p className="text-xs text-[#8B8168] mb-3">Seçilen ay içinde satın alınan paketler, türüne göre gruplanmış.</p>
        {packagesByType.length === 0 ? <p className="text-sm text-[#8B8168]">Bu ay paket satışı yok.</p> : (
          <div className="flex flex-col gap-1.5">
            {packagesByType.map((row) => (
              <div key={row.type} className="flex items-center justify-between text-sm">
                <span>{row.type}</span>
                <span className="font-mono text-xs text-[#8B8168]">{row.count} paket · {fmtMoney(row.revenue)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card-surface rounded-2xl p-4">
        <p className="text-sm font-semibold mb-1">Hoca Başına Seans Sayısı</p>
        <p className="text-xs text-[#8B8168] mb-3">Seçilen ay içinde her hocanın yaptırdığı (Geldi/Gelmedi işaretlenen) seans sayısı — bir iş yükü/performans göstergesi. Gelir, paketler üyeye bağlı kaydedildiği için hoca bazında kesin olarak ayrıştırılamıyor.</p>
        {sessionsByInstructor.length === 0 ? <p className="text-sm text-[#8B8168]">Bu ay yoklama kaydı yok.</p> : (
          <div className="flex flex-col gap-1.5">
            {sessionsByInstructor.map((row) => (
              <div key={row.name} className="flex items-center justify-between text-sm">
                <span>{row.name}</span>
                <span className="font-mono text-xs text-[#8B8168]">{row.count} seans</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card-surface rounded-2xl p-4 flex flex-col gap-3">
        <p className="text-sm font-semibold flex items-center gap-1.5"><FileSpreadsheet size={15} /> Aylık Rapor İndir</p>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={exportMonthlyReport} className="btn-clay px-4 py-2.5 rounded-xl text-sm font-semibold flex items-center gap-2"><Download size={15} /> Excel İndir</button>
        </div>
        <p className="text-xs text-[#8B8168]">Yukarıda seçtiğin dönem için gelir, gider, yoklama ve yeni üye verilerini içeren .xlsx dosyası indirilir.</p>
      </div>
    </div>
  );
}

/* ============================= AYARLAR (ADMIN) ============================= */

function AutoBackupsList({ db }) {
  const [backups, setBackups] = useState(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const { data, error: err } = await supabase.from("backups").select("id, created_at").order("created_at", { ascending: false }).limit(10);
        if (err) throw err;
        setBackups(data || []);
      } catch (e) {
        setError(true);
      }
    })();
  }, []);

  const downloadBackup = async (id) => {
    try {
      const { data, error: err } = await supabase.from("backups").select("data, created_at").eq("id", id).single();
      if (err || !data) return;
      const blob = new Blob([JSON.stringify(data.data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `otomatik-yedek-${data.created_at.slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {}
  };

  return (
    <div className="card-surface rounded-2xl p-4 flex flex-col gap-2">
      <p className="text-sm font-semibold flex items-center gap-1.5"><Clock size={15} /> Otomatik Yedekler</p>
      <p className="text-xs text-[#8B8168]">
        Sistem her hafta otomatik olarak bir yedek alır (son {backups?.length ?? "…"} yedek saklanıyor).
        {db.lastAutoBackup ? ` Son otomatik yedek: ${fmtDateTime(db.lastAutoBackup)}.` : ""}
      </p>
      {error && <p className="text-xs text-[#B14A3A]">Yedek listesi alınamadı.</p>}
      {backups && backups.length === 0 && <p className="text-xs text-[#8B8168]">Henüz otomatik yedek oluşmadı.</p>}
      {backups && backups.length > 0 && (
        <div className="flex flex-col gap-1.5 mt-1">
          {backups.map((b) => (
            <div key={b.id} className="flex items-center justify-between text-sm">
              <span className="font-mono text-xs text-[#8B8168]">{fmtDateTime(b.created_at)}</span>
              <button onClick={() => downloadBackup(b.id)} className="text-xs font-semibold px-2.5 py-1 rounded-lg flex items-center gap-1" style={{ background: "#E4EEF2", color: "#2F6F8F" }}>
                <Download size={12} /> İndir
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function maintenanceNextDue(task) {
  return addDays(task.lastDoneDate || task.createdAt.slice(0, 10), task.intervalDays);
}

function MaintenanceFormModal({ onClose, onSave }) {
  const [title, setTitle] = useState("");
  const [roomId, setRoomId] = useState("none");
  const [intervalDays, setIntervalDays] = useState(30);

  return (
    <Modal
      title="Yeni Bakım Görevi"
      onClose={onClose}
      footer={<button disabled={!title.trim()} onClick={() => onSave({ title: title.trim(), roomId, intervalDays: Number(intervalDays) })} className="btn-primary rounded-xl py-3 font-semibold w-full disabled:opacity-40">Kaydet</button>}
    >
      <div className="flex flex-col gap-3">
        <Field label="Görev Adı"><input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Örn. Masaj sedyesi bakımı" /></Field>
        <Field label="Oda (opsiyonel)">
          <select value={roomId} onChange={(e) => setRoomId(e.target.value)}>
            <option value="none">Genel / Belirli bir oda değil</option>
            {ROOMS.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </Field>
        <Field label="Tekrar Sıklığı (gün)"><input type="number" min={1} value={intervalDays} onChange={(e) => setIntervalDays(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

function MaintenanceSection({ db, mutate }) {
  const [showForm, setShowForm] = useState(false);
  const tasks = db.maintenanceTasks || [];

  const addTask = (data) => {
    mutate((d) => {
      d.maintenanceTasks = d.maintenanceTasks || [];
      d.maintenanceTasks.push({ id: uid(), ...data, lastDoneDate: null, createdAt: new Date().toISOString() });
      return d;
    });
    setShowForm(false);
  };
  const markDone = (id) => mutate((d) => { const t = (d.maintenanceTasks || []).find((x) => x.id === id); if (t) t.lastDoneDate = todayISO(); return d; });
  const removeTask = (id) => {
    const t = tasks.find((x) => x.id === id);
    if (!window.confirm(`"${t?.title || "Bu bakım görevi"}" görevini silmek istediğine emin misin?`)) return;
    mutate((d) => { d.maintenanceTasks = (d.maintenanceTasks || []).filter((x) => x.id !== id); return d; });
  };

  const today = todayISO();
  const sorted = [...tasks].sort((a, b) => new Date(maintenanceNextDue(a)) - new Date(maintenanceNextDue(b)));

  return (
    <div className="card-surface rounded-2xl p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold flex items-center gap-1.5"><Wrench size={15} /> Ekipman & Oda Bakımı</p>
        <button onClick={() => setShowForm(true)} className="text-xs font-semibold px-2.5 py-1.5 rounded-lg flex items-center gap-1" style={{ background: "#E4EEF2", color: "#2F6F8F" }}><Plus size={12} /> Yeni Görev</button>
      </div>
      {sorted.length === 0 ? (
        <p className="text-xs text-[#8B8168]">Henüz periyodik bir bakım görevi tanımlanmadı.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {sorted.map((t) => {
            const due = maintenanceNextDue(t);
            const overdue = due < today;
            const room = ROOMS.find((r) => r.id === t.roomId);
            return (
              <div key={t.id} className="flex items-center justify-between gap-2 flex-wrap bg-[#F4F0E6] rounded-xl p-2.5">
                <div>
                  <p className="text-sm font-medium">{t.title}{room ? ` · ${room.name}` : ""}</p>
                  <p className="text-xs" style={{ color: overdue ? "#B14A3A" : "#8B8168" }}>
                    {overdue ? "Süresi geçti — " : "Sıradaki bakım: "}{fmtDate(due)}
                    {t.lastDoneDate ? ` (son yapılan: ${fmtDate(t.lastDoneDate)})` : " (hiç yapılmadı)"}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button onClick={() => markDone(t.id)} className="text-xs font-semibold px-2.5 py-1.5 rounded-lg" style={{ background: "#E7F0EA", color: "#3E6B52" }}>Yapıldı</button>
                  <button onClick={() => removeTask(t.id)} className="text-[#8B8168] hover:text-[#B14A3A]"><Trash2 size={14} /></button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {showForm && <MaintenanceFormModal onClose={() => setShowForm(false)} onSave={addTask} />}
    </div>
  );
}

function SettingsTab({ db, mutate }) {
  const [name, setName] = useState(db.studio.name);
  const [address, setAddress] = useState(db.studio.address);
  const [lat, setLat] = useState(db.studio.lat);
  const [lng, setLng] = useState(db.studio.lng);
  const [radius, setRadius] = useState(db.studio.radius);
  const [locStatus, setLocStatus] = useState("idle");
  const [saved, setSaved] = useState(false);
  const [importStatus, setImportStatus] = useState("idle");
  const fileInputRef = useRef(null);

  const useCurrentLocation = () => {
    if (!navigator.geolocation) return;
    setLocStatus("loading");
    navigator.geolocation.getCurrentPosition(
      (pos) => { setLat(pos.coords.latitude); setLng(pos.coords.longitude); setLocStatus("done"); },
      () => setLocStatus("error"),
      { enableHighAccuracy: true, timeout: 12000 }
    );
  };

  const save = () => {
    mutate((d) => { d.studio = { name, address, lat: lat != null ? Number(lat) : null, lng: lng != null ? Number(lng) : null, radius: Number(radius) || 150 }; return d; });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleExport = () => {
    const blob = new Blob([JSON.stringify(db, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pilates-yedek-${todayISO()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleImportFile = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target.result);
        if (!parsed || !Array.isArray(parsed.members) || !Array.isArray(parsed.staff) || !Array.isArray(parsed.packages)) {
          setImportStatus("error");
          return;
        }
        const confirmed = window.confirm("Mevcut tüm veriler bu yedek dosyasındaki verilerle değiştirilecek. Bu işlem geri alınamaz. Emin misin?");
        if (!confirmed) { setImportStatus("idle"); return; }
        mutate(() => migrateDB(parsed));
        setImportStatus("success");
        setTimeout(() => setImportStatus("idle"), 4000);
      } catch (err) {
        setImportStatus("error");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  return (
    <div className="flex flex-col gap-4">
      <h2 className="font-display text-xl font-semibold">Ayarlar</h2>
      <div className="card-surface rounded-2xl p-4 flex flex-col gap-3">
        <Field label="Stüdyo Adı"><input type="text" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Adres"><input type="text" value={address} onChange={(e) => setAddress(e.target.value)} /></Field>

        <div className="bg-[#F4F0E6] rounded-xl p-3 flex flex-col gap-2">
          <p className="text-sm font-semibold flex items-center gap-1.5"><MapPin size={15} /> Konum Doğrulama Noktası</p>
          <p className="text-xs text-[#8B8168]">Hocaların giriş yaparken karşılaştırılacağı stüdyo konumu. Stüdyoda iken aşağıdaki butona bas.</p>
          <button onClick={useCurrentLocation} className="btn-primary rounded-xl py-2.5 text-sm font-semibold flex items-center justify-center gap-2">
            {locStatus === "loading" ? <><Loader2 size={15} className="animate-spin" /> Konum alınıyor...</> : <><Navigation size={15} /> Şu Anki Konumu Kullan</>}
          </button>
          {locStatus === "error" && <p className="text-xs text-[#B14A3A]">Konum alınamadı, tarayıcı izinlerini kontrol edin.</p>}
          <div className="grid grid-cols-2 gap-2 mt-1">
            <Field label="Enlem (lat)"><input type="number" value={lat ?? ""} onChange={(e) => setLat(e.target.value)} /></Field>
            <Field label="Boylam (lng)"><input type="number" value={lng ?? ""} onChange={(e) => setLng(e.target.value)} /></Field>
          </div>
          <Field label="Tolerans Yarıçapı (metre)"><input type="number" value={radius} onChange={(e) => setRadius(e.target.value)} /></Field>
        </div>

        <button onClick={save} className="btn-clay rounded-xl py-3 font-semibold">{saved ? "Kaydedildi ✓" : "Ayarları Kaydet"}</button>
      </div>

      <div className="card-surface rounded-2xl p-4 flex flex-col gap-3">
        <p className="text-sm font-semibold flex items-center gap-1.5"><Download size={15} /> Yedekleme & Geri Yükleme</p>
        <p className="text-xs text-[#8B8168]">Tüm üye, paket, ödeme, yoklama, ders programı ve personel verilerini bir dosyaya indir. Düzenli olarak yedek almanı öneririz.</p>
        <button onClick={handleExport} className="btn-primary rounded-xl py-2.5 text-sm font-semibold flex items-center justify-center gap-2">
          <Download size={15} /> Yedeği İndir (.json)
        </button>
        <label className="btn-clay rounded-xl py-2.5 text-sm font-semibold flex items-center justify-center gap-2 cursor-pointer">
          <Upload size={15} /> Yedekten Geri Yükle
          <input ref={fileInputRef} type="file" accept="application/json" onChange={handleImportFile} className="hidden" />
        </label>
        {importStatus === "success" && <p className="text-xs text-[#3E6B52]">Veriler başarıyla geri yüklendi.</p>}
        {importStatus === "error" && <p className="text-xs text-[#B14A3A]">Dosya okunamadı veya geçersiz format — geçerli bir yedek dosyası seç.</p>}
      </div>

      <AutoBackupsList db={db} />

      <MaintenanceSection db={db} mutate={mutate} />

      <div className="card-surface rounded-2xl p-4">
        <p className="text-sm font-semibold mb-1 flex items-center gap-1.5"><Clock size={15} /> Değişiklik Kaydı</p>
        <p className="text-xs text-[#8B8168] mb-3">Kim, ne zaman, ne ekledi veya sildi — en yeniden eskiye.</p>
        {(db.activityLog || []).length === 0 ? (
          <p className="text-sm text-[#8B8168]">Henüz kayıtlı işlem yok.</p>
        ) : (
          <div className="flex flex-col gap-2 max-h-96 overflow-y-auto scrollbar-thin pr-1">
            {[...db.activityLog].reverse().map((log) => (
              <div key={log.id} className="text-sm border-b border-[#EFE8D5] pb-2 last:border-0">
                <p>{log.description}</p>
                <p className="text-xs text-[#8B8168] mt-0.5">{log.actorName} · {fmtDateTime(log.timestamp)}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ============================= NAVİGASYON ============================= */

const ADMIN_TABS = [
  { id: "overview", label: "Genel Bakış", icon: Home },
  { id: "members", label: "Üyeler", icon: Users },
  { id: "prospects", label: "Bekleyen Adaylar", icon: PlaneTakeoff },
  { id: "packages", label: "Paketler", icon: CreditCard },
  { id: "attendance", label: "Yoklama", icon: CalendarCheck },
  { id: "makeups", label: "Telafiler", icon: RefreshCcw },
  { id: "schedule", label: "Ders Programı", icon: CalendarDays },
  { id: "finance", label: "Muhasebe", icon: Wallet },
  { id: "staff", label: "Personel", icon: ShieldCheck },
  { id: "reports", label: "Raporlar", icon: BarChart3 },
  { id: "settings", label: "Ayarlar", icon: SettingsIcon },
];
const INSTRUCTOR_TABS = [
  { id: "overview", label: "Genel Bakış", icon: Home },
  { id: "members", label: "Üyeler", icon: Users },
  { id: "prospects", label: "Bekleyen Adaylar", icon: PlaneTakeoff },
  { id: "attendance", label: "Yoklama", icon: CalendarCheck },
  { id: "makeups", label: "Telafiler", icon: RefreshCcw },
  { id: "schedule", label: "Programım", icon: CalendarDays },
  { id: "checkin", label: "Giriş Yap", icon: MapPin },
];

function Sidebar({ tabs, activeTab, setActiveTab, currentUser, onLogout, studioName, syncing }) {
  return (
    <div className="hidden md:flex flex-col w-60 shrink-0 border-r border-[#E7DFC9] bg-[#FCFAF4] fixed h-screen">
      <div className="p-5 border-b border-[#E7DFC9]">
        <p className="font-display text-lg font-semibold leading-tight">{studioName}</p>
        <p className="text-xs text-[#8B8168] mt-1">{currentUser.role === "admin" ? "Yönetici Paneli" : "Hoca Paneli"}</p>
        {syncing && <p className="text-xs text-[#3E6B52] mt-1 flex items-center gap-1"><Loader2 size={11} className="animate-spin" /> Senkronize ediliyor...</p>}
      </div>
      <div className="flex-1 p-3 flex flex-col gap-1 overflow-y-auto scrollbar-thin">
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setActiveTab(t.id)} className={`flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-sm font-medium text-left ${activeTab === t.id ? "btn-primary" : "text-[#3B3626] hover:bg-[#F4F0E6]"}`}>
            <t.icon size={17} /> {t.label}
          </button>
        ))}
      </div>
      <div className="p-3 border-t border-[#E7DFC9]">
        <div className="px-3.5 py-2 text-sm font-medium text-[#3B3626] truncate">{currentUser.name}</div>
        <button onClick={onLogout} className="w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-sm font-medium text-[#B14A3A] hover:bg-[#F7E7E2]">
          <LogOut size={16} /> Çıkış Yap
        </button>
      </div>
    </div>
  );
}

function BottomNav({ tabs, activeTab, setActiveTab }) {
  return (
    <div className="md:hidden fixed bottom-0 left-0 right-0 bg-[#FCFAF4] border-t border-[#E7DFC9] flex justify-around py-2.5 z-40 overflow-x-auto scrollbar-thin" style={{ scrollSnapType: "x proximity" }}>
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => setActiveTab(t.id)}
          className={`flex flex-col items-center justify-center gap-1 px-3 rounded-xl min-w-[68px] shrink-0 ${activeTab === t.id ? "text-[#20291F] bg-[#F4F0E6]" : "text-[#8B8168]"}`}
          style={{ minHeight: 58, scrollSnapAlign: "start" }}
        >
          <t.icon size={22} />
          <span className="text-[10px] font-semibold leading-none whitespace-nowrap">{t.label}</span>
        </button>
      ))}
    </div>
  );
}

/* ============================= ANA UYGULAMA ============================= */

export default function App() {
  const [db, setDb] = useState(null);
  const [loading, setLoading] = useState(true);
  const [dbError, setDbError] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [activeTab, setActiveTab] = useState("overview");
  const [syncing, setSyncing] = useState(false);
  const [offline, setOffline] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const mutateChainRef = useRef(Promise.resolve());
  const pendingQueueRef = useRef([]);
  const currentUserRef = useRef(null);
  useEffect(() => { currentUserRef.current = currentUser; }, [currentUser]);

  useEffect(() => {
    (async () => {
      let d = await loadDB();
      if (!d) {
        setDbError(true);
        setLoading(false);
        return;
      }
      d = migrateDB(d);
      setDb(d);
      setLoading(false);
      // Bilinçli olarak oturum hatırlanmıyor: paylaşılan/ortak cihazlarda yanlış
      // kişi adına işlem yapılmasın diye her sayfa açılışında PIN ekranı gelir.

      // Haftalık otomatik yedekleme (arka planda, sessizce) — son yedek 7+ gün önceyse yenisini al.
      try {
        const lastBackup = d.lastAutoBackup ? new Date(d.lastAutoBackup) : null;
        const daysSince = lastBackup ? (Date.now() - lastBackup.getTime()) / 86400000 : Infinity;
        if (daysSince >= 7) {
          await supabase.from("backups").insert({ data: d });
          const updated = { ...d, lastAutoBackup: new Date().toISOString() };
          await saveDB(updated);
          setDb(updated);
          const { data: allBackups } = await supabase.from("backups").select("id, created_at").order("created_at", { ascending: false });
          if (allBackups && allBackups.length > 8) {
            for (const b of allBackups.slice(8)) await supabase.from("backups").delete().eq("id", b.id);
          }
        }
      } catch (e) {
        console.error("Otomatik yedekleme hatası", e);
      }
    })();
  }, []);

  // Diğer kullanıcıların yaptığı değişiklikleri anlık (realtime) olarak yansıt,
  // bağlantı koparsa diye uzun aralıklı bir yedek yoklama da tut.
  useEffect(() => {
    const channel = supabase
      .channel("app_state_sync")
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "app_state", filter: "id=eq.1" }, (payload) => {
        if (payload.new && payload.new.data) {
          const migrated = migrateDB(payload.new.data);
          setDb(migrated);
          const cu = currentUserRef.current;
          if (cu) {
            const stillActive = migrated.staff.find((s) => s.id === cu.id && s.active);
            if (!stillActive) { setCurrentUser(null); }
          }
        }
      })
      .subscribe();

    const interval = setInterval(async () => {
      try {
        const latest = await loadDB();
        if (latest) setDb(migrateDB(latest));
      } catch (e) {}
    }, 60000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
    };
  }, []);

  // Her kayıt işlemi, ekrandaki eski kopya yerine depodaki EN GÜNCEL veriyi baz alır
  // ve işlemler sıraya alınır — böylece iki kişi aynı anda kaydetse bile biri diğerinin
  // alakasız değişikliğini sessizce silmez. Kayıt internet/Supabase kopukluğu yüzünden
  // başarısız olursa, değişiklik EKRANDA kalır ama arka planda bir kuyruğa alınır ve
  // bağlantı geri gelince otomatik olarak tekrar gönderilir — kaybolmaz.
  const mutate = useCallback((updater) => {
    setSyncing(true);
    mutateChainRef.current = mutateChainRef.current
      .then(async () => {
        const { ok, next } = await attemptMutation(updater);
        setDb(next);
        if (!ok) {
          pendingQueueRef.current.push(updater);
          setPendingCount(pendingQueueRef.current.length);
          setOffline(true);
        }
      })
      .catch((e) => console.error("Kayıt hatası", e))
      .finally(() => setSyncing(false));
  }, []);

  const flushQueue = useCallback(() => {
    if (pendingQueueRef.current.length === 0) return;
    setSyncing(true);
    mutateChainRef.current = mutateChainRef.current
      .then(async () => {
        while (pendingQueueRef.current.length > 0) {
          const queuedUpdater = pendingQueueRef.current[0];
          const { ok, next } = await attemptMutation(queuedUpdater);
          if (!ok) break;
          pendingQueueRef.current.shift();
          setPendingCount(pendingQueueRef.current.length);
          setDb(next);
        }
        if (pendingQueueRef.current.length === 0) setOffline(false);
      })
      .catch((e) => console.error("Senkronizasyon hatası", e))
      .finally(() => setSyncing(false));
  }, []);

  // Bağlantı geri geldiğinde ve periyodik olarak bekleyen değişiklikleri göndermeyi dene.
  useEffect(() => {
    const onOnline = () => flushQueue();
    window.addEventListener("online", onOnline);
    const retryInterval = setInterval(() => { if (pendingQueueRef.current.length > 0) flushQueue(); }, 20000);
    return () => { window.removeEventListener("online", onOnline); clearInterval(retryInterval); };
  }, [flushQueue]);

  const handleLogin = (staff) => { setCurrentUser(staff); setActiveTab("overview"); };
  const handleLogout = () => { setCurrentUser(null); };

  if (dbError) {
    return (
      <div className="studio-root min-h-screen flex items-center justify-center p-4">
        <StyleTag />
        <div className="card-surface rounded-2xl p-6 max-w-sm text-center flex flex-col gap-3">
          <p className="font-display text-lg font-semibold text-[#B14A3A]">Veritabanına bağlanılamadı</p>
          <p className="text-sm text-[#5B5340]">Supabase bağlantı bilgilerini (URL / anon key) ve <code className="font-mono text-xs">app_state</code> tablosunun oluşturulduğunu kontrol et, sonra sayfayı yenile.</p>
        </div>
      </div>
    );
  }

  if (loading || !db) {
    return (
      <div className="studio-root min-h-screen flex items-center justify-center">
        <StyleTag />
        <Loader2 className="animate-spin text-[#3E6B52]" size={28} />
      </div>
    );
  }

  if (!currentUser) {
    return <LoginScreen db={db} onLogin={handleLogin} />;
  }

  const isAdmin = currentUser.role === "admin";
  const tabs = isAdmin ? ADMIN_TABS : INSTRUCTOR_TABS;
  const visibleTab = tabs.find((t) => t.id === activeTab) ? activeTab : "overview";

  return (
    <div className="studio-root min-h-screen">
      <StyleTag />
      <Sidebar tabs={tabs} activeTab={visibleTab} setActiveTab={setActiveTab} currentUser={currentUser} onLogout={handleLogout} studioName={db.studio.name} syncing={syncing} />

      {offline && (
        <div className="md:ml-60 flex items-center justify-between gap-2 px-4 py-2 text-xs font-semibold flex-wrap" style={{ background: "#F5EDDA", color: "#A98330" }}>
          <span className="flex items-center gap-1.5"><AlertTriangle size={13} /> Çevrimdışı — {pendingCount} değişiklik gönderilmeyi bekliyor. Bağlantı gelince otomatik gönderilecek.</span>
          <button onClick={flushQueue} className="underline shrink-0">Şimdi Dene</button>
        </div>
      )}

      <div className="md:hidden flex items-center justify-between px-4 py-3 border-b border-[#E7DFC9] bg-[#FCFAF4] sticky top-0 z-30">
        <div>
          <p className="font-display text-base font-semibold leading-tight">{db.studio.name}</p>
          <p className="text-xs text-[#8B8168]">{currentUser.name}</p>
        </div>
        <button onClick={handleLogout} aria-label="Çıkış Yap" className="w-9 h-9 rounded-full flex items-center justify-center bg-[#F4F0E6] text-[#B14A3A]"><LogOut size={16} /></button>
      </div>

      <div className="md:ml-60 p-4 md:p-8 pb-28 md:pb-8 max-w-4xl">
        {visibleTab === "overview" && <OverviewTab db={db} mutate={mutate} isAdmin={isAdmin} currentUser={currentUser} setActiveTab={setActiveTab} />}
        {visibleTab === "members" && <MembersTab db={db} mutate={mutate} isAdmin={isAdmin} currentUser={currentUser} />}
        {visibleTab === "prospects" && <ProspectsTab db={db} mutate={mutate} currentUser={currentUser} />}
        {visibleTab === "packages" && isAdmin && <PackagesTab db={db} />}
        {visibleTab === "attendance" && <AttendanceTab db={db} mutate={mutate} currentUser={currentUser} isAdmin={isAdmin} />}
        {visibleTab === "makeups" && <MakeupsTab db={db} mutate={mutate} isAdmin={isAdmin} currentUser={currentUser} />}
        {visibleTab === "schedule" && <ScheduleTab db={db} mutate={mutate} isAdmin={isAdmin} currentUser={currentUser} />}
        {visibleTab === "finance" && isAdmin && <FinanceTab db={db} mutate={mutate} currentUser={currentUser} />}
        {visibleTab === "staff" && isAdmin && <StaffTab db={db} mutate={mutate} currentUser={currentUser} />}
        {visibleTab === "reports" && isAdmin && <ReportsTab db={db} />}
        {visibleTab === "checkin" && !isAdmin && <CheckinTab db={db} mutate={mutate} currentUser={currentUser} />}
        {visibleTab === "settings" && isAdmin && <SettingsTab db={db} mutate={mutate} />}
      </div>

      <BottomNav tabs={tabs} activeTab={visibleTab} setActiveTab={setActiveTab} />
      <ToastHost />
    </div>
  );
}
