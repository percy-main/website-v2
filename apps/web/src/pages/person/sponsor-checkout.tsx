import { OptimisedImage } from "@/components/optimised-image";
import { PaymentForm } from "@/components/payment-form";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useDocumentMeta } from "@/hooks/use-document-meta.js";
import { api, callApi } from "@/lib/api-client";
import { getImageUrl, getPicture } from "@/lib/image-map";
import { resizeLogo } from "@/lib/logo-resize";
import { getPersonBySlug } from "@/lib/people";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { IoChevronForward } from "react-icons/io5";
import { Link, useParams } from "react-router";

const ANON_IMAGE = getImageUrl("/images/anon.jpg");
const ANON_PICTURE = getPicture("/images/anon.jpg");
const MAX_MESSAGE_CHARS = 100;

const currencyFormatter = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  minimumFractionDigits: 2,
});

type Step = "details" | "paying" | "success";

export function Component() {
  const { slug } = useParams();
  const person = getPersonBySlug(slug ?? "");

  useDocumentMeta(person ? `Sponsor ${person.name}` : "Sponsor");

  const [step, setStep] = useState<Step>("details");
  const [sponsorName, setSponsorName] = useState("");
  const [sponsorEmail, setSponsorEmail] = useState("");
  const [sponsorWebsite, setSponsorWebsite] = useState("");
  const [sponsorPhone, setSponsorPhone] = useState("");
  const [sponsorMessage, setSponsorMessage] = useState("");
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null);
  const [logoError, setLogoError] = useState<string | null>(null);

  const priceQuery = useQuery({
    queryKey: ["player-sponsorship-price"],
    queryFn: () => callApi(api.GET("/api/sponsorship/player/price")),
    staleTime: 5 * 60 * 1000,
  });

  // Fire-and-forget: creates a Stripe payment intent and transitions to the
  // in-page payment form. No cached data changes until the webhook reconciles.
  const paymentMutation = useMutation({
    mutationFn: () =>
      callApi(
        api.POST("/api/sponsorship/player/create-payment", {
          body: {
            slug: slug ?? "",
            playerName: person?.name ?? "",
            sponsorName,
            sponsorEmail,
            sponsorWebsite: sponsorWebsite || undefined,
            sponsorPhone: sponsorPhone || undefined,
            sponsorLogoDataUrl: logoDataUrl ?? undefined,
            sponsorMessage: sponsorMessage || undefined,
          },
        }),
      ),
    onSuccess: () => setStep("paying"),
  });

  if (!person) {
    return (
      <div className="container mx-auto max-w-md px-4 py-12">
        <h1>Person Not Found</h1>
        <Link to="/people" className="text-primary hover:underline">
          Back to People
        </Link>
      </div>
    );
  }

  const isFormValid =
    sponsorName.trim().length > 0 &&
    sponsorEmail.trim().length > 0 &&
    sponsorEmail.includes("@") &&
    sponsorMessage.length <= MAX_MESSAGE_CHARS &&
    !logoError;

  const handleLogoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      setLogoDataUrl(null);
      setLogoError(null);
      return;
    }
    setLogoError(null);
    try {
      const dataUrl = await resizeLogo(file);
      setLogoDataUrl(dataUrl);
    } catch (err) {
      setLogoError(
        err instanceof Error ? err.message : "Failed to process logo",
      );
      setLogoDataUrl(null);
    }
  };

  if (step === "success") {
    return (
      <div className="container mx-auto max-w-md px-4 py-12">
        <Card>
          <CardHeader>
            <CardTitle>Thank You!</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p>
              Your sponsorship of <strong>{person.name}</strong> has been
              received.
            </p>
            <p className="text-sm text-stone-600">
              A confirmation has been sent to {sponsorEmail}. Your details will
              be reviewed by an admin before being displayed on the site.
            </p>
          </CardContent>
          <CardFooter>
            <Link
              to={`/person/${slug}`}
              className="text-primary text-sm hover:underline"
            >
              Back to {person.name}&apos;s profile
            </Link>
          </CardFooter>
        </Card>
      </div>
    );
  }

  if (step === "paying" && paymentMutation.data?.clientSecret) {
    return (
      <div className="container mx-auto max-w-md px-4 py-12">
        <PaymentForm
          clientSecret={paymentMutation.data.clientSecret}
          amount={paymentMutation.data.amount}
          title={`Sponsor ${person.name}`}
          onSuccess={() => setStep("success")}
          onCancel={() => setStep("details")}
        />
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-md px-4 py-6">
      {/* Breadcrumbs */}
      <div className="text-h4 mb-4 flex items-center gap-2">
        <Link to="/people" className="hover:text-primary text-stone-600">
          People
        </Link>
        <IoChevronForward className="text-stone-400" size={14} />
        <Link
          to={`/person/${slug}`}
          className="hover:text-primary text-stone-600"
        >
          {person.name}
        </Link>
        <IoChevronForward className="text-stone-400" size={14} />
        <span className="text-dark font-medium">Sponsor</span>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            {(() => {
              const picture = person.photoPicture ?? ANON_PICTURE;
              return picture ? (
                <OptimisedImage
                  picture={picture}
                  alt={person.name}
                  className="size-10 rounded-full"
                  sizes="40px"
                />
              ) : (
                <img
                  src={person.photo ?? ANON_IMAGE}
                  alt={person.name}
                  className="size-10 rounded-full"
                />
              );
            })()}
            <CardTitle>Sponsor {person.name}</CardTitle>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Price info */}
          {priceQuery.data && (
            <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
              Player sponsorship:{" "}
              <strong>
                {currencyFormatter.format(priceQuery.data.amountPence / 100)}
              </strong>{" "}
              for the season
            </div>
          )}

          <div className="space-y-3">
            <div>
              <Label htmlFor="sponsorName">Sponsor Name / Company Name *</Label>
              <Input
                id="sponsorName"
                value={sponsorName}
                onChange={(e) => setSponsorName(e.target.value)}
                maxLength={200}
              />
            </div>

            <div>
              <Label htmlFor="sponsorEmail">Contact Email *</Label>
              <Input
                id="sponsorEmail"
                type="email"
                value={sponsorEmail}
                onChange={(e) => setSponsorEmail(e.target.value)}
              />
            </div>

            <div>
              <Label htmlFor="sponsorWebsite">Website URL</Label>
              <Input
                id="sponsorWebsite"
                type="text"
                placeholder="https://www.example.com (optional)"
                value={sponsorWebsite}
                onChange={(e) => setSponsorWebsite(e.target.value)}
              />
            </div>

            <div>
              <Label htmlFor="sponsorPhone">Phone</Label>
              <Input
                id="sponsorPhone"
                type="tel"
                placeholder="Optional"
                value={sponsorPhone}
                onChange={(e) => setSponsorPhone(e.target.value)}
              />
            </div>

            <div>
              <Label htmlFor="sponsorLogo">Logo</Label>
              <Input
                id="sponsorLogo"
                type="file"
                accept="image/*"
                onChange={(e) => void handleLogoChange(e)}
              />
              {logoError && (
                <p className="mt-1 text-xs text-red-600">{logoError}</p>
              )}
              {logoDataUrl && (
                <img
                  src={logoDataUrl}
                  alt="Logo preview"
                  className="mt-2 max-w-[120px]"
                />
              )}
            </div>

            <div>
              <Label htmlFor="sponsorMessage">Message / Dedication</Label>
              <Input
                id="sponsorMessage"
                value={sponsorMessage}
                onChange={(e) => setSponsorMessage(e.target.value)}
                maxLength={MAX_MESSAGE_CHARS}
              />
              <p className="mt-1 text-xs text-stone-400">
                {sponsorMessage.length}/{MAX_MESSAGE_CHARS}
              </p>
            </div>
          </div>

          {paymentMutation.error && (
            <Alert variant="destructive">
              <AlertDescription>
                {paymentMutation.error.message}
              </AlertDescription>
            </Alert>
          )}
        </CardContent>

        <CardFooter className="flex justify-between">
          <Link
            to={`/person/${slug}`}
            className="text-sm text-stone-500 hover:underline"
          >
            Cancel
          </Link>
          <Button
            onClick={() => paymentMutation.mutate()}
            disabled={!isFormValid || paymentMutation.isPending}
          >
            {paymentMutation.isPending ? "Processing…" : "Continue to Payment"}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
