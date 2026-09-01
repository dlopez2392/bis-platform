"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Check, ChevronsUpDown, Building2 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { m } from "@/lib/messages";
import { accountInitial } from "@/lib/account-initial";

export type AccountOption = { id: string; name: string; timezone: string };

export function AccountSwitcher({
  accounts,
  activeAccountId,
  collapsed,
}: {
  accounts: AccountOption[];
  activeAccountId?: string;
  collapsed: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const active = accounts.find((a) => a.id === activeAccountId);
  // Accounts carry no uploaded mark (app-sidebar.tsx's client identity block
  // is where a logo shows) — the chip's fallback is this account's own
  // initial instead of a generic icon, once one is selected. "" (no active
  // account, or a blank name) falls through to the Building2 icon below,
  // same as before this task.
  const initial = active ? accountInitial(active.name) : "";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label={m["shell.switchAccount"]}
        className={cn(
          "flex w-full items-center gap-2 rounded-md border border-sidebar-border px-2 py-2 text-left text-sidebar-foreground transition-colors hover:bg-white/5",
          collapsed && "justify-center px-0",
        )}
      >
        <span className="flex size-7 shrink-0 items-center justify-center rounded bg-sidebar-accent/20 text-sidebar-accent">
          {initial ? (
            // Decorative, like the icon it replaces: the trigger's own
            // aria-label above already carries the accessible name, and a
            // letter avatar adds no information a screen reader needs.
            <span aria-hidden className="text-sm font-semibold">
              {initial}
            </span>
          ) : (
            <Building2 className="size-4" aria-hidden />
          )}
        </span>
        {collapsed ? null : (
          <>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">
                {active?.name ?? m["shell.switchAccount"]}
              </span>
              <span className="block truncate text-[11px] text-sidebar-foreground/60">
                {active?.timezone ?? ""}
              </span>
            </span>
            <ChevronsUpDown className="size-4 shrink-0 opacity-60" aria-hidden />
          </>
        )}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-0">
        <Command>
          <CommandInput placeholder={m["shell.searchAccounts"]} />
          <CommandList>
            <CommandEmpty>{m["shell.noAccounts"]}</CommandEmpty>
            <CommandGroup>
              {accounts.map((a) => (
                <CommandItem
                  key={a.id}
                  value={a.name}
                  onSelect={() => {
                    setOpen(false);
                    router.push(`/dashboard/accounts/${a.id}/contacts`);
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 size-4",
                      a.id === activeAccountId ? "opacity-100" : "opacity-0",
                    )}
                    aria-hidden
                  />
                  <span className="truncate">{a.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
