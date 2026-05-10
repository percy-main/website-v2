import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";
import type { ScoutCache } from "./cache.ts";
import { createWeatherTools } from "./weather.ts";

// Cache that always misses — keeps test focus on the fetch path.
const passthroughCache: ScoutCache = {
  getOrSet: async (_tool, _args, _ttl, fetcher) => fetcher(),
};

const opts = {
  toolCallId: "test-call",
  messages: [],
  abortSignal: undefined,
} as unknown as Parameters<
  NonNullable<ReturnType<typeof createWeatherTools>["weather_get"]["execute"]>
>[1];

const tools = createWeatherTools({ cache: passthroughCache });

async function runWeather(input: {
  latitude: number;
  longitude: number;
  startDate: string;
  endDate: string;
  timezone?: string;
}) {
  const exec = tools.weather_get.execute;
  if (!exec) throw new Error("no execute");
  return exec({ timezone: "Europe/London", ...input }, opts) as Promise<{
    source: "forecast" | "archive";
  }>;
}

let fetchSpy: MockInstance<typeof fetch>;

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ daily: { time: [] } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
});

afterEach(() => {
  fetchSpy.mockRestore();
});

describe("weather_get routing", () => {
  it("uses the forecast endpoint for upcoming dates", async () => {
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    await runWeather({
      latitude: 55.0167,
      longitude: -1.45,
      startDate: tomorrow,
      endDate: tomorrow,
    });
    const url = fetchSpy.mock.calls[0][0] as URL;
    expect(url.toString()).toContain("api.open-meteo.com/v1/forecast");
  });

  it("uses the forecast endpoint for recent past (within 90 days)", async () => {
    const recent = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    await runWeather({
      latitude: 55.0167,
      longitude: -1.45,
      startDate: recent,
      endDate: recent,
    });
    const url = fetchSpy.mock.calls[0][0] as URL;
    expect(url.toString()).toContain("/v1/forecast");
  });

  it("uses the archive endpoint for old dates", async () => {
    await runWeather({
      latitude: 55.0167,
      longitude: -1.45,
      startDate: "2024-07-01",
      endDate: "2024-07-01",
    });
    const url = fetchSpy.mock.calls[0][0] as URL;
    expect(url.toString()).toContain("archive-api.open-meteo.com/v1/archive");
  });

  it("passes daily and hourly variables, lat/lng, and timezone", async () => {
    await runWeather({
      latitude: 55.0167,
      longitude: -1.45,
      startDate: "2024-07-01",
      endDate: "2024-07-01",
    });
    const url = fetchSpy.mock.calls[0][0] as URL;
    expect(url.searchParams.get("latitude")).toBe("55.0167");
    expect(url.searchParams.get("longitude")).toBe("-1.45");
    expect(url.searchParams.get("start_date")).toBe("2024-07-01");
    expect(url.searchParams.get("end_date")).toBe("2024-07-01");
    expect(url.searchParams.get("timezone")).toBe("Europe/London");
    // Sanity-check a few of the variables we always pull.
    expect(url.searchParams.get("daily")).toContain("precipitation_sum");
    expect(url.searchParams.get("daily")).toContain("temperature_2m_max");
    expect(url.searchParams.get("hourly")).toContain("relative_humidity_2m");
  });

  it("tags the source on the response", async () => {
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const result = await runWeather({
      latitude: 0,
      longitude: 0,
      startDate: tomorrow,
      endDate: tomorrow,
    });
    expect(result.source).toBe("forecast");
  });

  it("throws on non-2xx response", async () => {
    fetchSpy.mockResolvedValueOnce(new Response("nope", { status: 500 }));
    await expect(
      runWeather({
        latitude: 0,
        longitude: 0,
        startDate: "2024-07-01",
        endDate: "2024-07-01",
      }),
    ).rejects.toThrow(/Open-Meteo archive/);
  });
});

describe("weather_geocode", () => {
  function runGeocode(name: string) {
    const exec = tools.weather_geocode.execute;
    if (!exec) throw new Error("no execute");
    return exec({ name }, opts);
  }

  it("calls the geocoding endpoint with the place name", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ results: [] }), { status: 200 }),
    );
    await runGeocode("Percy Main");
    const url = fetchSpy.mock.calls[0][0] as URL;
    expect(url.toString()).toContain("geocoding-api.open-meteo.com/v1/search");
    expect(url.searchParams.get("name")).toBe("Percy Main");
    expect(url.searchParams.get("count")).toBe("5");
  });
});
