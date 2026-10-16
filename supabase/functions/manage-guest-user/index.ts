import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ALLOWED_ORIGIN = 'https://app.inflowhr.com'

const corsHeaders = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function generateOtp(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let otp = ''
  const arr = new Uint8Array(8)
  crypto.getRandomValues(arr)
  for (const byte of arr) otp += chars[byte % chars.length]
  return otp
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Missing authorization' }), { status: 401, headers: corsHeaders })
    }

    const token = authHeader.replace('Bearer ', '')
    const supabaseAuth = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )
    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser(token)
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Invalid or expired token' }), { status: 401, headers: corsHeaders })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const { action, email, company_id, role_key, read_only, guest_id } = await req.json()

    if (!action) {
      return new Response(JSON.stringify({ error: 'action required' }), { status: 400, headers: corsHeaders })
    }

    // Verify caller is an admin for this company
    const { data: callerCu } = await supabase
      .from('company_users')
      .select('role')
      .eq('auth_user_id', user.id)
      .eq('company_id', company_id)
      .eq('is_active', true)
      .maybeSingle()

    const { data: saResult } = await supabase.rpc('is_super_admin', {}, {
      headers: { Authorization: `Bearer ${token}` }
    })

    if (!saResult && (!callerCu || callerCu.role !== 'admin')) {
      return new Response(JSON.stringify({ error: 'Admin access required' }), { status: 403, headers: corsHeaders })
    }

    if (action === 'create') {
      if (!email || !company_id || !role_key) {
        return new Response(JSON.stringify({ error: 'email, company_id, and role_key required' }), { status: 400, headers: corsHeaders })
      }

      const normalEmail = email.trim().toLowerCase()
      const otp = generateOtp()
      const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString()

      // Check if guest already exists for this company+email
      const { data: existing } = await supabase
        .from('guest_users')
        .select('id, auth_user_id')
        .eq('company_id', company_id)
        .eq('email', normalEmail)
        .maybeSingle()

      if (existing) {
        return new Response(JSON.stringify({ error: 'A guest account already exists for this email in this company' }), { status: 409, headers: corsHeaders })
      }

      // Create or find auth user
      let authUserId: string
      const { data: existingAuth } = await supabase.auth.admin.listUsers()
      const existingAuthUser = existingAuth?.users?.find(u => u.email === normalEmail)

      if (existingAuthUser) {
        authUserId = existingAuthUser.id
        await supabase.auth.admin.updateUserById(authUserId, { password: otp })
      } else {
        const { data: newAuth, error: createErr } = await supabase.auth.admin.createUser({
          email: normalEmail,
          password: otp,
          email_confirm: true,
        })
        if (createErr || !newAuth.user) {
          return new Response(JSON.stringify({ error: 'Failed to create auth user: ' + (createErr?.message || 'unknown') }), { status: 500, headers: corsHeaders })
        }
        authUserId = newAuth.user.id
      }

      // Insert guest_users row
      const { data: guest, error: insertErr } = await supabase
        .from('guest_users')
        .insert({
          company_id,
          email: normalEmail,
          otp_hash: otp,
          role_key: role_key || 'read_only',
          read_only: read_only !== false,
          is_active: true,
          otp_expires_at: expiresAt,
          auth_user_id: authUserId,
          created_by: user.email || user.id,
        })
        .select()
        .single()

      if (insertErr) {
        return new Response(JSON.stringify({ error: 'Failed to create guest: ' + insertErr.message }), { status: 500, headers: corsHeaders })
      }

      return new Response(JSON.stringify({ guest, otp }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    if (action === 'regenerate') {
      if (!guest_id) {
        return new Response(JSON.stringify({ error: 'guest_id required' }), { status: 400, headers: corsHeaders })
      }

      const { data: guest } = await supabase
        .from('guest_users')
        .select('id, auth_user_id, company_id')
        .eq('id', guest_id)
        .eq('company_id', company_id)
        .single()

      if (!guest) {
        return new Response(JSON.stringify({ error: 'Guest not found' }), { status: 404, headers: corsHeaders })
      }

      const otp = generateOtp()
      const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString()

      if (guest.auth_user_id) {
        await supabase.auth.admin.updateUserById(guest.auth_user_id, { password: otp })
      }

      await supabase
        .from('guest_users')
        .update({ otp_hash: otp, otp_expires_at: expiresAt, is_active: true, updated_at: new Date().toISOString() })
        .eq('id', guest_id)
        .eq('company_id', company_id)

      return new Response(JSON.stringify({ otp, expires_at: expiresAt }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    if (action === 'revoke') {
      if (!guest_id) {
        return new Response(JSON.stringify({ error: 'guest_id required' }), { status: 400, headers: corsHeaders })
      }

      await supabase
        .from('guest_users')
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq('id', guest_id)
        .eq('company_id', company_id)

      return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    if (action === 'update') {
      if (!guest_id) {
        return new Response(JSON.stringify({ error: 'guest_id required' }), { status: 400, headers: corsHeaders })
      }

      const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
      if (role_key !== undefined) updates.role_key = role_key
      if (read_only !== undefined) updates.read_only = read_only

      await supabase
        .from('guest_users')
        .update(updates)
        .eq('id', guest_id)
        .eq('company_id', company_id)

      return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    if (action === 'delete') {
      if (!guest_id) {
        return new Response(JSON.stringify({ error: 'guest_id required' }), { status: 400, headers: corsHeaders })
      }

      const { data: guest } = await supabase
        .from('guest_users')
        .select('auth_user_id')
        .eq('id', guest_id)
        .eq('company_id', company_id)
        .single()

      if (!guest) {
        return new Response(JSON.stringify({ error: 'Guest not found' }), { status: 404, headers: corsHeaders })
      }

      await supabase.from('guest_users').delete().eq('id', guest_id).eq('company_id', company_id)

      if (guest?.auth_user_id) {
        const { data: otherGuests } = await supabase
          .from('guest_users')
          .select('id')
          .eq('auth_user_id', guest.auth_user_id)
          .limit(1)
        if (!otherGuests || otherGuests.length === 0) {
          await supabase.auth.admin.deleteUser(guest.auth_user_id)
        }
      }

      return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    return new Response(JSON.stringify({ error: 'Invalid action. Use: create, regenerate, revoke, update, delete' }), { status: 400, headers: corsHeaders })

  } catch (err) {
    return new Response(JSON.stringify({ error: 'Internal error' }), { status: 500, headers: corsHeaders })
  }
})
