
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS previous_department public.department;

CREATE TABLE IF NOT EXISTS public.app_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS settings_read ON public.app_settings;
CREATE POLICY settings_read ON public.app_settings FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS settings_admin_all ON public.app_settings;
CREATE POLICY settings_admin_all ON public.app_settings FOR ALL TO authenticated
  USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

INSERT INTO public.app_settings (key, value) VALUES
  ('penalty_per_day', '100000'::jsonb),
  ('telegram_hour_utc', '4'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- Allow all authenticated users to read profile names (needed for history display).
DROP POLICY IF EXISTS profiles_read_names ON public.profiles;
CREATE POLICY profiles_read_names ON public.profiles FOR SELECT TO authenticated USING (true);

-- Reschedule telegram cron from app
CREATE OR REPLACE FUNCTION public.reschedule_telegram_cron(hour_utc int)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, cron, net AS $$
DECLARE
  v_url text := 'https://novzazayavka.lovable.app/api/public/cron/telegram-report';
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin only';
  END IF;
  PERFORM cron.unschedule('daily-telegram-delay-report');
  PERFORM cron.schedule(
    'daily-telegram-delay-report',
    format('0 %s * * *', hour_utc),
    format($cmd$SELECT net.http_post(url := %L, headers := '{"Content-Type":"application/json"}'::jsonb);$cmd$, v_url)
  );
END;
$$;
