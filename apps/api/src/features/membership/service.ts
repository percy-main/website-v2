import type { StripeConfig } from "@percy-main/shared";
import type Stripe from "stripe";

function formatPrice(price: Stripe.Price): {
  id: string;
  unitAmount: number;
  formattedPrice: string;
  mode: "subscription" | "payment";
} {
  const unitAmount = price.unit_amount ?? 0;
  return {
    id: price.id,
    unitAmount,
    formattedPrice: `£${(unitAmount / 100).toFixed(2)}`,
    mode: price.type === "recurring" ? "subscription" : "payment",
  };
}

/**
 * Fetch all membership prices from Stripe, grouped by product.
 */
export function getMembershipPrices(
  stripe: Stripe,
  stripeConfig: StripeConfig,
) {
  return async () => {
    const productIds = stripeConfig.product;

    // Fetch all active prices for each product in parallel
    const [playerPrices, socialPrices, concessionaryPrices, womenPrices] =
      await Promise.all(
        [
          productIds.subs_player,
          productIds.subs_social,
          productIds.subs_concessionary,
          productIds.subs_women_player,
        ].map((productId) =>
          stripe.prices.list({
            product: productId,
            active: true,
          }),
        ),
      );

    const findByMode = (
      prices: Stripe.ApiList<Stripe.Price>,
      mode: "recurring" | "one_time",
    ) => {
      const price = prices.data.find((p) => p.type === mode);
      if (!price) throw new Error(`Missing ${mode} price`);
      return formatPrice(price);
    };

    return {
      senior_player: {
        name: "Senior Player",
        monthly: findByMode(playerPrices, "recurring"),
        annually: findByMode(playerPrices, "one_time"),
      },
      social: {
        name: "Social",
        monthly: findByMode(socialPrices, "recurring"),
        annually: findByMode(socialPrices, "one_time"),
      },
      concessionary: {
        name: "Student / Concessionary",
        monthly: findByMode(concessionaryPrices, "recurring"),
        annually: findByMode(concessionaryPrices, "one_time"),
      },
      senior_women_player: {
        name: "Women's Player",
        monthly: findByMode(womenPrices, "recurring"),
        annually: findByMode(womenPrices, "one_time"),
      },
    };
  };
}
