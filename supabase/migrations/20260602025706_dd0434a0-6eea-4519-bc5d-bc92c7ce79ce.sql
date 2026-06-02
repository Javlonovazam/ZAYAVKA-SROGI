
-- 1. departments catalog
CREATE TABLE public.departments (
  key text PRIMARY KEY,
  label text NOT NULL,
  icon text NOT NULL DEFAULT '📋',
  sort_order int NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.departments TO authenticated;
GRANT ALL ON public.departments TO service_role;
ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;

INSERT INTO public.departments (key, label, icon, sort_order) VALUES
  ('ojidaniya', 'Ojidaniya', '⏳', 1),
  ('stolyarka', 'Stolyarka', '🪵', 2),
  ('stolyarka_otk', 'Stolyarka OTK', '🔍', 3),
  ('malyarka', 'Malyarka', '🎨', 4),
  ('malyarka_otk', 'Malyarka OTK', '🔍', 5),
  ('kraska', 'Kraska', '🖌️', 6),
  ('kraska_otk', 'Kraska OTK', '🔍', 7),
  ('upakovka', 'Upakovka', '📦', 8),
  ('arxiv', 'Arxiv', '🗄️', 9);

-- 2. user_departments mapping
CREATE TABLE public.user_departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  department_key text NOT NULL REFERENCES public.departments(key) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, department_key)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_departments TO authenticated;
GRANT ALL ON public.user_departments TO service_role;
ALTER TABLE public.user_departments ENABLE ROW LEVEL SECURITY;

-- 3. profiles new columns
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS system_role text NOT NULL DEFAULT 'user'
    CHECK (system_role IN ('general','admin','user')),
  ADD COLUMN IF NOT EXISTS login_dept text,
  ADD COLUMN IF NOT EXISTS login_password_plain text;

CREATE INDEX IF NOT EXISTS idx_profiles_login ON public.profiles(login_dept, login_password_plain);

-- 4. Drop old policies that depend on enum-typed functions
DROP POLICY IF EXISTS orders_update ON public.orders;
DROP POLICY IF EXISTS orders_admin_delete ON public.orders;
DROP POLICY IF EXISTS orders_admin_insert ON public.orders;
DROP POLICY IF EXISTS settings_admin_all ON public.app_settings;

-- 5. Drop old helper functions that reference enums
DROP FUNCTION IF EXISTS public.user_in_dept(uuid, public.department);
DROP FUNCTION IF EXISTS public.role_to_dept(public.app_role);
DROP FUNCTION IF EXISTS public.has_role(uuid, public.app_role);

-- 6. Convert enum columns to text
ALTER TABLE public.orders ALTER COLUMN current_department DROP DEFAULT;
ALTER TABLE public.orders
  ALTER COLUMN current_department TYPE text USING current_department::text,
  ALTER COLUMN previous_department TYPE text USING previous_department::text;
ALTER TABLE public.orders ALTER COLUMN current_department SET DEFAULT 'ojidaniya';

ALTER TABLE public.order_history
  ALTER COLUMN from_department TYPE text USING from_department::text,
  ALTER COLUMN to_department TYPE text USING to_department::text;

ALTER TABLE public.user_roles ALTER COLUMN role TYPE text USING role::text;

-- 7. Drop enums
DROP TYPE IF EXISTS public.department;
DROP TYPE IF EXISTS public.app_role;

-- 8. Replace is_admin to use profiles.system_role (admin OR general)
CREATE OR REPLACE FUNCTION public.is_admin(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT EXISTS(SELECT 1 FROM public.profiles WHERE id = _user_id AND system_role IN ('admin','general')) $$;

CREATE OR REPLACE FUNCTION public.is_general(_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT EXISTS(SELECT 1 FROM public.profiles WHERE id = _uid AND system_role = 'general') $$;

CREATE OR REPLACE FUNCTION public.user_has_dept(_uid uuid, _dept text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT EXISTS(SELECT 1 FROM public.user_departments WHERE user_id = _uid AND department_key = _dept) $$;

-- 9. New RLS policies

-- departments
CREATE POLICY departments_select ON public.departments FOR SELECT TO authenticated USING (true);
CREATE POLICY departments_general_all ON public.departments FOR ALL TO authenticated
  USING (public.is_general(auth.uid())) WITH CHECK (public.is_general(auth.uid()));

-- user_departments
CREATE POLICY user_dept_select ON public.user_departments FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_admin(auth.uid()));
CREATE POLICY user_dept_general_all ON public.user_departments FOR ALL TO authenticated
  USING (public.is_general(auth.uid())) WITH CHECK (public.is_general(auth.uid()));

-- orders
CREATE POLICY orders_update ON public.orders FOR UPDATE TO authenticated
  USING (public.is_admin(auth.uid()) OR public.user_has_dept(auth.uid(), current_department))
  WITH CHECK (public.is_admin(auth.uid()) OR public.user_has_dept(auth.uid(), current_department));
CREATE POLICY orders_admin_insert ON public.orders FOR INSERT TO authenticated
  WITH CHECK (public.is_admin(auth.uid()));
CREATE POLICY orders_admin_delete ON public.orders FOR DELETE TO authenticated
  USING (public.is_admin(auth.uid()));

-- app_settings: only general can write
CREATE POLICY settings_general_all ON public.app_settings FOR ALL TO authenticated
  USING (public.is_general(auth.uid())) WITH CHECK (public.is_general(auth.uid()));

-- 10. Seed: existing admin → general, password General2323
UPDATE public.profiles
  SET system_role = 'general',
      login_dept = '__general__',
      login_password_plain = 'General2323'
  WHERE id IN (SELECT id FROM auth.users WHERE email = 'admin@crm.local');

-- Update auth password
UPDATE auth.users
  SET encrypted_password = crypt('General2323', gen_salt('bf'))
  WHERE email = 'admin@crm.local';
