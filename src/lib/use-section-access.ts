import { useAuth } from "@/lib/auth/context";
import { useOrgMembers } from "@/lib/queries";
import { resolveSectionAccess } from "@/lib/permissions";
import type { Section, SectionLevel } from "@/lib/supabase/types";

/** The signed-in user's effective access level for one section of the current org. */
export function useSectionAccess(section: Section): SectionLevel {
  const { user, currentOrg } = useAuth();
  const { data: members = [] } = useOrgMembers(currentOrg?.id);
  const me = members.find((m) => m.user_id === user?.id && m.status === "active");
  return resolveSectionAccess(me?.role ?? null, me?.section_access, section);
}
