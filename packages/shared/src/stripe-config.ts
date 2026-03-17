/**
 * Stripe price and product IDs, split by environment.
 *
 * Ported from v1's `stripe.json`. These are not secrets — they're
 * public identifiers used to initiate Stripe Checkout flows.
 */

export interface StripeConfig {
  stripeEnv: "live" | "test";
  prices: {
    sponsorship: string;
    playerSponsorship: string;
    donation: string;
    nets: string;
  };
  product: {
    subs_player: string;
    subs_social: string;
    subs_concessionary: string;
    subs_women_player: string;
  };
}

const live: StripeConfig = {
  stripeEnv: "live",
  prices: {
    sponsorship: "price_1QeNAEIoYmCDxYlku6fuUon5",
    playerSponsorship: "price_1T5OHzIoYmCDxYlkFusp3IzK",
    donation: "price_1Qg3v7IoYmCDxYlkVFuUKYXX",
    nets: "price_1QgUuVIoYmCDxYlke2hIm9ku",
  },
  product: {
    subs_player: "prod_RYaHXiECGLyH9k",
    subs_social: "prod_RYaMScmSF06OQp",
    subs_concessionary: "prod_U72kxbH8P7IZy3",
    subs_women_player: "prod_U7DLUVb24JKSJT",
  },
};

const dev: StripeConfig = {
  stripeEnv: "test",
  prices: {
    sponsorship: "price_1QlwpNIoYmCDxYlk50mvNJ6R",
    playerSponsorship: "price_1T5OIUIoYmCDxYlk19ArCJpi",
    donation: "price_1PHSBTIoYmCDxYlkBoo86Xdb",
    nets: "price_1QnTf1IoYmCDxYlkLJelFvkH",
  },
  product: {
    subs_player: "prod_RfHLa2wMmBDJcK",
    subs_social: "prod_RfHN1rXeCNb2a9",
    subs_concessionary: "prod_U72ie4uTjyR3NY",
    subs_women_player: "prod_U7DNq47xD5h8tK",
  },
};

export const stripeConfig = { live, dev };
