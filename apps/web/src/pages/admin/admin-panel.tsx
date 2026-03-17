import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSession } from "@/lib/auth-client";
import { Link, useSearchParams } from "react-router";
import { ChargesTab } from "./charges-tab";
import { FantasyTab } from "./fantasy-tab";
import { JuniorsTab } from "./juniors-tab";
import { MembersTab } from "./members-tab";
import { RecordLinkingTab } from "./record-linking-tab";
import { SponsorshipsTab } from "./sponsorships-tab";
import { TreasurerTab } from "./treasurer-tab";

const TABS = [
  "members",
  "juniors",
  "charges",
  "contacts",
  "sponsorships",
  "duplicates",
  "match-fees",
  "record-linking",
  "game-reports",
  "treasurer",
  "fantasy",
] as const;
type Tab = (typeof TABS)[number];

const ACTIVE_TABS: Tab[] = [
  "members",
  "juniors",
  "charges",
  "sponsorships",
  "treasurer",
  "fantasy",
  "record-linking",
];

function isValidTab(value: string | null): value is Tab {
  return TABS.includes(value as Tab);
}

export function Component() {
  const { data: session } = useSession();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const tab: Tab = isValidTab(tabParam) ? tabParam : "members";

  const onTabChange = (value: string) => {
    setSearchParams(value === "members" ? {} : { tab: value }, {
      replace: true,
    });
  };

  if (!session) return null;

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex flex-col items-start justify-stretch gap-4">
        <div className="flex w-full flex-row items-start justify-between">
          <h1>Admin Panel</h1>
          <div className="flex flex-row flex-wrap gap-4">
            <Link
              className="rounded border border-gray-800 px-4 py-2 text-sm text-gray-900 hover:bg-gray-200"
              to="/members"
            >
              Members Area
            </Link>
          </div>
        </div>
        <Tabs value={tab} onValueChange={onTabChange} className="w-full">
          <TabsList className="flex flex-wrap gap-1">
            <TabsTrigger value="members">Members</TabsTrigger>
            <TabsTrigger value="juniors">Juniors</TabsTrigger>
            <TabsTrigger value="charges">Charges</TabsTrigger>
            <TabsTrigger value="contacts">Contacts</TabsTrigger>
            <TabsTrigger value="sponsorships">Sponsorships</TabsTrigger>
            <TabsTrigger value="duplicates">Duplicates</TabsTrigger>
            <TabsTrigger value="match-fees">Match Fees</TabsTrigger>
            <TabsTrigger value="record-linking">Record Linking</TabsTrigger>
            <TabsTrigger value="game-reports">Game Reports</TabsTrigger>
            <TabsTrigger value="treasurer">Treasurer</TabsTrigger>
            <TabsTrigger value="fantasy">Fantasy</TabsTrigger>
          </TabsList>

          <TabsContent value="members">
            <MembersTab />
          </TabsContent>
          <TabsContent value="juniors">
            <JuniorsTab />
          </TabsContent>
          <TabsContent value="charges">
            <ChargesTab />
          </TabsContent>
          <TabsContent value="sponsorships">
            <SponsorshipsTab />
          </TabsContent>
          <TabsContent value="treasurer">
            <TreasurerTab />
          </TabsContent>
          <TabsContent value="fantasy">
            <FantasyTab />
          </TabsContent>
          <TabsContent value="record-linking">
            <RecordLinkingTab />
          </TabsContent>

          {TABS.filter((t) => !ACTIVE_TABS.includes(t)).map((t) => (
            <TabsContent key={t} value={t}>
              <div className="py-12 text-center text-gray-500">
                Coming soon — this tab will be available in a future update.
              </div>
            </TabsContent>
          ))}
        </Tabs>
      </div>
    </div>
  );
}
