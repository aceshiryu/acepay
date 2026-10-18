'use client';

import { useParams } from 'next/navigation';
import * as api from '@/admin/api/client';
import { RecordRedirect } from '@/admin/redirects';

/** Old global URL: records now live under their app. */
export default function Page() {
  const params = useParams();
  const id = (params.id as string) ?? null;
  return <RecordRedirect recordId={id} segment="merchants" load={() => api.merchants.one(id ?? '')} />;
}
