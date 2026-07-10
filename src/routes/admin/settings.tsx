import { createFileRoute } from "@tanstack/react-router";
import { Settings2, Save, Globe, Lock, Mail, CreditCard } from "lucide-react";

export const Route = createFileRoute("/admin/settings")({
  component: GlobalSettings,
});

function GlobalSettings() {
  const sections = [
    {
      id: "general",
      title: "General Configuration",
      icon: Globe,
      desc: "Platform-wide defaults and branding settings",
      fields: [
        { label: "Platform Name", type: "text", defaultValue: "HelloData AI" },
        { label: "Support Email", type: "email", defaultValue: "support@hellodata.ai" },
        { label: "Default Timezone", type: "select", defaultValue: "Asia/Kolkata" },
      ]
    },
    {
      id: "security",
      title: "Security Defaults",
      icon: Lock,
      desc: "Global authentication and access controls",
      fields: [
        { label: "Require 2FA for Admins", type: "toggle", defaultValue: true },
        { label: "Session Timeout (minutes)", type: "number", defaultValue: 120 },
        { label: "Password Expiry (days)", type: "number", defaultValue: 90 },
      ]
    },
    {
      id: "billing",
      title: "Billing & Invoicing",
      icon: CreditCard,
      desc: "Tax codes, currency, and payment gateway rules",
      fields: [
        { label: "Base Currency", type: "select", defaultValue: "INR" },
        { label: "Tax Percentage (GST)", type: "number", defaultValue: 18 },
        { label: "Invoice Prefix", type: "text", defaultValue: "LEDG-" },
      ]
    },
    {
      id: "email",
      title: "SMTP / Email Delivery",
      icon: Mail,
      desc: "Outbound transactional email routing",
      fields: [
        { label: "SMTP Host", type: "text", defaultValue: "smtp.sendgrid.net" },
        { label: "SMTP Port", type: "number", defaultValue: 587 },
        { label: "Sender Name", type: "text", defaultValue: "HelloData Operations" },
      ]
    }
  ];

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Global Settings</h1>
          <p className="mt-1 font-mono text-xs text-muted-foreground/80">Platform configuration and system variables</p>
        </div>
        <button className="flex items-center gap-1.5 rounded-md bg-blue-600 px-4 py-2 font-mono text-[12px] text-foreground transition-colors hover:bg-blue-700">
          <Save className="h-3.5 w-3.5" /> Save Changes
        </button>
      </div>

      <div className="space-y-6">
        {sections.map(section => (
          <div key={section.id} className="rounded-lg border border-border bg-surface">
            <div className="flex items-center gap-3 border-b border-border px-6 py-4">
              <section.icon className="h-5 w-5 text-muted-foreground" />
              <div>
                <h3 className="text-sm font-medium text-foreground">{section.title}</h3>
                <p className="font-mono text-[10px] text-muted-foreground/80">{section.desc}</p>
              </div>
            </div>
            <div className="p-6 space-y-4">
              {section.fields.map(field => (
                <div key={field.label} className="grid grid-cols-3 gap-4 items-center">
                  <label className="font-mono text-[11px] text-foreground/80">{field.label}</label>
                  <div className="col-span-2">
                    {field.type === "toggle" ? (
                      <div className={`h-5 w-9 rounded-full relative cursor-pointer ${field.defaultValue ? 'bg-blue-600' : 'bg-muted border border-border/80'}`}>
                        <div className={`absolute top-0.5 h-4 w-4 rounded-full bg-foreground transition-all ${field.defaultValue ? 'left-4.5' : 'left-0.5'}`} />
                      </div>
                    ) : field.type === "select" ? (
                      <select className="w-full max-w-md rounded-md border border-border bg-surface-2 px-3 py-1.5 font-mono text-[12px] text-foreground outline-none focus:border-[#333]">
                        <option>{field.defaultValue}</option>
                      </select>
                    ) : (
                      <input 
                        type={field.type} 
                        defaultValue={field.defaultValue as string} 
                        className="w-full max-w-md rounded-md border border-border bg-surface-2 px-3 py-1.5 font-mono text-[12px] text-foreground outline-none focus:border-[#333]" 
                      />
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
