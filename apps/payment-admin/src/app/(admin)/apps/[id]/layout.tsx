'use client';

import React from 'react';
import { useParams } from 'next/navigation';
import { AppShell } from '@/admin/app-shell';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const params = useParams();
  return <AppShell appId={params.id as string}>{children}</AppShell>;
}
