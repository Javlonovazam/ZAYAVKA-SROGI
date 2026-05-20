import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import {
  DEPARTMENTS, DEPT_LABELS, PENALTY_PER_DAY, calcDelayDays, formatMoney,
  type Department,
} from "@/lib/departments";
import {
  acceptOrderFn, deliverOrderFn, createOrderFn, updateDeadlineFn,
  moveOrderFn, deleteOrderFn, adminCreateUserFn, updateOrderFn,
} from "@/lib/orders.functions";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { LogOut, Plus, Settings, AlertTriangle, Search, BarChart3 } from "lucide-react";

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
  status: "pending_accept" | "in_progress" | "delivered";
  deadline: string | null; position_deadlines: Record<string, string>;
  pogonaj_required: boolean; pogonaj_status: string; comment: string;
  entered_current_dept_at: string;
};

function DashboardPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [deptFilter, setDeptFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");

  useEffect(() => {
    if (!auth.loading && !auth.user) navigate({ to: "/login" });
  }, [auth.loading, auth.user, navigate]);

  const { data: orders = [] } = useQuery({
    queryKey: ["orders"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orders")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Order[];
    },
    enabled: !!auth.user,
  });

  // Realtime
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
    if (!search) return true;
    const s = search.toLowerCase();
    return o.number.toLowerCase().includes(s) || o.filial.toLowerCase().includes(s);
  });

  // Stats
  const delayed = filtered.filter((o) => {
    const dl = o.position_deadlines?.[o.current_department] || o.deadline;
    return o.status !== "delivered" && calcDelayDays(dl) > 0;
  });
  const totalPenalty = delayed.reduce((sum, o) => {
    const dl = o.position_deadlines?.[o.current_department] || o.deadline;
    return sum + calcDelayDays(dl) * PENALTY_PER_DAY;
  }, 0);

  if (auth.loading) return <div className="min-h-screen flex items-center justify-center">Yuklanmoqda...</div>;
  if (!auth.user) return null;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card sticky top-0 z-20">
        <div className="px-4 md:px-6 py-3 flex items-center gap-3 flex-wrap">
          <h1 className="text-lg md:text-xl font-bold">Ishlab chiqarish CRM</h1>
          <div className="ml-auto flex items-center gap-2 flex-wrap">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Qidirish..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8 w-48 md:w-64" />
            </div>
            {auth.isAdmin && <NewOrderDialog />}
            {auth.isAdmin && <AdminPanel />}
            <Button variant="ghost" size="sm" onClick={async () => { await supabase.auth.signOut(); navigate({ to: "/login" }); }}>
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
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
            const cards = filtered.filter((o) => o.current_department === dept);
            return (
              <div key={dept} className="w-80 flex-shrink-0">
                <div className="bg-secondary rounded-xl p-3 mb-3 flex items-center justify-between">
                  <h2 className="font-semibold text-sm">{DEPT_LABELS[dept]}</h2>
                  <Badge variant="outline">{cards.length}</Badge>
                </div>
                <div className="space-y-3">
                  {cards.map((o) => (
                    <OrderCard key={o.id} order={o} auth={auth} />
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

function OrderCard({ order, auth }: { order: Order; auth: ReturnType<typeof useAuth> }) {
  const accept = useServerFn(acceptOrderFn);
  const deliver = useServerFn(deliverOrderFn);
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const positionDeadline = order.position_deadlines?.[order.current_department] || order.deadline;
  const delayDays = calcDelayDays(positionDeadline);
  const isDelayed = order.status !== "delivered" && delayDays > 0;
  const penalty = delayDays * PENALTY_PER_DAY;

  const canActOnDept = auth.isAdmin || auth.roles.includes(order.current_department as any);

  let bg = "bg-card border-border";
  if (order.status === "delivered") bg = "bg-status-done/10 border-status-done/40";
  else if (isDelayed) bg = "bg-status-pending/10 border-status-pending/50";
  else if (order.status === "pending_accept") bg = "bg-status-pending/10 border-status-pending/40";
  else if (order.status === "in_progress") bg = "bg-status-progress/15 border-status-progress/50";

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={`w-full text-left rounded-lg border-2 ${bg} p-3 hover:shadow-md transition`}
      >
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="font-mono font-bold text-sm">#{order.number}</div>
          {order.status === "pending_accept" && <Badge className="bg-status-pending text-status-pending-fg">Qabul kutilmoqda</Badge>}
          {order.status === "in_progress" && <Badge className="bg-status-progress text-status-progress-fg">Jarayonda</Badge>}
          {order.status === "delivered" && <Badge className="bg-status-done text-status-done-fg">Tugadi</Badge>}
        </div>
        <div className="text-sm font-medium">{order.filial}</div>
        <div className="text-xs text-muted-foreground mt-1">
          🚪 {order.doors_count} • {order.product_type}
        </div>
        {positionDeadline && (
          <div className="text-xs mt-2">
            Srok: {new Date(positionDeadline).toLocaleDateString("uz-UZ")}
          </div>
        )}
        {isDelayed && (
          <div className="mt-2 text-xs text-status-pending font-semibold">
            ⏳ {delayDays} kun kechikdi • 💰 {formatMoney(penalty)}
          </div>
        )}
        {order.pogonaj_required && (
          <Badge variant="outline" className="mt-2 text-xs">Pogonaj: {order.pogonaj_status || "kerak"}</Badge>
        )}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Zayavka #{order.number}</DialogTitle></DialogHeader>
          <div className="space-y-2 text-sm">
            <div><b>Filial:</b> {order.filial}</div>
            <div><b>Eshik soni:</b> {order.doors_count}</div>
            <div><b>Mahsulot:</b> {order.product_type}</div>
            <div><b>Bo'lim:</b> {DEPT_LABELS[order.current_department]}</div>
            {positionDeadline && <div><b>Srok:</b> {new Date(positionDeadline).toLocaleString("uz-UZ")}</div>}
            {isDelayed && <div className="text-status-pending"><b>Kechikish:</b> {delayDays} kun • Jarima: {formatMoney(penalty)}</div>}
            {order.comment && <div><b>Izoh:</b> {order.comment}</div>}
          </div>

          {canActOnDept && order.status !== "delivered" && (
            <div className="flex gap-2 pt-2">
              {order.status === "pending_accept" && (
                <Button onClick={async () => {
                  try { await accept({ data: { orderId: order.id } }); toast.success("Qabul qilindi"); qc.invalidateQueries({ queryKey: ["orders"] }); setOpen(false); }
                  catch (e: any) { toast.error(e.message); }
                }}>QABUL QILDIM</Button>
              )}
              {order.status === "in_progress" && (
                <Button className="bg-status-done text-status-done-fg hover:bg-status-done/90" onClick={async () => {
                  try { await deliver({ data: { orderId: order.id } }); toast.success("Topshirildi"); qc.invalidateQueries({ queryKey: ["orders"] }); setOpen(false); }
                  catch (e: any) { toast.error(e.message); }
                }}>TAYYOR / TOPSHIRDIM</Button>
              )}
            </div>
          )}

          {auth.isAdmin && <AdminOrderActions order={order} onDone={() => setOpen(false)} />}
        </DialogContent>
      </Dialog>
    </>
  );
}

function AdminOrderActions({ order, onDone }: { order: Order; onDone: () => void }) {
  const updateDl = useServerFn(updateDeadlineFn);
  const move = useServerFn(moveOrderFn);
  const del = useServerFn(deleteOrderFn);
  const qc = useQueryClient();
  const positionDeadline = order.position_deadlines?.[order.current_department] || "";
  const [newDl, setNewDl] = useState(positionDeadline ? new Date(positionDeadline).toISOString().slice(0, 16) : "");
  const [moveTo, setMoveTo] = useState<Department>(order.current_department);

  return (
    <div className="border-t border-border pt-4 mt-2 space-y-3">
      <div className="text-xs font-semibold text-muted-foreground">ADMIN</div>
      <div className="flex gap-2 items-end">
        <div className="flex-1">
          <Label className="text-xs">Joriy bo'lim srogi</Label>
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
          <Label className="text-xs">Bo'limga ko'chirish</Label>
          <Select value={moveTo} onValueChange={(v) => setMoveTo(v as Department)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {DEPARTMENTS.map((d) => <SelectItem key={d} value={d}>{DEPT_LABELS[d]}</SelectItem>)}
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
      }}>O'chirish</Button>
    </div>
  );
}

function NewOrderDialog() {
  const create = useServerFn(createOrderFn);
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ number: "", filial: "", doors_count: 0, product_type: "", comment: "", pogonaj_required: false });
  const [posDl, setPosDl] = useState<Record<string, string>>({});

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm"><Plus className="h-4 w-4 mr-1" />Yangi</Button></DialogTrigger>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Yangi zayavka</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Raqami</Label><Input value={f.number} onChange={(e) => setF({ ...f, number: e.target.value })} /></div>
          <div><Label>Filial</Label><Input value={f.filial} onChange={(e) => setF({ ...f, filial: e.target.value })} /></div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label>Eshik soni</Label><Input type="number" value={f.doors_count} onChange={(e) => setF({ ...f, doors_count: +e.target.value })} /></div>
            <div><Label>Mahsulot turi</Label><Input value={f.product_type} onChange={(e) => setF({ ...f, product_type: e.target.value })} /></div>
          </div>
          <div><Label>Izoh</Label><Textarea value={f.comment} onChange={(e) => setF({ ...f, comment: e.target.value })} /></div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={f.pogonaj_required} onChange={(e) => setF({ ...f, pogonaj_required: e.target.checked })} />
            Pogonaj kerak
          </label>
          <div className="border-t border-border pt-3">
            <div className="text-sm font-semibold mb-2">Pozitsiya sroklari (ixtiyoriy)</div>
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {DEPARTMENTS.map((d) => (
                <div key={d} className="grid grid-cols-2 gap-2 items-center">
                  <span className="text-xs">{DEPT_LABELS[d]}</span>
                  <Input type="datetime-local" value={posDl[d] || ""} onChange={(e) => setPosDl({ ...posDl, [d]: e.target.value })} />
                </div>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={async () => {
            try {
              const pd: Record<string, string> = {};
              Object.entries(posDl).forEach(([k, v]) => { if (v) pd[k] = new Date(v).toISOString(); });
              await create({ data: { ...f, position_deadlines: pd } });
              toast.success("Yaratildi");
              qc.invalidateQueries({ queryKey: ["orders"] });
              setOpen(false);
              setF({ number: "", filial: "", doors_count: 0, product_type: "", comment: "", pogonaj_required: false });
              setPosDl({});
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
        <DialogHeader><DialogTitle>Yangi foydalanuvchi</DialogTitle></DialogHeader>
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
