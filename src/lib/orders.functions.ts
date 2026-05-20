import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const DEPTS = [
  "ojidaniya",
  "stolyarka",
  "stolyarka_otk",
  "malyarka",
  "malyarka_otk",
  "kraska",
  "kraska_otk",
  "upakovka",
  "arxiv",
] as const;

const departmentSchema = z.enum(DEPTS);

async function assertAdmin(supabase: any, userId: string) {
  const { data, error } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Faqat admin bajara oladi");
}

function nextDept(d: string): string | null {
  const i = DEPTS.indexOf(d as any);
  if (i < 0 || i >= DEPTS.length - 1) return null;
  return DEPTS[i + 1];
}

// ---------- Create order (admin) ----------
export const createOrderFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        number: z.string().min(1),
        filial: z.string().default(""),
        doors_count: z.number().int().min(0).default(0),
        product_type: z.string().default(""),
        comment: z.string().default(""),
        pogonaj_required: z.boolean().default(false),
        deadline: z.string().nullable().optional(),
        position_deadlines: z.record(z.string(), z.string()).default({}),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);

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
        current_department: "ojidaniya",
        status: "pending_accept",
      })
      .select()
      .single();
    if (error) throw new Error(error.message);

    await supabaseAdmin.from("order_history").insert({
      order_id: order.id,
      user_id: userId,
      action: "created",
      to_department: "ojidaniya",
    });

    return { order };
  });

// ---------- Accept (joriy bo'lim qabul qiladi) ----------
export const acceptOrderFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ orderId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: order, error } = await supabase
      .from("orders")
      .update({ status: "in_progress" })
      .eq("id", data.orderId)
      .eq("status", "pending_accept")
      .select()
      .single();
    if (error) throw new Error(error.message);

    await supabase.from("order_history").insert({
      order_id: data.orderId,
      user_id: userId,
      action: "accepted",
      to_department: order.current_department,
    });
    return { order };
  });

// ---------- Deliver (keyingi bo'limga) ----------
export const deliverOrderFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ orderId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: cur, error: e1 } = await supabase
      .from("orders")
      .select("current_department")
      .eq("id", data.orderId)
      .single();
    if (e1) throw new Error(e1.message);

    const next = nextDept(cur.current_department) as any;
    const isLast = next === null;

    const { data: order, error } = await supabase
      .from("orders")
      .update({
        current_department: (next ?? cur.current_department) as any,
        status: isLast ? "delivered" : "pending_accept",
        entered_current_dept_at: new Date().toISOString(),
        finished_at: isLast ? new Date().toISOString() : null,
      })
      .eq("id", data.orderId)
      .select()
      .single();
    if (error) throw new Error(error.message);

    await supabase.from("order_history").insert({
      order_id: data.orderId,
      user_id: userId,
      action: "delivered",
      from_department: cur.current_department,
      to_department: (next ?? cur.current_department) as any,
    });
    return { order };
  });

// ---------- Admin: move to any dept ----------
export const moveOrderFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({ orderId: z.string().uuid(), to: departmentSchema })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { data: cur } = await supabaseAdmin
      .from("orders")
      .select("current_department")
      .eq("id", data.orderId)
      .single();

    const { error } = await supabaseAdmin
      .from("orders")
      .update({
        current_department: data.to,
        status: data.to === "arxiv" ? "delivered" : "pending_accept",
        entered_current_dept_at: new Date().toISOString(),
        finished_at: data.to === "arxiv" ? new Date().toISOString() : null,
      })
      .eq("id", data.orderId);
    if (error) throw new Error(error.message);

    await supabaseAdmin.from("order_history").insert({
      order_id: data.orderId,
      user_id: userId,
      action: "moved",
      from_department: cur?.current_department,
      to_department: data.to,
    });
    return { ok: true };
  });

// ---------- Admin: update deadline (global yoki position) ----------
export const updateDeadlineFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        orderId: z.string().uuid(),
        deadline: z.string().nullable().optional(),
        position_deadlines: z.record(z.string(), z.string()).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);

    const patch: Record<string, unknown> = {};
    if (data.deadline !== undefined) patch.deadline = data.deadline;
    if (data.position_deadlines !== undefined)
      patch.position_deadlines = data.position_deadlines;

    const { error } = await supabaseAdmin
      .from("orders")
      .update(patch as any)
      .eq("id", data.orderId);
    if (error) throw new Error(error.message);

    await supabaseAdmin.from("order_history").insert({
      order_id: data.orderId,
      user_id: userId,
      action: "deadline_changed",
      note: JSON.stringify(patch),
    });
    return { ok: true };
  });

// ---------- Admin: update order fields ----------
export const updateOrderFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        orderId: z.string().uuid(),
        number: z.string().min(1).optional(),
        filial: z.string().optional(),
        doors_count: z.number().int().min(0).optional(),
        product_type: z.string().optional(),
        comment: z.string().optional(),
        pogonaj_required: z.boolean().optional(),
        pogonaj_status: z.string().optional(),
      })
      .parse(input),
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
    const { error } = await supabaseAdmin
      .from("orders")
      .delete()
      .eq("id", data.orderId);
    if (error) throw new Error(error.message);
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
      number: o.number,
      filial: o.filial,
      dept: o.current_department,
      status: o.status,
      doors: o.doors_count,
      deadline: o.position_deadlines?.[o.current_department] || o.deadline,
      created_at: o.created_at,
      finished_at: o.finished_at,
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
    if (res.status === 429) throw new Error("AI: limit oshib ketdi, biroz kuting");
    if (res.status === 402) throw new Error("AI: kreditlar tugagan");
    if (!res.ok) throw new Error(`AI xato: ${res.status}`);
    const json = await res.json();
    const text = json.choices?.[0]?.message?.content || "Tahlil bo'sh";
    return { text };
  });

// ---------- Admin: create user with role ----------
export const adminCreateUserFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        email: z.string().email(),
        password: z.string().min(6),
        full_name: z.string().default(""),
        role: z.enum(["admin", ...DEPTS] as [string, ...string[]]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);

    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
      user_metadata: { full_name: data.full_name },
    });
    if (error) throw new Error(error.message);
    const newUserId = created.user!.id;

    // Profile auto-created by trigger; ensure role
    const { error: rErr } = await supabaseAdmin
      .from("user_roles")
      .insert({ user_id: newUserId, role: data.role as any });
    if (rErr) throw new Error(rErr.message);

    return { userId: newUserId };
  });
