import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useDocumentMeta } from "@/hooks/use-document-meta.js";
import { api, callApi } from "@/lib/api-client";
import {
  CONTACT_PREFERENCES,
  CONTACT_PREFERENCE_LABELS,
  CONTRIBUTION_ABILITIES,
  CONTRIBUTION_ABILITY_LABELS,
  DURATIONS,
  DURATION_LABELS,
  REASON_CATEGORIES,
  REASON_CATEGORY_LABELS,
  REQUEST_STATUS_LABELS,
  VOLUNTEER_OPTIONS,
  VOLUNTEER_OPTION_LABELS,
  type ContactPreference,
  type ContributionAbility,
  type Duration,
  type ReasonCategory,
  type VolunteerOption,
} from "@percy-main/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useReducer } from "react";
import { Link } from "react-router";

interface FormState {
  memberId: string;
  requestedMembershipFull: boolean;
  requestedMembershipPartial: boolean;
  requestedMatchFees: boolean;
  partialAmountPounds: string;
  reasonCategory: ReasonCategory | "";
  reasonText: string;
  duration: Duration | "";
  durationOtherText: string;
  contributionAbility: ContributionAbility | "";
  contributionAmountPounds: string;
  volunteerOptions: VolunteerOption[];
  volunteerNotes: string;
  contactPreference: ContactPreference;
  privacyAcknowledged: boolean;
  declarationConfirmed: boolean;
}

const initialState: FormState = {
  memberId: "",
  requestedMembershipFull: false,
  requestedMembershipPartial: false,
  requestedMatchFees: false,
  partialAmountPounds: "",
  reasonCategory: "",
  reasonText: "",
  duration: "",
  durationOtherText: "",
  contributionAbility: "",
  contributionAmountPounds: "",
  volunteerOptions: [],
  volunteerNotes: "",
  contactPreference: "none",
  privacyAcknowledged: false,
  declarationConfirmed: false,
};

function poundsToPence(input: string): number | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed * 100);
}

// eslint-disable-next-line react-doctor/no-giant-component -- single multi-section relief application form; sections share validation state and a single submit
export function Component() {
  useDocumentMeta(
    "Financial relief request",
    "Ask the club for support with membership or match donation costs.",
  );

  const queryClient = useQueryClient();

  const eligibleQuery = useQuery({
    queryKey: ["financial-relief", "eligible-members"],
    queryFn: () => callApi(api.GET("/api/financial-relief/eligible-members")),
  });

  const myStatusQuery = useQuery({
    queryKey: ["financial-relief", "me"],
    queryFn: () => callApi(api.GET("/api/financial-relief/me")),
  });

  const [form, update] = useReducer(
    (s: FormState, p: Partial<FormState>) => ({ ...s, ...p }),
    initialState,
  );

  const eligibleMembers = eligibleQuery.data?.members ?? [];

  // Auto-select the only option if there's just one (the account holder).
  const effectiveMemberId =
    form.memberId ||
    (eligibleMembers.length === 1 ? eligibleMembers[0].memberId : "");

  const submit = useMutation({
    mutationFn: () =>
      callApi(
        api.POST("/api/financial-relief/requests", {
          body: {
            memberId: effectiveMemberId,
            requestedMembershipFull: form.requestedMembershipFull,
            requestedMembershipPartial: form.requestedMembershipPartial,
            requestedMatchFees: form.requestedMatchFees,
            partialAmountPence: form.requestedMembershipPartial
              ? poundsToPence(form.partialAmountPounds)
              : null,
            reasonCategory: form.reasonCategory || null,
            reasonText: form.reasonText || null,
            duration: form.duration || null,
            durationOtherText:
              form.duration === "other" ? form.durationOtherText || null : null,
            contributionAbility: form.contributionAbility || null,
            contributionAmountPence:
              form.contributionAbility === "yes_reduced"
                ? poundsToPence(form.contributionAmountPounds)
                : null,
            volunteerOptions: form.volunteerOptions,
            volunteerNotes: form.volunteerNotes || null,
            contactPreference: form.contactPreference,
            privacyAcknowledged: true as const,
            declarationConfirmed: true as const,
          },
        }),
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["financial-relief"] });
    },
  });

  const supportTypeChosen =
    form.requestedMembershipFull ||
    form.requestedMembershipPartial ||
    form.requestedMatchFees;

  const canSubmit =
    !!effectiveMemberId &&
    supportTypeChosen &&
    form.privacyAcknowledged &&
    form.declarationConfirmed &&
    !submit.isPending;

  const openRequest = useMemo(
    () =>
      myStatusQuery.data?.requests.find((r) =>
        ["submitted", "in_review", "more_info_needed", "approved"].includes(
          r.status,
        ),
      ) ?? null,
    [myStatusQuery.data?.requests],
  );

  function toggleVolunteer(option: VolunteerOption, checked: boolean) {
    update({
      volunteerOptions: checked
        ? [...form.volunteerOptions, option]
        : form.volunteerOptions.filter((o) => o !== option),
    });
  }

  if (submit.isSuccess) {
    return (
      <div className="container mx-auto max-w-2xl px-4 py-8">
        <h1>Thank you</h1>
        <p className="mt-4">
          We&rsquo;ve received your request and a committee member will review
          it shortly. We&rsquo;ll be in touch when there&rsquo;s news, using the
          email address on your account.
        </p>
        <p className="mt-4">
          You don&rsquo;t need to do anything else for now.
        </p>
        <p className="mt-6">
          <Link className="text-blue-900 underline" to="/members">
            Back to your members area
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-2xl px-4 py-8">
      <h1>Financial relief request</h1>

      <p className="mt-4 text-sm text-stone-700">
        Use this form if paying full club fees would make it hard for you or a
        member of your family to take part at Percy Main. You don&rsquo;t need
        to share detailed financial information. A short explanation is enough.
      </p>

      {myStatusQuery.data?.requests.length ? (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="text-base">Your current requests</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {myStatusQuery.data.requests.map((r) => (
              <div key={r.id} className="flex flex-col gap-1 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{r.memberName ?? "—"}</span>
                  <Badge variant="secondary">
                    {REQUEST_STATUS_LABELS[r.status]}
                  </Badge>
                </div>
                {r.memberFacingNote ? (
                  <p className="text-stone-700">{r.memberFacingNote}</p>
                ) : null}
                {r.activeGrant ? (
                  <p className="text-stone-700">
                    Support is in place
                    {r.activeGrant.coversMatchFees
                      ? " for match donations"
                      : ""}
                    {r.activeGrant.coversMembership ? " for membership" : ""}.
                  </p>
                ) : null}
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {openRequest ? (
        <Alert className="mt-6">
          <AlertDescription>
            You already have an open request. Please wait for the committee to
            review it before sending another.
          </AlertDescription>
        </Alert>
      ) : (
        <form
          className="mt-6 flex flex-col gap-6"
          onSubmit={(e) => {
            e.preventDefault();
            if (canSubmit) submit.mutate();
          }}
        >
          {/* 1. Member being supported */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Who is this request for?
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {eligibleQuery.isLoading ? (
                <p className="text-sm text-stone-600">
                  Loading members&hellip;
                </p>
              ) : eligibleMembers.length === 0 ? (
                <p className="text-sm text-stone-600">
                  We can&rsquo;t find a club record matching your account.
                  Please contact the club committee.
                </p>
              ) : eligibleMembers.length === 1 ? (
                <p className="text-sm text-stone-700">
                  {eligibleMembers[0].name}
                </p>
              ) : (
                <Select
                  value={form.memberId}
                  onValueChange={(v) => update({ memberId: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Choose a member" />
                  </SelectTrigger>
                  <SelectContent>
                    {eligibleMembers.map((m) => (
                      <SelectItem key={m.memberId} value={m.memberId}>
                        {m.name ?? m.memberId}
                        {m.relationship === "junior" ? " (junior)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </CardContent>
          </Card>

          {/* 2. Type of support requested */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                What kind of support are you asking for?
              </CardTitle>
              <CardDescription>Tick all that apply.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <CheckboxRow
                id="reqMembershipFull"
                checked={form.requestedMembershipFull}
                onChange={(v) =>
                  update({
                    requestedMembershipFull: v,
                    ...(v ? { requestedMembershipPartial: false } : {}),
                  })
                }
                label="Full membership fee relief"
              />
              <CheckboxRow
                id="reqMembershipPartial"
                checked={form.requestedMembershipPartial}
                onChange={(v) =>
                  update({
                    requestedMembershipPartial: v,
                    ...(v ? { requestedMembershipFull: false } : {}),
                  })
                }
                label="Partial membership fee relief"
              />
              {form.requestedMembershipPartial ? (
                <div className="flex flex-col gap-1 pl-7">
                  <Label htmlFor="partialAmount">
                    What level of contribution would be manageable? (in £)
                  </Label>
                  <Input
                    id="partialAmount"
                    type="number"
                    min="0"
                    step="1"
                    value={form.partialAmountPounds}
                    onChange={(e) =>
                      update({ partialAmountPounds: e.target.value })
                    }
                  />
                </div>
              ) : null}
              <CheckboxRow
                id="reqMatchFees"
                checked={form.requestedMatchFees}
                onChange={(v) => update({ requestedMatchFees: v })}
                label="Match donation relief"
              />
            </CardContent>
          </Card>

          {/* 3. Reason */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Why would financial relief help?
              </CardTitle>
              <CardDescription>
                A short explanation is enough. You don&rsquo;t need to provide
                detailed financial information.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <Label htmlFor="reasonCategory">
                  Which of these best describes your situation? (optional)
                </Label>
                <Select
                  value={form.reasonCategory}
                  onValueChange={(v) =>
                    update({ reasonCategory: v as ReasonCategory })
                  }
                >
                  <SelectTrigger id="reasonCategory">
                    <SelectValue placeholder="Choose one (optional)" />
                  </SelectTrigger>
                  <SelectContent>
                    {REASON_CATEGORIES.map((c) => (
                      <SelectItem key={c} value={c}>
                        {REASON_CATEGORY_LABELS[c]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="reasonText">In your own words (optional)</Label>
                <Textarea
                  id="reasonText"
                  rows={4}
                  maxLength={2000}
                  value={form.reasonText}
                  onChange={(e) => update({ reasonText: e.target.value })}
                />
              </div>
            </CardContent>
          </Card>

          {/* 4. Duration */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                How long do you expect to need support for?
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <Select
                value={form.duration}
                onValueChange={(v) => update({ duration: v as Duration })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Choose one" />
                </SelectTrigger>
                <SelectContent>
                  {DURATIONS.map((d) => (
                    <SelectItem key={d} value={d}>
                      {DURATION_LABELS[d]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {form.duration === "other" ? (
                <div className="flex flex-col gap-1">
                  <Label htmlFor="durationOther">Please describe</Label>
                  <Input
                    id="durationOther"
                    value={form.durationOtherText}
                    onChange={(e) =>
                      update({ durationOtherText: e.target.value })
                    }
                  />
                </div>
              ) : null}
            </CardContent>
          </Card>

          {/* 5. Contribution */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Are you able to contribute something towards club costs at this
                time?
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <Select
                value={form.contributionAbility}
                onValueChange={(v) =>
                  update({ contributionAbility: v as ContributionAbility })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Choose one" />
                </SelectTrigger>
                <SelectContent>
                  {CONTRIBUTION_ABILITIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {CONTRIBUTION_ABILITY_LABELS[c]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {form.contributionAbility === "yes_reduced" ? (
                <div className="flex flex-col gap-1">
                  <Label htmlFor="contributionAmount">
                    What amount would be manageable? (in £)
                  </Label>
                  <Input
                    id="contributionAmount"
                    type="number"
                    min="0"
                    step="1"
                    value={form.contributionAmountPounds}
                    onChange={(e) =>
                      update({ contributionAmountPounds: e.target.value })
                    }
                  />
                </div>
              ) : null}
            </CardContent>
          </Card>

          {/* 6. Volunteering */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Could you help the club in non-financial ways?
              </CardTitle>
              <CardDescription>
                This could include ground work, scoring, umpiring, helping at
                junior sessions, fundraising, matchday setup, admin, or other
                volunteering. We understand this isn&rsquo;t possible for
                everyone.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                {VOLUNTEER_OPTIONS.map((option) => (
                  <CheckboxRow
                    key={option}
                    id={`volunteer_${option}`}
                    checked={form.volunteerOptions.includes(option)}
                    onChange={(v) => toggleVolunteer(option, v)}
                    label={VOLUNTEER_OPTION_LABELS[option]}
                  />
                ))}
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="volunteerNotes">
                  Roughly what you could help with and how often (optional)
                </Label>
                <Textarea
                  id="volunteerNotes"
                  rows={3}
                  maxLength={2000}
                  value={form.volunteerNotes}
                  onChange={(e) => update({ volunteerNotes: e.target.value })}
                />
              </div>
            </CardContent>
          </Card>

          {/* 7. Contact preference */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Would you prefer to chat before a decision is made?
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Select
                value={form.contactPreference}
                onValueChange={(v) =>
                  update({ contactPreference: v as ContactPreference })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CONTACT_PREFERENCES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {CONTACT_PREFERENCE_LABELS[c]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardContent>
          </Card>

          {/* 8. Declarations */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Before you submit</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm text-stone-700">
              <p>
                Percy Main Community Sports Club will use the information in
                this form to assess your request, administer any approved
                financial relief, and record the value of fees or charges
                waived. If support is approved, future eligible charges may be
                recorded internally as waived. This allows the club to report
                the total value of support provided without publicly identifying
                individuals.
              </p>
              <p>
                Information about financial relief requests is only visible to
                the relevant club committee members. Where match donation relief
                is approved, the relevant team captain may also be able to see
                that match donations have been waived, so they can administer
                team payments correctly.
              </p>
              <p>
                We will not publish individual names or details when reporting
                on financial relief provided by the club.
              </p>
              <CheckboxRow
                id="privacyAck"
                checked={form.privacyAcknowledged}
                onChange={(v) => update({ privacyAcknowledged: v })}
                label="I&rsquo;ve read and understood the above."
              />
              <CheckboxRow
                id="declarationConfirmed"
                checked={form.declarationConfirmed}
                onChange={(v) => update({ declarationConfirmed: v })}
                label="I confirm that the information provided is accurate to the best of my knowledge and that I will tell the club if my circumstances change."
              />
            </CardContent>
          </Card>

          {submit.error ? (
            <Alert variant="destructive">
              <AlertDescription>
                {submit.error instanceof Error
                  ? submit.error.message
                  : "Something went wrong. Please try again or contact the club."}
              </AlertDescription>
            </Alert>
          ) : null}

          <div className="flex justify-end">
            <Button type="submit" disabled={!canSubmit}>
              {submit.isPending ? "Submitting…" : "Submit request"}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

function CheckboxRow({
  id,
  checked,
  onChange,
  label,
}: {
  id: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <div className="flex items-start gap-2">
      <Checkbox
        id={id}
        className="mt-1"
        checked={checked}
        onCheckedChange={(v) => onChange(v === true)}
      />
      <Label
        htmlFor={id}
        className="leading-snug"
        dangerouslySetInnerHTML={{ __html: label }}
      />
    </div>
  );
}
