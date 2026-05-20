# Ishlab chiqarish CRM — Reja

Trello/Kanban uslubidagi zayavkalar boshqaruv tizimi, 9 bo'lim bo'yicha pipeline, role-based auth, jarima hisoblash va Telegram integratsiyasi.

## Texnologiya
- **Frontend**: TanStack Start (React 19) + Tailwind v4 + shadcn
- **Backend**: TanStack server functions
- **DB + Auth**: Lovable Cloud (Supabase)
- **Cron**: pg_cron → har kuni 09:00 Telegram hisobot
- **Telegram**: Bot API, secrets'da saqlanadi

## Bo'limlar (pipeline tartibida)
Ojidaniya → Stolyarka → Stolyarka OTK → Malyarka → Malyarka OTK → Kraska → Kraska OTK → Upakovka → Arxiv

## Database
- `profiles` — foydalanuvchi (id, full_name)
- `user_roles` — `app_role` enum: `admin`, `ojidaniya`, `stolyarka`, `stolyarka_otk`, `malyarka`, `malyarka_otk`, `kraska`, `kraska_otk`, `upakovka`, `arxiv`
- `orders` — zayavkalar:
  - number, filial, doors_count, product_type, comment
  - current_department (enum), status (`pending_accept` qizil / `in_progress` sariq / `delivered` yashil)
  - deadline (timestamp), pogonaj_required (bool), pogonaj_status
  - position_deadlines (jsonb) — har bo'lim uchun alohida srok (faqat admin o'zgartiradi)
  - created_at, updated_at, finished_at
- `order_history` — audit log (har QABUL/TOPSHIRDIM)
- `penalties` — kechikish/jarima yozuvi

## RLS qoidalari
- Admin: hammasiga to'liq access
- Bo'lim: faqat `current_department = own_role` bo'lgan kartani **update** qila oladi (QABUL QILDIM / TOPSHIRDIM)
- Boshqa kartalar — faqat read
- Deadline'larni faqat admin yangilaydi (RLS + server function check)

## Server functions
- `createOrder` (admin) — Ojidaniya'ga tushadi
- `acceptOrder` — joriy bo'lim qabul qiladi (status → in_progress, qizildan sariqqa)
- `deliverOrder` — keyingi bo'limga topshiradi (status → pending_accept qizil)
- `updateDeadline` (admin) — istalgan position srokini o'zgartiradi
- `moveOrder` (admin) — istalgan bo'limga ko'chiradi
- `getDelayReport` — kechikish hisoboti + jarima (100 000 so'm/kun)
- `sendDailyTelegramReport` — chat ID'ga formatlangan xabar (sizning shablon bo'yicha)

## Kanban UI
- 9 ustun, drag-and-drop yo'q (button orqali harakat)
- Karta ranglari: qizil/sariq/yashil
- Filter: bo'lim, status, filial, qidiruv
- Mobile responsive (gorizontal scroll)

## Admin paneli
- Yangi zayavka qo'shish
- Har bo'lim uchun srok qo'yish (Ojidaniya'da ham pozitsiya bo'yicha)
- Kechikishlar dashboardi (jami jarima, bo'lim bo'yicha breakdown)
- AI analiz: Lovable AI Gateway orqali — top muammoli bo'limlar, prognoz, tavsiyalar
- Statistika: tugatilgan/jarayonda/kechikkan, vaqt bo'yicha grafik

## Telegram integratsiyasi
- Secrets: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` (Lovable Cloud secrets'ga, kodga emas)
- Har kuni 09:00 da pg_cron `/api/public/cron/telegram-report` ni chaqiradi
- Xabar shabloni: siz yuborgan format (bo'lim bo'yicha, jarima, batafsil ro'yxat)
- Karta yaratish/topshirish — ixtiyoriy notification

## Auth
- Email/parol (admin yaratadi foydalanuvchilarni)
- Sign-up ochiq emas — faqat admin user yaratadi
- Birinchi admin: SQL'da qo'lda tayinlanadi (yo'riqnomada ko'rsataman)

## Iteratsiyalar
1. **V1 (hozir)**: Auth, Kanban, role permission, CRUD, jarima, deadline
2. **V2**: Telegram integratsiya + cron
3. **V3**: AI analiz, statistika dashboard, advanced filter

## Xavfsizlik eslatmasi
Siz chatda yuborgan Telegram bot token ochiq qoldi — yangi token oling (BotFather → /revoke), keyin Lovable Cloud secrets formasi orqali kiritasiz.
