import { requireAgency } from "@/lib/auth";
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  await requireAgency();
  return <div className="mx-auto max-w-5xl p-6">{children}</div>;
}
