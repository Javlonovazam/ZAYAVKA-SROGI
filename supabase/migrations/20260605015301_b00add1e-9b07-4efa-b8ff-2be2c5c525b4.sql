
-- 1) Privilege escalation fix: users can't change their own system_role
DROP POLICY IF EXISTS profiles_self_update ON public.profiles;
CREATE POLICY profiles_self_update ON public.profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (
    id = auth.uid()
    AND system_role IS NOT DISTINCT FROM (SELECT p.system_role FROM public.profiles p WHERE p.id = auth.uid())
  );

-- 2) Hide system_role from broad reads (column-level grant)
DROP POLICY IF EXISTS profiles_read_names ON public.profiles;
-- Reinstate a names-only public read policy; system_role hidden by column grants
CREATE POLICY profiles_read_names ON public.profiles
  FOR SELECT TO authenticated
  USING (true);

REVOKE SELECT ON public.profiles FROM authenticated;
GRANT SELECT (id, full_name, created_at) ON public.profiles TO authenticated;
GRANT UPDATE (full_name) ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;

-- Allow each user to read their own system_role via a security-definer function
CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$ SELECT system_role FROM public.profiles WHERE id = auth.uid() $$;

REVOKE ALL ON FUNCTION public.get_my_role() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_role() TO authenticated;

-- 3) Lock down user_credentials — plaintext passwords must not be readable by clients
DROP POLICY IF EXISTS creds_general_all ON public.user_credentials;
REVOKE ALL ON public.user_credentials FROM authenticated, anon;
GRANT ALL ON public.user_credentials TO service_role;

-- 4) Fix mutable search_path on touch_updated_at trigger function
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$;
