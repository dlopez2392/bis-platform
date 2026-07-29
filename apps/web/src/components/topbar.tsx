import { OrganizationSwitcher, UserButton } from "@clerk/nextjs";
import { ThemeToggle } from "@/components/theme-toggle";

export function Topbar() {
  return (
    <header className="flex h-14 shrink-0 items-center justify-end gap-3 border-b border-border bg-card px-6">
      <ThemeToggle />
      <OrganizationSwitcher hidePersonal />
      <UserButton />
    </header>
  );
}
