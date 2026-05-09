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

  const gameQuery = useQuery({
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

  const game = gameQuery.data;
  const gameTitle = game
    ? `${game.team.name} vs ${game.opposition.club.name} ${game.opposition.team.name}`
    : "Game";

  useDocumentMeta(game ? `Sponsor: ${gameTitle}` : "Sponsor Game");

  // eslint-disable-next-line react-doctor/rerender-state-only-in-handlers -- `step` drives which checkout step renders (details → payment → confirm); useRef would not switch the view.
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

  const priceQuery = useQuery({
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

  if (gameQuery.isLoading) {
    return (
      <div className="container mx-auto max-w-md px-4 py-12">
        <div className="h-6 w-48 animate-pulse rounded bg-stone-200" />
      </div>
    );
  }

  if (!game) {
    return (
      <div className="container mx-auto max-w-md px-4 py-12">
        <h1>Game Not Found</h1>
        <Link to="/calendar" className="text-primary hover:underline">
          Back to Calendar
        </Link>
      </div>
    );
  }

  if (step === "success") {
    return (
      <div className="container mx-auto max-w-md px-4 py-12">
        <Card>
          <CardHeader>
            <CardTitle>Thank You!</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p>
              Thank you for sponsoring this game! Your sponsorship details will
              be reviewed by our team and displayed on the game page once
              approved.
            </p>
            <p className="text-sm text-stone-600">
              A confirmation email has been sent to {sponsorEmail}.
            </p>
          </CardContent>
          <CardFooter>
            <Link
              to={`/calendar/game/${id}`}
              className="text-primary text-sm hover:underline"
            >
              Back to game
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
        <Link to="/calendar" className="hover:text-primary text-stone-600">
          Calendar
        </Link>
        <IoChevronForward className="text-stone-400" size={14} />
        <Link
          to={`/calendar/game/${id}`}
          className="hover:text-primary text-stone-600"
        >
          {gameTitle}
        </Link>
        <IoChevronForward className="text-stone-400" size={14} />
        <span className="text-dark font-medium">Sponsor</span>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Sponsor This Game</CardTitle>
          <p className="text-sm text-stone-600">{gameTitle}</p>
          <p className="text-sm text-stone-600">
            Sponsor this game and your details will be displayed on the match
            page.
          </p>
        </CardHeader>

        <CardContent className="space-y-4">
          {priceQuery.data && (
            <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
              Game sponsorship:{" "}
              <strong>
                {currencyFormatter.format(priceQuery.data.amountPence / 100)}
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
                onChange={(e) => update({ sponsorMessage: e.target.value })}
                placeholder='e.g. "Good luck lads!" or "In memory of…"'
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
            to={`/calendar/game/${id}`}
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
