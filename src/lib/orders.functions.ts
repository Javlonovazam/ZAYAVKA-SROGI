import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// ---------- helpers ----------
async function getRole(_supabase: any, userId: string): Promise<string | null> {
  // system_role column is not readable by clients (RLS/grants). Use admin client.
  const { data } = await supabaseAdmin.from("profiles").select("system_role").eq("id", userId).maybeSingle();
  return (data as any)?.system_role ?? null;
}

async function actorName(userId: string): Promise<string> {
  const { data } = await supabaseAdmin.from("profiles").select("full_name").eq("id", userId).maybeSingle();
  return ((data as any)?.full_name as string) || "";
}

async function audit(
  userId: string,
  entity: string,
  action: string,
  entityId: string | null,
  before: any = null,
  after: any = null,
  meta: any = null,
) {
  try {
    const name = await actorName(userId);
    await supabaseAdmin.from("audit_log").insert({
      actor_id: userId, actor_name: name, entity, entity_id: entityId,
      action, before, after, meta,
    });
  } catch (e) { /* never break business logic on audit failure */ }
}

async function assertAdmin(supabase: any, userId: string) {
  const r = await getRole(supabase, userId);
  if (r !== "admin" && r !== "general") throw new Error("Faqat admin/general bajara oladi");
}

async function assertGeneral(supabase: any, userId: string) {
  const r = await getRole(supabase, userId);
  if (r !== "general") throw new Error("Faqat General bajara oladi");
}

async function nextDeptKey(currentKey: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("departments").select("key, sort_order")
    .eq("active", true).order("sort_order");
  const arr = (data ?? []) as { key: string; sort_order: number }[];
  const i = arr.findIndex((d) => d.key === currentKey);
  if (i < 0 || i >= arr.length - 1) return null;
  return arr[i + 1].key;
}

async function firstDeptKey(): Promise<string> {
  const { data } = await supabaseAdmin
    .from("departments").select("key").eq("active", true)
    .order("sort_order").limit(1).maybeSingle();
  return ((data as any)?.key as string) ?? "ojidaniya";
}

async function lastDeptKey(): Promise<string> {
  const { data } = await supabaseAdmin
    .from("departments").select("key").eq("active", true)
    .order("sort_order", { ascending: false }).limit(1).maybeSingle();
  return ((data as any)?.key as string) ?? "arxiv";
}

// ---------- LOGIN: dept + password -> email ----------
export const loginByDeptPasswordFn = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({
      dept: z.string().min(1).max(64),
      password: z.string().min(1).max(128),
    }).parse(input),
  )
  .handler(async ({ data }) => {
    const { data: cred } = await supabaseAdmin
      .from("user_credentials")
      .select("user_id")
      .eq("login_dept", data.dept)
      .eq("password_plain", data.password)
      .maybeSingle();
    if (!cred) return { email: null as string | null, error: "Pozitsa yoki parol noto'g'ri" };
    const { data: u } = await supabaseAdmin.auth.admin.getUserById((cred as any).user_id);
    const email = u.user?.email ?? null;
    if (!email) return { email: null, error: "Hisob topilmadi" };
    return { email, error: null as string | null };
  });

// ---------- List available login pozitsalar (public) ----------
export const listLoginDeptsFn = createServerFn({ method: "GET" })
  .handler(async () => {
    const { data } = await supabaseAdmin
      .from("user_credentials").select("login_dept");
    const set = new Set<string>();
    (data ?? []).forEach((r: any) => { if (r.login_dept) set.add(r.login_dept); });
    return { keys: Array.from(set).sort() };
  });

// ---------- Create order (admin) ----------
export const createOrderFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      number: z.string().min(1).max(64),
      filial: z.string().default(""),
      doors_count: z.number().int().min(0).default(0),
      product_type: z.string().default(""),
      comment: z.string().default(""),
      pogonaj_required: z.boolean().default(false),
      deadline: z.string().nullable().optional(),
      position_deadlines: z.record(z.string(), z.string()).default({}),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const first = await firstDeptKey();

    const { data: order, error } = await supabaseAdmin
      .from("orders")
      .insert({
        number: data.number,
        filial: data.filial,
        doors_count: data.doors_count,
        product_type: data.product_type,
        comment: data.comment,
        pogonaj_required: data.pogonaj_required,
        deadline: data.deadline ?? null,
        position_deadlines: data.position_deadlines,
        current_department: first,
        status: "pending_accept",
      })
      .select().single();
    if (error) throw new Error(error.message);

    await supabaseAdmin.from("order_history").insert({
      order_id: order.id, user_id: userId, action: "created", to_department: first,
    });
    await audit(userId, "orders", "created", order.id, null, order);
    return { order };
  });

// ---------- Accept ----------
export const acceptOrderFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ orderId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: order, error } = await supabase
      .from("orders")
      .update({ status: "in_progress", previous_department: null, entered_current_dept_at: new Date().toISOString() })
      .eq("id", data.orderId).eq("status", "pending_accept")
      .select().single();
    if (error) throw new Error(error.message);
    await supabase.from("order_history").insert({
      order_id: data.orderId, user_id: userId, action: "accepted",
      to_department: (order as any).current_department,
    });
    await audit(userId, "orders", "accepted", data.orderId, null, { dept: (order as any).current_department });
    return { order };
  });

// ---------- Deliver ----------
export const deliverOrderFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ orderId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { data: cur, error: e1 } = await supabaseAdmin
      .from("orders").select("current_department")
      .eq("id", data.orderId).single();
    if (e1) throw new Error(e1.message);
    const curDept = (cur as any).current_department as string;
    // permission: admin/general OR user assigned to current dept
    const role = await getRole(null, userId);
    const isAdmin = role === "admin" || role === "general";
    if (!isAdmin) {
      const { data: ud } = await supabaseAdmin.from("user_departments")
        .select("id").eq("user_id", userId).eq("department_key", curDept).maybeSingle();
      if (!ud) throw new Error("Bu bo'limga ruxsat yo'q");
    }
    const next = await nextDeptKey(curDept);
    const isLast = next === null;

    const { data: order, error } = await supabaseAdmin
      .from("orders")
      .update({
        current_department: next ?? curDept,
        previous_department: isLast ? null : curDept,
        status: isLast ? "delivered" : "pending_accept",
        entered_current_dept_at: new Date().toISOString(),
        finished_at: isLast ? new Date().toISOString() : null,
      })
      .eq("id", data.orderId).select().single();
    if (error) throw new Error(error.message);

    await supabaseAdmin.from("order_history").insert({
      order_id: data.orderId, user_id: userId, action: "delivered",
      from_department: curDept, to_department: next ?? curDept,
    });
    await audit(userId, "orders", "delivered", data.orderId, { dept: curDept }, { dept: next ?? curDept });
    return { order };
  });

// ---------- History ----------
export const getOrderHistoryFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ orderId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data }) => {
    const { data: rows, error } = await supabaseAdmin
      .from("order_history")
      .select("id, action, from_department, to_department, note, created_at, user_id")
      .eq("order_id", data.orderId).order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    const ids = Array.from(new Set((rows ?? []).map((r: any) => r.user_id).filter(Boolean)));
    let names: Record<string, string> = {};
    if (ids.length) {
      const { data: profs } = await supabaseAdmin.from("profiles").select("id, full_name").in("id", ids);
      names = Object.fromEntries((profs ?? []).map((p: any) => [p.id, p.full_name]));
    }
    return { items: (rows ?? []).map((r: any) => ({ ...r, actor_name: names[r.user_id] || "" })) };
  });

// ---------- Settings ----------
export const getSettingsFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { data } = await supabaseAdmin.from("app_settings").select("key, value");
    const map: Record<string, any> = {};
    (data ?? []).forEach((r: any) => { map[r.key] = r.value; });
    return {
      penalty_per_day: Number(map.penalty_per_day ?? 100000),
      telegram_hour_utc: Number(map.telegram_hour_utc ?? 4),
    };
  });

export const updateSettingsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      penalty_per_day: z.number().int().min(0).max(1_000_000_000),
      telegram_hour_utc: z.number().int().min(0).max(23),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertGeneral(supabase, userId);
    await supabaseAdmin.from("app_settings").upsert([
      { key: "penalty_per_day", value: data.penalty_per_day as any },
      { key: "telegram_hour_utc", value: data.telegram_hour_utc as any },
    ], { onConflict: "key" });
    const { error } = await supabaseAdmin.rpc("reschedule_telegram_cron", { hour_utc: data.telegram_hour_utc });
    if (error) throw new Error("Cron yangilab bo'lmadi: " + error.message);
    await audit(userId, "settings", "updated", null, null, data);
    return { ok: true };
  });

// ---------- Admin: move ----------
export const moveOrderFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ orderId: z.string().uuid(), to: z.string().min(1).max(64) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { data: cur } = await supabaseAdmin
      .from("orders").select("current_department").eq("id", data.orderId).single();
    const last = await lastDeptKey();

    const { error } = await supabaseAdmin
      .from("orders")
      .update({
        current_department: data.to,
        status: data.to === last ? "delivered" : "pending_accept",
        entered_current_dept_at: new Date().toISOString(),
        finished_at: data.to === last ? new Date().toISOString() : null,
      })
      .eq("id", data.orderId);
    if (error) throw new Error(error.message);

    await supabaseAdmin.from("order_history").insert({
      order_id: data.orderId, user_id: userId, action: "moved",
      from_department: (cur as any)?.current_department, to_department: data.to,
    });
    await audit(userId, "orders", "moved", data.orderId, { dept: (cur as any)?.current_department }, { dept: data.to });
    return { ok: true };
  });

// ---------- Admin: update deadline ----------
export const updateDeadlineFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      orderId: z.string().uuid(),
      deadline: z.string().nullable().optional(),
      position_deadlines: z.record(z.string(), z.string()).optional(),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const patch: Record<string, unknown> = {};
    if (data.deadline !== undefined) patch.deadline = data.deadline;
    if (data.position_deadlines !== undefined) patch.position_deadlines = data.position_deadlines;
    const { error } = await supabaseAdmin.from("orders").update(patch as any).eq("id", data.orderId);
    if (error) throw new Error(error.message);
    await supabaseAdmin.from("order_history").insert({
      order_id: data.orderId, user_id: userId, action: "deadline_changed", note: JSON.stringify(patch),
    });
    await audit(userId, "orders", "deadline_changed", data.orderId, null, patch);
    return { ok: true };
  });

// ---------- Admin: update order ----------
export const updateOrderFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      orderId: z.string().uuid(),
      number: z.string().min(1).max(64).optional(),
      filial: z.string().max(255).optional(),
      doors_count: z.number().int().min(0).max(100000).optional(),
      product_type: z.string().max(255).optional(),
      comment: z.string().max(2000).optional(),
      pogonaj_required: z.boolean().optional(),
      pogonaj_status: z.string().max(255).optional(),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { orderId, ...patch } = data;
    const { error } = await supabaseAdmin.from("orders").update(patch as any).eq("id", orderId);
    if (error) throw new Error(error.message);
    await supabaseAdmin.from("order_history").insert({
      order_id: orderId, user_id: userId, action: "edited", note: JSON.stringify(patch),
    });
    await audit(userId, "orders", "edited", orderId, null, patch);
    return { ok: true };
  });

// ---------- Admin: delete order ----------
export const deleteOrderFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ orderId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { data: prev } = await supabaseAdmin.from("orders").select("*").eq("id", data.orderId).maybeSingle();
    const { error } = await supabaseAdmin.from("orders").delete().eq("id", data.orderId);
    if (error) throw new Error(error.message);
    await audit(userId, "orders", "deleted", data.orderId, prev, null);
    return { ok: true };
  });

// ---------- AI analyze ----------
export const aiAnalyzeFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { data: orders } = await supabaseAdmin.from("orders").select("*");
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("LOVABLE_API_KEY yo'q");
    const summary = (orders ?? []).map((o: any) => ({
      number: o.number, filial: o.filial, dept: o.current_department,
      status: o.status, doors: o.doors_count,
      deadline: o.position_deadlines?.[o.current_department] || o.deadline,
      created_at: o.created_at, finished_at: o.finished_at,
    }));
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: "Sen ishlab chiqarish tahlilchisisan. Faqat o'zbek tilida, qisqa va aniq, markdown bullet ko'rinishda javob ber." },
          { role: "user", content: `Quyidagi zayavkalar ma'lumotini tahlil qil. Bottleneck bo'limlarni, kechikishlar trendini, eng ko'p muammoli filialni aniqla va aniq tavsiyalar ber.\n\n${JSON.stringify(summary).slice(0, 12000)}` },
        ],
      }),
    });
    if (res.status === 429) throw new Error("AI: limit oshib ketdi");
    if (res.status === 402) throw new Error("AI: kreditlar tugagan");
    if (!res.ok) throw new Error(`AI xato: ${res.status}`);
    const json = await res.json();
    return { text: json.choices?.[0]?.message?.content || "Tahlil bo'sh" };
  });

// ============ DEPARTMENTS MANAGEMENT (General only) ============
export const createDepartmentFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      key: z.string().min(1).max(64).regex(/^[a-z0-9_]+$/, "faqat lotin kichik harf, raqam, _"),
      label: z.string().min(1).max(64),
      icon: z.string().min(1).max(8).default("📋"),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertGeneral(supabase, userId);
    const { data: maxRow } = await supabaseAdmin
      .from("departments").select("sort_order")
      .order("sort_order", { ascending: false }).limit(1).maybeSingle();
    const sort = (((maxRow as any)?.sort_order as number) ?? 0) + 1;
    const { error } = await supabaseAdmin.from("departments").insert({
      key: data.key, label: data.label, icon: data.icon, sort_order: sort, active: true,
    });
    if (error) throw new Error(error.message);
    await audit(userId, "departments", "created", data.key, null, data);
    return { ok: true };
  });

export const updateDepartmentFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      key: z.string().min(1).max(64),
      label: z.string().min(1).max(64).optional(),
      icon: z.string().min(1).max(8).optional(),
      sort_order: z.number().int().min(0).max(10000).optional(),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertGeneral(supabase, userId);
    const { key, ...patch } = data;
    const { error } = await supabaseAdmin.from("departments").update(patch).eq("key", key);
    if (error) throw new Error(error.message);
    await audit(userId, "departments", "updated", key, null, patch);
    return { ok: true };
  });

export const deleteDepartmentFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ key: z.string().min(1).max(64) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertGeneral(supabase, userId);
    const { count } = await supabaseAdmin
      .from("orders").select("id", { count: "exact", head: true })
      .eq("current_department", data.key);
    if ((count ?? 0) > 0) {
      throw new Error(`Bu bo'limda ${count} ta zayavka bor. Avval ularni boshqa joyga ko'chiring`);
    }
    const { error } = await supabaseAdmin.from("departments").delete().eq("key", data.key);
    if (error) throw new Error(error.message);
    await audit(userId, "departments", "deleted", data.key, null, null);
    return { ok: true };
  });

// ============ USERS MANAGEMENT (General only) ============
export const listUsersFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await assertGeneral(supabase, userId);
    const { data: profs } = await supabaseAdmin
      .from("profiles").select("id, full_name, system_role");
    const { data: deps } = await supabaseAdmin
      .from("user_departments").select("user_id, department_key");
    const { data: creds } = await supabaseAdmin
      .from("user_credentials").select("user_id, login_dept, password_plain");
    const depMap: Record<string, string[]> = {};
    (deps ?? []).forEach((d: any) => {
      (depMap[d.user_id] ??= []).push(d.department_key);
    });
    const credMap: Record<string, any> = {};
    (creds ?? []).forEach((c: any) => { credMap[c.user_id] = c; });
    return {
      users: (profs ?? []).map((p: any) => ({
        id: p.id,
        full_name: p.full_name,
        system_role: p.system_role,
        depts: depMap[p.id] ?? [],
        login_dept: credMap[p.id]?.login_dept ?? "",
        password: credMap[p.id]?.password_plain ?? "",
      })),
    };
  });

const userRoleSchema = z.enum(["user", "admin"]);

export const createUserFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      full_name: z.string().min(1).max(64),
      password: z.string().min(4).max(64),
      role: userRoleSchema,
      dept_keys: z.array(z.string().min(1).max(64)).min(1, "Kamida 1 ta bo'lim tanlang").max(50),
      login_dept: z.string().min(1).max(64), // qaysi bo'lim orqali login qiladi (dept_keys ichidan)
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertGeneral(supabase, userId);

    const SPECIAL = ["__admin__", "__user__", "__general__"];
    if (!SPECIAL.includes(data.login_dept) && !data.dept_keys.includes(data.login_dept)) {
      throw new Error("Login bo'limi tanlangan bo'limlar ichida yoki Admin/User bo'lishi kerak");
    }

    // Uniqueness (login_dept, password)
    const { data: dup } = await supabaseAdmin
      .from("user_credentials").select("user_id")
      .eq("login_dept", data.login_dept).eq("password_plain", data.password).maybeSingle();
    if (dup) throw new Error("Bu bo'limda shu parol allaqachon ishlatilgan");

    const rnd = Math.random().toString(36).slice(2, 10);
    const email = `u-${rnd}@crm.local`;

    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      email, password: data.password, email_confirm: true,
      user_metadata: { full_name: data.full_name },
    });
    if (error) throw new Error(error.message);
    const newId = created.user!.id;

    await supabaseAdmin.from("profiles").upsert({
      id: newId, full_name: data.full_name, system_role: data.role,
    });
    if (data.dept_keys.length) {
      await supabaseAdmin.from("user_departments").insert(
        data.dept_keys.map((k) => ({ user_id: newId, department_key: k })),
      );
    }
    await supabaseAdmin.from("user_credentials").insert({
      user_id: newId, login_dept: data.login_dept, password_plain: data.password,
    });

    await audit(userId, "users", "created", newId, null, { full_name: data.full_name, role: data.role, depts: data.dept_keys, login_dept: data.login_dept });
    return { ok: true, userId: newId };
  });

export const updateUserFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      userId: z.string().uuid(),
      full_name: z.string().min(1).max(64).optional(),
      password: z.string().min(4).max(64).optional(),
      role: userRoleSchema.optional(),
      dept_keys: z.array(z.string().min(1).max(64)).max(50).optional(),
      login_dept: z.string().min(1).max(64).optional(),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertGeneral(supabase, userId);

    if (data.full_name !== undefined || data.role !== undefined) {
      const patch: any = {};
      if (data.full_name !== undefined) patch.full_name = data.full_name;
      if (data.role !== undefined) patch.system_role = data.role;
      await supabaseAdmin.from("profiles").update(patch).eq("id", data.userId);
    }

    if (data.dept_keys !== undefined) {
      await supabaseAdmin.from("user_departments").delete().eq("user_id", data.userId);
      if (data.dept_keys.length) {
        await supabaseAdmin.from("user_departments").insert(
          data.dept_keys.map((k) => ({ user_id: data.userId, department_key: k })),
        );
      }
    }

    if (data.password !== undefined || data.login_dept !== undefined) {
      const { data: existing } = await supabaseAdmin
        .from("user_credentials").select("login_dept, password_plain")
        .eq("user_id", data.userId).maybeSingle();
      const newDept = data.login_dept ?? (existing as any)?.login_dept ?? "";
      const newPwd = data.password ?? (existing as any)?.password_plain ?? "";

      // uniqueness
      const { data: dup } = await supabaseAdmin
        .from("user_credentials").select("user_id")
        .eq("login_dept", newDept).eq("password_plain", newPwd)
        .neq("user_id", data.userId).maybeSingle();
      if (dup) throw new Error("Bu bo'limda shu parol allaqachon ishlatilgan");

      await supabaseAdmin.from("user_credentials").upsert({
        user_id: data.userId, login_dept: newDept, password_plain: newPwd,
        updated_at: new Date().toISOString(),
      });
      if (data.password !== undefined) {
        const { error } = await supabaseAdmin.auth.admin.updateUserById(data.userId, { password: data.password });
        if (error) throw new Error(error.message);
      }
    }

    await audit(userId, "users", "updated", data.userId, null, { ...data, password: data.password ? "***" : undefined });
    return { ok: true };
  });

export const deleteUserFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ userId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertGeneral(supabase, userId);
    if (data.userId === userId) throw new Error("O'zingizni o'chira olmaysiz");
    const { error } = await supabaseAdmin.auth.admin.deleteUser(data.userId);
    if (error) throw new Error(error.message);
    await audit(userId, "users", "deleted", data.userId, null, null);
    return { ok: true };
  });

// ---------- Reorder departments (general only) ----------
export const reorderDepartmentsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ keys: z.array(z.string().min(1).max(64)).min(1).max(100) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertGeneral(supabase, userId);
    // assign sort_order 10, 20, 30... so future inserts can fit between
    for (let i = 0; i < data.keys.length; i++) {
      const { error } = await supabaseAdmin
        .from("departments").update({ sort_order: (i + 1) * 10 }).eq("key", data.keys[i]);
      if (error) throw new Error(error.message);
    }
    await audit(userId, "departments", "reordered", null, null, { order: data.keys });
    return { ok: true };
  });

// ---------- Audit log list (general only) ----------
export const listAuditFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      limit: z.number().int().min(1).max(500).default(100),
      entity: z.string().max(64).optional(),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertGeneral(supabase, userId);
    let q = supabaseAdmin.from("audit_log").select("*").order("created_at", { ascending: false }).limit(data.limit);
    if (data.entity) q = q.eq("entity", data.entity);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return { items: rows ?? [] };
  });
