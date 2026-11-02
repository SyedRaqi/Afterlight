DROP POLICY IF EXISTS "Authors or editors remove comments"
ON public.comments;

CREATE POLICY "Editors remove comments"
ON public.comments
FOR DELETE
TO authenticated
USING (public.is_editor());

REVOKE DELETE ON public.comments FROM anon;
