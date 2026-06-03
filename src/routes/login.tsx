import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useDepartments } from "@/lib/departments";
import { loginByDeptPasswordFn, listLoginDeptsFn } from "@/lib/orders.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

function specialLabel(key: string): string | null {
  if (key === "__general__") return "👑 General";
  if (key === "__admin__") return "🛡️ Admin";
  if (key === "__user__") return "👤 User";
  return null;
}

function LoginPage() {
  const depts = useDepartments();
  const listFn = useServerFn(listLoginDeptsFn);
  const loginKeys = useQuery({ queryKey: ["login-keys"], queryFn: () => listFn() });
  const lookup = useServerFn(loginByDeptPasswordFn);
  const [dept, setDept] = useState<string>("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) window.location.replace("/");
    });
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!dept || !password) return;
    setLoading(true);
    try {
      const { email } = await lookup({ data: { dept, password } });
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      toast.success("✅ Tizimga kirildi");
      window.location.href = "/";
    } catch (err: any) {
      toast.error(err?.message?.includes("Invalid") ? "Parol noto'g'ri" : (err.message || "Kirishda xato"));
    } finally {
      setLoading(false);
    }
  }

  const keys = loginKeys.data?.keys ?? [];
  const deptList = depts.data ?? [];
  const renderOption = (k: string) => {
    const sp = specialLabel(k);
    if (sp) return sp;
    const d = deptList.find((x) => x.key === k);
    return d ? `${d.icon} ${d.label}` : k;
  };

  // ensure General is always selectable even if creds list is empty
  const showKeys = keys.length > 0 ? keys : ["__general__"];

  return (
    <div className="min-h-screen flex items-center justify-center bg-[radial-gradient(ellipse_at_top,_oklch(0.97_0.04_265)_0%,_oklch(0.985_0.005_240)_45%,_oklch(0.95_0.03_180)_100%)] p-4">
      <div className="w-full max-w-md bg-card border border-border rounded-2xl shadow-2xl p-8 backdrop-blur">
        <div className="mb-8 text-center">
          <div className="text-5xl mb-3">🏭</div>
          <h1 className="text-2xl font-bold tracking-tight">Ishlab chiqarish CRM</h1>
          <p className="mt-2 text-sm text-muted-foreground">Pozitsa va parol bilan kiring</p>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <Label>🎯 Pozitsa</Label>
            <Select value={dept} onValueChange={setDept}>
              <SelectTrigger><SelectValue placeholder="Pozitsa tanlang..." /></SelectTrigger>
              <SelectContent>
                {showKeys.map((k) => (
                  <SelectItem key={k} value={k}>{renderOption(k)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="password">🔒 Parol</Label>
            <Input
              id="password" type="password" autoComplete="current-password"
              required value={password} onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <Button type="submit" className="w-full" disabled={loading || !dept || !password}>
            {loading ? "Kirilmoqda..." : "🚪 Kirish"}
          </Button>
        </form>
        <p className="mt-6 text-xs text-center text-muted-foreground">
          Hisob General tomonidan yaratiladi
        </p>
      </div>
    </div>
  );
}
