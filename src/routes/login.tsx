import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

// Username → email conversion. We store users with synthetic emails of the form
// `${username}@crm.local` so the UI only ever needs a username + password.
export function usernameToEmail(u: string) {
  return `${u.trim().toLowerCase()}@crm.local`;
}

function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) window.location.replace("/");
    });
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!username || !password) return;
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: usernameToEmail(username),
      password,
    });
    setLoading(false);
    if (error) toast.error("Login yoki parol noto'g'ri");
    else {
      toast.success("✅ Tizimga kirildi");
      window.location.href = "/";
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[radial-gradient(ellipse_at_top,_oklch(0.97_0.04_265)_0%,_oklch(0.985_0.005_240)_45%,_oklch(0.95_0.03_180)_100%)] p-4">
      <div className="w-full max-w-md bg-card border border-border rounded-2xl shadow-2xl p-8 backdrop-blur">
        <div className="mb-8 text-center">
          <div className="text-5xl mb-3">🏭</div>
          <h1 className="text-2xl font-bold tracking-tight">Ishlab chiqarish CRM</h1>
          <p className="mt-2 text-sm text-muted-foreground">Login va parol bilan kiring</p>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <Label htmlFor="username">👤 Login</Label>
            <Input id="username" autoComplete="username" required value={username} onChange={(e) => setUsername(e.target.value)} placeholder="masalan: stolyarka" />
          </div>
          <div>
            <Label htmlFor="password">🔒 Parol</Label>
            <Input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Kirilmoqda..." : "🚪 Kirish"}
          </Button>
        </form>
        <p className="mt-6 text-xs text-center text-muted-foreground">
          Hisob admin tomonidan yaratiladi
        </p>
      </div>
    </div>
  );
}
