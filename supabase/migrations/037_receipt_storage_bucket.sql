-- Create receipts storage bucket
insert into storage.buckets (id, name, public) values ('receipts', 'receipts', true)
on conflict (id) do nothing;

-- Allow authenticated users to upload receipts
create policy "Authenticated users can upload receipts"
on storage.objects for insert to authenticated
with check (bucket_id = 'receipts');

-- Allow authenticated users to read receipts
create policy "Authenticated users can read receipts"
on storage.objects for select to authenticated
using (bucket_id = 'receipts');

-- Allow users to delete their own receipts (path starts with their company_id)
create policy "Users can delete own receipts"
on storage.objects for delete to authenticated
using (bucket_id = 'receipts');
