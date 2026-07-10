import { createFileRoute, Link } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { Fragment, useEffect, useState } from "react";
import {
  ArrowUpRight,
  ArrowRight,
  FileText,
  Receipt,
  Landmark,
  Wallet,
  ScrollText,
  FileCheck2,
  FileSpreadsheet,
  ShieldCheck,
  Sparkles,
  ScanEye,
} from "lucide-react";
import { MarketingNav } from "@/components/marketing-nav";
import { MarketingFooter } from "@/components/marketing-footer";
import { Waves } from "@/components/ui/waves";
import RotatingText from "@/components/ui/rotating-text";
import TargetCursor from "@/components/ui/target-cursor";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { useAuth } from "@/lib/auth/context";
import { getTokenPayload } from "@/lib/auth/client";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "HelloData — AI financial document automation for finance teams" },
      {
        name: "description",
        content:
          "Upload thousands of invoices, GST returns, bank statements and salary slips. HelloData extracts structured data with AI — ready for your ERP, CSV or Excel.",
      },
    ],
  }),
  component: Landing,
});

const categories = [
  { icon: Receipt, name: "Invoice", tag: "Core" },
  { icon: FileText, name: "Purchase Order", tag: "Core" },
  { icon: ScrollText, name: "GST Return", tag: "Tax" },
  { icon: FileCheck2, name: "TDS Certificate", tag: "Tax" },
  { icon: Landmark, name: "Bank Statement", tag: "Core" },
  { icon: Wallet, name: "Cheque / DD", tag: "Core" },
  { icon: FileSpreadsheet, name: "Balance Sheet", tag: "Core" },
  { icon: FileSpreadsheet, name: "P&L Statement", tag: "Core" },
  { icon: FileText, name: "Delivery Challan", tag: "Soon" },
  { icon: Receipt, name: "Salary Slip", tag: "Core" },
  { icon: ScrollText, name: "Agreement / MOU", tag: "Soon" },
  { icon: Wallet, name: "Expense Report", tag: "Core" },
];

function Landing() {
  const { status } = useAuth();
  const isLoggedIn = status === "ready";
  const isSuperAdmin = isLoggedIn && !!getTokenPayload()?.is_super_admin;
  const dashboardTo = isSuperAdmin ? "/admin" : "/dashboard";

  return (
    <div className="min-h-screen bg-background">
      {/* Custom cursor — only active inside sections marked `.cursor-zone` */}
      <TargetCursor
        targetSelector=".cursor-target"
        zoneSelector=".cursor-zone"
        spinDuration={2}
        hideDefaultCursor
        cursorColor="#84cc16"
      />

      <MarketingNav />

      {/* HERO */}
      <section className="relative overflow-hidden border-b border-border">
        <div className="absolute inset-0 [mask-image:radial-gradient(ellipse_at_top,black,transparent_70%)]">
          <Waves
            lineColor="rgba(132, 204, 22, 0.3)"
            backgroundColor="transparent"
            waveSpeedX={0.0125}
            waveSpeedY={0.01}
            waveAmpX={40}
            waveAmpY={20}
            friction={0.9}
            tension={0.01}
            maxCursorMove={120}
            xGap={12}
            yGap={36}
          />
        </div>
        <div className="relative mx-auto flex min-h-[80vh] max-w-7xl items-center justify-center px-6">
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="mx-auto flex flex-wrap items-center justify-center gap-3 text-5xl font-semibold tracking-tight md:text-7xl"
          >
            <span>Data</span>
            <RotatingText
              texts={[
                "Invoices",
                "GST Returns",
                "Bank Statements",
                "Salary Slips",
                "Purchase Orders",
                "TDS Certificates",
                "Balance Sheets",
              ]}
              mainClassName="px-3 sm:px-4 md:px-5 bg-brand-lime text-background overflow-hidden py-1 sm:py-2 md:py-3 justify-center rounded-2xl"
              staggerFrom="last"
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "-120%" }}
              staggerDuration={0.025}
              splitLevelClassName="overflow-hidden pb-1 md:pb-2"
              transition={{ type: "spring", damping: 30, stiffness: 400 }}
              rotationInterval={2000}
            />
          </motion.div>
        </div>
      </section>

      {/* Statement */}
      <section className="border-b border-border">
        <div className="mx-auto max-w-4xl px-6 py-20 text-center">
          <p className="text-balance text-3xl font-semibold tracking-tight md:text-5xl">
            Manual data entry is <span className="text-brand-lime">dead</span>.
            <br className="hidden md:block" />
            Automation just took its place.
          </p>
        </div>
      </section>

      {/* Workflow */}
      <section className="cursor-zone relative border-b border-border">
        <div className="mx-auto max-w-7xl px-6 py-24">
          <div className="grid gap-12 md:grid-cols-[1fr_2fr]">
            <div>
              <div className="font-mono text-[11px] uppercase tracking-wider text-brand-blue">
                Workflow
              </div>
              <h2 className="mt-2 text-3xl font-semibold tracking-tight md:text-4xl">
                Four steps from PDF to spreadsheet.
              </h2>
              <p className="mt-3 max-w-md text-sm text-muted-foreground">
                Designed for batch operations — every step is built to scale from one document to a
                hundred thousand without breaking your workflow.
              </p>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              {[
                {
                  n: "01",
                  t: "Upload",
                  d: "Drag-and-drop folders, sync from Drive, or pipe in via API.",
                },
                {
                  n: "02",
                  t: "Detect",
                  d: "AI auto-classifies each document into the right template.",
                },
                {
                  n: "03",
                  t: "Configure",
                  d: "Toggle the exact fields you need. Save as a reusable template.",
                },
                {
                  n: "04",
                  t: "Export",
                  d: "Stream structured rows to CSV, Excel, ERP or webhook.",
                },
              ].map((s) => (
                <div
                  key={s.n}
                  className="cursor-target group rounded-xl border border-border bg-surface p-5 transition-colors hover:bg-surface-2"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs text-muted-foreground">{s.n}</span>
                    <ArrowRight className="h-3.5 w-3.5 text-muted-foreground transition-transform group-hover:translate-x-1" />
                  </div>
                  <div className="mt-6 text-base font-medium">{s.t}</div>
                  <div className="mt-1 text-sm text-muted-foreground">{s.d}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Categories */}
      <section className="cursor-zone border-b border-border">
        <div className="mx-auto max-w-7xl px-6 py-24">
          <div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-end">
            <div>
              <div className="font-mono text-[11px] uppercase tracking-wider text-brand-lime">
                Document library
              </div>
              <h2 className="mt-2 text-3xl font-semibold tracking-tight md:text-4xl">
                Built for every form your team touches.
              </h2>
            </div>
            <Link
              to="/categories"
              className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            >
              See all categories <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          </div>

          <div className="mt-10 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
            {categories.slice(0, 8).map((c) => (
              <CategoryCard key={c.name} {...c} />
            ))}
          </div>
        </div>
      </section>

      {/* Why */}
      <section className="border-b border-border overflow-hidden">
        <div className="mx-auto max-w-7xl px-6 py-24">
          <div className="mb-16 flex items-center gap-3 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
            <FileText className="h-3.5 w-3.5" />
            Any document
            <ArrowRight className="h-3.5 w-3.5" />
            <FileSpreadsheet className="h-3.5 w-3.5 text-brand-lime" />
            Clean spreadsheet
          </div>

          <div>
            <div className="flex flex-col gap-3 border-b border-border pb-8 md:flex-row md:items-baseline md:justify-between">
              <h3 className="text-6xl font-semibold tracking-tight md:text-8xl">Fast.</h3>
              <p className="max-w-xs text-sm text-muted-foreground md:text-right">
                Thousands of pages parsed in the time it takes to open a spreadsheet.
              </p>
            </div>
            <div className="flex flex-col gap-3 border-b border-border py-8 md:flex-row-reverse md:items-baseline md:justify-between md:pl-24">
              <h3 className="text-6xl font-semibold tracking-tight text-brand-blue md:text-8xl">
                Accurate.
              </h3>
              <p className="max-w-xs text-sm text-muted-foreground">
                99.4% field-level accuracy, verified against source on every run.
              </p>
            </div>
            <div className="flex flex-col gap-3 pt-8 md:flex-row md:items-baseline md:justify-between">
              <h3 className="text-6xl font-semibold tracking-tight text-brand-lime md:text-8xl">
                Cost-optimized.
              </h3>
              <p className="max-w-xs text-sm text-muted-foreground md:text-right">
                A fraction of the cost of manual entry or per-seat OCR tools.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Platform / AI model */}
      <section className="border-b border-border">
        <div className="mx-auto max-w-7xl px-6 py-24">
          <div className="mb-10 max-w-2xl">
            <div className="font-mono text-[11px] uppercase tracking-wider text-brand-blue">
              The engine
            </div>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight md:text-4xl">
              Three layers, one accurate result.
            </h2>
            <p className="mt-3 text-sm text-muted-foreground">
              Drag the handles to explore what powers every extraction.
            </p>
          </div>

          <EngineCard />
        </div>
      </section>

      {/* CTA */}
      <section className="border-b border-border">
        <div className="mx-auto max-w-7xl px-6 py-24">
          <div className="relative overflow-hidden rounded-3xl border border-border bg-surface px-8 py-16 md:px-16">
            <div className="absolute inset-0 dot-bg opacity-40" />
            <div className="relative grid items-center gap-8 md:grid-cols-[2fr_1fr]">
              <div>
                <h2 className="text-balance text-3xl font-semibold tracking-tight md:text-5xl">
                  Replace manual data entry. Permanently.
                </h2>
                <p className="mt-4 max-w-xl text-muted-foreground">
                  Get 50 credits free on your first sign-up. Connect your S3, Drive or email inbox
                  in minutes.
                </p>
              </div>
              <div className="flex flex-col gap-2 md:items-end">
                <Link
                  to={isLoggedIn ? dashboardTo : "/signup"}
                  className="inline-flex h-12 items-center gap-2 rounded-xl bg-foreground px-6 text-sm font-medium text-background hover:opacity-90"
                >
                  {isLoggedIn ? "Go to Dashboard" : "Start free"}
                  <ArrowUpRight className="h-4 w-4" />
                </Link>
                <Link
                  to="/categories"
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  Or talk to sales →
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      <MarketingFooter />
    </div>
  );
}

const engineLayers = [
  {
    icon: ShieldCheck,
    accent: "text-brand-lime",
    ring: "border-brand-lime/30 bg-brand-lime/10",
    title: "Your data stays yours",
    body: "We never expose, store, or train our LLM on your documents. Data is processed in isolation and discarded after extraction — nothing is retained.",
  },
  {
    icon: Sparkles,
    accent: "text-brand-blue",
    ring: "border-brand-blue/30 bg-brand-blue/10",
    title: "Trained on billions of documents",
    body: "Our LLM was built on billions of real financial documents, so it understands layouts and terminology out of the box — accuracy you can trust from the first upload.",
  },
  {
    icon: ScanEye,
    accent: "text-brand-lime",
    ring: "border-brand-lime/30 bg-brand-lime/10",
    title: "Computer vision that never misses",
    body: "A dedicated vision layer reads stamps, handwriting, tables and low-quality scans pixel by pixel — so no field slips through, no matter the source.",
  },
];

function EngineCard() {
  const [direction, setDirection] = useState<"horizontal" | "vertical">("horizontal");

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const update = () => setDirection(mq.matches ? "horizontal" : "vertical");
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  return (
    <div className="overflow-hidden rounded-3xl border border-border bg-surface">
      <ResizablePanelGroup orientation={direction} className="min-h-[520px] md:min-h-[340px]">
        {engineLayers.map((layer, i) => (
          <Fragment key={layer.title}>
            {i > 0 && <ResizableHandle withHandle orientation={direction} />}
            <ResizablePanel minSize="15%">
              <div className="flex h-full flex-col justify-between gap-6 p-8">
                <div className="flex items-center justify-between">
                  <div
                    className={`inline-flex h-10 w-10 items-center justify-center rounded-xl border ${layer.ring}`}
                  >
                    <layer.icon className={`h-5 w-5 ${layer.accent}`} />
                  </div>
                  <span className="font-mono text-xs text-muted-foreground">0{i + 1}</span>
                </div>
                <div>
                  <h3 className="text-lg font-semibold tracking-tight">{layer.title}</h3>
                  <p className="mt-2 text-sm text-muted-foreground">{layer.body}</p>
                </div>
              </div>
            </ResizablePanel>
          </Fragment>
        ))}
      </ResizablePanelGroup>
    </div>
  );
}

function CategoryCard({
  icon: Icon,
  name,
  tag,
}: {
  icon: typeof FileText;
  name: string;
  tag: string;
}) {
  const tagColor =
    tag === "Tax"
      ? "text-brand-blue border-brand-blue/30 bg-brand-blue/10"
      : tag === "Soon"
        ? "text-muted-foreground border-border bg-surface-2"
        : "text-brand-lime border-brand-lime/30 bg-brand-lime/10";
  return (
    <div className="cursor-target group relative overflow-hidden rounded-xl border border-border bg-surface p-5 transition-colors hover:bg-surface-2">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand-blue/50 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
      <div className="flex items-start justify-between">
        <div className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-background">
          <Icon className="h-4 w-4" />
        </div>
        <span className={`rounded-full border px-2 py-0.5 font-mono text-[10px] ${tagColor}`}>
          {tag}
        </span>
      </div>
      <div className="mt-6 text-sm font-medium">{name}</div>
      <div className="mt-1 text-xs text-muted-foreground">Pre-trained extraction template</div>
    </div>
  );
}
