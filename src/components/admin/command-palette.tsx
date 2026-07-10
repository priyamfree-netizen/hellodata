import { useState, useEffect, useCallback } from "react";
import { useRouter } from "@tanstack/react-router";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  LayoutDashboard, Users, Building2, CreditCard, Receipt,
  Layers3, Brain,
  Bell, Headphones, Settings,
  FileText, Search, Zap, ClipboardList,
} from "lucide-react";

const navItems = [
  { label: "Operations Dashboard", icon: LayoutDashboard, path: "/admin" },
  { label: "User Management", icon: Users, path: "/admin/users" },
  { label: "Organizations", icon: Building2, path: "/admin/organizations" },
  { label: "Plans & Subscriptions", icon: CreditCard, path: "/admin/plans" },
  { label: "Billing & Revenue", icon: Receipt, path: "/admin/billing" },
  { label: "Processing Queue", icon: Layers3, path: "/admin/queue" },
  { label: "ExDoc Health", icon: Brain, path: "/admin/analytics" },
  { label: "Notifications", icon: Bell, path: "/admin/notifications" },
  { label: "Support Center", icon: Headphones, path: "/admin/support" },
  { label: "Audit Log", icon: ClipboardList, path: "/admin/audit" },
  { label: "Reports", icon: FileText, path: "/admin/reports" },
  { label: "Settings", icon: Settings, path: "/admin/settings" },
];

const quickActions = [
  { label: "Search Users", icon: Search },
  { label: "Retry Failed Jobs", icon: Zap },
  { label: "View Queue", icon: Layers3 },
  { label: "Check ExDoc Health", icon: Brain },
];

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "k") {
      e.preventDefault();
      setOpen((prev) => !prev);
    }
  }, []);

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  const navigate = (path: string) => {
    router.navigate({ to: path });
    setOpen(false);
  };

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <Command className="rounded-xl border border-border/80 bg-surface-2">
        <CommandInput
          placeholder="Search pages, actions, users..."
          className="border-b border-border bg-transparent text-sm text-foreground placeholder:text-muted-foreground/80"
        />
        <CommandList className="max-h-[400px] overflow-y-auto">
          <CommandEmpty className="py-8 text-center font-mono text-xs text-muted-foreground/80">
            No results found.
          </CommandEmpty>

          <CommandGroup heading="Pages" className="[&_[cmdk-group-heading]]:font-mono [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-muted-foreground/80">
            {navItems.map((item) => (
              <CommandItem
                key={item.path}
                value={item.label}
                onSelect={() => navigate(item.path)}
                className="flex items-center gap-2.5 rounded-md px-3 py-2.5 text-sm text-foreground/80 aria-selected:bg-muted aria-selected:text-foreground"
              >
                <item.icon className="h-4 w-4 text-muted-foreground/80" />
                {item.label}
              </CommandItem>
            ))}
          </CommandGroup>

          <CommandSeparator className="bg-muted/80" />

          <CommandGroup heading="Quick Actions" className="[&_[cmdk-group-heading]]:font-mono [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-muted-foreground/80">
            {quickActions.map((action) => (
              <CommandItem
                key={action.label}
                value={action.label}
                className="flex items-center gap-2.5 rounded-md px-3 py-2.5 text-sm text-foreground/80 aria-selected:bg-muted aria-selected:text-foreground"
              >
                <action.icon className="h-4 w-4 text-muted-foreground/80" />
                {action.label}
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
