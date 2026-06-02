
# Reja: Dinamik bo'limlar va yangi foydalanuvchi tizimi

## 1) Ma'lumotlar bazasi (eng katta o'zgarish)

Hozir `department` va `app_role` PostgreSQL enum'lari. Yangi bo'lim qo'shish/o'chirish uchun butun sxemani jadvalga o'tkazamiz.

**Yangi jadvallar:**
- `departments(key text PK, label text, icon text, sort_order int, active bool)` — bo'limlar katalogi. Boshlang'ich 9 ta qator (ojidaniya…arxiv) seed qilinadi.
- `user_departments(user_id uuid, department_key text)` — bir foydalanuvchi → ko'p bo'lim.
- `profiles.system_role text` — `'general' | 'admin' | 'user'` (yangi ustun). `user_roles` jadvali eskirib qoladi (saqlanadi, lekin ishlatilmaydi).

**O'zgartirilgan ustunlar:**
- `orders.current_department`, `orders.previous_department` → `text` (enum o'rniga, departments.key ga ishora).
- `order_history.from_department`, `to_department` → `text`.

**Yangi yordamchi funksiyalar (SECURITY DEFINER):**
- `is_general(uid)` — `profiles.system_role = 'general'`.
- `is_admin_or_general(uid)` — admin yoki general.
- `user_has_dept(uid, dept_key)` — `user_departments` orqali tekshiradi.

**RLS qayta yoziladi:**
- `orders` UPDATE: `is_admin_or_general(uid) OR user_has_dept(uid, current_department)`.
- `departments`, `user_departments`: faqat general CRUD; barcha autentifikatsiyalangan foydalanuvchilar SELECT.
- `Settings` jadvali: faqat general yoza oladi.

**Eski enum'lar va `user_in_dept`/`role_to_dept`/`has_role` funksiyalari o'chiriladi** (RLS'da ishlatilmagandan keyin).

## 2) Login oqimi (Pozitsa + Parol)

Foydalanuvchilar uchun login = bo'lim tanlash + parol.

Texnik qiyinchilik: Supabase Auth email/parol talab qiladi va parol orqali `email` ni topa olmaymiz. Yechim:

- Yangi foydalanuvchi yaratilganda **avtomatik** noyob email beriladi: `u-${shortId}@crm.local`. Foydalanuvchi buni bilmaydi.
- `profiles` ga `login_dept text` va `login_password_plain text` qo'shamiz (faqat general o'qiy oladi — RLS bilan himoyalanadi). 
- Login formada bo'lim tanlanadi + parol kiritiladi. Server funksiyasi `loginByDeptPassword({dept, password})` `supabaseAdmin` orqali shu bo'lim + parolga mos foydalanuvchi emailini topadi, keyin browser uni `signInWithPassword` qiladi.
- **Cheklov**: (bo'lim, parol) jufti noyob bo'lishi shart. Sozlamalarda foydalanuvchi qo'shilayotganda real-vaqtli tekshiruv: agar shu bo'limda shu parol allaqachon bor bo'lsa, ogohlantirish.

General uchun: alohida `general` bo'limi yaratiladi (login ro'yxatida ko'rinadi, lekin board kolonkasi sifatida ko'rinmaydi). General login: bo'lim = "👑 General", parol = `General2323`. Bu hisob migratsiya paytida seed qilinadi.

## 3) Sozlamalar UI (faqat General)

Hozirgi `SettingsDialog` 4 tabga kengaytiriladi:

1. **Umumiy** — jarima, telegram vaqti (avvalgidek).
2. **Bo'limlar** ⭐ yangi — bo'limlar ro'yxati (drag-tartib), qo'shish/o'chirish/nomini va emojisini tahrirlash. O'chirishdan oldin: agar shu bo'limda zayavkalar bor bo'lsa, ogohlantirish.
3. **Foydalanuvchilar** — qayta yozildi:
   - "Yangi foydalanuvchi" formasi: 👤 Ism, 🔒 Parol, ☑️ Rol (User / Admin), ☑️ Bo'limlar checkbox ro'yxati (multi-select, dinamik).
   - Mavjud foydalanuvchilar ro'yxati: parolni tahrirlash, bo'limlarni o'zgartirish, rolni o'zgartirish, o'chirish.
4. **Filiallar / Mahsulotlar** — avvalgidek.

## 4) Rollar va ruxsatlar

- **General**: hamma narsa, shu jumladan Sozlamalar. Yagona hisob.
- **Admin**: hamma bo'limlarni ko'radi, hamma zayavkalarni tahrirlay/yarata oladi, statistika ko'radi. **Sozlamalarga ruxsat YO'Q**.
- **User**: faqat o'ziga biriktirilgan bo'lim(lar) kolonkalarini ko'radi, faqat o'sha bo'limlarda "Qabul qildim" / "Topshirdim" qila oladi. Boshqa hech narsa.

UI ko'rinishi (`src/routes/index.tsx`):
- "Yangi zayavka", Sozlamalar tugmasi: General va Admin'ga (Sozlamalar faqat General).
- Statistika: General + Admin.
- User: faqat tegishli kolonkalar, "Qabul qildim/Topshirdim" tugmalari, sroklar va tahrir tugmalari yashirin.

## 5) Frontend tozalash

- `src/lib/departments.ts` qattiq ro'yxat o'rniga **runtime fetch** qiladi (`useDepartments()` hook + cache).
- `useAuth` `profiles.system_role` va `user_departments` ni qaytaradi.
- `src/routes/login.tsx`: username inputi olib tashlanadi, o'rniga bo'lim `Select`.
- Tezlik: departments/users `react-query` bilan cache, Kanban karta `memo`.

## 6) Texnik tafsilotlar

```text
Migratsiya tartibi:
1. departments jadvali yaratish + 9 ta seed
2. user_departments yaratish
3. profiles ga system_role, login_dept, login_password_plain qo'shish
4. orders/order_history ustunlarini text ga konversiya (enum→text cast)
5. enum'larni va eski funksiyalarni drop qilish
6. Yangi RLS funksiyalari va policy'lar
7. Mavjud admin -> general qilib belgilash, General2323 paroli bilan
```

```text
Server fn'lar:
- loginByDeptPassword(dept, password) -> { email } (admin client)
- createUser(name, password, role, dept_keys[])
- updateUser(id, {password?, role?, dept_keys?})
- deleteUser(id)
- createDepartment(key, label, icon)
- deleteDepartment(key)
```

## Tasdiqlash

Bu migratsiya orders/order_history'ni text ustunlarga ko'chiradi va enum'larni o'chiradi. Mavjud zayavkalar saqlanadi, lekin operatsiya qaytarib bo'lmaydi. Davom etamizmi?
