import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Session, User } from "@supabase/supabase-js";

export type SystemRole = "general" | "admin" | "user";

export interface AuthState {
  user: User | null;
  session: Session | null;
  systemRole: SystemRole | null;
  depts: string[];
  isGeneral: boolean;
  isAdmin: boolean; // admin OR general — broad CRUD scope on orders
  loading: boolean;
}

export function useAuth(): AuthState {
  const [session, setSession] = useState<Session | null>(null);
  const [systemRole, setSystemRole] = useState<SystemRole | null>(null);
  const [depts, setDepts] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
    });
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session?.user) {
      setSystemRole(null);
      setDepts([]);
      return;
    }
    const uid = session.user.id;
    Promise.all([
      supabase.rpc("get_my_role"),
      supabase.from("user_departments").select("department_key").eq("user_id", uid),
    ]).then(([p, d]) => {
      setSystemRole(((p.data as any) as SystemRole) ?? "user");
      setDepts(((d.data ?? []) as any[]).map((x) => x.department_key));
    });
  }, [session?.user?.id]);

  return {
    user: session?.user ?? null,
    session,
    systemRole,
    depts,
    isGeneral: systemRole === "general",
    isAdmin: systemRole === "admin" || systemRole === "general",
    loading,
  };
}
