import { PaymentForm } from "@/components/payment-form";
import { RadioButtons } from "@/components/radio-buttons";
import { Kicker, StampButton, StampLink } from "@/components/theme/bits.js";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
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
import { useDocumentMeta } from "@/hooks/use-document-meta";
import { api, callApi } from "@/lib/api-client";
import { useAuthedQuery, useAuthedQueryKey } from "@/lib/authed-query.js";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { useReducer } from "react";
import { Link } from "react-router";
import {
  type Dependent,
  type Step,
  STEPS,
  STEP_LABELS,
  calculateTotal,
  initialJuniorWizardState,
  juniorWizardReducer,
  priceForChild,
} from "./membership-junior.reducer";

const SCHOOL_YEARS = [
  "Year 4",
  "Year 5",
  "Year 6",
  "Year 7",
  "Year 8",
  "Year 9",
  "Year 10",
  "Year 11",
  "Year 12",
  "Year 13",
];

const PREVIOUS_CRICKET_OPTIONS = [
  "First/Primary School",
  "Middle/Secondary School",
  "SEN School",
  "Local Authority Coaching Session",
  "Club",
  "County",
];

const DISABILITY_TYPES = [
  "Visual Impairment",
  "Hearing Impairment",
  "Physical Disability",
  "Learning Disability",
  "Multiple Disability",
];

function StepIndicator({ currentStep }: { currentStep: Step }) {
  const currentIndex = STEPS.indexOf(currentStep);
  return (
    <nav className="mb-6">
      <ol className="text-muted flex items-center text-xs font-medium sm:text-sm">
        {STEPS.map((step, i) => {
          const isActive = i === currentIndex;
          const isComplete = i < currentIndex;
          return (
            <li
              key={step}
              className={`flex items-center ${i < STEPS.length - 1 ? "after:bg-border after:mx-2 after:inline-block after:h-px after:w-4 after:content-[''] sm:after:w-8" : ""}`}
            >
              <span
                className={`flex items-center gap-1 whitespace-nowrap ${isActive ? "text-cta font-semibold" : ""} ${isComplete ? "text-primary" : ""}`}
              >
                {isComplete && (
                  <svg
                    className="size-3.5"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                      clipRule="evenodd"
                    />
                  </svg>
                )}
                <span className="hidden sm:inline">{STEP_LABELS[step]}</span>
                <span className="sm:hidden">{i + 1}</span>
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function StepNav({
  onBack,
  onNext,
  nextLabel,
}: {
  onBack: () => void;
  onNext: () => void;
  nextLabel: string;
}) {
  return (
    <div className="mb-8 flex flex-wrap gap-3">
      <StampButton variant="navy" size="sm" onClick={onBack}>
        Back
      </StampButton>
      <StampButton size="sm" onClick={onNext}>
        {nextLabel} →
      </StampButton>
    </div>
  );
}

function SelectInput({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="mt-2 mb-5 w-full space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id}>
          <SelectValue placeholder={`Select ${label}`} />
        </SelectTrigger>
        <SelectContent>
          {options.map((opt) => (
            <SelectItem key={opt} value={opt}>
              {opt}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function TextInput({
  id,
  label,
  value,
  type = "text",
  required,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  type?: string;
  required?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div className="mt-2 mb-5 w-full space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type={type}
        required={required}
        value={value}
        onChange={(e) => onChange(e.currentTarget.value)}
      />
    </div>
  );
}

function SocialMembershipUpsell() {
  const { data: membershipData } = useAuthedQuery({
    queryKey: ["membership"],
    queryFn: () => callApi(api.GET("/api/members/me/membership")),
  });

  const membership = membershipData?.membership;
  if (membership) return null;

  return (
    <div className="border-primary bg-surface text-primary mt-8 border-2 p-4">
      <p className="mb-2 text-sm font-semibold">Support the club?</p>
      <p className="text-muted mb-3 text-sm">
        As a parent you don&apos;t need a membership, but if you&apos;d like to
        support the club you can become a social member.
      </p>
      <StampLink to="/membership/pay" className="fc-stamp--navy fc-stamp--sm">
        Become a Social Member →
      </StampLink>
    </div>
  );
}

// eslint-disable-next-line react-doctor/no-giant-component -- multi-step junior registration wizard: parent-account / dependents / consent / payment all share the wizard reducer + 4 mutations + Stripe integration.
function JuniorRegistrationInner() {
  const [wizard, dispatch] = useReducer(juniorWizardReducer, undefined, () =>
    initialJuniorWizardState(),
  );
  const { step, dependents, errors, paymentData, paymentError } = wizard;
  const setStep = (next: Step) => dispatch({ type: "goToStep", step: next });
  const queryClient = useQueryClient();
  const authedKey = useAuthedQueryKey();

  const { data: existingDepsData } = useAuthedQuery({
    queryKey: ["dependents"],
    queryFn: () => callApi(api.GET("/api/junior/dependents")),
  });
  const existingCount = existingDepsData?.currentYearCount ?? 0;

  const addDependentsMutation = useMutation({
    mutationFn: async (deps: Dependent[]) =>
      callApi(
        api.POST("/api/junior/dependents", {
          body: {
            dependents: deps.map(({ clientId: _clientId, ...d }) => ({
              ...d,
              sex: d.sex as "male" | "female",
              played_before: d.played_before ?? false,
              whatsapp_consent: d.whatsapp_consent ?? false,
              alt_contact_whatsapp_consent:
                d.alt_contact_whatsapp_consent ?? false,
              has_disability: d.has_disability ?? false,
              emergency_medical_consent: d.emergency_medical_consent ?? false,
              medical_fitness_declaration:
                d.medical_fitness_declaration ?? false,
              data_protection_consent: d.data_protection_consent ?? false,
              photo_consent: d.photo_consent ?? false,
              previous_cricket: d.previous_cricket || undefined,
              disability_type: d.disability_type || undefined,
              medical_info: d.medical_info || undefined,
            })),
          },
        }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: authedKey(["dependents"]),
      });
      void queryClient.invalidateQueries({
        queryKey: authedKey(["myCharges"]),
      });
    },
  });

  const payMutation = useMutation({
    // Junior registration pays only the charge just created for these
    // dependents - passing chargeIds prevents bundling unrelated
    // outstanding charges (#93) like a parent's own membership fee.
    mutationFn: (chargeIds: string[]) =>
      callApi(
        api.POST("/api/charges/pay-outstanding", { body: { chargeIds } }),
      ),
    onSuccess: (data) => {
      if (!data.clientSecret) return;
      const piId = data.clientSecret.split("_secret_")[0];
      dispatch({
        type: "setPaymentData",
        data: {
          clientSecret: data.clientSecret,
          totalAmountPence: data.totalAmountPence,
          paymentIntentId: piId,
        },
      });
      dispatch({ type: "setPaymentError", message: null });
      void queryClient.invalidateQueries({
        queryKey: authedKey(["myCharges"]),
      });
    },
    onError: () => {
      dispatch({
        type: "setPaymentError",
        message: "Failed to create payment. Please try again.",
      });
    },
  });

  const updateDependent = (index: number, updates: Partial<Dependent>) =>
    dispatch({ type: "updateDependent", index, updates });

  const addChild = () => dispatch({ type: "addChild" });

  const removeChild = (index: number) =>
    dispatch({ type: "removeChild", index });

  const validateAndAdvance = (nextStep: Step) =>
    dispatch({ type: "advanceIfValid", next: nextStep });

  const handleSubmit = async () => {
    let result;
    try {
      result = await addDependentsMutation.mutateAsync(dependents);
    } catch {
      // Surfaced via addDependentsMutation.error on the review step.
      return;
    }
    setStep("payment");
    payMutation.mutate([result.chargeId]);
  };

  if (step === "done") {
    return (
      <div className="mx-auto max-w-2xl">
        <div className="border-primary bg-surface flex flex-col items-center border-2 p-6 text-center">
          <h4 className="fc-two-tone mb-2">Registration & Payment Complete</h4>
          <p className="text-muted mb-4 text-sm">
            Your junior members have been registered and payment has been
            received. You can view your payment history in the members area.
          </p>
          <StampLink to="/members?tab=payments">Go to Members Area →</StampLink>
        </div>
        <SocialMembershipUpsell />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <Kicker className="mb-1">
        Step {STEPS.indexOf(step) + 1} of {STEPS.length} - {STEP_LABELS[step]}
      </Kicker>
      <h4 className="fc-two-tone mb-2">Junior Membership Registration</h4>
      <p className="text-muted mb-4 text-sm">
        Register your children as junior members of Percy Main Cricket Club.
      </p>

      <StepIndicator currentStep={step} />

      {/* Step 1: Children basic info */}
      {step === "children" && (
        <>
          {dependents.map((dep, i) => (
            <div
              key={dep.clientId}
              className="border-primary bg-surface mb-6 border-2 p-4"
            >
              <div className="mb-2 flex items-center justify-between">
                <h5 className="text-sm font-semibold">
                  Child {existingCount + i + 1}
                  {`: £${priceForChild(existingCount, i)}`}
                </h5>
                {dependents.length > 1 && (
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    onClick={() => removeChild(i)}
                  >
                    Remove
                  </Button>
                )}
              </div>

              <TextInput
                id={`dep-name-${i}`}
                label="Child's Full Name"
                required
                value={dep.name}
                onChange={(val) => updateDependent(i, { name: val })}
              />
              <RadioButtons
                id={`dep-sex-${i}`}
                value={dep.sex || undefined}
                onChange={(val) => updateDependent(i, { sex: val })}
                options={[
                  { title: "Male", value: "male" },
                  { title: "Female", value: "female" },
                ]}
              />
              <TextInput
                id={`dep-dob-${i}`}
                label="Date of Birth"
                type="date"
                required
                value={dep.dob}
                onChange={(val) => updateDependent(i, { dob: val })}
              />
              <SelectInput
                id={`dep-school-year-${i}`}
                label="School Year"
                value={dep.school_year}
                options={SCHOOL_YEARS}
                onChange={(val) => updateDependent(i, { school_year: val })}
              />

              {errors[i] && (
                <p className="mt-1 text-sm text-red-700">{errors[i]}</p>
              )}
            </div>
          ))}

          <div className="mb-8 flex flex-wrap gap-3">
            <StampButton variant="navy" size="sm" onClick={addChild}>
              + Add Another Child
            </StampButton>
            <StampButton
              size="sm"
              onClick={() => validateAndAdvance("cricket")}
            >
              Next: Cricket Experience →
            </StampButton>
          </div>
        </>
      )}

      {/* Step 2: Cricket experience */}
      {step === "cricket" && (
        <>
          {dependents.map((dep, i) => (
            <div
              key={dep.clientId}
              className="border-primary bg-surface mb-6 border-2 p-4"
            >
              <h5 className="mb-3 text-sm font-semibold">{dep.name}</h5>

              <p className="text-primary mb-2 text-sm font-medium">
                Has your child played cricket before?
              </p>
              <RadioButtons
                id={`dep-played-before-${i}`}
                value={
                  dep.played_before === null
                    ? undefined
                    : dep.played_before
                      ? "yes"
                      : "no"
                }
                onChange={(val) =>
                  updateDependent(i, {
                    played_before: val === "yes",
                    previous_cricket: val === "no" ? "" : dep.previous_cricket,
                  })
                }
                options={[
                  { title: "Yes", value: "yes" },
                  { title: "No", value: "no" },
                ]}
              />

              {dep.played_before && (
                <>
                  <p className="text-primary mb-2 text-sm font-medium">
                    Where have they played cricket?
                  </p>
                  <RadioButtons
                    id={`dep-previous-cricket-${i}`}
                    value={dep.previous_cricket || undefined}
                    onChange={(val) =>
                      updateDependent(i, { previous_cricket: val })
                    }
                    options={PREVIOUS_CRICKET_OPTIONS.map((opt) => ({
                      title: opt,
                      value: opt,
                    }))}
                  />
                </>
              )}

              {errors[i] && (
                <p className="mt-1 text-sm text-red-700">{errors[i]}</p>
              )}
            </div>
          ))}

          <StepNav
            onBack={() => setStep("children")}
            onNext={() => validateAndAdvance("contact")}
            nextLabel="Next: Contact Details"
          />
        </>
      )}

      {/* Step 3: Contact details */}
      {step === "contact" && (
        <>
          {dependents.map((dep, i) => (
            <div
              key={dep.clientId}
              className="border-primary bg-surface mb-6 border-2 p-4"
            >
              <h5 className="mb-3 text-sm font-semibold">{dep.name}</h5>

              <p className="text-primary mb-2 text-sm font-medium">
                Do you give permission for your mobile phone number to be added
                to this child&apos;s team WhatsApp groups?
              </p>
              <RadioButtons
                id={`dep-whatsapp-${i}`}
                value={
                  dep.whatsapp_consent === null
                    ? undefined
                    : dep.whatsapp_consent
                      ? "yes"
                      : "no"
                }
                onChange={(val) =>
                  updateDependent(i, { whatsapp_consent: val === "yes" })
                }
                options={[
                  { title: "Yes", value: "yes" },
                  { title: "No", value: "no" },
                ]}
              />

              <h6 className="text-primary mt-4 mb-2 text-sm font-semibold">
                Alternative Contact
              </h6>
              {i > 0 && (
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  className="mb-3"
                  onClick={() =>
                    updateDependent(i, {
                      alt_contact_name: dependents[0].alt_contact_name,
                      alt_contact_phone: dependents[0].alt_contact_phone,
                      alt_contact_whatsapp_consent:
                        dependents[0].alt_contact_whatsapp_consent,
                    })
                  }
                >
                  Copy from {dependents[0].name || "Child 1"}
                </Button>
              )}
              <TextInput
                id={`dep-alt-name-${i}`}
                label="Alternative Contact Name"
                required
                value={dep.alt_contact_name}
                onChange={(val) =>
                  updateDependent(i, { alt_contact_name: val })
                }
              />
              <TextInput
                id={`dep-alt-phone-${i}`}
                label="Alternative Contact Phone Number"
                type="tel"
                required
                value={dep.alt_contact_phone}
                onChange={(val) =>
                  updateDependent(i, { alt_contact_phone: val })
                }
              />
              <p className="text-primary mb-2 text-sm font-medium">
                Would you like the alternative contact phone number to be added
                to team WhatsApp groups?
              </p>
              <RadioButtons
                id={`dep-alt-whatsapp-${i}`}
                value={
                  dep.alt_contact_whatsapp_consent === null
                    ? undefined
                    : dep.alt_contact_whatsapp_consent
                      ? "yes"
                      : "no"
                }
                onChange={(val) =>
                  updateDependent(i, {
                    alt_contact_whatsapp_consent: val === "yes",
                  })
                }
                options={[
                  { title: "Yes", value: "yes" },
                  { title: "No", value: "no" },
                ]}
              />

              {errors[i] && (
                <p className="mt-1 text-sm text-red-700">{errors[i]}</p>
              )}
            </div>
          ))}

          <StepNav
            onBack={() => setStep("cricket")}
            onNext={() => validateAndAdvance("medical")}
            nextLabel="Next: Medical Information"
          />
        </>
      )}

      {/* Step 4: Medical information */}
      {step === "medical" && (
        <>
          {dependents.map((dep, i) => (
            <div
              key={dep.clientId}
              className="border-primary bg-surface mb-6 border-2 p-4"
            >
              <h5 className="mb-3 text-sm font-semibold">{dep.name}</h5>

              {i > 0 && (
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  className="mb-3"
                  onClick={() =>
                    updateDependent(i, {
                      gp_surgery: dependents[0].gp_surgery,
                      gp_phone: dependents[0].gp_phone,
                    })
                  }
                >
                  Copy GP details from {dependents[0].name || "Child 1"}
                </Button>
              )}

              <TextInput
                id={`dep-gp-surgery-${i}`}
                label="Name of GP's Surgery"
                required
                value={dep.gp_surgery}
                onChange={(val) => updateDependent(i, { gp_surgery: val })}
              />
              <TextInput
                id={`dep-gp-phone-${i}`}
                label="GP's Phone Number"
                type="tel"
                required
                value={dep.gp_phone}
                onChange={(val) => updateDependent(i, { gp_phone: val })}
              />

              <p className="text-primary mb-2 text-sm font-medium">
                Do you consider your child to have a disability?
              </p>
              <RadioButtons
                id={`dep-disability-${i}`}
                value={
                  dep.has_disability === null
                    ? undefined
                    : dep.has_disability
                      ? "yes"
                      : "no"
                }
                onChange={(val) =>
                  updateDependent(i, {
                    has_disability: val === "yes",
                    disability_type: val === "no" ? "" : dep.disability_type,
                  })
                }
                options={[
                  { title: "Yes", value: "yes" },
                  { title: "No", value: "no" },
                ]}
              />

              {dep.has_disability && (
                <>
                  <p className="text-primary mb-2 text-sm font-medium">
                    What is the nature of the disability?
                  </p>
                  <RadioButtons
                    id={`dep-disability-type-${i}`}
                    value={dep.disability_type || undefined}
                    onChange={(val) =>
                      updateDependent(i, { disability_type: val })
                    }
                    options={DISABILITY_TYPES.map((opt) => ({
                      title: opt,
                      value: opt,
                    }))}
                  />
                </>
              )}

              <div className="mt-2 mb-5 w-full space-y-2">
                <Label htmlFor={`dep-medical-info-${i}`}>
                  Medical Information
                </Label>
                <Textarea
                  id={`dep-medical-info-${i}`}
                  value={dep.medical_info}
                  placeholder="Please detail any important medical information (e.g. epilepsy, asthma, diabetes, allergies)"
                  rows={3}
                  onChange={(e) =>
                    updateDependent(i, { medical_info: e.target.value })
                  }
                />
              </div>

              <div className="border-cta bg-surface mt-4 border-2 p-3">
                <p className="text-primary mb-2 text-sm font-medium">
                  I give my consent that in an emergency situation, the Club may
                  act in loco parentis to seek emergency medical treatment,
                  including anaesthetic if required.
                </p>
                <RadioButtons
                  id={`dep-emergency-consent-${i}`}
                  value={
                    dep.emergency_medical_consent === null
                      ? undefined
                      : dep.emergency_medical_consent
                        ? "yes"
                        : "no"
                  }
                  onChange={(val) =>
                    updateDependent(i, {
                      emergency_medical_consent: val === "yes",
                    })
                  }
                  options={[
                    { title: "Yes", value: "yes" },
                    { title: "No", value: "no" },
                  ]}
                />
              </div>

              <div className="border-cta bg-surface mt-4 border-2 p-3">
                <p className="text-primary mb-2 text-sm font-medium">
                  I confirm that to the best of my knowledge, my child does not
                  suffer from any medical condition other than those listed
                  above.
                </p>
                <RadioButtons
                  id={`dep-fitness-declaration-${i}`}
                  value={
                    dep.medical_fitness_declaration === null
                      ? undefined
                      : dep.medical_fitness_declaration
                        ? "yes"
                        : "no"
                  }
                  onChange={(val) =>
                    updateDependent(i, {
                      medical_fitness_declaration: val === "yes",
                    })
                  }
                  options={[
                    { title: "Yes", value: "yes" },
                    { title: "No", value: "no" },
                  ]}
                />
              </div>

              {errors[i] && (
                <p className="mt-1 text-sm text-red-700">{errors[i]}</p>
              )}
            </div>
          ))}

          <StepNav
            onBack={() => setStep("contact")}
            onNext={() => validateAndAdvance("consents")}
            nextLabel="Next: Consents"
          />
        </>
      )}

      {/* Step 5: Consents */}
      {step === "consents" && (
        <>
          <div className="border-primary bg-surface text-primary mb-6 border-2 p-4">
            <h5 className="mb-2 text-sm font-semibold">Data Protection</h5>
            <p className="text-muted text-sm">
              Percy Main Cricket Club collects personal data to administer
              membership, organise cricket activities, and communicate with
              members. Your data is processed in accordance with our{" "}
              <Link
                to="/legal/privacy"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary decoration-cta/70 hover:text-cta underline underline-offset-2"
              >
                Privacy Policy
              </Link>
              . As the person completing this form, you must ensure that each
              person whose information you include knows what will happen to
              their information.
            </p>
          </div>

          {dependents.map((dep, i) => (
            <div
              key={dep.clientId}
              className="border-primary bg-surface mb-6 border-2 p-4"
            >
              <h5 className="mb-3 text-sm font-semibold">{dep.name}</h5>

              <div className="border-cta bg-surface mb-4 border-2 p-3">
                <p className="text-primary mb-2 text-sm font-medium">
                  I confirm I have read the Privacy Policy and consent to the
                  processing of my child&apos;s personal data as described.
                </p>
                <RadioButtons
                  id={`dep-data-consent-${i}`}
                  value={
                    dep.data_protection_consent === null
                      ? undefined
                      : dep.data_protection_consent
                        ? "yes"
                        : "no"
                  }
                  onChange={(val) =>
                    updateDependent(i, {
                      data_protection_consent: val === "yes",
                    })
                  }
                  options={[
                    { title: "Yes", value: "yes" },
                    { title: "No", value: "no" },
                  ]}
                />
              </div>

              <div className="border-cta bg-surface border-2 p-3">
                <p className="text-primary mb-2 text-sm font-medium">
                  I give my consent to my child being photographed and/or
                  videoed for the purposes of coaching and/or publicity.
                </p>
                <RadioButtons
                  id={`dep-photo-consent-${i}`}
                  value={
                    dep.photo_consent === null
                      ? undefined
                      : dep.photo_consent
                        ? "yes"
                        : "no"
                  }
                  onChange={(val) =>
                    updateDependent(i, {
                      photo_consent: val === "yes",
                    })
                  }
                  options={[
                    { title: "Yes", value: "yes" },
                    { title: "No", value: "no" },
                  ]}
                />
              </div>

              {errors[i] && (
                <p className="mt-1 text-sm text-red-700">{errors[i]}</p>
              )}
            </div>
          ))}

          <StepNav
            onBack={() => setStep("medical")}
            onNext={() => validateAndAdvance("review")}
            nextLabel="Review & Pay"
          />
        </>
      )}

      {/* Step 6: Review */}
      {step === "review" && (
        <>
          {dependents.map((dep, i) => (
            <div
              key={dep.clientId}
              className="border-primary bg-surface mb-6 border-2 p-4"
            >
              <div className="mb-2 flex items-center justify-between">
                <h5 className="font-semibold">
                  {dep.name}: £{priceForChild(existingCount, i)}
                </h5>
              </div>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                <dt className="text-muted font-medium">Date of Birth</dt>
                <dd>{format(new Date(dep.dob), "dd/MM/yyyy")}</dd>
                <dt className="text-muted font-medium">Gender</dt>
                <dd className="capitalize">{dep.sex}</dd>
                <dt className="text-muted font-medium">School Year</dt>
                <dd>{dep.school_year}</dd>
                <dt className="text-muted font-medium">Played Before</dt>
                <dd>{dep.played_before ? "Yes" : "No"}</dd>
                {dep.played_before && dep.previous_cricket && (
                  <>
                    <dt className="text-muted font-medium">Where</dt>
                    <dd>{dep.previous_cricket}</dd>
                  </>
                )}
                <dt className="text-muted font-medium">Photo Consent</dt>
                <dd>{dep.photo_consent ? "Yes" : "No"}</dd>
              </dl>
            </div>
          ))}

          <div className="border-primary bg-surface mb-6 border-2 p-4">
            <h5 className="mb-2 font-semibold">Payment Summary</h5>
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b">
                  <th className="pb-2">Name</th>
                  <th className="pb-2 text-right">Price</th>
                </tr>
              </thead>
              <tbody>
                {dependents.map((dep, i) => (
                  <tr key={dep.clientId} className="border-b last:border-0">
                    <td className="py-2">{dep.name}</td>
                    <td className="py-2 text-right">
                      £{priceForChild(existingCount, i)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-semibold">
                  <td className="pt-3">Total</td>
                  <td className="pt-3 text-right">
                    £{calculateTotal(existingCount, dependents.length)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          <p className="text-muted mb-4 text-sm">
            This is a one-off payment for junior membership valid until the end
            of {new Date().getFullYear()}. You will not be automatically charged
            when it expires.
          </p>

          {addDependentsMutation.error && (
            <p className="mb-4 text-sm text-red-700">
              {addDependentsMutation.error instanceof Error
                ? addDependentsMutation.error.message
                : "Registration failed. Please try again."}
            </p>
          )}

          <div className="mb-8 flex flex-wrap gap-3">
            <StampButton
              variant="navy"
              size="sm"
              onClick={() => setStep("consents")}
            >
              Back
            </StampButton>
            <StampButton
              size="sm"
              disabled={addDependentsMutation.isPending}
              onClick={() => void handleSubmit()}
            >
              {addDependentsMutation.isPending
                ? "Registering…"
                : "Confirm & Continue to Payment →"}
            </StampButton>
          </div>
        </>
      )}

      {/* Step 7: Payment */}
      {step === "payment" && (
        <div>
          {payMutation.isPending && !paymentData && (
            <div className="border-primary bg-surface border-2 p-6 text-center">
              <p className="text-muted text-sm">Setting up payment…</p>
            </div>
          )}

          {paymentError && (
            <div className="flex flex-col gap-4">
              <Alert variant="destructive">
                <AlertDescription>{paymentError}</AlertDescription>
              </Alert>
              <div className="flex flex-wrap items-center gap-3">
                <StampButton
                  size="sm"
                  disabled={!addDependentsMutation.data?.chargeId}
                  onClick={() => {
                    const chargeId = addDependentsMutation.data?.chargeId;
                    if (!chargeId) return;
                    dispatch({ type: "setPaymentError", message: null });
                    payMutation.mutate([chargeId]);
                  }}
                >
                  Try Again →
                </StampButton>
                <Link
                  to="/members?tab=payments"
                  className="text-primary decoration-cta/70 hover:text-cta text-sm underline underline-offset-2"
                >
                  Pay Later
                </Link>
              </div>
            </div>
          )}

          {paymentData && (
            <div className="flex flex-col gap-4">
              <PaymentForm
                clientSecret={paymentData.clientSecret}
                amount={paymentData.totalAmountPence}
                title="Pay for Junior Membership"
                onSuccess={() => {
                  callApi(
                    api.POST("/api/charges/confirm-payment", {
                      body: {
                        paymentIntentId: paymentData.paymentIntentId,
                      },
                    }),
                  ).catch(() => {
                    // Payment succeeded at Stripe but confirmation failed - the
                    // webhook will reconcile, so still show success.
                  });
                  setStep("done");
                }}
                onCancel={() => {
                  window.location.href = "/members?tab=payments";
                }}
              />
              <p className="text-muted text-center text-sm">
                Or{" "}
                <Link
                  to="/members?tab=payments"
                  className="text-primary decoration-cta/70 hover:text-cta underline underline-offset-2"
                >
                  pay later in the members area
                </Link>
              </p>
            </div>
          )}
        </div>
      )}

      <SocialMembershipUpsell />
    </div>
  );
}

export function Component() {
  useDocumentMeta("Junior Membership");
  return <JuniorRegistrationInner />;
}
