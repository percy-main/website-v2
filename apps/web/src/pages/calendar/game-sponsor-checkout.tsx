import { PaymentForm } from "@/components/payment-form";
import { StampButton } from "@/components/theme/bits.js";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useDocumentMeta } from "@/hooks/use-document-meta.js";
import { api, callApi } from "@/lib/api-client";
import { resizeLogo } from "@/lib/logo-resize";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useReducer, useState } from "react";
import { IoChevronForward } from "react-icons/io5";
import { Link, useParams } from "react-router";

const MAX_MESSAGE_CHARS = 100;

const currencyFormatter = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  minimumFractionDigits: 2,
});

type Step = "details" | "paying" | "success";

interface SponsorFormState {
  sponsorName: string;
  sponsorEmail: string;
  sponsorWebsite: string;
  sponsorPhone: string;
  sponsorMessage: string;
  logoDataUrl: string | null;
  logoError: string | null;
}

const initialSponsorFormState: SponsorFormState = {
  sponsorName: "",
  sponsorEmail: "",
  sponsorWebsite: "",
  sponsorPhone: "",
  sponsorMessage: "",
  logoDataUrl: null,
  logoError: null,
};

export function Component() {
  const { id } = useParams<{ id: string }>();

  const { data: game, isLoading: gameLoading } = useQuery({
    queryKey: ["game", id],
    queryFn: () =>
      callApi(
        api.GET("/api/games/{matchId}", {
          params: { path: { matchId: id ?? "" } },
        }),
      ),
    enabled: !!id,
    staleTime: 5 * 60 * 1000,
  });

  const gameTitle = game
    ? `${game.team.name} vs ${game.opposition.club.name} ${game.opposition.team.name}`
    : "Game";

  useDocumentMeta(game ? `Sponsor: ${gameTitle}` : "Sponsor Game");

  const [step, setStep] = useState<Step>("details");
  const [form, update] = useReducer(
    (s: SponsorFormState, p: Partial<SponsorFormState>) => ({ ...s, ...p }),
    initialSponsorFormState,
  );
  const {
    sponsorName,
    sponsorEmail,
    sponsorWebsite,
    sponsorPhone,
    sponsorMessage,
    logoDataUrl,
    logoError,
  } = form;

  const { data: priceData } = useQuery({
    queryKey: ["game-sponsorship-price"],
    queryFn: () => callApi(api.GET("/api/sponsorship/game/price")),
    staleTime: 5 * 60 * 1000,
  });

  // Fire-and-forget: creates a Stripe payment intent and transitions to the
  // in-page payment form. No cached data changes until the webhook reconciles.
  // eslint-disable-next-line react-doctor/query-mutation-missing-invalidation -- creates a Stripe payment intent; sponsorship data updates server-side via the Stripe webhook, not from this client mutation
  const paymentMutation = useMutation({
    mutationFn: () =>
      callApi(
        api.POST("/api/sponsorship/game/create-payment", {
          body: {
            gameId: id ?? "",
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

  const isFormValid =
    sponsorName.trim().length > 0 &&
    sponsorEmail.trim().length > 0 &&
    sponsorEmail.includes("@") &&
    sponsorMessage.length <= MAX_MESSAGE_CHARS &&
    !logoError;

  const handleLogoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      update({ logoDataUrl: null, logoError: null });
      return;
    }
    update({ logoError: null });
    try {
      const dataUrl = await resizeLogo(file);
      update({ logoDataUrl: dataUrl });
    } catch (err) {
      update({
        logoError:
          err instanceof Error ? err.message : "Failed to process logo",
        logoDataUrl: null,
      });
    }
  };

  if (gameLoading) {
    return (
      <div className="container mx-auto max-w-md px-4 py-12">
        <div className="bg-primary/10 h-6 w-48 animate-pulse rounded" />
      </div>
    );
  }

  if (!game) {
    return (
      <div className="container mx-auto max-w-md px-4 py-12">
        <h1 className="fc-two-tone">Game Not Found</h1>
        <Link to="/calendar" className="text-cta hover:underline">
          Back to Calendar
        </Link>
      </div>
    );
  }

  if (step === "success") {
    return (
      <div className="container mx-auto max-w-md px-4 py-12">
        <div className="border-primary bg-surface flex flex-col gap-3 border-2 p-6">
          <h2 className="fc-two-tone text-xl font-semibold">Thank You!</h2>
          <p>
            Thank you for sponsoring this game! Your sponsorship details will be
            reviewed by our team and displayed on the game page once approved.
          </p>
          <p className="text-muted text-sm">
            A confirmation email has been sent to {sponsorEmail}.
          </p>
          <Link
            to={`/calendar/game/${id}`}
            className="text-cta self-start text-sm hover:underline"
          >
            Back to game
          </Link>
        </div>
      </div>
    );
  }

  if (step === "paying" && paymentMutation.data?.clientSecret) {
    return (
      <div className="container mx-auto max-w-md px-4 py-12">
        <PaymentForm
          clientSecret={paymentMutation.data.clientSecret}
          amount={paymentMutation.data.amount}
          title={`Sponsor: ${gameTitle}`}
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
        <Link to="/calendar" className="hover:text-primary text-muted">
          Calendar
        </Link>
        <IoChevronForward className="text-muted" size={14} />
        <Link
          to={`/calendar/game/${id}`}
          className="hover:text-primary text-muted"
        >
          {gameTitle}
        </Link>
        <IoChevronForward className="text-muted" size={14} />
        <span className="text-primary font-medium">Sponsor</span>
      </div>

      <div className="border-primary bg-surface border-2 p-6">
        <div className="space-y-1">
          <h2 className="fc-two-tone text-xl font-semibold">
            Sponsor This Game
          </h2>
          <p className="text-muted text-sm">{gameTitle}</p>
          <p className="text-muted text-sm">
            Sponsor this game and your details will be displayed on the match
            page.
          </p>
        </div>

        <div className="mt-4 space-y-4">
          {priceData && (
            <div className="border-primary bg-surface text-primary border-2 px-4 py-3 text-sm">
              Game sponsorship:{" "}
              <strong>
                {currencyFormatter.format(priceData.amountPence / 100)}
              </strong>
            </div>
          )}

          <div className="space-y-3">
            <div>
              <Label htmlFor="sponsorName">Your Name / Company Name *</Label>
              <Input
                id="sponsorName"
                value={sponsorName}
                onChange={(e) => update({ sponsorName: e.target.value })}
                placeholder="e.g. Smith & Sons Builders"
                maxLength={200}
              />
            </div>

            <div>
              <Label htmlFor="sponsorEmail">Contact Email *</Label>
              <Input
                id="sponsorEmail"
                type="email"
                value={sponsorEmail}
                onChange={(e) => update({ sponsorEmail: e.target.value })}
                placeholder="you@example.com"
              />
            </div>

            <div>
              <Label htmlFor="sponsorWebsite">Website URL</Label>
              <Input
                id="sponsorWebsite"
                type="text"
                placeholder="https://www.example.com (optional)"
                value={sponsorWebsite}
                onChange={(e) => update({ sponsorWebsite: e.target.value })}
              />
            </div>

            <div>
              <Label htmlFor="sponsorPhone">Phone</Label>
              <Input
                id="sponsorPhone"
                type="tel"
                placeholder="Optional"
                value={sponsorPhone}
                onChange={(e) => update({ sponsorPhone: e.target.value })}
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
                <p className="mt-1 text-xs text-red-700">{logoError}</p>
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
                onChange={(e) => update({ sponsorMessage: e.target.value })}
                placeholder='e.g. "Good luck lads!" or "In memory of…"'
                maxLength={MAX_MESSAGE_CHARS}
              />
              <p className="text-muted mt-1 text-xs">
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
        </div>

        <div className="mt-6 flex items-center justify-between">
          <Link
            to={`/calendar/game/${id}`}
            className="text-muted text-sm hover:underline"
          >
            Cancel
          </Link>
          <StampButton
            size="sm"
            onClick={() => paymentMutation.mutate()}
            disabled={!isFormValid || paymentMutation.isPending}
          >
            {paymentMutation.isPending
              ? "Processing…"
              : "Continue to Payment →"}
          </StampButton>
        </div>
      </div>
    </div>
  );
}
