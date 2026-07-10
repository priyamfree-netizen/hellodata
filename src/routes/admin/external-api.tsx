import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/external-api")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/analytics" });
  },
});
