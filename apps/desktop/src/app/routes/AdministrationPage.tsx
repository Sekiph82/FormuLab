import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Boxes, ClipboardList, ExternalLink, Scale, Settings, ShieldCheck } from "lucide-react";
import { TestDefinitionsPanel } from "@/components/formula/TestDefinitionsPanel";
import { cn } from "@/lib/cn";

type Section = "overview" | "testDefinitions";
// Bound before the JSX for the same reason as LaboratoryPage.tsx.
const SECTION_OVERVIEW: Section = "overview";
const SECTION_TEST_DEFINITIONS: Section = "testDefinitions";

const LINKS = [
  { key: "materials", icon: Boxes, href: "/materials", titleKey: "administration.links.materials.title", descKey: "administration.links.materials.description" },
  { key: "regulatoryRules", icon: Scale, href: "/regulatory", titleKey: "administration.links.regulatoryRules.title", descKey: "administration.links.regulatoryRules.description" },
  { key: "approvalPolicies", icon: ShieldCheck, href: "/approval", titleKey: "administration.links.approvalPolicies.title", descKey: "administration.links.approvalPolicies.description" },
  { key: "settings", icon: Settings, href: "/settings", titleKey: "administration.links.settings.title", descKey: "administration.links.settings.description" },
] as const;

/**
 * The Administration workspace — configuration that shouldn't clutter daily
 * R&D work. Materials/suppliers/packaging SKUs/factory profiles already
 * have a complete dedicated page (`/materials`); regulatory rule
 * verification/import-export lives in the Regulatory workspace; approval
 * policies live in the Approval workspace. This page links to each rather
 * than re-implementing them, and hosts the one genuinely global,
 * prop-less editor (test definitions) directly. There is no user-management
 * backend in this codebase yet, so no "Users and roles" section is shown —
 * inventing one is out of scope. See docs/WORKSPACES.md.
 */
export function AdministrationPage() {
  const { t } = useTranslation("session");
  const [section, setSection] = useState<Section>("overview");

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-2">
        <h1 className="text-[13px] font-medium text-text">{t("administration.heading")}</h1>
        <div className="flex-1" />
        <nav className="flex gap-1">
          <SectionTab active={section === "overview"} onClick={() => setSection(SECTION_OVERVIEW)} icon={<ClipboardList size={13} />}>
            {t("administration.overview")}
          </SectionTab>
          <SectionTab active={section === "testDefinitions"} onClick={() => setSection(SECTION_TEST_DEFINITIONS)} icon={<ClipboardList size={13} />}>
            {t("builder.tabTests")}
          </SectionTab>
        </nav>
      </header>

      <div className="min-h-0 flex-1">
        {section === "overview" && (
          <div className="mx-auto max-w-2xl px-6 py-6">
            <p className="mb-4 text-[12px] text-muted">{t("administration.description")}</p>
            <ul className="divide-y divide-border-faint rounded-card border border-border">
              {LINKS.map(({ key, icon: Icon, href, titleKey, descKey }) => (
                <li key={key}>
                  <Link to={href} className="flex items-center gap-3 px-4 py-3 text-left hover:bg-surface-2">
                    <Icon size={15} className="text-muted" />
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] text-text">{t(titleKey)}</div>
                      <div className="text-[11px] text-muted">{t(descKey)}</div>
                    </div>
                    <ExternalLink size={13} className="shrink-0 text-muted" />
                  </Link>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-[11px] text-muted">{t("administration.noUserManagement")}</p>
          </div>
        )}
        {section === "testDefinitions" && <TestDefinitionsPanel />}
      </div>
    </div>
  );
}

function SectionTab({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn("flex items-center gap-1.5 rounded-input px-2.5 py-1 text-xs", active ? "bg-surface-2 font-medium text-text" : "text-muted hover:text-text")}
    >
      {icon}
      {children}
    </button>
  );
}
