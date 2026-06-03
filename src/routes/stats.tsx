import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useDepartments, deptLabel, calcDelayDays, formatMoney } from "@/lib/departments";
import { aiAnalyzeFn } from "@/lib/orders.functions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { ArrowLeft, Sparkles, ExternalLink } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  PieChart, Pie, Cell, Legend, LineChart, Line,
} from "recharts";

export const Route = createFileRoute("/stats")({
  component: StatsPage,
});

const COLORS = ["#ef4444", "#f59e0b", "#22c55e", "#3b82f6", "#a855f7", "#ec4899", "#14b8a6", "#f97316", "#84cc16"];

type Period = "today" | "week" | "month" | "all";

function periodStart(p: Period): Date | null {
  const d = new Date(); d.setHours(0, 0, 0, 0);
  if (p === "today") return d;
  if (p === "week") { d.setDate(d.getDate() - 7); return d; }
  if (p === "month") { d.setDate(d.getDate() - 30); return d; }
  return null;
}

function StatsPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const analyze = useServerFn(aiAnalyzeFn);
  const deps = useDepartments();
  const deptList = deps.data ?? [];
  const [aiText, setAiText] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [period, setPeriod] = useState<Period>("all");
  const [filialFilter, setFilialFilter] = useState<string>("all");
  const [openDeptKey, setOpenDeptKey] = useState<string | null>(null);

  useEffect(() => {
    if (!auth.loading && (!auth.user || !auth.isAdmin)) navigate({ to: "/" });
  }, [auth.loading, auth.user, auth.isAdmin, navigate]);

  const { data: settings } = useQuery({
    queryKey: ["app_settings"],
    queryFn: async () => {
      const { data } = await supabase.from("app_settings").select("key, value");
      const m: Record<string, any> = {};
      (data ?? []).forEach((r: any) => { m[r.key] = r.value; });
      return { penalty_per_day: Number(m.penalty_per_day ?? 100000) };
    },
  });
  const PENALTY = settings?.penalty_per_day ?? 100000;

  const { data: allOrders = [] } = useQuery({
    queryKey: ["orders"],
    queryFn: async () => {
      const { data } = await supabase.from("orders").select("*").order("created_at", { ascending: false });
      return (data || []) as any[];
    },
    enabled: !!auth.user,
  });

  const { data: history = [] } = useQuery({
    queryKey: ["history-list"],
    queryFn: async () => {
      const { data } = await supabase
        .from("order_history")
        .select("id, order_id, action, from_department, to_department, created_at, user_id")
        .order("created_at", { ascending: false }).limit(500);
      const userIds = Array.from(new Set((data ?? []).map((r: any) => r.user_id).filter(Boolean)));
      let names: Record<string, string> = {};
      if (userIds.length) {
        const { data: profs } = await supabase.from("profiles").select("id, full_name").in("id", userIds);
        names = Object.fromEntries((profs ?? []).map((p: any) => [p.id, p.full_name]));
      }
      const orderIds = Array.from(new Set((data ?? []).map((r: any) => r.order_id)));
      let nums: Record<string, string> = {};
      if (orderIds.length) {
        const { data: ords } = await supabase.from("orders").select("id, number").in("id", orderIds);
        nums = Object.fromEntries((ords ?? []).map((o: any) => [o.id, o.number]));
      }
      return (data ?? []).map((r: any) => ({ ...r, actor: names[r.user_id] || "", order_number: nums[r.order_id] || "" }));
    },
    enabled: !!auth.user,
  });

  const since = periodStart(period);
  const filials = useMemo(
    () => Array.from(new Set((allOrders as any[]).map((o) => o.filial).filter(Boolean))).sort(),
    [allOrders],
  );

  const orders = useMemo(
    () => (allOrders as any[]).filter((o) =>
      (!since || new Date(o.created_at) >= since) &&
      (filialFilter === "all" || o.filial === filialFilter)
    ),
    [allOrders, since, filialFilter],
  );
  const filteredHistory = useMemo(() => history.filter((h: any) => !since || new Date(h.created_at) >= since), [history, since]);

  if (auth.loading) return <div className="min-h-screen flex items-center justify-center">Yuklanmoqda...</div>;

  // helper: who is blamed for delay
  const blameOf = (o: any) => (o.status === "pending_accept" && o.previous_department) ? o.previous_department : o.current_department;

  // per-department breakdown (table + charts)
  const breakdown = deptList.map((d) => {
    const all = orders.filter((o: any) => o.current_department === d.key);
    const delayedOrders = orders.filter((o: any) => {
      if (o.status === "delivered") return false;
      if (blameOf(o) !== d.key) return false;
      const dl = o.position_deadlines?.[d.key] || o.deadline;
      return calcDelayDays(dl) > 0;
    });
    const totalDelayDays = delayedOrders.reduce((s: number, o: any) => {
      const dl = o.position_deadlines?.[d.key] || o.deadline;
      return s + calcDelayDays(dl);
    }, 0);
    const penalty = totalDelayDays * PENALTY;
    return {
      key: d.key, label: d.label, icon: d.icon,
      total: all.length, delayed: delayedOrders.length,
      delayDays: totalDelayDays, penalty,
      delayedOrders,
    };
  });

  const statusCounts = [
    { name: "🔴 Qabul kutilmoqda", value: orders.filter((o: any) => o.status === "pending_accept").length },
    { name: "🟠 Jarayonda", value: orders.filter((o: any) => o.status === "in_progress").length },
    { name: "🟢 Tugagan", value: orders.filter((o: any) => o.status === "delivered").length },
  ];

  const days = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - (13 - i)); d.setHours(0, 0, 0, 0);
    return d;
  });
  const trend = days.map((d) => {
    const next = new Date(d); next.setDate(next.getDate() + 1);
    const created = orders.filter((o: any) => {
      const t = new Date(o.created_at).getTime();
      return t >= d.getTime() && t < next.getTime();
    }).length;
    const finished = orders.filter((o: any) => o.finished_at && (() => {
      const t = new Date(o.finished_at).getTime();
      return t >= d.getTime() && t < next.getTime();
    })()).length;
    return { day: d.toLocaleDateString("uz-UZ", { day: "2-digit", month: "2-digit" }), Yangi: created, Tugagan: finished };
  });

  const totalDelayed = breakdown.reduce((s, x) => s + x.delayed, 0);
  const totalPenalty = breakdown.reduce((s, x) => s + x.penalty, 0);
  const openDept = breakdown.find((b) => b.key === openDeptKey) || null;

  const runAi = async () => {
    setAiLoading(true); setAiText("");
    try { const r = await analyze({ data: undefined as any }); setAiText(r.text); }
    catch (e: any) { toast.error(e.message); }
    finally { setAiLoading(false); }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card sticky top-0 z-20 backdrop-blur">
        <div className="px-4 md:px-6 py-3 flex items-center gap-3 flex-wrap">
          <Link to="/"><Button size="sm" variant="ghost"><ArrowLeft className="h-4 w-4 mr-1" />Kanban</Button></Link>
          <h1 className="text-lg md:text-xl font-bold">📊 Statistika va tahlil</h1>
          <Select value={period} onValueChange={(v) => setPeriod(v as Period)}>
            <SelectTrigger className="w-40 ml-2"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="today">📅 Bugun</SelectItem>
              <SelectItem value="week">🗓️ 7 kun</SelectItem>
              <SelectItem value="month">📆 30 kun</SelectItem>
              <SelectItem value="all">🌐 Hammasi</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filialFilter} onValueChange={setFilialFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="🏢 Filial" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">🏢 Barcha filiallar</SelectItem>
              {filials.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </header>

      <main className="p-4 md:p-6 space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="📋 Jami zayavka" value={orders.length} />
          <StatCard label="🔄 Jarayonda" value={orders.filter((o: any) => o.status !== "delivered").length} />
          <StatCard label="⏳ Kechikkan" value={totalDelayed} accent="text-status-pending" />
          <StatCard label="💰 Jami jarima" value={formatMoney(totalPenalty)} accent="text-status-pending" />
        </div>

        <Tabs defaultValue="dashboard">
          <TabsList className="flex-wrap">
            <TabsTrigger value="dashboard">📊 Dashboard</TabsTrigger>
            <TabsTrigger value="charts">📈 Grafiklar</TabsTrigger>
            <TabsTrigger value="ai">🤖 AI tahlil</TabsTrigger>
            <TabsTrigger value="history">🕘 Tarix ({filteredHistory.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="dashboard" className="pt-4 space-y-4">
            <Card className="p-0 overflow-hidden">
              <div className="p-4 border-b border-border">
                <h3 className="font-semibold">🏭 Bo'limlar bo'yicha jarima hisoboti</h3>
                <p className="text-xs text-muted-foreground mt-1">Bo'lim ustiga bosing — kechikkan zayavkalar ro'yxati ochiladi</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-secondary/50 text-xs uppercase">
                    <tr>
                      <th className="text-left p-3">Bo'lim</th>
                      <th className="text-right p-3">Jami zayavka</th>
                      <th className="text-right p-3">⏳ Kechikkan</th>
                      <th className="text-right p-3">📅 Jami kechikish (kun)</th>
                      <th className="text-right p-3">💰 Jarima summasi</th>
                      <th className="p-3 w-10"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {breakdown.map((b) => (
                      <tr
                        key={b.key}
                        className={`border-t border-border ${b.delayed > 0 ? "hover:bg-status-pending/5 cursor-pointer" : "hover:bg-secondary/30"}`}
                        onClick={() => b.delayed > 0 && setOpenDeptKey(b.key)}
                      >
                        <td className="p-3 font-medium">{b.icon} {b.label}</td>
                        <td className="p-3 text-right">{b.total}</td>
                        <td className={`p-3 text-right ${b.delayed > 0 ? "text-status-pending font-bold" : ""}`}>{b.delayed}</td>
                        <td className="p-3 text-right">{b.delayDays}</td>
                        <td className={`p-3 text-right ${b.penalty > 0 ? "text-status-pending font-bold" : ""}`}>{formatMoney(b.penalty)}</td>
                        <td className="p-3 text-muted-foreground">{b.delayed > 0 && <ExternalLink className="h-4 w-4" />}</td>
                      </tr>
                    ))}
                    <tr className="border-t-2 border-border bg-secondary/30 font-bold">
                      <td className="p-3">JAMI</td>
                      <td className="p-3 text-right">{orders.length}</td>
                      <td className="p-3 text-right text-status-pending">{totalDelayed}</td>
                      <td className="p-3 text-right">{breakdown.reduce((s, x) => s + x.delayDays, 0)}</td>
                      <td className="p-3 text-right text-status-pending">{formatMoney(totalPenalty)}</td>
                      <td></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </Card>

            <Card className="p-5">
              <h3 className="font-semibold mb-4">💰 Jarima bo'limlar bo'yicha</h3>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={breakdown.map((b) => ({ name: b.label, jarima: b.penalty }))}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} angle={-20} textAnchor="end" height={70} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v: any) => formatMoney(Number(v))} />
                  <Bar dataKey="jarima" fill="#ef4444" />
                </BarChart>
              </ResponsiveContainer>
            </Card>
          </TabsContent>

          <TabsContent value="charts" className="pt-4">
            <div className="grid lg:grid-cols-2 gap-4">
              <Card className="p-5">
                <h3 className="font-semibold mb-4">Bo'limlar bo'yicha zayavkalar</h3>
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={breakdown.map((b) => ({ name: b.label, jami: b.total, kechikkan: b.delayed }))}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} angle={-20} textAnchor="end" height={70} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="jami" fill="hsl(var(--primary))" />
                    <Bar dataKey="kechikkan" fill="#ef4444" />
                  </BarChart>
                </ResponsiveContainer>
              </Card>

              <Card className="p-5">
                <h3 className="font-semibold mb-4">Statuslar bo'yicha</h3>
                <ResponsiveContainer width="100%" height={280}>
                  <PieChart>
                    <Pie data={statusCounts} dataKey="value" nameKey="name" outerRadius={100} label>
                      {statusCounts.map((_, i) => <Cell key={i} fill={COLORS[i]} />)}
                    </Pie>
                    <Tooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </Card>

              <Card className="p-5 lg:col-span-2">
                <h3 className="font-semibold mb-4">Oxirgi 14 kun trendi</h3>
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={trend}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Legend />
                    <Line type="monotone" dataKey="Yangi" stroke="hsl(var(--primary))" strokeWidth={2} />
                    <Line type="monotone" dataKey="Tugagan" stroke="#22c55e" strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="ai" className="pt-4">
            <Card className="p-5 space-y-4">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <h3 className="font-semibold flex items-center gap-2"><Sparkles className="h-4 w-4 text-primary" /> AI har kunlik tahlil</h3>
                  <p className="text-xs text-muted-foreground mt-1">
                    Jarayonni baholaydi, bottleneck bo'limlarni topadi va aniq tavsiyalar beradi
                  </p>
                </div>
                <Button onClick={runAi} disabled={aiLoading}>
                  <Sparkles className="h-4 w-4 mr-1" />
                  {aiLoading ? "Tahlil qilinmoqda..." : "Yangi tahlil"}
                </Button>
              </div>
              {aiText ? (
                <div className="text-sm whitespace-pre-wrap leading-relaxed border border-primary/20 bg-primary/5 rounded-lg p-4">
                  {aiText}
                </div>
              ) : (
                <div className="text-sm text-muted-foreground text-center py-10 border-2 border-dashed border-border rounded-lg">
                  {aiLoading ? "⏳ Tahlil qilinmoqda..." : "Tahlilni boshlash uchun “Yangi tahlil” tugmasini bosing"}
                </div>
              )}
            </Card>
          </TabsContent>

          <TabsContent value="history" className="pt-4">
            <Card className="p-0 overflow-hidden">
              <div className="max-h-[70vh] overflow-y-auto divide-y divide-border">
                {filteredHistory.length === 0 && <div className="p-6 text-sm text-muted-foreground text-center">Tarix bo'sh</div>}
                {filteredHistory.map((h: any) => (
                  <div key={h.id} className="p-3 hover:bg-secondary/40 transition flex items-center gap-3 text-sm">
                    <div className="text-xs text-muted-foreground w-40 shrink-0">
                      {new Date(h.created_at).toLocaleString("uz-UZ", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                    </div>
                    <div className="font-mono text-xs w-20 shrink-0">#{h.order_number}</div>
                    <div className="flex-1">
                      {h.action === "created" && <>🆕 Yaratildi → <b>{deptLabel(deptList, h.to_department)}</b></>}
                      {h.action === "accepted" && <>✅ Qabul qildi <b>{deptLabel(deptList, h.to_department)}</b></>}
                      {h.action === "delivered" && <>📦 <b>{deptLabel(deptList, h.from_department)}</b> → <b>{deptLabel(deptList, h.to_department)}</b></>}
                      {h.action === "moved" && <>🔀 Admin: <b>{deptLabel(deptList, h.from_department)}</b> → <b>{deptLabel(deptList, h.to_department)}</b></>}
                      {h.action === "deadline_changed" && <>📅 Srok o'zgartirildi</>}
                      {h.action === "edited" && <>✏️ Tahrirlandi</>}
                    </div>
                    <div className="text-xs text-muted-foreground">{h.actor}</div>
                  </div>
                ))}
              </div>
            </Card>
          </TabsContent>
        </Tabs>
      </main>

      <Dialog open={!!openDept} onOpenChange={(o) => !o && setOpenDeptKey(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {openDept && `${openDept.icon} ${openDept.label} — kechikkan zayavkalar`}
            </DialogTitle>
          </DialogHeader>
          {openDept && (
            <div className="space-y-2 max-h-[60vh] overflow-y-auto">
              <div className="text-sm flex flex-wrap gap-4 p-3 bg-secondary/40 rounded-lg">
                <span>⏳ <b>{openDept.delayed}</b> ta zayavka</span>
                <span>📅 <b>{openDept.delayDays}</b> kun</span>
                <span className="text-status-pending">💰 <b>{formatMoney(openDept.penalty)}</b></span>
              </div>
              {openDept.delayedOrders.length === 0 && (
                <div className="text-center text-sm text-muted-foreground py-6">Bo'sh</div>
              )}
              {openDept.delayedOrders.map((o: any) => {
                const dl = o.position_deadlines?.[openDept.key] || o.deadline;
                const dd = calcDelayDays(dl);
                return (
                  <div key={o.id} className="border border-border rounded-lg p-3 flex items-center justify-between gap-3 hover:bg-secondary/30">
                    <div className="min-w-0">
                      <div className="font-mono text-sm font-semibold">#{o.number}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        🏢 {o.filial || "—"} • 🚪 {o.doors_count} ta • {o.product_type || ""}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-status-pending font-bold text-sm">⏳ {dd} kun</div>
                      <div className="text-xs text-status-pending">{formatMoney(dd * PENALTY)}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatCard({ label, value, accent }: { label: string; value: any; accent?: string }) {
  return (
    <Card className="p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${accent || ""}`}>{value}</div>
    </Card>
  );
}
