import { createFileRoute, redirect, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { DEPARTMENTS, DEPT_LABELS, PENALTY_PER_DAY, calcDelayDays, formatMoney, type Department } from "@/lib/departments";
import { aiAnalyzeFn } from "@/lib/orders.functions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { ArrowLeft, Sparkles } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  PieChart, Pie, Cell, Legend, LineChart, Line,
} from "recharts";

export const Route = createFileRoute("/stats")({
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw redirect({ to: "/login" });
  },
  component: StatsPage,
});

const COLORS = ["#ef4444", "#f59e0b", "#22c55e", "#3b82f6", "#a855f7", "#ec4899", "#14b8a6", "#f97316", "#84cc16"];

function StatsPage() {
  const auth = useAuth();
  const analyze = useServerFn(aiAnalyzeFn);
  const [aiText, setAiText] = useState("");
  const [aiLoading, setAiLoading] = useState(false);

  const { data: orders = [] } = useQuery({
    queryKey: ["orders"],
    queryFn: async () => {
      const { data } = await supabase.from("orders").select("*").order("created_at", { ascending: false });
      return data || [];
    },
    enabled: !!auth.user,
  });

  if (auth.loading) return <div className="min-h-screen flex items-center justify-center">Yuklanmoqda...</div>;

  // Per dept counts
  const byDept = DEPARTMENTS.map((d) => {
    const all = orders.filter((o: any) => o.current_department === d);
    const delayed = all.filter((o: any) => {
      const dl = o.position_deadlines?.[d] || o.deadline;
      return o.status !== "delivered" && calcDelayDays(dl) > 0;
    });
    return { name: DEPT_LABELS[d as Department], jami: all.length, kechikkan: delayed.length };
  });

  // Status pie
  const statusCounts = [
    { name: "Qabul kutilmoqda", value: orders.filter((o: any) => o.status === "pending_accept").length },
    { name: "Jarayonda", value: orders.filter((o: any) => o.status === "in_progress").length },
    { name: "Tugagan", value: orders.filter((o: any) => o.status === "delivered").length },
  ];

  // Last 14 days trend (created vs finished)
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

  // Penalty per dept
  const penaltyByDept = DEPARTMENTS.map((d) => {
    const sum = orders
      .filter((o: any) => o.current_department === d && o.status !== "delivered")
      .reduce((acc: number, o: any) => {
        const dl = o.position_deadlines?.[d] || o.deadline;
        return acc + calcDelayDays(dl) * PENALTY_PER_DAY;
      }, 0);
    return { name: DEPT_LABELS[d as Department], jarima: sum };
  });

  const totalDelayed = orders.filter((o: any) => {
    const dl = o.position_deadlines?.[o.current_department] || o.deadline;
    return o.status !== "delivered" && calcDelayDays(dl) > 0;
  }).length;
  const totalPenalty = penaltyByDept.reduce((s, x) => s + x.jarima, 0);

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card sticky top-0 z-20">
        <div className="px-4 md:px-6 py-3 flex items-center gap-3">
          <Link to="/"><Button size="sm" variant="ghost"><ArrowLeft className="h-4 w-4 mr-1" />Kanban</Button></Link>
          <h1 className="text-lg md:text-xl font-bold">Statistika va tahlil</h1>
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
          <StatCard label="Jami zayavka" value={orders.length} />
          <StatCard label="Jarayonda" value={orders.filter((o: any) => o.status !== "delivered").length} />
          <StatCard label="Kechikkan" value={totalDelayed} accent="text-status-pending" />
          <StatCard label="Jami jarima" value={formatMoney(totalPenalty)} accent="text-status-pending" />
        </div>

        {aiText && (
          <Card className="p-5 border-primary/30 bg-primary/5">
            <div className="flex items-center gap-2 mb-3 text-sm font-semibold text-primary">
              <Sparkles className="h-4 w-4" />AI tahlil natijasi
            </div>
            <div className="text-sm whitespace-pre-wrap leading-relaxed">{aiText}</div>
          </Card>
        )}

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
