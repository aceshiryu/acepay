'use client';

import { CustomersPage } from '../../../admin/pages/customers';
import { useNavigate } from '../../../admin/navigate';

export default function Page() {
  return <CustomersPage onNavigate={useNavigate()} />;
}
