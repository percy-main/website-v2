import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useDocumentMeta } from "@/hooks/use-document-meta.js";
import { useSession } from "@/lib/auth-client";
import { Link, useSearchParams } from "react-router";
import { ChargesTab } from "./charges-tab";
import { ContactsTab } from "./contacts-tab";
import { DocumentsTab } from "./documents-tab";
import { DuplicatesTab } from "./duplicates-tab";
import { ExpenseHistoryTab } from "./expense-history-tab";
import { FantasyTab } from "./fantasy-tab";
import { GameReportsTab } from "./game-reports-tab";
import { IncidentsTab } from "./incidents-tab";
import { JuniorsTab } from "./juniors-tab";
import { LeadsTab } from "./leads-tab";
import { MarketingOutboxTab } from "./marketing-outbox-tab";
import { MatchFeesTab } from "./match-fees-tab";
import { MembersTab } from "./members-tab";
import { RecordLinkingTab } from "./record-linking-tab";
import { SponsorshipsTab } from "./sponsorships-tab";
import { TreasurerTab } from "./treasurer-tab";

interface SectionDef {
  value: string;
  label: string;
  subTabs: Array<{
    value: string;
    label: string;
    render: () => React.ReactNode;
  }>;
}

const SECTIONS = [
  {
    value: "people",
    label: "People",
    subTabs: [
      { value: "members", label: "Members", render: () => <MembersTab /> },
      { value: "juniors", label: "Juniors", render: () => <JuniorsTab /> },
      {
        value: "duplicates",
        label: "Duplicates",
        render: () => <DuplicatesTab />,
      },
      {
        value: "record-linking",
        label: "Record Linking",
        render: () => <RecordLinkingTab />,
      },
    ],
  },
  {
    value: "outreach",
    label: "Outreach",
    subTabs: [
      { value: "leads", label: "Leads", render: () => <LeadsTab /> },
      { value: "contacts", label: "Contacts", render: () => <ContactsTab /> },
      {
        value: "marketing-outbox",
        label: "Marketing Outbox",
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
        render: () => <TreasurerTab />,
      },
      { value: "charges", label: "Charges", render: () => <ChargesTab /> },
      {
        value: "sponsorships",
        label: "Sponsorships",
        render: () => <SponsorshipsTab />,
      },
      {
        value: "expenses",
        label: "Expenses",
        render: () => <ExpenseHistoryTab />,
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
        render: () => <GameReportsTab />,
      },
      {
        value: "match-fees",
        label: "Match Donations",
        render: () => <MatchFeesTab />,
      },
      { value: "fantasy", label: "Fantasy", render: () => <FantasyTab /> },
    ],
  },
  {
    value: "compliance",
    label: "Compliance",
    subTabs: [
      {
        value: "incidents",
        label: "Incidents",
        render: () => <IncidentsTab />,
      },
      {
        value: "documents",
        label: "Documents",
        render: () => <DocumentsTab />,
      },
    ],
  },
] as const satisfies readonly SectionDef[];

type Section = (typeof SECTIONS)[number];
type SectionValue = Section["value"];

const DEFAULT_SECTION: SectionValue = "people";

function findSection(value: string | null): Section | undefined {
  return SECTIONS.find((s) => s.value === value);
}

function getSection(value: string | null): Section {
  return findSection(value) ?? SECTIONS[0];
}

export function Component() {
  useDocumentMeta("Admin Panel");
  const { data: session } = useSession();
  const [searchParams, setSearchParams] = useSearchParams();

  const sectionParam = searchParams.get("section");
  const section = getSection(sectionParam);

  const subParam = searchParams.get("sub");
  const subTab =
    section.subTabs.find((s) => s.value === subParam) ?? section.subTabs[0];

  const onSectionChange = (value: string) => {
    const next = findSection(value);
    if (!next) return;
    const params = new URLSearchParams();
    if (next.value !== DEFAULT_SECTION) params.set("section", next.value);
    setSearchParams(params, { replace: true });
  };

  const onSubChange = (value: string) => {
    const params = new URLSearchParams();
    if (section.value !== DEFAULT_SECTION) params.set("section", section.value);
    if (value !== section.subTabs[0].value) params.set("sub", value);
    setSearchParams(params, { replace: true });
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
        <Tabs
          value={section.value}
          onValueChange={onSectionChange}
          className="w-full"
        >
          <TabsList>
            {SECTIONS.map((s) => (
              <TabsTrigger key={s.value} value={s.value}>
                {s.label}
              </TabsTrigger>
            ))}
          </TabsList>

          {SECTIONS.map((s) => (
            <TabsContent key={s.value} value={s.value}>
              {s.value === section.value && (
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
      </div>
    </div>
  );
}
