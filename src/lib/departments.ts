export type Department =
  | "ojidaniya"
  | "stolyarka"
  | "stolyarka_otk"
  | "malyarka"
  | "malyarka_otk"
  | "kraska"
  | "kraska_otk"
  | "upakovka"
  | "arxiv";

export type AppRole = "admin" | Department;

export type OrderStatus = "pending_accept" | "in_progress" | "delivered";

export const DEPARTMENTS: Department[] = [
  "ojidaniya",
  "stolyarka",
  "stolyarka_otk",
  "malyarka",
  "malyarka_otk",
  "kraska",
  "kraska_otk",
  "upakovka",
  "arxiv",
];

export const DEPT_LABELS: Record<Department, string> = {
  ojidaniya: "Ojidaniya",
  stolyarka: "Stolyarka",
  stolyarka_otk: "Stolyarka OTK",
  malyarka: "Malyarka",
  malyarka_otk: "Malyarka OTK",
  kraska: "Kraska",
  kraska_otk: "Kraska OTK",
  upakovka: "Upakovka",
  arxiv: "Arxiv",
};

export const DEPT_ICONS: Record<Department, string> = {
  ojidaniya: "⏳", stolyarka: "🪵", stolyarka_otk: "🔍",
  malyarka: "🎨", malyarka_otk: "🔍", kraska: "🖌️",
  kraska_otk: "🔍", upakovka: "📦", arxiv: "🗄️",
};

export const ROLE_LABELS: Record<AppRole, string> = {
  admin: "Admin",
  ...DEPT_LABELS,
};

export const DEFAULT_PENALTY_PER_DAY = 100_000; // so'm (overridden by settings)
export const PENALTY_PER_DAY = DEFAULT_PENALTY_PER_DAY;

export function nextDepartment(dept: Department): Department | null {
  const i = DEPARTMENTS.indexOf(dept);
  if (i < 0 || i >= DEPARTMENTS.length - 1) return null;
  return DEPARTMENTS[i + 1];
}

export function statusColor(status: OrderStatus, isDelayed: boolean) {
  if (isDelayed) return "delayed";
  return status;
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
