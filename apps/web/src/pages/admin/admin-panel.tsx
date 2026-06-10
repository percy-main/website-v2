import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useDocumentMeta } from "@/hooks/use-document-meta.js";
import { useSession } from "@/lib/auth-client";
import { checkPermission } from "@percy-main/shared/auth/permissions";
import { Link, useSearchParams } from "react-router";
import { AccessTab } from "./access-tab";
import { ChargesTab } from "./charges-tab";
import { ContactsTab } from "./contacts-tab";
import { ContentTab } from "./content-tab";
import { DocumentsTab } from "./documents-tab";
import { DuplicatesTab } from "./duplicates-tab";
import { ExpenseHistoryTab } from "./expense-history-tab";
import { FantasyTab } from "./fantasy-tab";
import { FinancialReliefTab } from "./financial-relief-tab";
import { GameReportsTab } from "./game-reports-tab";
import { GroupsTab } from "./groups-tab";
import { IncidentsTab } from "./incidents-tab";
import { JuniorsTab } from "./juniors-tab";
import { LeadsTab } from "./leads-tab";
import { MarketingOutboxTab } from "./marketing-outbox-tab";
import { MatchFeesTab } from "./match-fees-tab";
import { MembersTab } from "./members-tab";
import { RecordLinkingTab } from "./record-linking-tab";
import { SponsorshipsTab } from "./sponsorships-tab";
import { TreasurerTab } from "./treasurer-tab";

interface SubTabDef {
  value: string;
  label: string;
  /**
   * Whether the current user's role has the BE permission this sub-tab's API
   * requires. Mirrors the backend requirePermission gates so we never show a
   * tab whose data won't load. Sub-tabs without an explicit gate return true.
   */
  visible: (role: string | null) => boolean;
  render: () => React.ReactNode;
}

interface SectionDef {
  value: string;
  label: string;
  subTabs: readonly SubTabDef[];
}

const SECTIONS: readonly SectionDef[] = [
  {
    value: "people",
    label: "People",
    subTabs: [
      {
        value: "members",
        label: "Members",
        visible: (role) => checkPermission(role, "users", "view"),
        render: () => <MembersTab />,
      },
      {
        value: "groups",
        label: "Groups",
        visible: (role) => checkPermission(role, "users", "manage"),
        render: () => <GroupsTab />,
      },
      {
        value: "juniors",
        label: "Juniors",
        visible: (role) => checkPermission(role, "juniors", "view"),
        render: () => <JuniorsTab />,
      },
      {
        value: "duplicates",
        label: "Duplicates",
        visible: (role) => checkPermission(role, "users", "manage"),
        render: () => <DuplicatesTab />,
      },
      {
        value: "record-linking",
        label: "Record Linking",
        visible: (role) => checkPermission(role, "users", "manage"),
        render: () => <RecordLinkingTab />,
      },
    ],
  },
  {
    value: "outreach",
    label: "Outreach",
    subTabs: [
      {
        value: "leads",
        label: "Leads",
        visible: (role) => checkPermission(role, "marketing", "view"),
        render: () => <LeadsTab />,
      },
      {
        value: "contacts",
        label: "Contacts",
        visible: (role) => checkPermission(role, "marketing", "view"),
        render: () => <ContactsTab />,
      },
      {
        value: "marketing-outbox",
        label: "Marketing Outbox",
        visible: (role) => checkPermission(role, "marketing", "view"),
        render: () => <MarketingOutboxTab />,
      },
    ],
  },
  {
    value: "finance",
    label: "Finance",
    subTabs: [
      {
        value: "overview",
        label: "Overview",
        visible: (role) => checkPermission(role, "finance", "manage"),
        render: () => <TreasurerTab />,
      },
      {
        value: "charges",
        label: "Charges",
        visible: (role) => checkPermission(role, "finance", "view"),
        render: () => <ChargesTab />,
      },
      {
        value: "financial-relief",
        label: "Financial Relief",
        visible: (role) => checkPermission(role, "finance", "manage"),
        render: () => <FinancialReliefTab />,
      },
      {
        value: "sponsorships",
        label: "Sponsorships",
        visible: (role) => checkPermission(role, "finance", "manage"),
        render: () => <SponsorshipsTab />,
      },
      {
        value: "expenses",
        label: "Expenses",
        visible: (role) => checkPermission(role, "finance", "manage"),
        render: () => <ExpenseHistoryTab />,
      },
      {
        value: "match-fees",
        label: "Match Donations",
        visible: (role) => checkPermission(role, "finance", "view"),
        render: () => <MatchFeesTab />,
      },
    ],
  },
  {
    value: "cricket",
    label: "Cricket",
    subTabs: [
      {
        value: "game-reports",
        label: "Game Reports",
        visible: (role) => checkPermission(role, "matchday", "view"),
        render: () => <GameReportsTab />,
      },
      {
        value: "fantasy",
        label: "Fantasy",
        visible: (role) => checkPermission(role, "fantasy", "manage"),
        render: () => <FantasyTab />,
      },
    ],
  },
  {
    value: "content",
    label: "Content",
    subTabs: [
      {
        value: "game-reports",
        label: "Match Reports",
        visible: (role) => checkPermission(role, "content_reports", "view"),
        render: () => <ContentTab kind="game_report" />,
      },
    ],
  },
  {
    value: "compliance",
    label: "Compliance",
    subTabs: [
      {
        value: "incidents",
        label: "Incidents",
        visible: (role) => checkPermission(role, "incidents", "view"),
        render: () => <IncidentsTab />,
      },
      {
        value: "documents",
        label: "Documents",
        visible: (role) => checkPermission(role, "documents", "manage"),
        render: () => <DocumentsTab />,
      },
    ],
  },
  {
    value: "access",
    label: "Access",
    subTabs: [
      {
        value: "users",
        label: "User Roles",
        visible: (role) => checkPermission(role, "users", "manage_roles"),
        render: () => <AccessTab />,
      },
    ],
  },
];

type SectionValue = (typeof SECTIONS)[number]["value"];

const DEFAULT_SECTION: SectionValue = "people";

function findSection(value: string | null): SectionDef | undefined {
  return SECTIONS.find((s) => s.value === value);
}

function getSection(value: string | null): SectionDef {
  return findSection(value) ?? SECTIONS[0];
}

/**
 * Filter a section's sub-tabs to those the user can actually open. Each
 * sub-tab declares its own permission gate above, mirroring the backend's
 * requirePermission. A section is visible iff at least one of its sub-tabs
 * is.
 */
function visibleSubTabs(
  section: SectionDef,
  role: string | null,
): readonly SubTabDef[] {
  return section.subTabs.filter((t) => t.visible(role));
}

export function Component() {
  useDocumentMeta("Admin Panel");
  const { data: session } = useSession();
  const [searchParams, setSearchParams] = useSearchParams();

  const role =
    (session?.user as { role?: string | null } | undefined)?.role ?? null;
  const sectionsWithVisibleSubTabs = SECTIONS.reduce<
    Array<{ section: SectionDef; subTabs: readonly SubTabDef[] }>
  >((acc, s) => {
    const subTabs = visibleSubTabs(s, role);
    if (subTabs.length > 0) acc.push({ section: s, subTabs });
    return acc;
  }, []);

  const sectionParam = searchParams.get("section");
  const requestedSection = getSection(sectionParam);
  const current =
    sectionsWithVisibleSubTabs.find(
      (s) => s.section.value === requestedSection.value,
    ) ?? sectionsWithVisibleSubTabs[0];

  const subParam = searchParams.get("sub");
  const subTab = current
    ? (current.subTabs.find((s) => s.value === subParam) ?? current.subTabs[0])
    : undefined;

  const onSectionChange = (value: string) => {
    const next = sectionsWithVisibleSubTabs.find(
      (s) => s.section.value === value,
    );
    if (!next) return;
    const params = new URLSearchParams();
    if (next.section.value !== DEFAULT_SECTION)
      params.set("section", next.section.value);
    // Push, don't replace: tab navigation should be retraceable with the
    // browser back button.
    setSearchParams(params);
  };

  const onSubChange = (value: string) => {
    if (!current) return;
    const params = new URLSearchParams();
    if (current.section.value !== DEFAULT_SECTION)
      params.set("section", current.section.value);
    if (value !== current.subTabs[0].value) params.set("sub", value);
    setSearchParams(params);
  };

  if (!session) return null;

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex flex-col items-start justify-stretch gap-4">
        <div className="flex w-full flex-row items-start justify-between">
          <h1>Admin Panel</h1>
          <div className="flex flex-row flex-wrap gap-4">
            <Link
              className="rounded border border-stone-800 px-4 py-2 text-sm text-stone-900 hover:bg-stone-200"
              to="/members"
            >
              Members Area
            </Link>
          </div>
        </div>
        {current && subTab ? (
          <Tabs
            value={current.section.value}
            onValueChange={onSectionChange}
            className="w-full"
          >
            <TabsList>
              {sectionsWithVisibleSubTabs.map((s) => (
                <TabsTrigger key={s.section.value} value={s.section.value}>
                  {s.section.label}
                </TabsTrigger>
              ))}
            </TabsList>

            {sectionsWithVisibleSubTabs.map((s) => (
              <TabsContent key={s.section.value} value={s.section.value}>
                {s.section.value === current.section.value && (
                  <Tabs
                    value={subTab.value}
                    onValueChange={onSubChange}
                    className="w-full"
                  >
                    <TabsList className="mt-4">
                      {s.subTabs.map((sub) => (
                        <TabsTrigger key={sub.value} value={sub.value}>
                          {sub.label}
                        </TabsTrigger>
                      ))}
                    </TabsList>
                    {s.subTabs.map((sub) => (
                      <TabsContent key={sub.value} value={sub.value}>
                        {sub.value === subTab.value && sub.render()}
                      </TabsContent>
                    ))}
                  </Tabs>
                )}
              </TabsContent>
            ))}
          </Tabs>
        ) : (
          <p className="text-stone-700">
            You don&apos;t have access to any admin sections.
          </p>
        )}
      </div>
    </div>
  );
}
