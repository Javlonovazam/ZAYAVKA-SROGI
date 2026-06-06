// Google Sheets backup helper. Server-only.
// Mirrors order create/move events into a single spreadsheet as a backup copy.
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/google_sheets/v4";
const SHEET_TITLE = "Novza Production Backup";
const TAB_NAME = "Sheet1";
const SETTINGS_KEY = "gsheet_backup_id";

const HEADERS = [
  "ID",
  "Date",
  "Order Number",
  "Customer",
  "Product",
  "Quantity",
  "Current Department",
  "Status",
  "Comment",
  "User",
  "Updated At",
];

function authHeaders(): Record<string, string> | null {
  const lov = process.env.LOVABLE_API_KEY;
  const gs = process.env.GOOGLE_SHEETS_API_KEY;
  if (!lov || !gs) return null;
  return {
    Authorization: `Bearer ${lov}`,
    "X-Connection-Api-Key": gs,
    "Content-Type": "application/json",
  };
}

async function getStoredSpreadsheetId(): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("app_settings").select("value").eq("key", SETTINGS_KEY).maybeSingle();
  const v = (data as any)?.value;
  if (typeof v === "string") return v;
  if (v && typeof v === "object" && typeof v.id === "string") return v.id;
  return null;
}

async function storeSpreadsheetId(id: string) {
  await supabaseAdmin.from("app_settings").upsert(
    { key: SETTINGS_KEY, value: id as any },
    { onConflict: "key" },
  );
}

async function createSpreadsheet(headers: Record<string, string>): Promise<string> {
  const res = await fetch(`${GATEWAY_URL}/spreadsheets`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      properties: { title: SHEET_TITLE },
      sheets: [{ properties: { title: TAB_NAME } }],
    }),
  });
  if (!res.ok) throw new Error(`Sheets create ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { spreadsheetId: string };
  // Write header row
  await fetch(
    `${GATEWAY_URL}/spreadsheets/${json.spreadsheetId}/values/${TAB_NAME}!A1?valueInputOption=RAW`,
    {
      method: "PUT",
      headers,
      body: JSON.stringify({ values: [HEADERS] }),
    },
  );
  return json.spreadsheetId;
}

async function ensureSpreadsheetId(headers: Record<string, string>): Promise<string> {
  const existing = await getStoredSpreadsheetId();
  if (existing) return existing;
  const id = await createSpreadsheet(headers);
  await storeSpreadsheetId(id);
  return id;
}

async function deptLabel(key: string | null | undefined): Promise<string> {
  if (!key) return "";
  const { data } = await supabaseAdmin
    .from("departments").select("label").eq("key", key).maybeSingle();
  return (data as any)?.label || key;
}

async function userName(userId: string | null | undefined): Promise<string> {
  if (!userId) return "";
  const { data } = await supabaseAdmin
    .from("profiles").select("full_name").eq("id", userId).maybeSingle();
  return (data as any)?.full_name || "";
}

export async function appendOrderBackup(opts: {
  order: any;
  userId: string | null;
  action: string; // created | accepted | delivered | moved
}): Promise<void> {
  try {
    const headers = authHeaders();
    if (!headers) return; // silent no-op if not connected
    const { order, userId, action } = opts;
    const id = await ensureSpreadsheetId(headers);
    const [deptLbl, who] = await Promise.all([
      deptLabel(order.current_department),
      userName(userId),
    ]);
    const now = new Date().toISOString();
    const row = [
      String(order.id ?? ""),
      now,
      String(order.number ?? ""),
      String(order.filial ?? ""),
      String(order.product_type ?? ""),
      Number(order.doors_count ?? 0),
      deptLbl,
      `${order.status ?? ""} (${action})`,
      String(order.comment ?? ""),
      who,
      String(order.updated_at ?? now),
    ];
    const res = await fetch(
      `${GATEWAY_URL}/spreadsheets/${id}/values/${TAB_NAME}!A1:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ values: [row] }),
      },
    );
    if (!res.ok) {
      console.error("[gsheets-backup] append failed", res.status, await res.text());
    }
  } catch (e) {
    // never break business logic
    console.error("[gsheets-backup] error", e);
  }
}
