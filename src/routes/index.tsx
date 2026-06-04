import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import {
  useDepartments, calcDelayDays, formatMoney, deptLabel, deptIcon,
  type DeptRow,
} from "@/lib/departments";
import {
  acceptOrderFn, deliverOrderFn, createOrderFn, updateDeadlineFn,
  moveOrderFn, deleteOrderFn, updateOrderFn,
  getOrderHistoryFn, getSettingsFn, updateSettingsFn,
  createDepartmentFn, deleteDepartmentFn, reorderDepartmentsFn, listAuditFn,
  createUserFn, updateUserFn, deleteUserFn, listUsersFn,
} from "@/lib/orders.functions";
import { useTheme } from "@/hooks/use-theme";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { LogOut, Plus, Settings, AlertTriangle, Search, BarChart3, Cog, CheckCircle2, ArrowRight, Clock, Trash2, ArrowUp, ArrowDown, Sun, Moon } from "lucide-react";

export const Route = createFileRoute("/")({
  component: DashboardPage,
});

type Order = {
  id: string; number: string; filial: string; doors_count: number;
  product_type: string; current_department: string;
  previous_department: string | null;
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
  const depts = useDepartments();
  const deptList = depts.data ?? [];

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

  const visibleDepts = useMemo(() => {
    if (auth.isAdmin) return deptList;
    return deptList.filter((d) => auth.depts.includes(d.key));
  }, [deptList, auth.isAdmin, auth.depts]);

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

  function cardsForDept(deptKey: string) {
    return filtered.filter((o) => {
      if (deptFilter !== "all" && deptFilter !== deptKey) return false;
      return o.current_department === deptKey || (o.status === "pending_accept" && o.previous_department === deptKey);
    });
  }

  function blameDept(o: Order): string {
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
    <div className="min-h-screen bg-background bg-[radial-gradient(ellipse_at_top,_color-mix(in_oklab,var(--primary)_10%,transparent)_0%,transparent_55%)]">
      <header className="border-b border-border bg-card sticky top-0 z-20 backdrop-blur supports-[backdrop-filter]:bg-card/80">
        <div className="px-4 md:px-6 py-3 flex items-center gap-3 flex-wrap">
          <h1 className="text-lg md:text-xl font-bold tracking-tight">🏭 Ishlab chiqarish CRM</h1>
          <div className="ml-auto flex items-center gap-2 flex-wrap">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Qidirish..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8 w-48 md:w-64" />
            </div>
            {auth.isAdmin && <Link to="/stats"><Button size="sm" variant="outline"><BarChart3 className="h-4 w-4 mr-1" />Statistika</Button></Link>}
            {auth.isAdmin && <NewOrderDialog depts={deptList} />}
            {auth.isGeneral && <SettingsDialog depts={deptList} />}
            <Button variant="ghost" size="sm" onClick={async () => { await supabase.auth.signOut(); navigate({ to: "/login" }); }}>
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
        {auth.isAdmin && (
          <div className="px-4 md:px-6 pb-3 flex items-center gap-2 flex-wrap border-t border-border pt-3">
            <Select value={deptFilter} onValueChange={setDeptFilter}>
              <SelectTrigger className="w-44"><SelectValue placeholder="Bo'lim" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Barcha bo'limlar</SelectItem>
                {deptList.map((d) => <SelectItem key={d.key} value={d.key}>{d.icon} {d.label}</SelectItem>)}
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
        )}
      </header>


      <main className="overflow-x-auto p-3 md:p-4">
        <div className="flex gap-3 min-w-max">
          {visibleDepts.map((d) => {
            const cards = cardsForDept(d.key);
            return (
              <div key={d.key} className="w-64 flex-shrink-0">
                <div className="bg-gradient-to-br from-secondary to-secondary/60 rounded-lg px-2.5 py-2 mb-2 flex items-center justify-between shadow-sm sticky top-0">
                  <h2 className="font-semibold text-xs flex items-center gap-1.5">
                    <span className="text-sm">{d.icon}</span>
                    {d.label}
                  </h2>
                  <Badge variant="outline" className="bg-card text-[10px] h-5 px-1.5">{cards.length}</Badge>
                </div>
                <div className="space-y-2">
                  {cards.map((o) => (
                    <OrderCard key={o.id + d.key} order={o} columnDept={d.key} auth={auth} penalty={PENALTY} blameDept={blameDept(o)} depts={deptList} />
                  ))}
                  {cards.length === 0 && (
                    <div className="text-[11px] text-muted-foreground text-center py-6 border-2 border-dashed border-border rounded-lg">
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

function OrderCard({ order, columnDept, auth, penalty, blameDept, depts }: {
  order: Order; columnDept: string; auth: ReturnType<typeof useAuth>; penalty: number; blameDept: string; depts: DeptRow[];
}) {
  const accept = useServerFn(acceptOrderFn);
  const deliver = useServerFn(deliverOrderFn);
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const isGhost = order.status === "pending_accept" && order.previous_department === columnDept && order.current_department !== columnDept;
  const isReceiverPending = order.status === "pending_accept" && order.current_department === columnDept;

  const positionDeadline = order.position_deadlines?.[blameDept] || order.deadline;
  const delayDays = calcDelayDays(positionDeadline);
  const isDelayed = order.status !== "delivered" && delayDays > 0;
  const penaltyAmount = delayDays * penalty;

  const canActOnDept = !isGhost && (auth.isAdmin || auth.depts.includes(order.current_department));

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
        className={`w-full text-left rounded-lg border ${bg} ${extra} p-2 hover:shadow-md transition-all animate-slide-up`}
      >
        <div className="flex items-center justify-between gap-1.5 mb-1">
          <div className="font-mono font-bold text-xs truncate">#{order.number}</div>
          {isGhost && <span className="text-[10px] px-1.5 py-0.5 rounded bg-status-done/30 text-status-done font-semibold whitespace-nowrap">✅</span>}
          {!isGhost && order.status === "pending_accept" && <span className="text-[10px] px-1.5 py-0.5 rounded bg-status-pending/30 text-status-pending font-semibold whitespace-nowrap">🔴 Kuting</span>}
          {!isGhost && order.status === "in_progress" && <span className="text-[10px] px-1.5 py-0.5 rounded bg-status-accepted/30 text-status-accepted font-semibold whitespace-nowrap">🟠</span>}
          {!isGhost && order.status === "delivered" && <span className="text-[10px] px-1.5 py-0.5 rounded bg-status-done/30 text-status-done font-semibold whitespace-nowrap">🟢</span>}
        </div>
        <div className="text-xs font-medium truncate">🏢 {order.filial}</div>
        <div className="text-[11px] text-muted-foreground truncate">
          🚪 {order.doors_count} • {order.product_type}
        </div>
        {positionDeadline && (
          <div className="text-[10px] mt-1 flex items-center gap-1 text-muted-foreground">
            <Clock className="h-2.5 w-2.5" />
            {new Date(positionDeadline).toLocaleString("uz-UZ", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
          </div>
        )}
        {isDelayed && (
          <div className="mt-1 text-[10px] text-status-pending font-semibold">
            ⏳ {delayDays}k • 💰 {formatMoney(penaltyAmount)}
          </div>
        )}
      </button>

      {open && (
        <OrderDetailDialog
          order={order} open={open} onOpenChange={setOpen} auth={auth} penalty={penalty} depts={depts}
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

function OrderDetailDialog({ order, open, onOpenChange, auth, penalty, canActOnDept, onAccept, onDeliver, depts }: {
  order: Order; open: boolean; onOpenChange: (o: boolean) => void;
  auth: ReturnType<typeof useAuth>; penalty: number; canActOnDept: boolean;
  onAccept: () => void; onDeliver: () => void; depts: DeptRow[];
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
              <Info label="📍 Joriy bo'lim" value={`${deptIcon(depts, order.current_department)} ${deptLabel(depts, order.current_department)}`} />
              {order.previous_department && order.status === "pending_accept" && (
                <Info label="📤 Topshirgan" value={`${deptIcon(depts, order.previous_department)} ${deptLabel(depts, order.previous_department)}`} />
              )}
              <Info label="📅 Kiritildi" value={new Date(order.created_at).toLocaleString("uz-UZ")} />
            </div>
            {dl && <div className="rounded-lg bg-secondary p-3"><b>⏰ Joriy srok ({deptLabel(depts, blame)}):</b> {new Date(dl).toLocaleString("uz-UZ")}</div>}
            {dd > 0 && order.status !== "delivered" && (
              <div className="rounded-lg bg-status-pending/10 border border-status-pending/30 p-3 text-status-pending">
                <b>⏳ Kechikish:</b> {dd} kun • <b>💰 Jarima:</b> {formatMoney(dd * penalty)}
                <div className="text-xs mt-1 opacity-90">Jarima topshiruvchi bo'limga ({deptLabel(depts, blame)}) qo'yiladi</div>
              </div>
            )}
            {order.comment && <div className="rounded-lg bg-secondary p-3"><b>📝 Izoh:</b> {order.comment}</div>}
            {order.pogonaj_required && (
              <div className="rounded-lg bg-accent/30 p-3"><b>📏 Pogonaj:</b> {order.pogonaj_status || "kerak"}</div>
            )}

            {canActOnDept && order.status !== "delivered" && (
              <div className="flex gap-2 pt-3">
                {order.status === "pending_accept" && (
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
            <DeadlinesEditor order={order} canEdit={auth.isAdmin} depts={depts} />
          </TabsContent>

          <TabsContent value="history" className="pt-3">
            <div className="relative pl-6 space-y-3">
              <div className="absolute left-2 top-2 bottom-2 w-px bg-border" />
              {(hist?.items ?? []).map((h: any) => (
                <div key={h.id} className="relative animate-slide-up">
                  <div className="absolute -left-[18px] top-1 w-3 h-3 rounded-full bg-primary ring-4 ring-background" />
                  <div className="text-xs text-muted-foreground">{new Date(h.created_at).toLocaleString("uz-UZ", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" })}</div>
                  <div className="text-sm font-medium">
                    {h.action === "created" && <>🆕 Yaratildi → {deptLabel(depts, h.to_department)}</>}
                    {h.action === "accepted" && <>✅ Qabul qildi → {deptLabel(depts, h.to_department)}</>}
                    {h.action === "delivered" && <>📦 Topshirdi ({deptLabel(depts, h.from_department)} → {deptLabel(depts, h.to_department)})</>}
                    {h.action === "moved" && <>🔀 Admin ko'chirdi ({deptLabel(depts, h.from_department)} → {deptLabel(depts, h.to_department)})</>}
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

        {auth.isAdmin && <AdminOrderActions order={order} onDone={() => onOpenChange(false)} depts={depts} />}
      </DialogContent>
    </Dialog>
  );
}

function DeadlinesEditor({ order, canEdit, depts }: { order: Order; canEdit: boolean; depts: DeptRow[] }) {
  const updateDl = useServerFn(updateDeadlineFn);
  const qc = useQueryClient();
  const toLocal = (iso?: string) => iso ? new Date(iso).toISOString().slice(0, 16) : "";
  const [vals, setVals] = useState<Record<string, string>>(() => {
    const o: Record<string, string> = {};
    depts.forEach((d) => { o[d.key] = toLocal(order.position_deadlines?.[d.key]); });
    return o;
  });
  const [saving, setSaving] = useState(false);
  const dirty = depts.some((d) => (vals[d.key] || "") !== toLocal(order.position_deadlines?.[d.key]));

  const save = async () => {
    setSaving(true);
    try {
      const pd: Record<string, string> = {};
      depts.forEach((d) => { if (vals[d.key]) pd[d.key] = new Date(vals[d.key]).toISOString(); });
      await updateDl({ data: { orderId: order.id, position_deadlines: pd } });
      toast.success("📅 Sroklar saqlandi");
      qc.invalidateQueries({ queryKey: ["orders"] });
    } catch (e: any) { toast.error(e.message); }
    setSaving(false);
  };

  return (
    <div className="space-y-2">
      {depts.map((d) => {
        const days = calcDelayDays(order.position_deadlines?.[d.key]);
        return (
          <div key={d.key} className={`flex items-center justify-between gap-2 p-3 rounded-xl border transition-all ${order.current_department === d.key ? "bg-primary/5 border-primary/40 shadow-sm" : "bg-card border-border"}`}>
            <div className="flex items-center gap-2 text-sm min-w-[140px]">
              <span className="text-base">{d.icon}</span>
              <span className="font-medium">{d.label}</span>
            </div>
            <div className="flex items-center gap-2 flex-1 justify-end">
              {canEdit ? (
                <Input type="datetime-local" className="h-8 max-w-[200px]" value={vals[d.key] || ""} onChange={(e) => setVals({ ...vals, [d.key]: e.target.value })} />
              ) : vals[d.key] ? (
                <span className="text-xs">{new Date(vals[d.key]).toLocaleString("uz-UZ", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
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

function AdminOrderActions({ order, onDone, depts }: { order: Order; onDone: () => void; depts: DeptRow[] }) {
  const updateDl = useServerFn(updateDeadlineFn);
  const move = useServerFn(moveOrderFn);
  const del = useServerFn(deleteOrderFn);
  const updateOrder = useServerFn(updateOrderFn);
  const qc = useQueryClient();
  const positionDeadline = order.position_deadlines?.[order.current_department] || "";
  const [newDl, setNewDl] = useState(positionDeadline ? new Date(positionDeadline).toISOString().slice(0, 16) : "");
  const [moveTo, setMoveTo] = useState<string>(order.current_department);
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
          <Select value={moveTo} onValueChange={setMoveTo}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {depts.map((d) => <SelectItem key={d.key} value={d.key}>{d.icon} {d.label}</SelectItem>)}
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

function NewOrderDialog({ depts }: { depts: DeptRow[] }) {
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
              {depts.map((d) => (
                <div key={d.key} className="grid grid-cols-2 gap-2 items-center">
                  <span className="text-xs">{d.icon} {d.label}</span>
                  <Input type="datetime-local" value={posDl[d.key] || ""} onChange={(e) => setPosDl({ ...posDl, [d.key]: e.target.value })} />
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

function SettingsDialog({ depts }: { depts: DeptRow[] }) {
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
      const t = (s.telegram_hour_utc + 5) % 24;
      setTashkentHour(`${String(t).padStart(2, "0")}:00`);
    });
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="outline"><Cog className="h-4 w-4 mr-1" />Sozlamalar</Button></DialogTrigger>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>⚙️ Tizim sozlamalari</DialogTitle></DialogHeader>
        <Tabs defaultValue="general">
          <TabsList className="grid grid-cols-5 w-full">
            <TabsTrigger value="general">⚙️ Umumiy</TabsTrigger>
            <TabsTrigger value="depts">🗂️ Bo'limlar</TabsTrigger>
            <TabsTrigger value="users">👥 Foydalanuvchilar</TabsTrigger>
            <TabsTrigger value="filials">🏢 Filiallar</TabsTrigger>
            <TabsTrigger value="products">🪵 Mahsulotlar</TabsTrigger>
          </TabsList>
          <TabsContent value="general" className="space-y-4 pt-4">
            <div>
              <Label>💰 Kunlik jarima miqdori (so'm)</Label>
              <Input type="number" value={penalty} onChange={(e) => setPenalty(+e.target.value)} />
            </div>
            <div>
              <Label>📱 Telegram xabar vaqti (Toshkent vaqti)</Label>
              <Input type="time" step="3600" value={tashkentHour} onChange={(e) => {
                setTashkentHour(e.target.value);
                const h = parseInt(e.target.value.split(":")[0] || "9", 10);
                setHour((h - 5 + 24) % 24);
              }} />
              <div className="text-xs text-muted-foreground mt-1">UTC: {String(hour).padStart(2, "0")}:00</div>
            </div>
            <Button className="w-full" onClick={async () => {
              try {
                await update({ data: { penalty_per_day: penalty, telegram_hour_utc: hour } });
                toast.success("Saqlandi va cron yangilandi");
                qc.invalidateQueries({ queryKey: ["app_settings"] });
              } catch (e: any) { toast.error(e.message); }
            }}>💾 Saqlash</Button>
          </TabsContent>
          <TabsContent value="depts" className="pt-4">
            <DepartmentsEditor depts={depts} />
          </TabsContent>
          <TabsContent value="users" className="pt-4">
            <UsersEditor depts={depts} />
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

function DepartmentsEditor({ depts }: { depts: DeptRow[] }) {
  const qc = useQueryClient();
  const createDept = useServerFn(createDepartmentFn);
  const delDept = useServerFn(deleteDepartmentFn);
  const [n, setN] = useState({ key: "", label: "", icon: "📋" });

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-4 gap-2">
        <Input placeholder="key (kraska2)" value={n.key} onChange={(e) => setN({ ...n, key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "") })} />
        <Input placeholder="Nomi" value={n.label} onChange={(e) => setN({ ...n, label: e.target.value })} />
        <Input placeholder="🎨" value={n.icon} onChange={(e) => setN({ ...n, icon: e.target.value })} />
        <Button onClick={async () => {
          try {
            await createDept({ data: n });
            toast.success("Bo'lim qo'shildi");
            setN({ key: "", label: "", icon: "📋" });
            qc.invalidateQueries({ queryKey: ["departments"] });
          } catch (e: any) { toast.error(e.message); }
        }} disabled={!n.key || !n.label}><Plus className="h-4 w-4 mr-1" />Qo'shish</Button>
      </div>
      <div className="space-y-1 max-h-72 overflow-y-auto">
        {depts.map((d) => (
          <div key={d.key} className="flex items-center justify-between gap-2 p-2 rounded-lg bg-card border border-border">
            <span className="text-sm">{d.icon} <b>{d.label}</b> <span className="text-xs text-muted-foreground">({d.key})</span></span>
            <Button size="sm" variant="ghost" className="h-7 text-status-pending hover:bg-status-pending/10" onClick={async () => {
              if (!confirm(`"${d.label}" o'chirilsinmi?`)) return;
              try { await delDept({ data: { key: d.key } }); toast.success("O'chirildi"); qc.invalidateQueries({ queryKey: ["departments"] }); }
              catch (e: any) { toast.error(e.message); }
            }}><Trash2 className="h-3.5 w-3.5" /></Button>
          </div>
        ))}
      </div>
    </div>
  );
}

function UsersEditor({ depts }: { depts: DeptRow[] }) {
  const listFn = useServerFn(listUsersFn);
  const createFn = useServerFn(createUserFn);
  const updateFn = useServerFn(updateUserFn);
  const delFn = useServerFn(deleteUserFn);
  const { data, refetch } = useQuery({ queryKey: ["users-list"], queryFn: () => listFn() });

  const [nu, setNu] = useState({ full_name: "", password: "", role: "user" as "user" | "admin", dept_keys: [] as string[], login_dept: "" });

  const SPECIAL = ["__admin__", "__user__"];


  const toggle = (k: string) => {
    setNu((x) => {
      const arr = x.dept_keys.includes(k) ? x.dept_keys.filter((y) => y !== k) : [...x.dept_keys, k];
      const ldOk = SPECIAL.includes(x.login_dept) || arr.includes(x.login_dept);
      const ld = ldOk ? x.login_dept : (arr[0] || "__user__");
      return { ...x, dept_keys: arr, login_dept: ld };
    });
  };

  return (
    <div className="space-y-4">
      <div className="border border-border rounded-xl p-4 space-y-3 bg-secondary/30">
        <div className="font-semibold text-sm">➕ Yangi foydalanuvchi</div>
        <div className="grid grid-cols-2 gap-2">
          <div><Label className="text-xs">👤 Ism (ko'rsatiladigan)</Label><Input value={nu.full_name} onChange={(e) => setNu({ ...nu, full_name: e.target.value })} /></div>
          <div><Label className="text-xs">🔒 Parol</Label><Input value={nu.password} onChange={(e) => setNu({ ...nu, password: e.target.value })} placeholder="kamida 4 belgi" /></div>
        </div>
        <div>
          <Label className="text-xs">🎭 Rol</Label>
          <div className="flex gap-3 mt-1">
            <label className="flex items-center gap-2 text-sm"><input type="radio" checked={nu.role === "user"} onChange={() => setNu({ ...nu, role: "user", login_dept: nu.login_dept || "__user__" })} /> 👷 User</label>
            <label className="flex items-center gap-2 text-sm"><input type="radio" checked={nu.role === "admin"} onChange={() => setNu({ ...nu, role: "admin", login_dept: nu.login_dept || "__admin__" })} /> 🛡️ Admin</label>
          </div>
        </div>
        <div>
          <Label className="text-xs">☑️ Ruxsat berilgan bo'limlar (qabul/topshirish)</Label>
          <div className="grid grid-cols-2 gap-1 mt-1 max-h-40 overflow-y-auto p-2 rounded-lg border border-border bg-card">
            {depts.map((d) => (
              <label key={d.key} className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={nu.dept_keys.includes(d.key)} onChange={() => toggle(d.key)} />
                {d.icon} {d.label}
              </label>
            ))}
          </div>
        </div>
        <div>
          <Label className="text-xs">🚪 Login pozitsasi (kirishda tanlanadi)</Label>
          <Select value={nu.login_dept} onValueChange={(v) => setNu({ ...nu, login_dept: v })}>
            <SelectTrigger><SelectValue placeholder="Tanlang..." /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__admin__">🛡️ Admin</SelectItem>
              <SelectItem value="__user__">👤 User</SelectItem>
              {nu.dept_keys.map((k) => {
                const d = depts.find((x) => x.key === k);
                return <SelectItem key={k} value={k}>{d?.icon} {d?.label ?? k}</SelectItem>;
              })}
            </SelectContent>
          </Select>
          <p className="text-[10px] text-muted-foreground mt-1">Kirish oynasidagi “Pozitsa” ro'yxatida shu nom chiqadi</p>
        </div>
        <Button className="w-full" disabled={!nu.full_name || !nu.password || nu.dept_keys.length === 0 || !nu.login_dept} onClick={async () => {
          try {
            await createFn({ data: nu });
            toast.success("✅ Yaratildi");
            setNu({ full_name: "", password: "", role: "user", dept_keys: [], login_dept: "__user__" });
            refetch();
          } catch (e: any) { toast.error(e.message); }
        }}>Yaratish</Button>
      </div>


      <div className="space-y-2 max-h-96 overflow-y-auto">
        <div className="font-semibold text-sm">📋 Mavjud foydalanuvchilar</div>
        {(data?.users ?? []).map((u: any) => (
          <UserRow key={u.id} u={u} depts={depts} onChanged={refetch} updateFn={updateFn} delFn={delFn} />
        ))}
      </div>
    </div>
  );
}

function UserRow({ u, depts, onChanged, updateFn, delFn }: any) {
  const [e, setE] = useState({
    full_name: u.full_name, password: u.password, role: u.system_role as "user" | "admin",
    dept_keys: u.depts as string[], login_dept: u.login_dept as string,
  });
  const isGeneral = u.system_role === "general";
  const SPECIAL = ["__admin__", "__user__"];
  const toggle = (k: string) => {
    const arr = e.dept_keys.includes(k) ? e.dept_keys.filter((y: string) => y !== k) : [...e.dept_keys, k];
    const ldOk = SPECIAL.includes(e.login_dept) || arr.includes(e.login_dept);
    const ld = ldOk ? e.login_dept : (arr[0] || "__user__");
    setE({ ...e, dept_keys: arr, login_dept: ld });
  };


  return (
    <details className="rounded-lg border border-border bg-card">
      <summary className="cursor-pointer p-3 flex items-center justify-between">
        <span className="text-sm">
          {isGeneral ? "👑" : e.role === "admin" ? "🛡️" : "👤"} <b>{u.full_name}</b>
          <span className="text-xs text-muted-foreground ml-2">{isGeneral ? "General" : e.role} • {u.depts.length} ta bo'lim</span>
        </span>
      </summary>
      <div className="p-3 border-t border-border space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <div><Label className="text-xs">Ism</Label><Input value={e.full_name} onChange={(ev) => setE({ ...e, full_name: ev.target.value })} disabled={isGeneral} /></div>
          <div><Label className="text-xs">Parol</Label><Input value={e.password} onChange={(ev) => setE({ ...e, password: ev.target.value })} /></div>
        </div>
        {!isGeneral && (
          <>
            <div>
              <Label className="text-xs">Rol</Label>
              <div className="flex gap-3 mt-1">
                <label className="flex items-center gap-2 text-sm"><input type="radio" checked={e.role === "user"} onChange={() => setE({ ...e, role: "user" })} /> User</label>
                <label className="flex items-center gap-2 text-sm"><input type="radio" checked={e.role === "admin"} onChange={() => setE({ ...e, role: "admin" })} /> Admin</label>
              </div>
            </div>
            <div>
              <Label className="text-xs">Bo'limlar</Label>
              <div className="grid grid-cols-2 gap-1 max-h-32 overflow-y-auto p-2 rounded border border-border">
                {depts.map((d: DeptRow) => (
                  <label key={d.key} className="flex items-center gap-2 text-xs cursor-pointer">
                    <input type="checkbox" checked={e.dept_keys.includes(d.key)} onChange={() => toggle(d.key)} />
                    {d.icon} {d.label}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <Label className="text-xs">Login pozitsasi</Label>
              <Select value={e.login_dept} onValueChange={(v) => setE({ ...e, login_dept: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__admin__">🛡️ Admin</SelectItem>
                  <SelectItem value="__user__">👤 User</SelectItem>
                  {e.dept_keys.map((k: string) => {
                    const d = depts.find((x: DeptRow) => x.key === k);
                    return <SelectItem key={k} value={k}>{d?.icon} {d?.label ?? k}</SelectItem>;
                  })}
                </SelectContent>
              </Select>
            </div>

          </>
        )}
        <div className="flex gap-2 pt-2">
          <Button size="sm" className="flex-1" onClick={async () => {
            try {
              await updateFn({ data: { userId: u.id, ...e } });
              toast.success("Saqlandi"); onChanged();
            } catch (err: any) { toast.error(err.message); }
          }}>💾 Saqlash</Button>
          {!isGeneral && (
            <Button size="sm" variant="destructive" onClick={async () => {
              if (!confirm(`${u.full_name} o'chirilsinmi?`)) return;
              try { await delFn({ data: { userId: u.id } }); toast.success("O'chirildi"); onChanged(); }
              catch (err: any) { toast.error(err.message); }
            }}><Trash2 className="h-4 w-4" /></Button>
          )}
        </div>
      </div>
    </details>
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
          <div key={x} className="flex items-center justify-between gap-2 p-2 rounded-lg bg-card border border-border">
            <span className="text-sm">{icon} {x}</span>
            <Button size="sm" variant="ghost" className="h-7 text-status-pending hover:bg-status-pending/10" onClick={() => remove(x)}>🗑️</Button>
          </div>
        ))}
      </div>
    </div>
  );
}
