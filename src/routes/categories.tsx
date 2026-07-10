import { createFileRoute, redirect } from "@tanstack/react-router";

// Categories page has been merged into Templates.
// Any existing links to /categories are permanently redirected.
export const Route = createFileRoute("/categories")({
  beforeLoad: () => {
    throw redirect({ to: "/templates", replace: true });
  },
  component: () => null,
});
