import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api, callApi } from "@/lib/api-client";
import { readAttribution } from "@/lib/marketing/attribution.js";
import {
  CURRENT_CONSENT_VERSION,
  getConsentSnapshot,
  readConsentRecord,
} from "@/lib/marketing/consent.js";
import { trackLeadGenerated } from "@/lib/marketing/track-lead.js";
import { useMutation } from "@tanstack/react-query";
import { useCallback, useState, type FC } from "react";

type Variant = "adult" | "junior";

interface LeadFormProps {
  campaignId: string;
  segment: string;
  variant?: Variant;
}

interface AdultFormState {
  name: string;
  email: string;
  phone: string;
  notes: string;
  honeypot: string;
}

interface JuniorFormState {
  childName: string;
  parentName: string;
  parentEmail: string;
  parentPhone: string;
  notes: string;
  honeypot: string;
}

const HONEYPOT_STYLE: React.CSSProperties = {
  position: "absolute",
  left: "-9999px",
};

function buildConsentSnapshot() {
  const snapshot = getConsentSnapshot();
  const record = readConsentRecord();
  return {
    ad_user_data: snapshot.ad_user_data,
    ad_storage: snapshot.ad_storage,
    version: record?.version ?? CURRENT_CONSENT_VERSION,
    recordedAt: record?.timestamp ?? new Date().toISOString(),
  };
}

/**
 * Trims a string and returns undefined when empty — keeps optional fields
 * out of the payload entirely (per "use NULL/undefined, not empty string").
 */
function emptyToUndefined(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

export const LeadForm: FC<LeadFormProps> = ({
  campaignId,
  segment,
  variant = "adult",
}) => {
  const [adult, setAdult] = useState<AdultFormState>({
    name: "",
    email: "",
    phone: "",
    notes: "",
    honeypot: "",
  });
  const [junior, setJunior] = useState<JuniorFormState>({
    childName: "",
    parentName: "",
    parentEmail: "",
    parentPhone: "",
    notes: "",
    honeypot: "",
  });

  // Captured at submit time so the success message keeps showing the entered
  // name even after we clear/replace the form.
  const [submittedDisplayName, setSubmittedDisplayName] = useState<
    string | null
  >(null);

  const mutation = useMutation({
    mutationFn: async () => {
      const attribution = readAttribution() ?? undefined;
      const consent = buildConsentSnapshot();

      const isJunior = variant === "junior";

      const name = isJunior ? junior.parentName.trim() : adult.name.trim();
      const email = isJunior ? junior.parentEmail.trim() : adult.email.trim();
      const phone = isJunior
        ? emptyToUndefined(junior.parentPhone)
        : emptyToUndefined(adult.phone);
      const notes = isJunior
        ? emptyToUndefined(junior.notes)
        : emptyToUndefined(adult.notes);
      const honeypot = isJunior ? junior.honeypot : adult.honeypot;

      const fields: Record<string, unknown> = {};
      if (notes !== undefined) fields.notes = notes;
      if (isJunior) {
        const childName = junior.childName.trim();
        if (childName.length > 0) fields.child_name = childName;
      }

      const data = await callApi(
        api.POST("/api/marketing/leads", {
          body: {
            campaignId,
            segment,
            name,
            email,
            ...(phone !== undefined ? { phone } : {}),
            source: variant === "junior" ? "landing-junior" : "landing-adult",
            ...(Object.keys(fields).length > 0 ? { fields } : {}),
            ...(attribution !== undefined ? { attribution } : {}),
            consent,
            ...(honeypot.length > 0 ? { honeypot } : {}),
          },
        }),
      );

      return { leadId: data.leadId, email };
    },
    onSuccess: ({ email }) => {
      void trackLeadGenerated({ campaignId, segment, email });
    },
  });

  const handleSubmit = useCallback(
    (event: React.SyntheticEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (mutation.isPending) return;
      // Capture the display name the moment the user submits so the success
      // copy stays personalised even if state is later reset.
      setSubmittedDisplayName(
        variant === "junior" ? junior.childName.trim() : adult.name.trim(),
      );
      mutation.mutate();
    },
    [adult.name, junior.childName, mutation, variant],
  );

  if (mutation.isSuccess) {
    return (
      <SuccessMessage
        variant={variant}
        displayName={submittedDisplayName ?? ""}
      />
    );
  }

  const isPending = mutation.isPending;

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      {/* Honeypot — hidden from users, attractive to naive bots. */}
      <input
        type="text"
        name="honeypot"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        style={HONEYPOT_STYLE}
        value={variant === "junior" ? junior.honeypot : adult.honeypot}
        onChange={(e) => {
          const value = e.currentTarget.value;
          if (variant === "junior") {
            setJunior((s) => ({ ...s, honeypot: value }));
          } else {
            setAdult((s) => ({ ...s, honeypot: value }));
          }
        }}
      />

      {variant === "adult" ? (
        <>
          <Field id="lead-name" label="Name" required>
            <Input
              id="lead-name"
              type="text"
              name="name"
              autoComplete="name"
              required
              value={adult.name}
              onChange={(e) => {
                const value = e.currentTarget.value;
                setAdult((s) => ({ ...s, name: value }));
              }}
              disabled={isPending}
            />
          </Field>
          <Field id="lead-email" label="Email" required>
            <Input
              id="lead-email"
              type="email"
              name="email"
              autoComplete="email"
              required
              value={adult.email}
              onChange={(e) => {
                const value = e.currentTarget.value;
                setAdult((s) => ({ ...s, email: value }));
              }}
              disabled={isPending}
            />
          </Field>
          <Field
            id="lead-phone"
            label="Phone"
            hint="Add a number if you'd like us to call; we'll email otherwise."
          >
            <Input
              id="lead-phone"
              type="tel"
              name="phone"
              autoComplete="tel"
              value={adult.phone}
              onChange={(e) => {
                const value = e.currentTarget.value;
                setAdult((s) => ({ ...s, phone: value }));
              }}
              disabled={isPending}
            />
          </Field>
          <Field id="lead-notes" label="Notes (optional)">
            <Textarea
              id="lead-notes"
              name="notes"
              rows={3}
              placeholder="Anything we should know? Previous experience, preferred day, questions…"
              value={adult.notes}
              onChange={(e) => {
                const value = e.currentTarget.value;
                setAdult((s) => ({ ...s, notes: value }));
              }}
              disabled={isPending}
            />
          </Field>
        </>
      ) : (
        <>
          <Field id="lead-child-name" label="Child's name" required>
            <Input
              id="lead-child-name"
              type="text"
              name="child_name"
              autoComplete="off"
              required
              value={junior.childName}
              onChange={(e) => {
                const value = e.currentTarget.value;
                setJunior((s) => ({ ...s, childName: value }));
              }}
              disabled={isPending}
            />
          </Field>
          <Field id="lead-parent-name" label="Parent / guardian name" required>
            <Input
              id="lead-parent-name"
              type="text"
              name="parent_name"
              autoComplete="name"
              required
              value={junior.parentName}
              onChange={(e) => {
                const value = e.currentTarget.value;
                setJunior((s) => ({ ...s, parentName: value }));
              }}
              disabled={isPending}
            />
          </Field>
          <Field
            id="lead-parent-email"
            label="Parent / guardian email"
            required
          >
            <Input
              id="lead-parent-email"
              type="email"
              name="parent_email"
              autoComplete="email"
              required
              value={junior.parentEmail}
              onChange={(e) => {
                const value = e.currentTarget.value;
                setJunior((s) => ({ ...s, parentEmail: value }));
              }}
              disabled={isPending}
            />
          </Field>
          <Field
            id="lead-parent-phone"
            label="Parent / guardian phone"
            hint="Optional: add a number if you'd prefer a call."
          >
            <Input
              id="lead-parent-phone"
              type="tel"
              name="parent_phone"
              autoComplete="tel"
              value={junior.parentPhone}
              onChange={(e) => {
                const value = e.currentTarget.value;
                setJunior((s) => ({ ...s, parentPhone: value }));
              }}
              disabled={isPending}
            />
          </Field>
          <Field id="lead-junior-notes" label="Notes (optional)">
            <Textarea
              id="lead-junior-notes"
              name="notes"
              rows={3}
              placeholder="Anything we should know? Age, previous experience, preferred day…"
              value={junior.notes}
              onChange={(e) => {
                const value = e.currentTarget.value;
                setJunior((s) => ({ ...s, notes: value }));
              }}
              disabled={isPending}
            />
          </Field>
        </>
      )}

      {mutation.isError && (
        <div
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800"
        >
          <p className="font-medium">Something went wrong.</p>
          <p className="mt-1">
            We couldn't submit your details. Please try again, or email{" "}
            <a
              href="mailto:trustees@percymain.org"
              className="font-medium underline"
            >
              trustees@percymain.org
            </a>
            .
          </p>
        </div>
      )}

      <Button
        type="submit"
        variant="cta"
        size="lg"
        className="w-full"
        disabled={isPending}
      >
        {isPending ? "Sending…" : "Get in touch"}
      </Button>
    </form>
  );
};

interface FieldProps {
  id: string;
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}

const Field: FC<FieldProps> = ({ id, label, required, hint, children }) => (
  <div className="space-y-1.5">
    <Label htmlFor={id}>
      {label}
      {required && <span className="text-red-600"> *</span>}
    </Label>
    {children}
    {hint && <p className="text-muted text-xs">{hint}</p>}
  </div>
);

interface SuccessMessageProps {
  variant: Variant;
  displayName: string;
}

const SuccessMessage: FC<SuccessMessageProps> = ({ variant, displayName }) => {
  const safeName = displayName.length > 0 ? displayName : "";
  return (
    <div
      role="status"
      aria-live="polite"
      className="rounded-lg border border-green-200 bg-green-50 p-5 text-sm text-green-900"
    >
      {variant === "junior" ? (
        <>
          <p>
            Thanks, we'll be in touch about{" "}
            <strong>{safeName ? `${safeName}'s` : "your child's"}</strong> trial
            within <strong>1 working day</strong>.
          </p>
          <p className="mt-2">
            If you haven't heard from us by then, please email{" "}
            <a
              href="mailto:trustees@percymain.org"
              className="font-medium underline"
            >
              trustees@percymain.org
            </a>
            .
          </p>
        </>
      ) : (
        <>
          <p>
            Thanks{safeName ? <> {safeName}</> : null}, someone from Percy Main
            will be in touch within <strong>1 working day</strong>.
          </p>
          <p className="mt-2">
            If you haven't heard from us by then, please email{" "}
            <a
              href="mailto:trustees@percymain.org"
              className="font-medium underline"
            >
              trustees@percymain.org
            </a>{" "}
            and we'll sort it out.
          </p>
        </>
      )}
    </div>
  );
};
