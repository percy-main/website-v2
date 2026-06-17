import { Kicker, StampButton } from "@/components/theme/bits.js";
import { RisoHeading } from "@/components/theme/riso-heading.js";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { useMutation } from "@tanstack/react-query";
import { useReducer } from "react";
import { Link } from "react-router";

type ReporterRelationship =
  | "member"
  | "parent_or_guardian"
  | "player"
  | "coach_or_volunteer"
  | "visitor"
  | "other";

type AffectedRelationship =
  | "trustee"
  | "member"
  | "volunteer"
  | "visitor"
  | "contractor"
  | "other";

type IncidentType =
  | "injury"
  | "near_miss"
  | "dangerous_occurrence"
  | "ill_health"
  | "property_damage";

type InjurySeverity = "minor" | "serious" | "fatal";

// eslint-disable-next-line react-doctor/no-giant-component -- public H&S incident report: 26-field single-submission form covering reporter / affected / incident / injury / actions / declaration sections. All fields submit together with one validation lifecycle, and the form stays accessible without auth so we keep state colocated.
export function Component() {
  useDocumentMeta(
    "Report an accident or incident",
    "Report an accident, injury, near miss or safety concern at Percy Main Community Sports Club.",
  );

  interface ReportFormState {
    reporterName: string;
    reporterEmail: string;
    reporterPhone: string;
    reporterRelationship: ReporterRelationship;
    prefersNoContact: boolean;
    affectedName: string;
    affectedRelationship: AffectedRelationship | "";
    affectedContact: string;
    affectedIsMinor: boolean;
    occurredAt: string;
    location: string;
    activity: string;
    incidentType: IncidentType;
    description: string;
    injuryOccurred: boolean;
    natureOfInjury: string;
    bodyPartsAffected: string;
    injurySeverity: InjurySeverity | "";
    firstAidGiven: boolean;
    firstAiderName: string;
    firstAidDetails: string;
    medicalTreatmentRequired: boolean;
    immediateActions: string;
    witnesses: string;
    declarationConfirmed: boolean;
    /** Honeypot — bots tend to fill this, humans leave it blank. */
    website: string;
  }

  const [form, update] = useReducer(
    (s: ReportFormState, p: Partial<ReportFormState>) => ({ ...s, ...p }),
    {
      reporterName: "",
      reporterEmail: "",
      reporterPhone: "",
      reporterRelationship: "member",
      prefersNoContact: false,
      affectedName: "",
      affectedRelationship: "",
      affectedContact: "",
      affectedIsMinor: false,
      occurredAt: "",
      location: "",
      activity: "",
      incidentType: "injury",
      description: "",
      injuryOccurred: false,
      natureOfInjury: "",
      bodyPartsAffected: "",
      injurySeverity: "",
      firstAidGiven: false,
      firstAiderName: "",
      firstAidDetails: "",
      medicalTreatmentRequired: false,
      immediateActions: "",
      witnesses: "",
      declarationConfirmed: false,
      website: "",
    },
  );
  const {
    reporterName,
    reporterEmail,
    reporterPhone,
    reporterRelationship,
    prefersNoContact,
    affectedName,
    affectedRelationship,
    affectedContact,
    affectedIsMinor,
    occurredAt,
    location,
    activity,
    incidentType,
    description,
    injuryOccurred,
    natureOfInjury,
    bodyPartsAffected,
    injurySeverity,
    firstAidGiven,
    firstAiderName,
    firstAidDetails,
    medicalTreatmentRequired,
    immediateActions,
    witnesses,
    declarationConfirmed,
    website,
  } = form;

  // Fire-and-forget: public submission with no in-app cached list to refresh.
  // eslint-disable-next-line react-doctor/query-mutation-missing-invalidation -- public-facing submission; the admin incidents list is on a separate page and refetches on mount
  const submit = useMutation({
    mutationFn: () => {
      const occurredIso = occurredAt
        ? new Date(occurredAt).toISOString()
        : new Date().toISOString();
      return callApi(
        api.POST("/api/incident-report", {
          body: {
            reporterName,
            reporterEmail,
            ...(reporterPhone ? { reporterPhone } : {}),
            reporterRelationship,
            prefersNoContact,
            ...(affectedName ? { affectedName } : {}),
            ...(affectedRelationship ? { affectedRelationship } : {}),
            ...(affectedContact ? { affectedContact } : {}),
            affectedIsMinor,
            occurredAt: occurredIso,
            location,
            ...(activity ? { activity } : {}),
            incidentType,
            description,
            injuryOccurred,
            ...(natureOfInjury ? { natureOfInjury } : {}),
            ...(bodyPartsAffected ? { bodyPartsAffected } : {}),
            ...(injurySeverity ? { injurySeverity } : {}),
            firstAidGiven,
            ...(firstAiderName ? { firstAiderName } : {}),
            ...(firstAidDetails ? { firstAidDetails } : {}),
            medicalTreatmentRequired,
            ...(immediateActions ? { immediateActions } : {}),
            ...(witnesses ? { witnesses } : {}),
            declarationConfirmed: true as const,
            ...(website ? { website } : {}),
          },
        }),
      );
    },
  });

  function handleSubmit(e: React.SyntheticEvent) {
    e.preventDefault();
    if (!declarationConfirmed) return;
    submit.mutate();
  }

  if (submit.isSuccess) {
    return (
      <div className="container mx-auto max-w-2xl px-4 py-8">
        <h1 className="fc-two-tone">Thank you</h1>
        <p className="mt-4">
          Your report has been received. We&rsquo;ve sent a confirmation to the
          email address you provided. The club trustees will review it and, if
          needed, be in touch using the contact details you gave us.
        </p>
        <p className="mt-4">
          <Link
            className="text-primary decoration-cta/70 hover:text-cta underline underline-offset-2"
            to="/"
          >
            Back to the home page
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-2xl px-4 py-8">
      <RisoHeading as="h1">Report an accident or incident</RisoHeading>

      <Alert variant="destructive" className="mt-4">
        <AlertDescription>
          <strong>If this is an emergency, call 999 first.</strong> Use this
          form to log accidents, injuries, near misses, or safety concerns after
          anyone in immediate danger is safe.
        </AlertDescription>
      </Alert>

      <p className="text-muted mt-4 text-sm">
        This form is for reporting something that has already happened at, or in
        connection with, the club. The information you submit will be used by
        the club to record, review and respond to accidents, incidents and
        safety concerns. See our{" "}
        <Link
          className="text-primary decoration-cta/70 hover:text-cta underline underline-offset-2"
          to="/legal/privacy"
        >
          privacy policy
        </Link>{" "}
        for how we handle this information.
      </p>

      <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-6">
        {/* Honeypot — visually hidden, bots tend to fill it. */}
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            left: "-10000px",
            top: "auto",
            width: "1px",
            height: "1px",
            overflow: "hidden",
          }}
        >
          <label>
            Website
            <input
              type="text"
              tabIndex={-1}
              autoComplete="off"
              value={website}
              onChange={(e) => update({ website: e.target.value })}
            />
          </label>
        </div>

        <section className="flex flex-col gap-3">
          <Kicker>About you</Kicker>
          <FieldRow>
            <Field>
              <Label htmlFor="reporterName">Your name *</Label>
              <Input
                id="reporterName"
                required
                value={reporterName}
                onChange={(e) => update({ reporterName: e.target.value })}
              />
            </Field>
            <Field>
              <Label htmlFor="reporterRelationship">
                Your relationship to the club *
              </Label>
              <Select
                value={reporterRelationship}
                onValueChange={(v) =>
                  update({ reporterRelationship: v as ReporterRelationship })
                }
              >
                <SelectTrigger id="reporterRelationship">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="member">Member</SelectItem>
                  <SelectItem value="parent_or_guardian">
                    Parent or guardian
                  </SelectItem>
                  <SelectItem value="player">Player</SelectItem>
                  <SelectItem value="coach_or_volunteer">
                    Coach or volunteer
                  </SelectItem>
                  <SelectItem value="visitor">Visitor</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </FieldRow>
          <FieldRow>
            <Field>
              <Label htmlFor="reporterEmail">Email *</Label>
              <Input
                id="reporterEmail"
                type="email"
                required
                value={reporterEmail}
                onChange={(e) => update({ reporterEmail: e.target.value })}
              />
            </Field>
            <Field>
              <Label htmlFor="reporterPhone">Phone</Label>
              <Input
                id="reporterPhone"
                type="tel"
                value={reporterPhone}
                onChange={(e) => update({ reporterPhone: e.target.value })}
              />
            </Field>
          </FieldRow>
          <div className="flex items-start gap-2">
            <Checkbox
              id="prefersNoContact"
              className="mt-1"
              checked={prefersNoContact}
              onCheckedChange={(v) => update({ prefersNoContact: v === true })}
            />
            <Label htmlFor="prefersNoContact" className="leading-snug">
              I&rsquo;d prefer not to be contacted about this report. (We still
              need your contact details for our records, but we won&rsquo;t
              reach out unless we have to.)
            </Label>
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <Kicker>Details of the injured / affected person</Kicker>
          <FieldRow>
            <Field>
              <Label htmlFor="affectedName">
                Full name (if different from you)
              </Label>
              <Input
                id="affectedName"
                value={affectedName}
                onChange={(e) => update({ affectedName: e.target.value })}
                placeholder="Leave blank if this was you, or unknown"
              />
            </Field>
            <Field>
              <Label htmlFor="affectedRelationship">Role / relationship</Label>
              <Select
                value={affectedRelationship}
                onValueChange={(v) =>
                  update({ affectedRelationship: v as AffectedRelationship })
                }
              >
                <SelectTrigger id="affectedRelationship">
                  <SelectValue placeholder="Select…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="trustee">Trustee</SelectItem>
                  <SelectItem value="member">Member</SelectItem>
                  <SelectItem value="volunteer">Volunteer</SelectItem>
                  <SelectItem value="visitor">Visitor</SelectItem>
                  <SelectItem value="contractor">Contractor</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </FieldRow>
          <Field>
            <Label htmlFor="affectedContact">Contact details (if known)</Label>
            <Input
              id="affectedContact"
              value={affectedContact}
              onChange={(e) => update({ affectedContact: e.target.value })}
              placeholder="Email and/or phone number"
            />
          </Field>
          <div className="flex items-center gap-2">
            <Checkbox
              id="affectedIsMinor"
              checked={affectedIsMinor}
              onCheckedChange={(v) => update({ affectedIsMinor: v === true })}
            />
            <Label htmlFor="affectedIsMinor">
              The person affected is under 18
            </Label>
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <Kicker>Accident / incident details</Kicker>
          <FieldRow>
            <Field>
              <Label htmlFor="occurredAt">When did it happen? *</Label>
              <Input
                id="occurredAt"
                type="datetime-local"
                required
                value={occurredAt}
                onChange={(e) => update({ occurredAt: e.target.value })}
              />
            </Field>
            <Field>
              <Label htmlFor="location">Exact location *</Label>
              <Input
                id="location"
                required
                value={location}
                onChange={(e) => update({ location: e.target.value })}
                placeholder="e.g. Main pitch, clubhouse, nets"
              />
            </Field>
          </FieldRow>
          <FieldRow>
            <Field>
              <Label htmlFor="incidentType">Type of incident *</Label>
              <Select
                value={incidentType}
                onValueChange={(v) =>
                  update({ incidentType: v as IncidentType })
                }
              >
                <SelectTrigger id="incidentType">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="injury">Injury</SelectItem>
                  <SelectItem value="near_miss">Near miss</SelectItem>
                  <SelectItem value="dangerous_occurrence">
                    Dangerous occurrence
                  </SelectItem>
                  <SelectItem value="ill_health">Ill health</SelectItem>
                  <SelectItem value="property_damage">
                    Property damage
                  </SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <Label htmlFor="activity">Activity (if any)</Label>
              <Input
                id="activity"
                value={activity}
                onChange={(e) => update({ activity: e.target.value })}
                placeholder="e.g. Junior training, match day, maintenance"
              />
            </Field>
          </FieldRow>
          <Field>
            <Label htmlFor="description">Describe what happened *</Label>
            <Textarea
              id="description"
              required
              rows={5}
              value={description}
              onChange={(e) => update({ description: e.target.value })}
            />
          </Field>
        </section>

        <section className="flex flex-col gap-3">
          <Kicker>Injury or ill health details</Kicker>
          <div className="flex items-center gap-2">
            <Checkbox
              id="injuryOccurred"
              checked={injuryOccurred}
              onCheckedChange={(v) => update({ injuryOccurred: v === true })}
            />
            <Label htmlFor="injuryOccurred">
              Someone was injured or unwell
            </Label>
          </div>
          {injuryOccurred && (
            <>
              <Field>
                <Label htmlFor="natureOfInjury">
                  Nature of injury or condition
                </Label>
                <Textarea
                  id="natureOfInjury"
                  rows={2}
                  value={natureOfInjury}
                  onChange={(e) => update({ natureOfInjury: e.target.value })}
                  placeholder="e.g. sprained ankle, cut to the head, asthma attack"
                />
              </Field>
              <FieldRow>
                <Field>
                  <Label htmlFor="bodyPartsAffected">
                    Part(s) of body affected
                  </Label>
                  <Input
                    id="bodyPartsAffected"
                    value={bodyPartsAffected}
                    onChange={(e) =>
                      update({ bodyPartsAffected: e.target.value })
                    }
                  />
                </Field>
                <Field>
                  <Label htmlFor="injurySeverity">Severity</Label>
                  <Select
                    value={injurySeverity}
                    onValueChange={(v) =>
                      update({ injurySeverity: v as InjurySeverity })
                    }
                  >
                    <SelectTrigger id="injurySeverity">
                      <SelectValue placeholder="Select…" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="minor">Minor</SelectItem>
                      <SelectItem value="serious">Serious</SelectItem>
                      <SelectItem value="fatal">Fatal</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              </FieldRow>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="medicalTreatmentRequired"
                  checked={medicalTreatmentRequired}
                  onCheckedChange={(v) =>
                    update({ medicalTreatmentRequired: v === true })
                  }
                />
                <Label htmlFor="medicalTreatmentRequired">
                  Medical treatment was required
                </Label>
              </div>
            </>
          )}
          <div className="flex items-center gap-2">
            <Checkbox
              id="firstAidGiven"
              checked={firstAidGiven}
              onCheckedChange={(v) => update({ firstAidGiven: v === true })}
            />
            <Label htmlFor="firstAidGiven">First aid was given</Label>
          </div>
          {firstAidGiven && (
            <>
              <Field>
                <Label htmlFor="firstAiderName">Given by (name)</Label>
                <Input
                  id="firstAiderName"
                  value={firstAiderName}
                  onChange={(e) => update({ firstAiderName: e.target.value })}
                />
              </Field>
              <Field>
                <Label htmlFor="firstAidDetails">
                  First aid details (if any)
                </Label>
                <Textarea
                  id="firstAidDetails"
                  rows={2}
                  value={firstAidDetails}
                  onChange={(e) => update({ firstAidDetails: e.target.value })}
                />
              </Field>
            </>
          )}
        </section>

        <section className="flex flex-col gap-3">
          <Kicker>Immediate actions and witnesses</Kicker>
          <Field>
            <Label htmlFor="immediateActions">
              Details of any immediate actions taken
            </Label>
            <Textarea
              id="immediateActions"
              rows={3}
              value={immediateActions}
              onChange={(e) => update({ immediateActions: e.target.value })}
            />
          </Field>
          <Field>
            <Label htmlFor="witnesses">
              Witnesses: names, relationship and contact details if known
            </Label>
            <Textarea
              id="witnesses"
              rows={3}
              value={witnesses}
              onChange={(e) => update({ witnesses: e.target.value })}
            />
          </Field>
        </section>

        <section className="flex flex-col gap-3">
          <Kicker>Declaration</Kicker>
          <div className="border-primary bg-surface flex items-start gap-3 border-2 p-4">
            <Checkbox
              id="declarationConfirmed"
              className="mt-1"
              checked={declarationConfirmed}
              onCheckedChange={(v) =>
                update({ declarationConfirmed: v === true })
              }
            />
            <Label
              htmlFor="declarationConfirmed"
              className="text-sm leading-relaxed font-normal"
            >
              I confirm that the information provided in this accident/incident
              report is true and accurate to the best of my knowledge and
              belief. I understand that this record may be used for health and
              safety management, investigation purposes, insurance, and where
              necessary to meet statutory reporting requirements under UK health
              and safety legislation (including RIDDOR 2013). *
            </Label>
          </div>
        </section>

        {submit.isError && (
          <Alert variant="destructive">
            <AlertDescription>
              Sorry, something went wrong submitting your report. Please try
              again, or email the trustees directly at{" "}
              <a className="underline" href="mailto:trustees@percymain.org">
                trustees@percymain.org
              </a>
              .
            </AlertDescription>
          </Alert>
        )}

        <div className="flex justify-end">
          <StampButton
            type="submit"
            size="sm"
            disabled={submit.isPending || !declarationConfirmed}
          >
            {submit.isPending ? "Submitting…" : "Submit report →"}
          </StampButton>
        </div>
      </form>
    </div>
  );
}

function Field({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col gap-1">{children}</div>;
}

function FieldRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">{children}</div>
  );
}
