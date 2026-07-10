import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Mail, Phone } from "lucide-react";
import { MarketingNav } from "@/components/marketing-nav";
import { MarketingFooter } from "@/components/marketing-footer";
import { useCreateContactSubmission } from "@/lib/queries";

export const Route = createFileRoute("/contact")({
  head: () => ({
    meta: [
      { title: "Contact us — HelloData" },
      {
        name: "description",
        content:
          "Talk to the HelloData team about AI financial document automation for your organization.",
      },
    ],
  }),
  component: ContactPage,
});

function ContactPage() {
  const createSubmission = useCreateContactSubmission();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [company, setCompany] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  function resetForm() {
    setName("");
    setPhone("");
    setCompany("");
    setEmail("");
    setMessage("");
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !phone.trim() || !email.trim() || !message.trim()) {
      setFormError("Name, number, email and message are required.");
      return;
    }
    setFormError(null);
    createSubmission.mutate(
      {
        name: name.trim(),
        phone: phone.trim(),
        company: company.trim() || null,
        email: email.trim(),
        message: message.trim(),
      },
      {
        onSuccess: () => {
          toast.success("Message sent — our team will get back to you shortly.");
          resetForm();
        },
        onError: (err) =>
          setFormError(err instanceof Error ? err.message : "Could not send your message."),
      },
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <MarketingNav />

      <section className="border-b border-border">
        <div className="mx-auto max-w-5xl px-6 py-20">
          <div className="text-center">
            <h1 className="text-balance text-4xl font-semibold tracking-tight md:text-5xl">
              Get in touch.
            </h1>
            <p className="mx-auto mt-4 max-w-xl text-balance text-muted-foreground">
              Questions about HelloData, pricing or your account? Send us a message and our team
              will reach out.
            </p>
          </div>

          <div className="mt-14 grid gap-8 md:grid-cols-[1fr_1.4fr]">
            <div className="space-y-5">
              <div className="flex items-start gap-3 rounded-xl border border-border bg-surface p-4">
                <Mail className="mt-0.5 h-4 w-4 text-muted-foreground" />
                <div>
                  <div className="text-sm font-medium">Email</div>
                  <div className="mt-0.5 text-sm text-muted-foreground">
                    hellodata@dninfo.online
                  </div>
                </div>
              </div>
              <div className="flex items-start gap-3 rounded-xl border border-border bg-surface p-4">
                <Phone className="mt-0.5 h-4 w-4 text-muted-foreground" />
                <div>
                  <div className="text-sm font-medium">Phone</div>
                  <div className="mt-0.5 text-sm text-muted-foreground">+91 92135 36538</div>
                </div>
              </div>
            </div>

            <form
              onSubmit={handleSubmit}
              className="space-y-4 rounded-2xl border border-border bg-surface p-6"
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                    Name
                  </label>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-foreground/30"
                    placeholder="Your name"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                    Number
                  </label>
                  <input
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    type="tel"
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-foreground/30"
                    placeholder="Phone number"
                  />
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                    Company
                  </label>
                  <input
                    value={company}
                    onChange={(e) => setCompany(e.target.value)}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-foreground/30"
                    placeholder="Company (optional)"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                    Email
                  </label>
                  <input
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    type="email"
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-foreground/30"
                    placeholder="you@company.com"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                  Message
                </label>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={5}
                  className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-foreground/30"
                  placeholder="How can we help?"
                />
              </div>

              {formError && <p className="text-sm text-red-400">{formError}</p>}

              <button
                type="submit"
                disabled={createSubmission.isPending}
                className="w-full rounded-lg bg-foreground px-4 py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {createSubmission.isPending ? "Sending…" : "Send message"}
              </button>
            </form>
          </div>
        </div>
      </section>

      <MarketingFooter />
    </div>
  );
}
