import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
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
import { useState } from "react";
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

export function Component() {
  useDocumentMeta(
    "Report an accident or incident",
    "Report an accident, injury, near miss or safety concern at Percy Main Community Sports Club.",
  );

  // Reporter
  const [reporterName, setReporterName] = useState("");
  const [reporterEmail, setReporterEmail] = useState("");
  const [reporterPhone, setReporterPhone] = useState("");
  const [reporterRelationship, setReporterRelationship] =
    useState<ReporterRelationship>("member");
  const [prefersNoContact, setPrefersNoContact] = useState(false);

  // Affected
  const [affectedName, setAffectedName] = useState("");
  const [affectedRelationship, setAffectedRelationship] = useState<
    AffectedRelationship | ""
  >("");
  const [affectedContact, setAffectedContact] = useState("");
  const [affectedIsMinor, setAffectedIsMinor] = useState(false);

  // Incident
  const [occurredAt, setOccurredAt] = useState("");
  const [location, setLocation] = useState("");
  const [activity, setActivity] = useState("");
  const [incidentType, setIncidentType] = useState<IncidentType>("injury");
  const [description, setDescription] = useState("");

  // Injury / ill health
  const [injuryOccurred, setInjuryOccurred] = useState(false);
  const [natureOfInjury, setNatureOfInjury] = useState("");
  const [bodyPartsAffected, setBodyPartsAffected] = useState("");
  const [injurySeverity, setInjurySeverity] = useState<InjurySeverity | "">("");
  const [firstAidGiven, setFirstAidGiven] = useState(false);
  const [firstAiderName, setFirstAiderName] = useState("");
  const [firstAidDetails, setFirstAidDetails] = useState("");
  const [medicalTreatmentRequired, setMedicalTreatmentRequired] =
    useState(false);

  // Actions & witnesses
  const [immediateActions, setImmediateActions] = useState("");
  const [witnesses, setWitnesses] = useState("");

  // Declaration
  const [declarationConfirmed, setDeclarationConfirmed] = useState(false);

  // Honeypot — bots tend to fill this, humans leave it blank.
  const [website, setWebsite] = useState("");

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
        <h1>Thank you</h1>
        <p className="mt-4">
          Your report has been received. We&rsquo;ve sent a confirmation to the
          email address you provided. The club trustees will review it and, if
          needed, be in touch using the contact details you gave us.
        </p>
        <p className="mt-4">
          <Link className="text-blue-900 underline" to="/">
            Back to the home page
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-2xl px-4 py-8">
      <h1>Report an accident or incident</h1>

      <Alert variant="destructive" className="mt-4">
        <AlertDescription>
          <strong>If this is an emergency, call 999 first.</strong> Use this
          form to log accidents, injuries, near misses, or safety concerns after
          anyone in immediate danger is safe.
        </AlertDescription>
      </Alert>

      <p className="mt-4 text-sm text-stone-700">
        This form is for reporting something that has already happened at, or in
        connection with, the club. The information you submit will be used by
        the club to record, review and respond to accidents, incidents and
        safety concerns. See our{" "}
        <Link className="text-blue-900 underline" to="/legal/privacy">
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
              onChange={(e) => setWebsite(e.target.value)}
            />
          </label>
        </div>

        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">About you</h2>
          <FieldRow>
            <Field>
              <Label htmlFor="reporterName">Your name *</Label>
              <Input
                id="reporterName"
                required
                value={reporterName}
                onChange={(e) => setReporterName(e.target.value)}
              />
            </Field>
            <Field>
              <Label htmlFor="reporterRelationship">
                Your relationship to the club *
              </Label>
              <Select
                value={reporterRelationship}
                onValueChange={(v) =>
                  setReporterRelationship(v as ReporterRelationship)
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
                onChange={(e) => setReporterEmail(e.target.value)}
              />
            </Field>
            <Field>
              <Label htmlFor="reporterPhone">Phone</Label>
              <Input
                id="reporterPhone"
                type="tel"
                value={reporterPhone}
                onChange={(e) => setReporterPhone(e.target.value)}
              />
            </Field>
          </FieldRow>
          <div className="flex items-start gap-2">
            <Checkbox
              id="prefersNoContact"
              className="mt-1"
              checked={prefersNoContact}
              onCheckedChange={(v) => setPrefersNoContact(v === true)}
            />
            <Label htmlFor="prefersNoContact" className="leading-snug">
              I&rsquo;d prefer not to be contacted about this report. (We still
              need your contact details for our records, but we won&rsquo;t
              reach out unless we have to.)
            </Label>
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">
            Details of the injured / affected person
          </h2>
          <FieldRow>
            <Field>
              <Label htmlFor="affectedName">
                Full name (if different from you)
              </Label>
              <Input
                id="affectedName"
                value={affectedName}
                onChange={(e) => setAffectedName(e.target.value)}
                placeholder="Leave blank if this was you, or unknown"
              />
            </Field>
            <Field>
              <Label htmlFor="affectedRelationship">Role / relationship</Label>
              <Select
                value={affectedRelationship}
                onValueChange={(v) =>
                  setAffectedRelationship(v as AffectedRelationship)
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
              onChange={(e) => setAffectedContact(e.target.value)}
              placeholder="Email and/or phone number"
            />
          </Field>
          <div className="flex items-center gap-2">
            <Checkbox
              id="affectedIsMinor"
              checked={affectedIsMinor}
              onCheckedChange={(v) => setAffectedIsMinor(v === true)}
            />
            <Label htmlFor="affectedIsMinor">
              The person affected is under 18
            </Label>
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">Accident / incident details</h2>
          <FieldRow>
            <Field>
              <Label htmlFor="occurredAt">When did it happen? *</Label>
              <Input
                id="occurredAt"
                type="datetime-local"
                required
                value={occurredAt}
                onChange={(e) => setOccurredAt(e.target.value)}
              />
            </Field>
            <Field>
              <Label htmlFor="location">Exact location *</Label>
              <Input
                id="location"
                required
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="e.g. Main pitch, clubhouse, nets"
              />
            </Field>
          </FieldRow>
          <FieldRow>
            <Field>
              <Label htmlFor="incidentType">Type of incident *</Label>
              <Select
                value={incidentType}
                onValueChange={(v) => setIncidentType(v as IncidentType)}
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
                onChange={(e) => setActivity(e.target.value)}
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
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">
            Injury or ill health details
          </h2>
          <div className="flex items-center gap-2">
            <Checkbox
              id="injuryOccurred"
              checked={injuryOccurred}
              onCheckedChange={(v) => setInjuryOccurred(v === true)}
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
                  onChange={(e) => setNatureOfInjury(e.target.value)}
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
                    onChange={(e) => setBodyPartsAffected(e.target.value)}
                  />
                </Field>
                <Field>
                  <Label htmlFor="injurySeverity">Severity</Label>
                  <Select
                    value={injurySeverity}
                    onValueChange={(v) =>
                      setInjurySeverity(v as InjurySeverity)
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
                    setMedicalTreatmentRequired(v === true)
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
              onCheckedChange={(v) => setFirstAidGiven(v === true)}
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
                  onChange={(e) => setFirstAiderName(e.target.value)}
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
                  onChange={(e) => setFirstAidDetails(e.target.value)}
                />
              </Field>
            </>
          )}
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">
            Immediate actions and witnesses
          </h2>
          <Field>
            <Label htmlFor="immediateActions">
              Details of any immediate actions taken
            </Label>
            <Textarea
              id="immediateActions"
              rows={3}
              value={immediateActions}
              onChange={(e) => setImmediateActions(e.target.value)}
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
              onChange={(e) => setWitnesses(e.target.value)}
            />
          </Field>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">Declaration</h2>
          <div className="border-border bg-muted/30 flex items-start gap-3 rounded border p-4">
            <Checkbox
              id="declarationConfirmed"
              className="mt-1"
              checked={declarationConfirmed}
              onCheckedChange={(v) => setDeclarationConfirmed(v === true)}
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
          <Button
            type="submit"
            disabled={submit.isPending || !declarationConfirmed}
          >
            {submit.isPending ? "Submitting…" : "Submit report"}
          </Button>
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
