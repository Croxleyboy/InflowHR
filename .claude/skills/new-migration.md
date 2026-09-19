---
description: Create a new Supabase migration file with the correct number and standard structure
---

# New Migration

## Steps

1. Find the highest migration number in `supabase/migrations/`:
   ```bash
   ls supabase/migrations/*.sql | sort -t/ -k3 -n | tail -1
   ```

2. Increment by 1 and create the file as `supabase/migrations/NNN_description.sql`

3. Start the file with a comment header:
   ```sql
   -- Migration NNN: Description
   -- Date: DD-MM-YYYY
   -- Purpose: Brief description
   ```

4. Include the standard structure from `.claude/rules/sql.md`:
   - Table creation with `company_id` and RLS
   - All 4 RLS policies with company scoping
   - SECURITY DEFINER functions with REVOKE/GRANT
   - GDPR audit logging where PII is involved

5. After creating, remind the user:
   > **SQL to run**: Apply this migration to your Supabase instance:
   > ```sql
   > -- Contents of supabase/migrations/NNN_description.sql
   > ```
