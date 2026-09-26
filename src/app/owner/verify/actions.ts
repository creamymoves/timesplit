'use server';
import { requireRole } from '@/lib/auth/roles';
import { createClient } from '@/lib/supabase/server';
import { back, errMsg, str } from '@/lib/action';
import { DOC_TYPES, MAX_DOC_BYTES, extFor } from '@/lib/storage';

const PATH = '/owner/verify';

export async function startVerification() {
  const { user, ownerStatus } = await requireRole('owner', PATH);
  if (ownerStatus === 'approved') back(PATH, { ok: 'Already verified' });
  const supabase = createClient();
  const { error } = await supabase.from('owner_verifications').insert({ owner_id: user.id, status: 'in_progress' });
  if (error) back(PATH, { error: errMsg(error) });
  back(PATH, { ok: 'Verification started. Upload your ownership document.' });
}

export async function uploadOwnershipDoc(fd: FormData) {
  const { user } = await requireRole('owner', PATH);
  const id = str(fd, 'verification_id');
  const file = fd.get('file');
  if (!(file instanceof File) || file.size === 0) back(PATH, { error: 'Choose a file' });
  if (!DOC_TYPES.includes(file.type)) back(PATH, { error: 'PDF, JPEG or PNG only' });
  if (file.size > MAX_DOC_BYTES) back(PATH, { error: 'File is larger than 25 MB' });
  const supabase = createClient();
  const { data: v } = await supabase.from('owner_verifications').select('id, status').eq('id', id).eq('owner_id', user.id).maybeSingle();
  if (!v || v.status !== 'in_progress') back(PATH, { error: 'This verification is not editable' });
  const key = `${user.id}/${id}-${Date.now()}.${extFor(file.type)}`;
  const up = await supabase.storage.from('ownership-docs').upload(key, file, { contentType: file.type });
  if (up.error) back(PATH, { error: errMsg(up.error) });
  const resortId = str(fd, 'resort_id');
  const { error } = await supabase.from('owner_verifications').update({
    ownership_doc_path: `ownership-docs/${key}`, ownership_doc_type: str(fd, 'doc_type') || null,
    resort_id: resortId || null, ownership_doc_uploaded_at: new Date().toISOString(),
  }).eq('id', id);
  if (error) back(PATH, { error: errMsg(error) });
  back(PATH, { ok: 'Document uploaded' });
}
