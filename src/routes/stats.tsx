import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { DEPARTMENTS, DEPT_LABELS, DEPT_ICONS, calcDelayDays, formatMoney, type Department } from "@/lib/departments";
import { aiAnalyzeFn } from "@/lib/orders.functions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { ArrowLeft, Sparkles } from "lucide-react";
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
  const [aiText, setAiText] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [period, setPeriod] = useState<Period>("all");

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
      return data || [];
    },
    enabled: !!auth.user,
  });

  const { data: history = [] } = useQuery({
    queryKey: ["history-list"],
    queryFn: async () => {
      const { data } = await supabase
        .from("order_history")
        .select("id, order_id, action, from_department, to_department, created_at, user_id")
        .order("created_at", { ascending: false })
        .limit(500);
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
  const orders = useMemo(
    () => allOrders.filter((o: any) => !since || new Date(o.created_at) >= since),
    [allOrders, since],
  );
  const filteredHistory = useMemo(
    () => history.filter((h: any) => !since || new Date(h.created_at) >= since),
    [history, since],
  );

  if (auth.loading) return <div className="min-h-screen flex items-center justify-center">Yuklanmoqda...</div>;

  const byDept = DEPARTMENTS.map((d) => {
    const all = orders.filter((o: any) => o.current_department === d);
    const delayed = all.filter((o: any) => {
      const dl = o.position_deadlines?.[d] || o.deadline;
      return o.status !== "delivered" && calcDelayDays(dl) > 0;
    });
    return { name: DEPT_LABELS[d as Department], jami: all.length, kechikkan: delayed.length };
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

  const penaltyByDept = DEPARTMENTS.map((d) => {
    const sum = orders
      .filter((o: any) => {
        const blame = (o.status === "pending_accept" && o.previous_department) ? o.previous_department : o.current_department;
        return blame === d && o.status !== "delivered";
      })
      .reduce((acc: number, o: any) => {
        const blame = (o.status === "pending_accept" && o.previous_department) ? o.previous_department : o.current_department;
        const dl = o.position_deadlines?.[blame] || o.deadline;
        return acc + calcDelayDays(dl) * PENALTY;
      }, 0);
    return { name: DEPT_LABELS[d as Department], jarima: sum };
  });

  const totalDelayed = orders.filter((o: any) => {
    const blame = (o.status === "pending_accept" && o.previous_department) ? o.previous_department : o.current_department;
    const dl = o.position_deadlines?.[blame] || o.deadline;
    return o.status !== "delivered" && calcDelayDays(dl) > 0;
  }).length;
  const totalPenalty = penaltyByDept.reduce((s, x) => s + x.jarima, 0);

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
          {auth.isAdmin && (
            <Button size="sm" className="ml-auto" disabled={aiLoading} onClick={async () => {
              setAiLoading(true); setAiText("");
              try { const r = await analyze({ data: undefined as any }); setAiText(r.text); }
              catch (e: any) { toast.error(e.message); }
              finally { setAiLoading(false); }
            }}>
              <Sparkles className="h-4 w-4 mr-1" />{aiLoading ? "Tahlil qilinmoqda..." : "AI tahlil"}
            </Button>
          )}
        </div>
      </header>

      <main className="p-4 md:p-6 space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="📋 Jami zayavka" value={orders.length} />
          <StatCard label="🔄 Jarayonda" value={orders.filter((o: any) => o.status !== "delivered").length} />
          <StatCard label="⏳ Kechikkan" value={totalDelayed} accent="text-status-pending" />
          <StatCard label="💰 Jami jarima" value={formatMoney(totalPenalty)} accent="text-status-pending" />
        </div>

        {aiText && (
          <Card className="p-5 border-primary/30 bg-primary/5 animate-slide-up">
            <div className="flex items-center gap-2 mb-3 text-sm font-semibold text-primary">
              <Sparkles className="h-4 w-4" />AI tahlil natijasi
            </div>
            <div className="text-sm whitespace-pre-wrap leading-relaxed">{aiText}</div>
          </Card>
        )}

        <Tabs defaultValue="charts">
          <TabsList>
            <TabsTrigger value="charts">📈 Grafiklar</TabsTrigger>
            <TabsTrigger value="history">🕘 Tarix (oxirgi {filteredHistory.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="charts" className="pt-4">
            <div className="grid lg:grid-cols-2 gap-4">
              <Card className="p-5">
                <h3 className="font-semibold mb-4">Bo'limlar bo'yicha zayavkalar</h3>
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={byDept}>
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

              <Card className="p-5 lg:col-span-2">
                <h3 className="font-semibold mb-4">Bo'limlar bo'yicha jarima (so'm)</h3>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={penaltyByDept}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} angle={-20} textAnchor="end" height={70} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(v: any) => formatMoney(Number(v))} />
                    <Bar dataKey="jarima" fill="#ef4444" />
                  </BarChart>
                </ResponsiveContainer>
              </Card>
            </div>
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
                      {h.action === "created" && <>🆕 Yaratildi → <b>{DEPT_LABELS[h.to_department as Department] ?? h.to_department}</b></>}
                      {h.action === "accepted" && <>✅ Qabul qildi <b>{DEPT_LABELS[h.to_department as Department] ?? h.to_department}</b></>}
                      {h.action === "delivered" && <>📦 <b>{DEPT_LABELS[h.from_department as Department] ?? h.from_department}</b> → <b>{DEPT_LABELS[h.to_department as Department] ?? h.to_department}</b></>}
                      {h.action === "moved" && <>🔀 Admin: <b>{DEPT_LABELS[h.from_department as Department] ?? "—"}</b> → <b>{DEPT_LABELS[h.to_department as Department] ?? h.to_department}</b></>}
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
