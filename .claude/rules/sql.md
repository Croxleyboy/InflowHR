---
globs: supabase/**
---

# SQL and Migration Rules

## Migration file naming

Sequential number + snake_case description: `NNN_description.sql`
Find the highest existing number in `supabase/migrations/` and increment by 1.

## New table template

```sql
-- ── TABLE_NAME ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS table_name (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  -- columns here
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE table_name ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Company users can read own table_name"
  ON table_name FOR SELECT
  USING (company_id = get_my_company_id() OR is_super_admin());

CREATE POLICY "Admins can insert table_name"
  ON table_name FOR INSERT
  WITH CHECK (company_id = get_my_company_id()
    AND EXISTS (SELECT 1 FROM company_users WHERE user_id = auth.uid() AND company_id = table_name.company_id AND role IN ('admin','hr')));

CREATE POLICY "Admins can update table_name"
  ON table_name FOR UPDATE
  USING (company_id = get_my_company_id()
    AND EXISTS (SELECT 1 FROM company_users WHERE user_id = auth.uid() AND company_id = table_name.company_id AND role IN ('admin','hr')));

CREATE POLICY "Admins can delete table_name"
  ON table_name FOR DELETE
  USING (company_id = get_my_company_id()
    AND EXISTS (SELECT 1 FROM company_users WHERE user_id = auth.uid() AND company_id = table_name.company_id AND role = 'admin'));
```

## SECURITY DEFINER function template

```sql
CREATE OR REPLACE FUNCTION function_name(p_param type)
RETURNS return_type
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id uuid;
BEGIN
  -- 1. Get caller's company
  SELECT company_id INTO v_company_id FROM company_users WHERE user_id = auth.uid();
  IF v_company_id IS NULL THEN RAISE EXCEPTION 'Not a company member'; END IF;

  -- 2. Check role if needed
  -- 3. Business logic

  -- 4. GDPR audit log if touching PII
  PERFORM log_gdpr_action(v_company_id, 'table', record_id::text, 'ACTION', old_data, new_data, NULL, NULL);

  RETURN result;
END;
$$;

-- ALWAYS end with these two lines
REVOKE EXECUTE ON FUNCTION function_name(type) FROM anon;
GRANT EXECUTE ON FUNCTION function_name(type) TO authenticated;
```

## GDPR audit logging

Call `log_gdpr_action()` for any operation that reads, modifies, exports, or deletes PII:

```sql
PERFORM log_gdpr_action(
  p_company_id,        -- uuid: tenant
  p_table_name,        -- text: which table
  p_record_id,         -- text: which row
  p_action,            -- text: 'READ'|'UPDATE'|'DELETE'|'EXPORT'|'ANONYMISE'|'GRANT_ACCESS'|'REVOKE_ACCESS'
  p_old_data,          -- jsonb: previous values (NULL for reads)
  p_new_data,          -- jsonb: new values (NULL for deletes)
  p_support_access_id, -- uuid: if acting under support grant (NULL otherwise)
  p_metadata           -- jsonb: extra context
);
```

## Edge function auth pattern

```typescript
const authHeader = req.headers.get('Authorization')
if (!authHeader) return new Response('Unauthorized', { status: 401 })

const token = authHeader.replace('Bearer ', '')
const { data: { user }, error } = await supabase.auth.getUser(token)
if (error || !user) return new Response('Unauthorized', { status: 401 })

// Verify company membership and role
const { data: companyUser } = await supabase
  .from('company_users')
  .select('company_id, role')
  .eq('user_id', user.id)
  .single()
```

## Checklist before committing SQL

- [ ] RLS enabled on new tables
- [ ] All 4 policy types (SELECT/INSERT/UPDATE/DELETE) present
- [ ] `company_id` scoping on all policies
- [ ] `OR is_super_admin()` on SELECT policies
- [ ] SECURITY DEFINER functions have REVOKE FROM anon + GRANT TO authenticated
- [ ] PII operations call `log_gdpr_action()`
- [ ] No `USING(true)` on tenant data tables
- [ ] Audit/log tables have REVOKE UPDATE, DELETE
