/**
 * BillSOS · Stripe Webhook Handler
 *
 * Receives Stripe events and keeps the DB in sync:
 *   checkout.session.completed    → activate subscription
 *   customer.subscription.updated → sync status / period dates
 *   customer.subscription.deleted → cancel subscription
 *   invoice.paid                  → record invoice
 *   invoice.payment_failed        → mark subscription past_due
 *
 * Secrets required:
 *   STRIPE_SECRET_KEY      – sk_live_… or sk_test_…
 *   STRIPE_WEBHOOK_SECRET  – whsec_…  (from Stripe Dashboard → Webhooks)
 */

import { createClient } from "jsr:@supabase/supabase-js@2";

function log(level: "info" | "warn" | "error", message: string, data?: Record<string, unknown>) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), level, fn: "stripe-webhook", message, ...data }));
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const sig = req.headers.get("Stripe-Signature") ?? "";
  const rawBody = await req.text();
  const secret = Deno.env.get("STRIPE_WEBHOOK_SECRET");

  if (!secret) {
    log("error", "STRIPE_WEBHOOK_SECRET not configured");
    return new Response("Server misconfiguration", { status: 500 });
  }

  const valid = await verifyStripeSignature(rawBody, sig, secret);
  if (!valid) {
    log("warn", "Invalid Stripe signature");
    return new Response("Invalid signature", { status: 400 });
  }

  // deno-lint-ignore no-explicit-any
  let event: any;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  log("info", `Handling event`, { type: event.type, id: event.id });

  try {
    switch (event.type) {

      case "checkout.session.completed": {
        const session = event.data.object;
        if (session.mode !== "subscription") break;

        const orgId = session.metadata?.organization_id;
        if (!orgId) { log("warn", "checkout.session has no organization_id metadata"); break; }

        await supabase
          .from("organizations")
          .update({ stripe_customer_id: session.customer })
          .eq("id", orgId);

        const priceId = session.line_items?.data?.[0]?.price?.id ?? null;
        const { data: plan } = priceId
          ? await supabase.from("plans").select("id").eq("stripe_price_id", priceId).maybeSingle()
          : { data: null };

        // plan_id is only included when a matching plan row exists.
        // subscriptions(organization_id) has a unique constraint, so this upsert
        // updates the single subscription row for this org on repeated checkouts.
        const subRow: Record<string, unknown> = {
          organization_id: orgId,
          stripe_subscription_id: session.subscription,
          stripe_price_id: priceId,
          status: "active",
          current_period_start: new Date().toISOString(),
        };
        if (plan?.id) subRow.plan_id = plan.id;

        await supabase.from("subscriptions").upsert(subRow, { onConflict: "organization_id" });

        log("info", "Subscription activated", { org_id: orgId, sub_id: session.subscription });
        break;
      }

      case "customer.subscription.updated": {
        const sub = event.data.object;
        const priceId = sub.items?.data?.[0]?.price?.id ?? null;

        const { data: plan } = priceId
          ? await supabase.from("plans").select("id").eq("stripe_price_id", priceId).maybeSingle()
          : { data: null };

        const updateRow: Record<string, unknown> = {
          status: sub.status,
          stripe_price_id: priceId,
          current_period_start: new Date(sub.current_period_start * 1000).toISOString(),
          current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
        };
        if (plan?.id) updateRow.plan_id = plan.id;

        await supabase
          .from("subscriptions")
          .update(updateRow)
          .eq("stripe_subscription_id", sub.id);

        log("info", "Subscription updated", { stripe_sub_id: sub.id, status: sub.status });
        break;
      }

      case "customer.subscription.deleted": {
        const sub = event.data.object;
        await supabase
          .from("subscriptions")
          .update({ status: "canceled", current_period_end: new Date(sub.current_period_end * 1000).toISOString() })
          .eq("stripe_subscription_id", sub.id);

        log("info", "Subscription canceled", { stripe_sub_id: sub.id });
        break;
      }

      case "invoice.paid": {
        const inv = event.data.object;

        // Look up org via stripe_customer_id
        const { data: org } = await supabase
          .from("organizations")
          .select("id")
          .eq("stripe_customer_id", inv.customer)
          .maybeSingle();
        if (!org) { log("warn", "invoice.paid: org not found for customer", { customer: inv.customer }); break; }

        const { data: sub } = await supabase
          .from("subscriptions")
          .select("id, plan_id")
          .eq("organization_id", org.id)
          .maybeSingle();

        await supabase.from("invoices").upsert({
          organization_id: org.id,
          subscription_id: sub?.id ?? null,
          stripe_invoice_id: inv.id,
          number: inv.number,
          status: "paid",
          amount_inr: Math.round(inv.amount_paid / 100), // Stripe amounts in paisa
          issue_date: new Date(inv.created * 1000).toISOString().split("T")[0],
          pdf_url: inv.invoice_pdf,
        }, { onConflict: "stripe_invoice_id" });

        log("info", "Invoice recorded", { invoice_id: inv.id, org_id: org.id });
        break;
      }

      case "invoice.payment_failed": {
        const inv = event.data.object;
        await supabase
          .from("subscriptions")
          .update({ status: "past_due" })
          .eq("stripe_subscription_id", inv.subscription);

        log("warn", "Invoice payment failed", { invoice_id: inv.id, sub_id: inv.subscription });
        break;
      }

      default:
        log("info", "Unhandled event type — ignoring", { type: event.type });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log("error", "Event handler threw", { type: event.type, error: msg });
    return new Response("Handler error", { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});

async function verifyStripeSignature(rawBody: string, header: string, secret: string): Promise<boolean> {
  const parts: Record<string, string> = {};
  for (const chunk of header.split(",")) {
    const eq = chunk.indexOf("=");
    if (eq > 0) parts[chunk.slice(0, eq)] = chunk.slice(eq + 1);
  }
  const timestamp = parts["t"];
  const expected = parts["v1"];
  if (!timestamp || !expected) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${rawBody}`));
  const computed = Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");

  if (computed.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < computed.length; i++) diff |= computed.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}
