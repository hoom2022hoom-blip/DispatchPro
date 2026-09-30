
"use client";

import type { Metadata } from 'next';
import { Suspense } from 'react';
import './globals.css';
import { cn } from '@/lib/utils';
import { Toaster } from "@/components/ui/toaster";
import { AuthProvider } from '@/context/auth-context';
import { TraccarProvider } from '@/context/traccar-context';
import { MainHeader } from '@/components/main-header';
import AuthDebugger from '@/components/AuthDebugger';

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ar" className="h-full">
      <head>
        <title>تكسي نابلس والمهندس | DispatchPro</title>
        <meta name="description" content="A professional taxi dispatch app to connect passengers with available drivers and manage ride requests efficiently." />
        <link rel="manifest" href="/manifest.json" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=PT+Sans:wght@400;700&display=swap" rel="stylesheet" />
      </head>
      <body className={cn("font-body antialiased h-full")}>
        <Suspense fallback={<div role="status">جارٍ التحميل…</div>}>
        <AuthProvider>
          <TraccarProvider>
            <div className="flex flex-col h-full">
                <MainHeader />
                <main className="flex-1 overflow-hidden">
                    {children}
                </main>
            </div>
            <Toaster />
            <AuthDebugger />
          </TraccarProvider>
        </AuthProvider>
        </Suspense>
      </body>
    </html>
  );
}
