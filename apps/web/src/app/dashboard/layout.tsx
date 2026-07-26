import Link from "next/link";
import { OrganizationSwitcher, UserButton } from "@clerk/nextjs";
import { requireAgency } from "@/lib/auth";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  await requireAgency();
  return (
    <div className="mx-auto max-w-5xl p-6">
      <header className="mb-8 flex items-center justify-between border-b pb-4">
        <nav className="flex items-center gap-6">
          <Link href="/dashboard" className="font-semibold">BIS Platform</Link>
          <Link href="/dashboard/accounts">Accounts</Link>
        </nav>
        <div className="flex items-center gap-4">
          <OrganizationSwitcher hidePersonal />
          <UserButton />
        </div>
      </header>
      {children}
    </div>
  );
}
