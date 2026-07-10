export function MarketingFooter() {
  return (
    <footer className="border-t border-border bg-background">
      <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 px-6 py-10 md:flex-row">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="h-1.5 w-1.5 rounded-full bg-brand-lime" />
          All systems operational
        </div>
        <div className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
          © 2026 HelloData — A product of DN Info Solution
        </div>
      </div>
    </footer>
  );
}
