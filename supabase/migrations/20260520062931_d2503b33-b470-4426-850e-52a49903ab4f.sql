
-- Enums
CREATE TYPE public.app_role AS ENUM (
  'admin', 'ojidaniya', 'stolyarka', 'stolyarka_otk',
  'malyarka', 'malyarka_otk', 'kraska', 'kraska_otk',
  'upakovka', 'arxiv'
);

CREATE TYPE public.department AS ENUM (
  'ojidaniya', 'stolyarka', 'stolyarka_otk',
  'malyarka', 'malyarka_otk', 'kraska', 'kraska_otk',
  'upakovka', 'arxiv'
);

CREATE TYPE public.order_status AS ENUM (
  'pending_accept', -- qizil: keyingi bo'lim qabul qilmagan
  'in_progress',    -- sariq: jarayonda
  'delivered'       -- yashil: arxivga yetdi
);

-- Profiles
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- User roles
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role app_role NOT NULL,
  UNIQUE(user_id, role)
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Security definer helpers
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE OR REPLACE FUNCTION public.is_admin(_user_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = 'admin')
$$;

-- Map app_role → department
CREATE OR REPLACE FUNCTION public.role_to_dept(_role app_role)
RETURNS department LANGUAGE SQL IMMUTABLE AS $$
  SELECT CASE _role
    WHEN 'ojidaniya' THEN 'ojidaniya'::department
    WHEN 'stolyarka' THEN 'stolyarka'::department
    WHEN 'stolyarka_otk' THEN 'stolyarka_otk'::department
    WHEN 'malyarka' THEN 'malyarka'::department
    WHEN 'malyarka_otk' THEN 'malyarka_otk'::department
    WHEN 'kraska' THEN 'kraska'::department
    WHEN 'kraska_otk' THEN 'kraska_otk'::department
    WHEN 'upakovka' THEN 'upakovka'::department
    WHEN 'arxiv' THEN 'arxiv'::department
    ELSE NULL
  END
$$;

CREATE OR REPLACE FUNCTION public.user_in_dept(_user_id UUID, _dept department)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND public.role_to_dept(role) = _dept
  )
$$;

-- Orders
CREATE TABLE public.orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  number TEXT NOT NULL UNIQUE,
  filial TEXT NOT NULL DEFAULT '',
  doors_count INTEGER NOT NULL DEFAULT 0,
  product_type TEXT NOT NULL DEFAULT '',
  current_department department NOT NULL DEFAULT 'ojidaniya',
  status order_status NOT NULL DEFAULT 'pending_accept',
  deadline TIMESTAMPTZ,
  position_deadlines JSONB NOT NULL DEFAULT '{}'::jsonb, -- {ojidaniya: "...", stolyarka: "..."}
  pogonaj_required BOOLEAN NOT NULL DEFAULT false,
  pogonaj_status TEXT NOT NULL DEFAULT '',
  comment TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  entered_current_dept_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_orders_dept ON public.orders(current_department);
CREATE INDEX idx_orders_status ON public.orders(status);

-- Order history (audit log)
CREATE TABLE public.order_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id),
  action TEXT NOT NULL, -- 'created', 'accepted', 'delivered', 'moved', 'deadline_changed'
  from_department department,
  to_department department,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.order_history ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_order_history_order ON public.order_history(order_id);

-- RLS: profiles
CREATE POLICY "profiles_self_select" ON public.profiles FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.is_admin(auth.uid()));
CREATE POLICY "profiles_admin_all" ON public.profiles FOR ALL TO authenticated
  USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
CREATE POLICY "profiles_self_update" ON public.profiles FOR UPDATE TO authenticated
  USING (id = auth.uid()) WITH CHECK (id = auth.uid());

-- RLS: user_roles
CREATE POLICY "user_roles_self_select" ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_admin(auth.uid()));
CREATE POLICY "user_roles_admin_all" ON public.user_roles FOR ALL TO authenticated
  USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

-- RLS: orders — hamma authenticated user ko'radi
CREATE POLICY "orders_all_select" ON public.orders FOR SELECT TO authenticated USING (true);
CREATE POLICY "orders_admin_insert" ON public.orders FOR INSERT TO authenticated
  WITH CHECK (public.is_admin(auth.uid()));
CREATE POLICY "orders_admin_delete" ON public.orders FOR DELETE TO authenticated
  USING (public.is_admin(auth.uid()));
-- Update: admin yoki o'z bo'limidagi user
CREATE POLICY "orders_update" ON public.orders FOR UPDATE TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR public.user_in_dept(auth.uid(), current_department)
  )
  WITH CHECK (
    public.is_admin(auth.uid())
    OR public.user_in_dept(auth.uid(), current_department)
  );

-- RLS: order_history
CREATE POLICY "history_select" ON public.order_history FOR SELECT TO authenticated USING (true);
CREATE POLICY "history_insert" ON public.order_history FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id OR public.is_admin(auth.uid()));

-- Trigger: update updated_at
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$;
CREATE TRIGGER orders_touch BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Trigger: auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email));
  RETURN NEW;
END $$;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
