"use client";

import { Suspense } from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "./sidebar";
import { Header } from "./header";
import { DemoBanner } from "./demo-banner";

function DashboardContent({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isLoginPage = pathname === "/login";

  if (isLoginPage) {
    return <main className="min-h-screen bg-[#090d16]">{children}</main>;
  }

  return (
    <div className="min-h-screen bg-[#090d16] flex">
      <Sidebar />
      <div className="flex-1 pl-64 flex flex-col min-w-0">
        <Header />
        <DemoBanner />
        <main className="flex-1 p-8 overflow-y-auto">
          <div className="max-w-7xl mx-auto space-y-6">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}

export function DashboardShell({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<main className="min-h-screen bg-[#090d16]">{children}</main>}>
      <DashboardContent>{children}</DashboardContent>
    </Suspense>
  );
}
