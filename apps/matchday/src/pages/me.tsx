import { Button } from "@/components/ui/button.js";
import {
  Card,
  CardContent,
  CardEyebrow,
  CardHeader,
  CardTitle,
} from "@/components/ui/card.js";
import { signOut, useSession } from "@/lib/auth-client.js";
import { mainSiteUrl } from "@/lib/main-site.js";

export default function Me() {
  const { data: session } = useSession();
  const user = session?.user;
  return (
    <div className="mx-auto w-full max-w-md space-y-3 px-4 py-6">
      <Card>
        <CardHeader>
          <CardEyebrow>Account</CardEyebrow>
          <CardTitle>{user?.name ?? "You"}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Row label="Email" value={user?.email ?? "—"} />
          <Row
            label="Role"
            value={
              (user as { role?: string | null } | undefined)?.role ?? "member"
            }
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardEyebrow>Main site</CardEyebrow>
          <CardTitle>Membership & payments</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-text-secondary mb-3 text-sm">
            Member details, donation payments, and admin tools live on the main
            site.
          </p>
          <Button asChild tone="outline" className="w-full">
            <a href={mainSiteUrl("/members")} target="_blank" rel="noopener">
              Open percymain.org ↗
            </a>
          </Button>
        </CardContent>
      </Card>

      <Button
        tone="ghost"
        className="text-danger w-full"
        onClick={() => {
          void signOut().then(() => {
            window.location.href = mainSiteUrl("/");
          });
        }}
      >
        Sign out
      </Button>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-text-secondary">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
