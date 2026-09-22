import { describe, it, expect, vi, afterEach } from "vitest";
import { getWeather, weatherDescription, windDirection, WMO_CODES } from "../weather/open-meteo";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function openMeteoPayload() {
  return {
    latitude: 40.7,
    longitude: -74,
    timezone: "America/New_York",
    current_units: {
      temperature_2m: "°F",
      wind_speed_10m: "mph",
      surface_pressure: "inHg",
      precipitation: "inch",
      visibility: "ft",
    },
    current: {
      temperature_2m: 21.44,
      relative_humidity_2m: 62,
      apparent_temperature: 20.55,
      precipitation: 0.2,
      weather_code: 61,
      surface_pressure: 1014.25,
      wind_speed_10m: 12.34,
      wind_direction_10m: 202.5,
      wind_gusts_10m: 25.0,
      cloud_cover: 100,
      visibility: 12000,
      uv_index: 1.5,
      is_day: 1,
    },
    daily: {
      time: ["2026-01-01", "2026-01-02"],
      temperature_2m_max: [5.05, 6.0],
      temperature_2m_min: [-1.04, 0.0],
      precipitation_sum: [1.5, 0],
      weather_code: [61, 0],
      sunrise: ["2026-01-01T07:20", "2026-01-02T07:20"],
      sunset: ["2026-01-01T16:35", "2026-01-02T16:36"],
      wind_speed_10m_max: [30.5, 10],
      uv_index_max: [1.6, 1.7],
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("WMO_CODES", () => {
  it("covers the documented WMO interpretation codes", () => {
    expect(WMO_CODES[0]).toBe("Clear sky");
    expect(WMO_CODES[3]).toBe("Overcast");
    expect(WMO_CODES[45]).toBe("Fog");
    expect(WMO_CODES[65]).toBe("Heavy rain");
    expect(WMO_CODES[75]).toBe("Heavy snow fall");
    expect(WMO_CODES[95]).toBe("Thunderstorm");
    expect(WMO_CODES[99]).toBe("Thunderstorm with heavy hail");
  });

  it("holds exactly 28 entries", () => {
    expect(Object.keys(WMO_CODES)).toHaveLength(28);
  });
});

describe("weatherDescription", () => {
  it("maps known codes to descriptions", () => {
    expect(weatherDescription(0)).toBe("Clear sky");
    expect(weatherDescription(2)).toBe("Partly cloudy");
    expect(weatherDescription(53)).toBe("Moderate drizzle");
    expect(weatherDescription(86)).toBe("Heavy snow showers");
  });

  it("falls back to Unknown for undocumented codes", () => {
    expect(weatherDescription(4)).toBe("Unknown");
    expect(weatherDescription(-1)).toBe("Unknown");
    expect(weatherDescription(100)).toBe("Unknown");
  });
});

describe("windDirection", () => {
  it("maps degrees to the 16-point compass rose", () => {
    expect(windDirection(0)).toBe("N");
    expect(windDirection(22.5)).toBe("NNE");
    expect(windDirection(45)).toBe("NE");
    expect(windDirection(67.5)).toBe("ENE");
    expect(windDirection(90)).toBe("E");
    expect(windDirection(112.5)).toBe("ESE");
    expect(windDirection(135)).toBe("SE");
    expect(windDirection(157.5)).toBe("SSE");
    expect(windDirection(180)).toBe("S");
    expect(windDirection(202.5)).toBe("SSW");
    expect(windDirection(225)).toBe("SW");
    expect(windDirection(247.5)).toBe("WSW");
    expect(windDirection(270)).toBe("W");
    expect(windDirection(292.5)).toBe("WNW");
    expect(windDirection(315)).toBe("NW");
    expect(windDirection(337.5)).toBe("NNW");
  });

  it("wraps full circle back to north", () => {
    expect(windDirection(360)).toBe("N");
    expect(windDirection(720)).toBe("N");
  });

  it("rounds sub-bin values to the nearest point", () => {
    // 11.25 / 22.5 = 0.5 -> rounds up to 1 -> NNE
    expect(windDirection(11.25)).toBe("NNE");
    expect(windDirection(10)).toBe("N");
    expect(windDirection(15)).toBe("NNE");
    // 190 / 22.5 = 8.44 -> 8 -> S
    expect(windDirection(190)).toBe("S");
  });
});

describe("getWeather", () => {
  it("parses current conditions and the daily forecast", async () => {
    const fetchMock = vi.fn(() => jsonResponse(openMeteoPayload()));
    vi.stubGlobal("fetch", fetchMock);

    const result = await getWeather(40.7, -74);

    expect(result).not.toBeNull();
    expect(result?.source).toBe("open-meteo");
    expect(result?.timezone).toBe("America/New_York");
    expect(result?.current).toEqual({
      temperature: 21.4,
      apparentTemperature: 20.6,
      humidity: 62,
      weatherCode: 61,
      weatherDescription: "Slight rain",
      windSpeed: 12.3,
      windDirection: 202.5,
      windGusts: 25,
      pressure: 1014.3,
      precipitation: 0.2,
      cloudCover: 100,
      visibility: 12000,
      uvIndex: 1.5,
      isDay: true,
    });
    expect(result?.daily).toEqual([
      {
        date: "2026-01-01",
        tempMax: 5.1,
        tempMin: -1,
        precipitationSum: 1.5,
        weatherCode: 61,
        weatherDescription: "Slight rain",
        sunrise: "2026-01-01T07:20",
        sunset: "2026-01-01T16:35",
        windSpeedMax: 30.5,
        uvIndexMax: 1.6,
      },
      {
        date: "2026-01-02",
        tempMax: 6,
        tempMin: 0,
        precipitationSum: 0,
        weatherCode: 0,
        weatherDescription: "Clear sky",
        sunrise: "2026-01-02T07:20",
        sunset: "2026-01-02T16:36",
        windSpeedMax: 10,
        uvIndexMax: 1.7,
      },
    ]);
  });

  it("reports upstream units when provided", async () => {
    const fetchMock = vi.fn(() => jsonResponse(openMeteoPayload()));
    vi.stubGlobal("fetch", fetchMock);

    const result = await getWeather(40.7, -74);
    expect(result?.units).toEqual({
      temperature: "°F",
      windSpeed: "mph",
      pressure: "inHg",
      precipitation: "inch",
      visibility: "ft",
    });
  });

  it("falls back to metric defaults when units are absent", async () => {
    const payload = openMeteoPayload();
    const body = { current: payload.current, daily: payload.daily };
    const fetchMock = vi.fn(() => jsonResponse(body));
    vi.stubGlobal("fetch", fetchMock);

    const result = await getWeather(40.7, -74);
    expect(result?.units).toEqual({
      temperature: "°C",
      windSpeed: "km/h",
      pressure: "hPa",
      precipitation: "mm",
      visibility: "m",
    });
    // timezone falls back to UTC
    expect(result?.timezone).toBe("UTC");
  });

  it("is_day is false for the night value", async () => {
    const payload = openMeteoPayload();
    payload.current.is_day = 0;
    const fetchMock = vi.fn(() => jsonResponse(payload));
    vi.stubGlobal("fetch", fetchMock);

    const result = await getWeather(40.7, -74);
    expect(result?.current.isDay).toBe(false);
  });

  it("returns an empty daily list when the forecast block is missing", async () => {
    const payload = openMeteoPayload();
    const body = { current: payload.current, current_units: payload.current_units };
    const fetchMock = vi.fn(() => jsonResponse(body));
    vi.stubGlobal("fetch", fetchMock);

    const result = await getWeather(40.7, -74);
    expect(result?.daily).toEqual([]);
    expect(result?.current.temperature).toBe(21.4);
  });

  it("returns null for a non-200 response", async () => {
    const fetchMock = vi.fn(() => jsonResponse({ error: true, reason: "quota" }, 400));
    vi.stubGlobal("fetch", fetchMock);

    expect(await getWeather(40.7, -74)).toBeNull();
  });

  it("returns null when the API reports an error envelope", async () => {
    const fetchMock = vi.fn(() => jsonResponse({ error: true, reason: "out of range" }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await getWeather(40.7, -74)).toBeNull();
  });

  it("returns null for a malformed payload without a current block", async () => {
    const fetchMock = vi.fn(() => jsonResponse({ daily: {} }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await getWeather(40.7, -74)).toBeNull();
  });

  it("returns null when the payload is not JSON", async () => {
    const fetchMock = vi.fn(() => new Response("<html>oops</html>", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await getWeather(40.7, -74)).toBeNull();
  });

  it("returns null when the network request rejects", async () => {
    const fetchMock = vi.fn(() => {
      throw new TypeError("fetch failed");
    });
    vi.stubGlobal("fetch", fetchMock);

    expect(await getWeather(40.7, -74)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("builds the request URL with coordinates, variables and clamped forecast_days", async () => {
    const fetchMock = vi.fn((_input: string) => jsonResponse(openMeteoPayload()));
    vi.stubGlobal("fetch", fetchMock);

    await getWeather(40.7, -74);

    const url = fetchMock.mock.calls[0][0];
    expect(url.startsWith("https://api.open-meteo.com/v1/forecast?")).toBe(true);
    const params = new URL(url).searchParams;
    expect(params.get("latitude")).toBe("40.7");
    expect(params.get("longitude")).toBe("-74");
    expect(params.get("timezone")).toBe("auto");
    expect(params.get("forecast_days")).toBe("3");
    const currentVars = (params.get("current") ?? "").split(",");
    expect(currentVars).toContain("temperature_2m");
    expect(currentVars).toContain("relative_humidity_2m");
    expect(currentVars).toContain("apparent_temperature");
    expect(currentVars).toContain("weather_code");
    expect(currentVars).toContain("surface_pressure");
    expect(currentVars).toContain("wind_speed_10m");
    expect(currentVars).toContain("wind_direction_10m");
    expect(currentVars).toContain("wind_gusts_10m");
    expect(currentVars).toContain("cloud_cover");
    expect(currentVars).toContain("visibility");
    expect(currentVars).toContain("uv_index");
    expect(currentVars).toContain("is_day");
    const dailyVars = (params.get("daily") ?? "").split(",");
    expect(dailyVars).toEqual([
      "temperature_2m_max",
      "temperature_2m_min",
      "precipitation_sum",
      "weather_code",
      "sunrise",
      "sunset",
      "wind_speed_10m_max",
      "uv_index_max",
    ]);
  });

  it("clamps forecast_days to the 16 day API maximum", async () => {
    const fetchMock = vi.fn((_input: string) => jsonResponse(openMeteoPayload()));
    vi.stubGlobal("fetch", fetchMock);

    await getWeather(40.7, -74, 100);
    expect(new URL(fetchMock.mock.calls[0][0]).searchParams.get("forecast_days")).toBe("16");

    await getWeather(40.7, -74, 7);
    expect(new URL(fetchMock.mock.calls[1][0]).searchParams.get("forecast_days")).toBe("7");
  });
});
