GRANT SELECT, INSERT, UPDATE, DELETE ON public.orders TO authenticated;
GRANT ALL ON public.orders TO service_role;

DROP POLICY IF EXISTS orders_update ON public.orders;

CREATE POLICY orders_update
ON public.orders
FOR UPDATE
TO authenticated
USING (
  public.is_admin(auth.uid())
  OR public.user_has_dept(auth.uid(), current_department)
)
WITH CHECK (
  public.is_admin(auth.uid())
  OR public.user_has_dept(auth.uid(), current_department)
  OR public.user_has_dept(auth.uid(), previous_department)
);