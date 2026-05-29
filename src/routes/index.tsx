import { createFileRoute, redirect, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import {
  DEPARTMENTS, DEPT_LABELS, DEPT_ICONS, calcDelayDays, formatMoney,
  type Department,
} from "@/lib/departments";
import {
  acceptOrderFn, deliverOrderFn, createOrderFn, updateDeadlineFn,
  moveOrderFn, deleteOrderFn, adminCreateUserFn, updateOrderFn,
  getOrderHistoryFn, getSettingsFn, updateSettingsFn,
} from "@/lib/orders.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { LogOut, Plus, Settings, AlertTriangle, Search, BarChart3, Cog, CheckCircle2, ArrowRight, Clock } from "lucide-react";

export const Route = createFileRoute("/")({
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw redirect({ to: "/login" });
  },
  component: DashboardPage,
});

type Order = {
  id: string; number: string; filial: string; doors_count: number;
  product_type: string; current_department: Department;
  previous_department: Department | null;
  status: "pending_accept" | "in_progress" | "delivered";
  deadline: string | null; position_deadlines: Record<string, string>;
  pogonaj_required: boolean; pogonaj_status: string; comment: string;
  entered_current_dept_at: string; created_at: string;
};

function useSettings() {
  return useQuery({
    queryKey: ["app_settings"],
    queryFn: async () => {
      const { data } = await supabase.from("app_settings").select("key, value");
      const map: Record<string, any> = {};
      (data ?? []).forEach((r: any) => { map[r.key] = r.value; });
      const asArr = (v: any): string[] => Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
      return {
        penalty_per_day: Number(map.penalty_per_day ?? 100000),
        telegram_hour_utc: Number(map.telegram_hour_utc ?? 4),
        filials: asArr(map.filials),
        product_types: asArr(map.product_types),
      };
    },
  });
}

async function saveCatalog(key: "filials" | "product_types", value: string[]) {
  const { error } = await supabase.from("app_settings").upsert({ key, value: value as any }, { onConflict: "key" });
  if (error) throw error;
}



function DashboardPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [deptFilter, setDeptFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");

  const settings = useSettings();
  const PENALTY = settings.data?.penalty_per_day ?? 100000;

  useEffect(() => {
    if (!auth.loading && !auth.user) navigate({ to: "/login" });
  }, [auth.loading, auth.user, navigate]);

  const { data: orders = [] } = useQuery({
    queryKey: ["orders"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orders").select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Order[];
    },
    enabled: !!auth.user,
  });

  useEffect(() => {
    if (!auth.user) return;
    const ch = supabase
      .channel("orders-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, () => {
        qc.invalidateQueries({ queryKey: ["orders"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [auth.user, qc]);

  const filtered = orders.filter((o) => {
    if (search) {
      const s = search.toLowerCase();
      if (!o.number.toLowerCase().includes(s) && !o.filial.toLowerCase().includes(s)) return false;
    }
    if (statusFilter !== "all" && o.status !== statusFilter) return false;
    if (dateFrom && new Date(o.entered_current_dept_at) < new Date(dateFrom)) return false;
    if (dateTo && new Date(o.entered_current_dept_at) > new Date(dateTo + "T23:59:59")) return false;
    return true;
  });

  // Card appears in column if:
  //  • current_department === dept (always), OR
  //  • previous_department === dept AND status === 'pending_accept' (deliverer side ghost)
  function cardsForDept(dept: Department) {
    return filtered.filter((o) => {
      if (deptFilter !== "all" && deptFilter !== dept) return false;
      return o.current_department === dept || (o.status === "pending_accept" && o.previous_department === dept);
    });
  }

  // Penalty/delay: blame goes to previous_department while pending_accept
  function blameDept(o: Order): Department {
    return (o.status === "pending_accept" && o.previous_department) ? o.previous_department : o.current_department;
  }
  function delayInfo(o: Order) {
    const dept = blameDept(o);
    const dl = o.position_deadlines?.[dept] || o.deadline;
    const days = calcDelayDays(dl);
    return { dept, dl, days, penalty: days * PENALTY };
  }

  const delayed = filtered.filter((o) => o.status !== "delivered" && delayInfo(o).days > 0);
  const totalPenalty = delayed.reduce((s, o) => s + delayInfo(o).penalty, 0);

  if (auth.loading) return <div className="min-h-screen flex items-center justify-center">Yuklanmoqda...</div>;
  if (!auth.user) return null;

  return (
    <div className="min-h-screen bg-[radial-gradient(ellipse_at_top,_oklch(0.97_0.04_265)_0%,_oklch(0.985_0.005_240)_45%,_oklch(0.95_0.03_180)_100%)]">
      <header className="border-b border-border bg-card sticky top-0 z-20 backdrop-blur supports-[backdrop-filter]:bg-card/80">
        <div className="px-4 md:px-6 py-3 flex items-center gap-3 flex-wrap">
          <h1 className="text-lg md:text-xl font-bold tracking-tight">🏭 Ishlab chiqarish CRM</h1>
          <div className="ml-auto flex items-center gap-2 flex-wrap">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Qidirish..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8 w-48 md:w-64" />
            </div>
            <Link to="/stats"><Button size="sm" variant="outline"><BarChart3 className="h-4 w-4 mr-1" />Statistika</Button></Link>
            {auth.isAdmin && <NewOrderDialog />}
            {auth.isAdmin && <AdminPanel />}
            {auth.isAdmin && <SettingsDialog />}
            <Button variant="ghost" size="sm" onClick={async () => { await supabase.auth.signOut(); navigate({ to: "/login" }); }}>
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <div className="px-4 md:px-6 pb-3 flex items-center gap-2 flex-wrap border-t border-border pt-3">
          <Select value={deptFilter} onValueChange={setDeptFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Bo'lim" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Barcha bo'limlar</SelectItem>
              {DEPARTMENTS.map((d) => <SelectItem key={d} value={d}>{DEPT_ICONS[d]} {DEPT_LABELS[d]}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Holat" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Barcha holatlar</SelectItem>
              <SelectItem value="pending_accept">🔴 Qabul kutilmoqda</SelectItem>
              <SelectItem value="in_progress">🟠 Jarayonda</SelectItem>
              <SelectItem value="delivered">🟢 Tugagan</SelectItem>
            </SelectContent>
          </Select>
          <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-40" />
          <span className="text-xs text-muted-foreground">—</span>
          <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-40" />
          {(deptFilter !== "all" || statusFilter !== "all" || dateFrom || dateTo) && (
            <Button size="sm" variant="ghost" onClick={() => { setDeptFilter("all"); setStatusFilter("all"); setDateFrom(""); setDateTo(""); }}>Tozalash</Button>
          )}
        </div>
        {delayed.length > 0 && (
          <div className="bg-status-pending/10 border-t border-status-pending/30 px-4 md:px-6 py-2 text-sm flex items-center gap-2 text-status-pending">
            <AlertTriangle className="h-4 w-4" />
            <span><b>{delayed.length}</b> ta kechikkan zayavka • Jami jarima: <b>{formatMoney(totalPenalty)}</b></span>
          </div>
        )}
      </header>

      <main className="overflow-x-auto p-4 md:p-6">
        <div className="flex gap-4 min-w-max">
          {DEPARTMENTS.map((dept) => {
            const cards = cardsForDept(dept);
            return (
              <div key={dept} className="w-80 flex-shrink-0">
                <div className="bg-gradient-to-br from-secondary to-secondary/60 rounded-xl p-3 mb-3 flex items-center justify-between shadow-sm">
                  <h2 className="font-semibold text-sm flex items-center gap-2">
                    <span className="text-base">{DEPT_ICONS[dept]}</span>
                    {DEPT_LABELS[dept]}
                  </h2>
                  <Badge variant="outline" className="bg-card">{cards.length}</Badge>
                </div>
                <div className="space-y-3">
                  {cards.map((o) => (
                    <OrderCard key={o.id + dept} order={o} columnDept={dept} auth={auth} penalty={PENALTY} blameDept={blameDept(o)} />
                  ))}
                  {cards.length === 0 && (
                    <div className="text-xs text-muted-foreground text-center py-8 border-2 border-dashed border-border rounded-lg">
                      Bo'sh
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </main>
    </div>
  );
}

function OrderCard({ order, columnDept, auth, penalty, blameDept }: {
  order: Order; columnDept: Department; auth: ReturnType<typeof useAuth>; penalty: number; blameDept: Department;
}) {
  const accept = useServerFn(acceptOrderFn);
  const deliver = useServerFn(deliverOrderFn);
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  // ghost = card showing on previous_department's column while waiting for receiver
  const isGhost = order.status === "pending_accept" && order.previous_department === columnDept && order.current_department !== columnDept;
  const isReceiverPending = order.status === "pending_accept" && order.current_department === columnDept;

  const positionDeadline = order.position_deadlines?.[blameDept] || order.deadline;
  const delayDays = calcDelayDays(positionDeadline);
  const isDelayed = order.status !== "delivered" && delayDays > 0;
  const penaltyAmount = delayDays * penalty;

  const canActOnDept = !isGhost && (auth.isAdmin || auth.roles.includes(order.current_department as any));

  // Color logic
  let bg = "bg-card border-border";
  let extra = "";
  if (isGhost) { bg = "bg-status-done/15 border-status-done/50"; extra = "ring-2 ring-status-done/30"; }
  else if (order.status === "delivered") bg = "bg-status-done/10 border-status-done/40";
  else if (isReceiverPending) { bg = "bg-status-pending/15 border-status-pending"; extra = "animate-pulse-red"; }
  else if (order.status === "in_progress") bg = "bg-status-accepted/20 border-status-accepted";

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={`w-full text-left rounded-xl border-2 ${bg} ${extra} p-3 hover:shadow-lg transition-all animate-slide-up`}
      >
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="font-mono font-bold text-sm">#{order.number}</div>
          {isGhost && <Badge className="bg-status-done text-status-done-fg gap-1">✅ Topshirildi</Badge>}
          {!isGhost && order.status === "pending_accept" && <Badge className="bg-status-pending text-status-pending-fg gap-1">🔴 Qabul kuting</Badge>}
          {!isGhost && order.status === "in_progress" && <Badge className="bg-status-accepted text-status-accepted-fg gap-1">🟠 Jarayonda</Badge>}
          {!isGhost && order.status === "delivered" && <Badge className="bg-status-done text-status-done-fg gap-1">🟢 Tugadi</Badge>}
        </div>
        <div className="text-sm font-medium">🏢 {order.filial}</div>
        <div className="text-xs text-muted-foreground mt-1">
          🚪 {order.doors_count} • {order.product_type}
        </div>
        {isGhost && (
          <div className="text-xs mt-2 text-status-done font-medium">
            ➡️ {DEPT_LABELS[order.current_department]} qabul qilishini kuting
          </div>
        )}
        {positionDeadline && (
          <div className="text-xs mt-2 flex items-center gap-1"><Clock className="h-3 w-3" />
            {new Date(positionDeadline).toLocaleString("uz-UZ", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
          </div>
        )}
        {isDelayed && (
          <div className="mt-2 text-xs text-status-pending font-semibold">
            ⏳ {delayDays} kun kechikdi • 💰 {formatMoney(penaltyAmount)}
          </div>
        )}
        {order.pogonaj_required && (
          <Badge variant="outline" className="mt-2 text-xs">📏 Pogonaj: {order.pogonaj_status || "kerak"}</Badge>
        )}
      </button>

      {open && (
        <OrderDetailDialog
          order={order} open={open} onOpenChange={setOpen} auth={auth} penalty={penalty}
          canActOnDept={canActOnDept}
          onAccept={async () => {
            try { await accept({ data: { orderId: order.id } }); toast.success("✅ Qabul qilindi"); qc.invalidateQueries({ queryKey: ["orders"] }); setOpen(false); }
            catch (e: any) { toast.error(e.message); }
          }}
          onDeliver={async () => {
            try { await deliver({ data: { orderId: order.id } }); toast.success("📦 Topshirildi"); qc.invalidateQueries({ queryKey: ["orders"] }); setOpen(false); }
            catch (e: any) { toast.error(e.message); }
          }}
        />
      )}
    </>
  );
}

function OrderDetailDialog({ order, open, onOpenChange, auth, penalty, canActOnDept, onAccept, onDeliver }: {
  order: Order; open: boolean; onOpenChange: (o: boolean) => void;
  auth: ReturnType<typeof useAuth>; penalty: number; canActOnDept: boolean;
  onAccept: () => void; onDeliver: () => void;
}) {
  const getHistory = useServerFn(getOrderHistoryFn);
  const { data: hist } = useQuery({
    queryKey: ["history", order.id],
    queryFn: () => getHistory({ data: { orderId: order.id } }),
    enabled: open,
  });

  const blame = (order.status === "pending_accept" && order.previous_department) ? order.previous_department : order.current_department;
  const dl = order.position_deadlines?.[blame] || order.deadline;
  const dd = calcDelayDays(dl);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="font-mono">#{order.number}</span>
            <span className="text-muted-foreground text-sm font-normal">{order.filial}</span>
          </DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="info">
          <TabsList className="grid grid-cols-3 w-full">
            <TabsTrigger value="info">📋 Ma'lumot</TabsTrigger>
            <TabsTrigger value="deadlines">📅 Sroklar</TabsTrigger>
            <TabsTrigger value="history">🕘 Tarix</TabsTrigger>
          </TabsList>

          <TabsContent value="info" className="space-y-2 text-sm pt-3">
            <div className="grid grid-cols-2 gap-2">
              <Info label="🏢 Filial" value={order.filial} />
              <Info label="🚪 Eshik soni" value={String(order.doors_count)} />
              <Info label="🪵 Mahsulot" value={order.product_type} />
              <Info label="📍 Joriy bo'lim" value={`${DEPT_ICONS[order.current_department]} ${DEPT_LABELS[order.current_department]}`} />
              {order.previous_department && order.status === "pending_accept" && (
                <Info label="📤 Topshirgan" value={`${DEPT_ICONS[order.previous_department]} ${DEPT_LABELS[order.previous_department]}`} />
              )}
              <Info label="📅 Kiritildi" value={new Date(order.created_at).toLocaleString("uz-UZ")} />
            </div>
            {dl && <div className="rounded-lg bg-secondary p-3"><b>⏰ Joriy srok ({DEPT_LABELS[blame]}):</b> {new Date(dl).toLocaleString("uz-UZ")}</div>}
            {dd > 0 && order.status !== "delivered" && (
              <div className="rounded-lg bg-status-pending/10 border border-status-pending/30 p-3 text-status-pending">
                <b>⏳ Kechikish:</b> {dd} kun • <b>💰 Jarima:</b> {formatMoney(dd * penalty)}
                <div className="text-xs mt-1 opacity-90">Jarima topshiruvchi bo'limga ({DEPT_LABELS[blame]}) qo'yiladi</div>
              </div>
            )}
            {order.comment && <div className="rounded-lg bg-secondary p-3"><b>📝 Izoh:</b> {order.comment}</div>}
            {order.pogonaj_required && (
              <div className="rounded-lg bg-accent/30 p-3"><b>📏 Pogonaj:</b> {order.pogonaj_status || "kerak"}</div>
            )}

            {canActOnDept && order.status !== "delivered" && (
              <div className="flex gap-2 pt-3">
                {order.status === "pending_accept" && order.current_department !== "arxiv" && (
                  <Button size="lg" className="flex-1 bg-status-pending text-status-pending-fg hover:bg-status-pending/90" onClick={onAccept}>
                    <CheckCircle2 className="h-5 w-5 mr-1" /> QABUL QILDIM
                  </Button>
                )}
                {order.status === "in_progress" && (
                  <Button size="lg" className="flex-1 bg-status-done text-status-done-fg hover:bg-status-done/90" onClick={onDeliver}>
                    <ArrowRight className="h-5 w-5 mr-1" /> TAYYOR — TOPSHIRDIM
                  </Button>
                )}
              </div>
            )}
          </TabsContent>

          <TabsContent value="deadlines" className="pt-3">
            <DeadlinesEditor order={order} canEdit={auth.isAdmin} />
          </TabsContent>


          <TabsContent value="history" className="pt-3">
            <div className="relative pl-6 space-y-3">
              <div className="absolute left-2 top-2 bottom-2 w-px bg-border" />
              {(hist?.items ?? []).map((h: any) => (
                <div key={h.id} className="relative animate-slide-up">
                  <div className="absolute -left-[18px] top-1 w-3 h-3 rounded-full bg-primary ring-4 ring-background" />
                  <div className="text-xs text-muted-foreground">{new Date(h.created_at).toLocaleString("uz-UZ", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" })}</div>
                  <div className="text-sm font-medium">
                    {h.action === "created" && <>🆕 Yaratildi → {DEPT_LABELS[h.to_department as Department] ?? h.to_department}</>}
                    {h.action === "accepted" && <>✅ Qabul qildi → {DEPT_LABELS[h.to_department as Department] ?? h.to_department}</>}
                    {h.action === "delivered" && <>📦 Topshirdi {h.from_department && `(${DEPT_LABELS[h.from_department as Department]} → ${DEPT_LABELS[h.to_department as Department]})`}</>}
                    {h.action === "moved" && <>🔀 Admin ko'chirdi {h.from_department && `(${DEPT_LABELS[h.from_department as Department]} → ${DEPT_LABELS[h.to_department as Department]})`}</>}
                    {h.action === "deadline_changed" && <>📅 Srok yangilandi</>}
                    {h.action === "edited" && <>✏️ Ma'lumot tahrirlandi</>}
                  </div>
                  {h.actor_name && <div className="text-xs text-muted-foreground">👤 {h.actor_name}</div>}
                </div>
              ))}
              {(!hist || hist.items.length === 0) && <div className="text-sm text-muted-foreground">Tarix bo'sh</div>}
            </div>
          </TabsContent>
        </Tabs>

        {auth.isAdmin && <AdminOrderActions order={order} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}
function DeadlinesEditor({ order, canEdit }: { order: Order; canEdit: boolean }) {
  const updateDl = useServerFn(updateDeadlineFn);
  const qc = useQueryClient();
  const toLocal = (iso?: string) => iso ? new Date(iso).toISOString().slice(0, 16) : "";
  const [vals, setVals] = useState<Record<string, string>>(() => {
    const o: Record<string, string> = {};
    DEPARTMENTS.forEach((d) => { o[d] = toLocal(order.position_deadlines?.[d]); });
    return o;
  });
  const [saving, setSaving] = useState(false);
  const dirty = DEPARTMENTS.some((d) => (vals[d] || "") !== toLocal(order.position_deadlines?.[d]));

  const save = async () => {
    setSaving(true);
    try {
      const pd: Record<string, string> = {};
      DEPARTMENTS.forEach((d) => { if (vals[d]) pd[d] = new Date(vals[d]).toISOString(); });
      await updateDl({ data: { orderId: order.id, position_deadlines: pd } });
      toast.success("📅 Sroklar saqlandi");
      qc.invalidateQueries({ queryKey: ["orders"] });
    } catch (e: any) { toast.error(e.message); }
    setSaving(false);
  };

  return (
    <div className="space-y-2">
      {DEPARTMENTS.map((d) => {
        const days = calcDelayDays(order.position_deadlines?.[d]);
        return (
          <div key={d} className={`flex items-center justify-between gap-2 p-3 rounded-xl border transition-all ${order.current_department === d ? "bg-primary/5 border-primary/40 shadow-sm" : "bg-card border-border"}`}>
            <div className="flex items-center gap-2 text-sm min-w-[140px]">
              <span className="text-base">{DEPT_ICONS[d]}</span>
              <span className="font-medium">{DEPT_LABELS[d]}</span>
            </div>
            <div className="flex items-center gap-2 flex-1 justify-end">
              {canEdit ? (
                <Input type="datetime-local" className="h-8 max-w-[200px]" value={vals[d]} onChange={(e) => setVals({ ...vals, [d]: e.target.value })} />
              ) : vals[d] ? (
                <span className="text-xs">{new Date(vals[d]).toLocaleString("uz-UZ", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
              ) : <span className="text-xs text-muted-foreground">—</span>}
              {days > 0 && <span className="text-xs text-status-pending whitespace-nowrap">⏳ {days} k</span>}
            </div>
          </div>
        );
      })}
      {canEdit && (
        <Button className="w-full" disabled={!dirty || saving} onClick={save}>
          💾 Sroklarni saqlash
        </Button>
      )}
    </div>
  );
}


function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-secondary p-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-medium text-sm">{value}</div>
    </div>
  );
}

function AdminOrderActions({ order, onDone }: { order: Order; onDone: () => void }) {
  const updateDl = useServerFn(updateDeadlineFn);
  const move = useServerFn(moveOrderFn);
  const del = useServerFn(deleteOrderFn);
  const updateOrder = useServerFn(updateOrderFn);
  const qc = useQueryClient();
  const positionDeadline = order.position_deadlines?.[order.current_department] || "";
  const [newDl, setNewDl] = useState(positionDeadline ? new Date(positionDeadline).toISOString().slice(0, 16) : "");
  const [moveTo, setMoveTo] = useState<Department>(order.current_department);
  const [edit, setEdit] = useState({
    number: order.number, filial: order.filial, doors_count: order.doors_count,
    product_type: order.product_type, comment: order.comment,
    pogonaj_required: order.pogonaj_required, pogonaj_status: order.pogonaj_status,
  });

  return (
    <div className="border-t border-border pt-4 mt-2 space-y-3">
      <div className="text-xs font-semibold text-muted-foreground">⚙️ ADMIN — TAHRIRLASH</div>
      <div className="grid grid-cols-2 gap-2">
        <div><Label className="text-xs">Raqami</Label><Input value={edit.number} onChange={(e) => setEdit({ ...edit, number: e.target.value })} /></div>
        <div><Label className="text-xs">Filial</Label><Input value={edit.filial} onChange={(e) => setEdit({ ...edit, filial: e.target.value })} /></div>
        <div><Label className="text-xs">Eshik soni</Label><Input type="number" value={edit.doors_count} onChange={(e) => setEdit({ ...edit, doors_count: +e.target.value })} /></div>
        <div><Label className="text-xs">Mahsulot</Label><Input value={edit.product_type} onChange={(e) => setEdit({ ...edit, product_type: e.target.value })} /></div>
      </div>
      <div><Label className="text-xs">Izoh</Label><Textarea rows={2} value={edit.comment} onChange={(e) => setEdit({ ...edit, comment: e.target.value })} /></div>
      <div className="flex gap-3 items-center">
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={edit.pogonaj_required} onChange={(e) => setEdit({ ...edit, pogonaj_required: e.target.checked })} />
          Pogonaj kerak
        </label>
        <Input placeholder="Pogonaj holati" className="flex-1" value={edit.pogonaj_status} onChange={(e) => setEdit({ ...edit, pogonaj_status: e.target.value })} />
      </div>
      <Button size="sm" className="w-full" onClick={async () => {
        try { await updateOrder({ data: { orderId: order.id, ...edit } }); toast.success("Saqlandi"); qc.invalidateQueries({ queryKey: ["orders"] }); }
        catch (e: any) { toast.error(e.message); }
      }}>💾 Ma'lumotni saqlash</Button>

      <div className="flex gap-2 items-end pt-2 border-t border-border">
        <div className="flex-1">
          <Label className="text-xs">📅 Joriy bo'lim srogi</Label>
          <Input type="datetime-local" value={newDl} onChange={(e) => setNewDl(e.target.value)} />
        </div>
        <Button size="sm" onClick={async () => {
          try {
            const pd = { ...order.position_deadlines, [order.current_department]: new Date(newDl).toISOString() };
            await updateDl({ data: { orderId: order.id, position_deadlines: pd } });
            toast.success("Srok yangilandi"); qc.invalidateQueries({ queryKey: ["orders"] });
          } catch (e: any) { toast.error(e.message); }
        }}>Saqlash</Button>
      </div>
      <div className="flex gap-2 items-end">
        <div className="flex-1">
          <Label className="text-xs">🔀 Bo'limga ko'chirish</Label>
          <Select value={moveTo} onValueChange={(v) => setMoveTo(v as Department)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {DEPARTMENTS.map((d) => <SelectItem key={d} value={d}>{DEPT_ICONS[d]} {DEPT_LABELS[d]}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <Button size="sm" onClick={async () => {
          try { await move({ data: { orderId: order.id, to: moveTo } }); toast.success("Ko'chirildi"); qc.invalidateQueries({ queryKey: ["orders"] }); onDone(); }
          catch (e: any) { toast.error(e.message); }
        }}>Ko'chir</Button>
      </div>
      <Button variant="destructive" size="sm" className="w-full" onClick={async () => {
        if (!confirm("O'chirilsinmi?")) return;
        try { await del({ data: { orderId: order.id } }); toast.success("O'chirildi"); qc.invalidateQueries({ queryKey: ["orders"] }); onDone(); }
        catch (e: any) { toast.error(e.message); }
      }}>🗑️ O'chirish</Button>
    </div>
  );
}

function NewOrderDialog() {
  const create = useServerFn(createOrderFn);
  const qc = useQueryClient();
  const settings = useSettings();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ number: "", filial: "", doors_count: 0, product_type: "", comment: "", pogonaj_required: false });
  const [posDl, setPosDl] = useState<Record<string, string>>({});
  const [dupCheck, setDupCheck] = useState<"idle" | "checking" | "duplicate" | "ok">("idle");

  useEffect(() => {
    if (!f.number.trim()) { setDupCheck("idle"); return; }
    setDupCheck("checking");
    const t = setTimeout(async () => {
      const { data } = await supabase.from("orders").select("id").eq("number", f.number.trim()).limit(1);
      setDupCheck((data && data.length > 0) ? "duplicate" : "ok");
    }, 350);
    return () => clearTimeout(t);
  }, [f.number]);

  const filials = settings.data?.filials ?? [];
  const productTypes = settings.data?.product_types ?? [];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm"><Plus className="h-4 w-4 mr-1" />Yangi</Button></DialogTrigger>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>➕ Yangi zayavka</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Raqami</Label>
            <Input value={f.number} onChange={(e) => setF({ ...f, number: e.target.value })} className={dupCheck === "duplicate" ? "border-status-pending" : ""} />
            {dupCheck === "duplicate" && (
              <div className="text-xs text-status-pending mt-1 flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" /> Bu raqam oldin yozilgan!
              </div>
            )}
            {dupCheck === "ok" && f.number && (
              <div className="text-xs text-status-done mt-1">✅ Bo'sh raqam</div>
            )}
          </div>
          <div>
            <Label>🏢 Filial</Label>
            {filials.length > 0 ? (
              <Select value={f.filial} onValueChange={(v) => setF({ ...f, filial: v })}>
                <SelectTrigger><SelectValue placeholder="Filial tanlang..." /></SelectTrigger>
                <SelectContent>
                  {filials.map((x) => <SelectItem key={x} value={x}>{x}</SelectItem>)}
                </SelectContent>
              </Select>
            ) : (
              <div className="text-xs text-muted-foreground p-2 bg-muted rounded">Filial yo'q. Sozlamalar → Filiallar dan qo'shing</div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label>🚪 Eshik soni</Label><Input type="number" value={f.doors_count} onChange={(e) => setF({ ...f, doors_count: +e.target.value })} /></div>
            <div>
              <Label>🪵 Mahsulot turi</Label>
              {productTypes.length > 0 ? (
                <Select value={f.product_type} onValueChange={(v) => setF({ ...f, product_type: v })}>
                  <SelectTrigger><SelectValue placeholder="Tanlang..." /></SelectTrigger>
                  <SelectContent>
                    {productTypes.map((x) => <SelectItem key={x} value={x}>{x}</SelectItem>)}
                  </SelectContent>
                </Select>
              ) : (
                <div className="text-xs text-muted-foreground p-2 bg-muted rounded">Sozlamalardan qo'shing</div>
              )}
            </div>
          </div>
          <div><Label>📝 Izoh</Label><Textarea value={f.comment} onChange={(e) => setF({ ...f, comment: e.target.value })} /></div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={f.pogonaj_required} onChange={(e) => setF({ ...f, pogonaj_required: e.target.checked })} />
            📏 Pogonaj kerak
          </label>
          <div className="border-t border-border pt-3">
            <div className="text-sm font-semibold mb-2">📅 Pozitsiya sroklari (ixtiyoriy)</div>
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {DEPARTMENTS.map((d) => (
                <div key={d} className="grid grid-cols-2 gap-2 items-center">
                  <span className="text-xs">{DEPT_ICONS[d]} {DEPT_LABELS[d]}</span>
                  <Input type="datetime-local" value={posDl[d] || ""} onChange={(e) => setPosDl({ ...posDl, [d]: e.target.value })} />
                </div>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button disabled={dupCheck === "duplicate" || dupCheck === "checking" || !f.number.trim()} onClick={async () => {
            try {
              const pd: Record<string, string> = {};
              Object.entries(posDl).forEach(([k, v]) => { if (v) pd[k] = new Date(v).toISOString(); });
              await create({ data: { ...f, position_deadlines: pd } });
              toast.success("✅ Yaratildi");
              qc.invalidateQueries({ queryKey: ["orders"] });
              setOpen(false);
              setF({ number: "", filial: "", doors_count: 0, product_type: "", comment: "", pogonaj_required: false });
              setPosDl({});
              setDupCheck("idle");
            } catch (e: any) { toast.error(e.message); }
          }}>Yaratish</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


function AdminPanel() {
  const createUser = useServerFn(adminCreateUserFn);
  const [open, setOpen] = useState(false);
  const [u, setU] = useState({ email: "", password: "", full_name: "", role: "ojidaniya" });
  const roles = ["admin", ...DEPARTMENTS];
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="outline"><Settings className="h-4 w-4 mr-1" />Foydalanuvchilar</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>👥 Yangi foydalanuvchi</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Ism</Label><Input value={u.full_name} onChange={(e) => setU({ ...u, full_name: e.target.value })} /></div>
          <div><Label>Email</Label><Input type="email" value={u.email} onChange={(e) => setU({ ...u, email: e.target.value })} /></div>
          <div><Label>Parol</Label><Input type="password" value={u.password} onChange={(e) => setU({ ...u, password: e.target.value })} /></div>
          <div>
            <Label>Rol</Label>
            <Select value={u.role} onValueChange={(v) => setU({ ...u, role: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {roles.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={async () => {
            try {
              await createUser({ data: u as any });
              toast.success("Foydalanuvchi yaratildi");
              setOpen(false);
              setU({ email: "", password: "", full_name: "", role: "ojidaniya" });
            } catch (e: any) { toast.error(e.message); }
          }}>Yaratish</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SettingsDialog() {
  const [open, setOpen] = useState(false);
  const get = useServerFn(getSettingsFn);
  const update = useServerFn(updateSettingsFn);
  const qc = useQueryClient();
  const [penalty, setPenalty] = useState(100000);
  const [hour, setHour] = useState(4);
  const [tashkentHour, setTashkentHour] = useState("09:00");

  useEffect(() => {
    if (!open) return;
    get({ data: undefined as any }).then((s) => {
      setPenalty(s.penalty_per_day); setHour(s.telegram_hour_utc);
      // Tashkent = UTC+5
      const t = (s.telegram_hour_utc + 5) % 24;
      setTashkentHour(`${String(t).padStart(2, "0")}:00`);
    });
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="outline"><Cog className="h-4 w-4 mr-1" />Sozlamalar</Button></DialogTrigger>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>⚙️ Tizim sozlamalari</DialogTitle></DialogHeader>
        <Tabs defaultValue="general">
          <TabsList className="grid grid-cols-3 w-full">
            <TabsTrigger value="general">⚙️ Umumiy</TabsTrigger>
            <TabsTrigger value="filials">🏢 Filiallar</TabsTrigger>
            <TabsTrigger value="products">🪵 Mahsulotlar</TabsTrigger>
          </TabsList>
          <TabsContent value="general" className="space-y-4 pt-4">
            <div>
              <Label>💰 Kunlik jarima miqdori (so'm)</Label>
              <Input type="number" value={penalty} onChange={(e) => setPenalty(+e.target.value)} />
              <div className="text-xs text-muted-foreground mt-1">Har bir kechikkan kun uchun</div>
            </div>
            <div>
              <Label>📱 Telegram xabar vaqti (Toshkent vaqti)</Label>
              <Input type="time" step="3600" value={tashkentHour} onChange={(e) => {
                setTashkentHour(e.target.value);
                const h = parseInt(e.target.value.split(":")[0] || "9", 10);
                setHour((h - 5 + 24) % 24);
              }} />
              <div className="text-xs text-muted-foreground mt-1">
                UTC: {String(hour).padStart(2, "0")}:00 • Har kuni shu vaqtda Telegram'ga hisobot yuboriladi
              </div>
            </div>
            <Button className="w-full" onClick={async () => {
              try {
                await update({ data: { penalty_per_day: penalty, telegram_hour_utc: hour } });
                toast.success("Sozlamalar saqlandi va cron yangilandi");
                qc.invalidateQueries({ queryKey: ["app_settings"] });
              } catch (e: any) { toast.error(e.message); }
            }}>💾 Saqlash</Button>
          </TabsContent>
          <TabsContent value="filials" className="pt-4">
            <CatalogEditor catalogKey="filials" title="Filial" icon="🏢" />
          </TabsContent>
          <TabsContent value="products" className="pt-4">
            <CatalogEditor catalogKey="product_types" title="Mahsulot turi" icon="🪵" />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function CatalogEditor({ catalogKey, title, icon }: { catalogKey: "filials" | "product_types"; title: string; icon: string }) {
  const settings = useSettings();
  const qc = useQueryClient();
  const list = settings.data?.[catalogKey] ?? [];
  const [newItem, setNewItem] = useState("");
  const [saving, setSaving] = useState(false);

  const add = async () => {
    const v = newItem.trim();
    if (!v) return;
    if (list.includes(v)) { toast.error("Bu allaqachon bor"); return; }
    setSaving(true);
    try { await saveCatalog(catalogKey, [...list, v]); setNewItem(""); qc.invalidateQueries({ queryKey: ["app_settings"] }); }
    catch (e: any) { toast.error(e.message); }
    setSaving(false);
  };
  const remove = async (v: string) => {
    if (!confirm(`"${v}" o'chirilsinmi?`)) return;
    try { await saveCatalog(catalogKey, list.filter((x) => x !== v)); qc.invalidateQueries({ queryKey: ["app_settings"] }); }
    catch (e: any) { toast.error(e.message); }
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Input placeholder={`Yangi ${title.toLowerCase()}...`} value={newItem} onChange={(e) => setNewItem(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
        <Button onClick={add} disabled={saving || !newItem.trim()}><Plus className="h-4 w-4 mr-1" />Qo'shish</Button>
      </div>
      <div className="space-y-1 max-h-72 overflow-y-auto">
        {list.length === 0 && <div className="text-sm text-muted-foreground text-center py-6 border-2 border-dashed rounded-lg">Bo'sh — birinchisini qo'shing</div>}
        {list.map((x) => (
          <div key={x} className="flex items-center justify-between gap-2 p-2 rounded-lg bg-card border border-border hover:border-primary/40 transition-all">
            <span className="text-sm">{icon} {x}</span>
            <Button size="sm" variant="ghost" className="h-7 text-status-pending hover:bg-status-pending/10" onClick={() => remove(x)}>🗑️</Button>
          </div>
        ))}
      </div>
    </div>
  );
}

