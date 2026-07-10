import { Lock, Eye } from "lucide-react";
import { SECTIONS } from "@/lib/permissions";
import type { Section } from "@/lib/supabase/types";

/** Full-page placeholder a route renders (inside its normal AppShell) when the signed-in user has no access to that section. */
export function NoSectionAccess({ section }: { section: Section }) {
  const label = SECTIONS.find((s) => s.id === section)?.label ?? "This section";
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 py-24 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted">
        <Lock className="h-5 w-5 text-muted-foreground" />
      </div>
      <div className="text-lg font-semibold">You don't have access to {label}</div>
      <p className="max-w-sm text-sm text-muted-foreground">
        Ask a workspace owner or admin to grant you access if you need it.
      </p>
    </div>
  );
}

/** Banner a page shows at the top of its content when access is "view" (read-only). */
export function ReadOnlyBanner({ section }: { section: Section }) {
  const label = SECTIONS.find((s) => s.id === section)?.label ?? "this section";
  return (
    <div className="mb-4 flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-500">
      <Eye className="h-3.5 w-3.5" />
      View only — ask a workspace owner or admin for edit access to {label.toLowerCase()}.
    </div>
  );
}
