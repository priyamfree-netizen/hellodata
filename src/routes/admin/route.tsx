import { createFileRoute, Outlet } from "@tanstack/react-router";
import { requireSuperAdmin } from "@/lib/auth-guards";
import { AdminShell } from "@/components/admin/admin-shell";

export const Route = createFileRoute("/admin")({
  beforeLoad: requireSuperAdmin,
  head: () => ({
    meta: [
      { title: "HelloData Admin — Internal Operations" },
      { name: "description", content: "Enterprise super admin operations platform for HelloData AI financial document automation." },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: AdminLayout,
});

function AdminLayout() {
  return (
    <AdminShell>
      <Outlet />
    </AdminShell>
  );
}
