
-- Move login credentials to a separate table (general-only read)
CREATE TABLE public.user_credentials (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  login_dept text NOT NULL,
  password_plain text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (login_dept, password_plain)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_credentials TO authenticated;
GRANT ALL ON public.user_credentials TO service_role;
ALTER TABLE public.user_credentials ENABLE ROW LEVEL SECURITY;

-- Only general can see / manage credentials
CREATE POLICY creds_general_all ON public.user_credentials FOR ALL TO authenticated
  USING (public.is_general(auth.uid())) WITH CHECK (public.is_general(auth.uid()));

-- Seed existing rows
INSERT INTO public.user_credentials (user_id, login_dept, password_plain)
SELECT id, COALESCE(login_dept, '__general__'), COALESCE(login_password_plain, '')
  FROM public.profiles
  WHERE login_password_plain IS NOT NULL AND login_password_plain <> ''
ON CONFLICT (user_id) DO UPDATE SET
  login_dept = EXCLUDED.login_dept,
  password_plain = EXCLUDED.password_plain;

-- Drop sensitive columns from profiles
ALTER TABLE public.profiles
  DROP COLUMN IF EXISTS login_dept,
  DROP COLUMN IF EXISTS login_password_plain;
