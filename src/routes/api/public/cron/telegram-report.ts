import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const DEPTS = [
  "ojidaniya","stolyarka","stolyarka_otk","malyarka","malyarka_otk",
  "kraska","kraska_otk","upakovka","arxiv",
] as const;

const DEPT_LABELS: Record<string, string> = {
  ojidaniya: "Ojidaniya", stolyarka: "Stolyarka", stolyarka_otk: "Stolyarka OTK",
  malyarka: "Malyarka", malyarka_otk: "Malyarka OTK", kraska: "Kraska",
  kraska_otk: "Kraska OTK", upakovka: "Upakovka", arxiv: "Arxiv",
};
const DEPT_ICONS: Record<string, string> = {
  ojidaniya: "⏳", stolyarka: "🪵", stolyarka_otk: "🔍", malyarka: "🎨",
  malyarka_otk: "🔍", kraska: "🖌️", kraska_otk: "🔍", upakovka: "📦", arxiv: "🗄️",
};

async function getPenalty(): Promise<number> {
  const { data } = await supabaseAdmin.from("app_settings").select("value").eq("key", "penalty_per_day").maybeSingle();
  return Number(data?.value ?? 100000);
}

function fmtMoney(n: number) {
  return new Intl.NumberFormat("uz-UZ").format(n) + " so'm";
}
function esc(s: string) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function delayDays(deadline: string | null): number {
  if (!deadline) return 0;
  const d = (Date.now() - new Date(deadline).getTime()) / 86400000;
  return d > 0 ? Math.floor(d) : 0;
}

async function sendTelegram(text: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) throw new Error("Telegram secrets not set");
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chat, text, parse_mode: "HTML", disable_web_page_preview: true }),
  });
  if (!res.ok) throw new Error(`Telegram error: ${res.status} ${await res.text()}`);
  return res.json();
}

export const Route = createFileRoute("/api/public/cron/telegram-report")({
  server: {
    handlers: {
      POST: async () => {
        const { data: orders, error } = await supabaseAdmin
          .from("orders").select("*").neq("status", "delivered");
        if (error) return Response.json({ error: error.message }, { status: 500 });

        const PENALTY = await getPenalty();
        const now = new Date();
        const sana = now.toLocaleDateString("uz-UZ");
        const vaqt = now.toLocaleTimeString("uz-UZ");

        const delayed = (orders || []).map((o: any) => {
          // jarima topshiruvchiga (pending_accept paytida — previous_department srogi)
          const deptForDl = o.status === "pending_accept" && o.previous_department
            ? o.previous_department
            : o.current_department;
          const dl = o.position_deadlines?.[deptForDl] || o.deadline;
          const dd = delayDays(dl);
          return { ...o, _delay: dd, _penalty: dd * PENALTY, _blameDept: deptForDl };
        }).filter((o: any) => o._delay > 0);

        let text = "🚨 <b>DIQQAT: MUDDATI O'TGAN BUYURTMALAR</b> 🚨\n";
        text += "━━━━━━━━━━━━━━━━━━━━━━━━━━\n";
        text += `🗓 <b>Sana:</b> ${sana}\n🕘 <b>Vaqt:</b> ${vaqt}\n`;
        text += `⚠️ <b>Jami kechikayotgan zayavkalar:</b> ${delayed.length} ta\n\n`;

        if (delayed.length === 0) {
          text += "✅ Bugun muddati o'tgan buyurtmalar yo'q. Ish jarayoni nazoratda.\n";
          await sendTelegram(text);
          return Response.json({ ok: true, total: 0 });
        }

        let no = 1;
        for (const dept of DEPTS) {
          const rows = delayed.filter((o: any) => o._blameDept === dept);
          if (!rows.length) continue;
          const dailyPenalty = rows.length * PENALTY;
          const totalPenalty = rows.reduce((s: number, r: any) => s + r._penalty, 0);

          text += `${DEPT_ICONS[dept]} <b>${no}. ${esc(DEPT_LABELS[dept])}</b>\n`;
          text += `Kechikayotgan: <b>${rows.length} ta</b>\n\n`;
          text += `💸 Kunlik jarima: <b>${fmtMoney(dailyPenalty)}</b>\n`;
          text += `🔴 Umumiy jarima: <b>${fmtMoney(totalPenalty)}</b>\n\n`;
          rows.slice(0, 20).forEach((r: any) => {
            text += `🆔 #<b>${esc(r.number)}</b> | 🚪 ${r.doors_count} ta | ⏳ ${r._delay} kun | 💰 ${fmtMoney(r._penalty)}\n`;
          });
          if (rows.length > 20) text += `… yana ${rows.length - 20} ta\n`;
          text += "\n";
          no++;
        }

        text += "📝 <b>MAS'ULLAR DIQQATIGA!</b>\n";
        text += "📢 <b>Vaqt g'animat, jarima miqdori oshib bormoqda!</b>";

        await sendTelegram(text);
        return Response.json({ ok: true, total: delayed.length });
      },
    },
  },
});
