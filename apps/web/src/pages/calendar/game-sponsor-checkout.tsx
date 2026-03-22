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
import { api } from "@/lib/api";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { IoChevronForward } from "react-icons/io5";
import { Link, useParams } from "react-router";

const MAX_LOGO_BYTES = 150_000;
const MAX_MESSAGE_CHARS = 100;

const currencyFormatter = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  minimumFractionDigits: 2,
});

interface PriceInfo {
  amountPence: number;
  currency: string;
  productName: string;
}

interface PaymentResult {
  clientSecret: string;
  amount: number;
  productName: string;
}

interface GameData {
  id: string;
  team: { name: string };
  opposition: { club: { name: string }; team: { name: string } };
  home: boolean;
}

type Step = "details" | "paying" | "success";

function resizeLogo(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const maxDim = 300;
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          const ratio = Math.min(maxDim / width, maxDim / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Failed to create canvas context"));
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);

        for (let q = 0.8; q >= 0.1; q -= 0.1) {
          const dataUrl = canvas.toDataURL("image/jpeg", q);
          if (dataUrl.length <= MAX_LOGO_BYTES) {
            resolve(dataUrl);
            return;
          }
        }
        reject(new Error("Logo could not be compressed below 150KB"));
      };
      img.onerror = () => reject(new Error("Failed to load image"));
      img.src = reader.result as string;
    };
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

export function Component() {
  const { id } = useParams<{ id: string }>();

  const gameQuery = useQuery<GameData>({
    queryKey: ["game", id],
    queryFn: () => api.get(`/games/${id}`),
    enabled: !!id,
    staleTime: 5 * 60 * 1000,
  });

  const game = gameQuery.data;
  const gameTitle = game
    ? `${game.team.name} vs ${game.opposition.club.name} ${game.opposition.team.name}`
    : "Game";

  useDocumentMeta(game ? `Sponsor: ${gameTitle}` : "Sponsor Game");

  const [step, setStep] = useState<Step>("details");
  const [sponsorName, setSponsorName] = useState("");
  const [sponsorEmail, setSponsorEmail] = useState("");
  const [sponsorWebsite, setSponsorWebsite] = useState("");
  const [sponsorMessage, setSponsorMessage] = useState("");
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null);
  const [logoError, setLogoError] = useState<string | null>(null);

  const priceQuery = useQuery({
    queryKey: ["game-sponsorship-price"],
    queryFn: () => api.get<PriceInfo>("/sponsorship/game/price"),
    staleTime: 5 * 60 * 1000,
  });

  const paymentMutation = useMutation({
    mutationFn: () =>
      api.post<PaymentResult>("/sponsorship/game/create-payment", {
        gameId: id,
        sponsorName,
        sponsorEmail,
        sponsorWebsite: sponsorWebsite || undefined,
        sponsorLogoDataUrl: logoDataUrl ?? undefined,
        sponsorMessage: sponsorMessage || undefined,
      }),
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

  if (gameQuery.isLoading) {
    return (
      <div className="container mx-auto max-w-md px-4 py-12">
        <div className="h-6 w-48 animate-pulse rounded bg-gray-200" />
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
            <p className="text-sm text-gray-600">
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

  if (step === "paying" && paymentMutation.data) {
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
        <Link to="/calendar" className="hover:text-primary text-gray-600">
          Calendar
        </Link>
        <IoChevronForward className="text-gray-400" size={14} />
        <Link
          to={`/calendar/game/${id}`}
          className="hover:text-primary text-gray-600"
        >
          {gameTitle}
        </Link>
        <IoChevronForward className="text-gray-400" size={14} />
        <span className="text-dark font-medium">Sponsor</span>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Sponsor This Game</CardTitle>
          <p className="text-sm text-gray-600">{gameTitle}</p>
          <p className="text-sm text-gray-600">
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
                onChange={(e) => setSponsorName(e.target.value)}
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
                onChange={(e) => setSponsorEmail(e.target.value)}
                placeholder="you@example.com"
              />
            </div>

            <div>
              <Label htmlFor="sponsorWebsite">Website URL</Label>
              <Input
                id="sponsorWebsite"
                type="url"
                placeholder="https://"
                value={sponsorWebsite}
                onChange={(e) => setSponsorWebsite(e.target.value)}
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
                placeholder='e.g. "Good luck lads!" or "In memory of..."'
                maxLength={MAX_MESSAGE_CHARS}
              />
              <p className="mt-1 text-xs text-gray-400">
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
            className="text-sm text-gray-500 hover:underline"
          >
            Cancel
          </Link>
          <Button
            onClick={() => paymentMutation.mutate()}
            disabled={!isFormValid || paymentMutation.isPending}
          >
            {paymentMutation.isPending
              ? "Processing..."
              : "Continue to Payment"}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
