import { GoogleAdsApi, type Customer } from "google-ads-api";
import type { Config } from "../../config.ts";

/**
 * Typed errors so the drain loop can decide retryable vs not.
 */
export class AdsValidationError extends Error {
  constructor(
    message: string,
    public readonly fieldErrors?: unknown,
  ) {
    super(message);
    this.name = "AdsValidationError";
  }
}

export class AdsTransientError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "AdsTransientError";
  }
}

/**
 * Minimal ClickConversion shape we build in the payload-builder; the SDK
 * accepts much more but we only set what we need.
 */
export interface ClickConversionPayload {
  conversion_action: string;
  conversion_date_time: string;
  conversion_value: number;
  currency_code: string;
  order_id: string;
  gclid: string;
  consent?: {
    ad_user_data: "GRANTED" | "DENIED" | "UNSPECIFIED";
    ad_personalization: "GRANTED" | "DENIED" | "UNSPECIFIED";
  };
}

export interface AdsClient {
  /**
   * Uploads a batch of click conversions. Resolves on success;
   * rejects with AdsValidationError on 4xx, AdsTransientError on
   * 5xx / 429 / network. The drain loop decides retry strategy from
   * the error class.
   */
  uploadClickConversions(conversions: ClickConversionPayload[]): Promise<void>;
}

class NoopAdsClient implements AdsClient {
  uploadClickConversions(conversions: ClickConversionPayload[]): Promise<void> {
    // Inert when env vars are absent — keeps local dev clean.
    void conversions;
    return Promise.resolve();
  }
}

class GoogleAdsApiClient implements AdsClient {
  constructor(
    private readonly customer: Customer,
    private readonly customerId: string,
  ) {}

  async uploadClickConversions(
    conversions: ClickConversionPayload[],
  ): Promise<void> {
    if (conversions.length === 0) return;
    try {
      const request = {
        customer_id: this.customerId,
        conversions,
        partial_failure: true,
        validate_only: false,
      };
      type UploadFn = (
        request: unknown,
      ) => Promise<{ partial_failure_error?: unknown }>;
      const upload = this.customer.conversionUploads
        .uploadClickConversions as unknown as UploadFn;
      const response = await upload(request);

      const partial = (response as { partial_failure_error?: unknown })
        .partial_failure_error;
      if (partial) {
        let detail: string;
        try {
          detail = JSON.stringify(partial);
        } catch {
          detail = Object.prototype.toString.call(partial);
        }
        throw new AdsValidationError(
          `Google Ads partial_failure_error on uploadClickConversions: ${detail}`,
          partial,
        );
      }
    } catch (err) {
      if (err instanceof AdsValidationError) throw err;
      const status = (err as { code?: number; status?: string }).code;
      const message = err instanceof Error ? err.message : String(err);

      // Validation: malformed conversion action, bad order_id, etc. Code 3
      // is INVALID_ARGUMENT in gRPC. Treat 4xx-equivalents as terminal.
      if (status === 3 || status === 9) {
        throw new AdsValidationError(message, err);
      }
      throw new AdsTransientError(message, err);
    }
  }
}

interface AdsClientConfig {
  GOOGLE_ADS_DEVELOPER_TOKEN?: string;
  GOOGLE_ADS_CUSTOMER_ID?: string;
  GOOGLE_ADS_LOGIN_CUSTOMER_ID?: string;
  GOOGLE_ADS_OAUTH_CLIENT_ID?: string;
  GOOGLE_ADS_OAUTH_CLIENT_SECRET?: string;
  GOOGLE_ADS_OAUTH_REFRESH_TOKEN?: string;
}

export function createAdsClient(config: AdsClientConfig | Config): AdsClient {
  const developerToken = config.GOOGLE_ADS_DEVELOPER_TOKEN;
  const customerId = config.GOOGLE_ADS_CUSTOMER_ID;
  const clientId = config.GOOGLE_ADS_OAUTH_CLIENT_ID;
  const clientSecret = config.GOOGLE_ADS_OAUTH_CLIENT_SECRET;
  const refreshToken = config.GOOGLE_ADS_OAUTH_REFRESH_TOKEN;

  if (
    !developerToken ||
    !customerId ||
    !clientId ||
    !clientSecret ||
    !refreshToken
  ) {
    return new NoopAdsClient();
  }

  const api = new GoogleAdsApi({
    client_id: clientId,
    client_secret: clientSecret,
    developer_token: developerToken,
  });

  const customer = api.Customer({
    customer_id: customerId,
    login_customer_id: config.GOOGLE_ADS_LOGIN_CUSTOMER_ID,
    refresh_token: refreshToken,
  });

  return new GoogleAdsApiClient(customer, customerId);
}

export function isNoopAdsClient(client: AdsClient): boolean {
  return client instanceof NoopAdsClient;
}
