import { tool } from "ai";
import { z } from "zod";
import type { ScoutCache } from "./cache.ts";

// Open-Meteo is free and keyless. Forecast covers ~16 days ahead and up to 92
// past_days; archive starts ~1940. We split forecast vs archive on a 90-day
// boundary so recent matches still come from the higher-resolution forecast
// model (which has past data baked in via past_days). Anything older falls
// to the long-term archive.
const FORECAST_BASE = "https://api.open-meteo.com/v1/forecast";
const ARCHIVE_BASE = "https://archive-api.open-meteo.com/v1/archive";
const GEOCODING_BASE = "https://geocoding-api.open-meteo.com/v1/search";

// Variables we always pull. Daily aggregates are what cricket actually cares
// about (max temp, total rain, max wind); hourly is for matchday timing
// (e.g. did the rain hit during the chase?). Variable names are stable across
// forecast and archive endpoints.
const DAILY_VARS = [
  "weather_code",
  "temperature_2m_max",
  "temperature_2m_min",
  "precipitation_sum",
  "rain_sum",
  "windspeed_10m_max",
  "winddirection_10m_dominant",
  "shortwave_radiation_sum",
  "sunshine_duration",
] as const;

const HOURLY_VARS = [
  "temperature_2m",
  "relative_humidity_2m",
  "precipitation",
  "cloudcover",
  "windspeed_10m",
  "winddirection_10m",
] as const;

const HOUR = 60 * 60;
const DAY = 24 * HOUR;
const NINETY_DAYS_MS = 90 * DAY * 1000;

export interface WeatherToolDeps {
  cache: ScoutCache;
}

export function createWeatherTools(deps: WeatherToolDeps) {
  const { cache } = deps;

  return {
    weather_get: tool({
      description: `Fetch weather for a cricket ground on a given date (or date range). Routes to Open-Meteo's forecast API for recent/upcoming dates and the archive API for older dates. Returns daily aggregates (max/min temp, total rain, peak wind, sunshine) and hourly series for the day.

Use this when weather is plausibly relevant: matchday planning (toss decision, bowling plans), post-mortem of a low-scoring innings, or scouting opposition form across conditions.

Prefer passing latitude/longitude when you already have them — every Play Cricket match summary row carries ground_latitude and ground_longitude. Fall back to weather_geocode (then call this tool with the result) if you only have a place name.`,
      inputSchema: z.object({
        latitude: z.number().describe("WGS84 latitude, e.g. 55.0167."),
        longitude: z.number().describe("WGS84 longitude, e.g. -1.45."),
        startDate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, "Use yyyy-mm-dd")
          .describe(
            "Start date in yyyy-mm-dd. Use the same value as endDate for a single day.",
          ),
        endDate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, "Use yyyy-mm-dd")
          .describe("End date in yyyy-mm-dd. Inclusive."),
        timezone: z
          .string()
          .default("Europe/London")
          .describe(
            "IANA timezone for daily aggregation boundaries. Defaults to Europe/London (Percy Main's home timezone).",
          ),
      }),
      execute: async ({ latitude, longitude, startDate, endDate, timezone }) =>
        cache.getOrSet(
          "weather_get",
          { latitude, longitude, startDate, endDate, timezone },
          24 * HOUR,
          () =>
            fetchWeather({ latitude, longitude, startDate, endDate, timezone }),
        ),
    }),

    weather_geocode: tool({
      description: `Look up latitude/longitude for a place by name. Use this only when a Play Cricket match summary row doesn't carry ground_latitude/ground_longitude — most do, so check first. Returns up to 5 candidates; the agent picks the right one (e.g. by country=GB).`,
      inputSchema: z.object({
        name: z
          .string()
          .min(1)
          .describe(
            "Place name to search — ground name, suburb, postcode, or town.",
          ),
      }),
      execute: async ({ name }) =>
        cache.getOrSet("weather_geocode", { name }, 30 * DAY, () =>
          fetchGeocode(name),
        ),
    }),
  };
}

export type WeatherTools = ReturnType<typeof createWeatherTools>;

interface FetchWeatherArgs {
  latitude: number;
  longitude: number;
  startDate: string;
  endDate: string;
  timezone: string;
}

async function fetchWeather(args: FetchWeatherArgs) {
  const useArchive = isArchiveRange(args.startDate, args.endDate);
  const base = useArchive ? ARCHIVE_BASE : FORECAST_BASE;

  const url = new URL(base);
  url.searchParams.set("latitude", String(args.latitude));
  url.searchParams.set("longitude", String(args.longitude));
  url.searchParams.set("start_date", args.startDate);
  url.searchParams.set("end_date", args.endDate);
  url.searchParams.set("timezone", args.timezone);
  url.searchParams.set("daily", DAILY_VARS.join(","));
  url.searchParams.set("hourly", HOURLY_VARS.join(","));
  url.searchParams.set("wind_speed_unit", "mph");
  url.searchParams.set("precipitation_unit", "mm");

  const res = await fetch(url);
  const body = await res.text();
  if (!res.ok) {
    throw new Error(
      `Open-Meteo ${useArchive ? "archive" : "forecast"} error (HTTP ${res.status}): ${body.slice(0, 500)}`,
    );
  }

  const json = JSON.parse(body) as Record<string, unknown>;
  return {
    source: useArchive ? ("archive" as const) : ("forecast" as const),
    ...json,
  };
}

async function fetchGeocode(name: string) {
  const url = new URL(GEOCODING_BASE);
  url.searchParams.set("name", name);
  url.searchParams.set("count", "5");
  url.searchParams.set("language", "en");
  url.searchParams.set("format", "json");

  const res = await fetch(url);
  const body = await res.text();
  if (!res.ok) {
    throw new Error(
      `Open-Meteo geocoding error (HTTP ${res.status}): ${body.slice(0, 500)}`,
    );
  }
  return JSON.parse(body) as unknown;
}

// The forecast endpoint accepts past dates up to ~92 days back; the archive
// endpoint covers everything older. Using forecast for recent past gives
// higher-resolution local data, so route on a 90-day boundary.
function isArchiveRange(start: string, end: string): boolean {
  const now = Date.now();
  const earliest = Math.min(parseDateUtc(start), parseDateUtc(end));
  return now - earliest > NINETY_DAYS_MS;
}

function parseDateUtc(yyyymmdd: string): number {
  // yyyy-mm-dd → midnight UTC. Comparison only — no DST nonsense to worry about.
  return Date.parse(`${yyyymmdd}T00:00:00Z`);
}
