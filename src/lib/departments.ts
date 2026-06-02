import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type DeptRow = {
  key: string;
  label: string;
  icon: string;
  sort_order: number;
  active: boolean;
};

export type OrderStatus = "pending_accept" | "in_progress" | "delivered";

export function useDepartments() {
  return useQuery({
    queryKey: ["departments"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("departments")
        .select("key, label, icon, sort_order, active")
        .eq("active", true)
        .order("sort_order");
      if (error) throw error;
      return (data ?? []) as DeptRow[];
    },
    staleTime: 60_000,
  });
}

export function findDept(depts: DeptRow[], key?: string | null): DeptRow | undefined {
  if (!key) return undefined;
  return depts.find((d) => d.key === key);
}

export function deptLabel(depts: DeptRow[], key?: string | null): string {
  const d = findDept(depts, key);
  return d ? d.label : (key ?? "");
}

export function deptIcon(depts: DeptRow[], key?: string | null): string {
  const d = findDept(depts, key);
  return d?.icon ?? "📋";
}

export function deptFull(depts: DeptRow[], key?: string | null): string {
  const d = findDept(depts, key);
  return d ? `${d.icon} ${d.label}` : (key ?? "");
}

export function nextDepartmentKey(depts: DeptRow[], current: string): string | null {
  const sorted = [...depts].sort((a, b) => a.sort_order - b.sort_order);
  const i = sorted.findIndex((d) => d.key === current);
  if (i < 0 || i >= sorted.length - 1) return null;
  return sorted[i + 1].key;
}

export function calcDelayDays(deadline: string | null | undefined): number {
  if (!deadline) return 0;
  const dl = new Date(deadline).getTime();
  const now = Date.now();
  if (now <= dl) return 0;
  return Math.floor((now - dl) / (1000 * 60 * 60 * 24));
}

export function formatMoney(n: number): string {
  return new Intl.NumberFormat("uz-UZ").format(n) + " so'm";
}
