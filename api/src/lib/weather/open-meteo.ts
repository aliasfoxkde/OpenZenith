/**
 * Open-Meteo weather data fetcher.
 *
 * Uses the free Open-Meteo API (no API key required).
 * Provides current weather conditions and daily forecasts.
 *
 * API docs: https://open-meteo.com/en/docs
 */

interface WeatherCurrent {
  temperature: number;
  apparentTemperature: number;
  humidity: number;
  weatherCode: number;
  weatherDescription: string;
  windSpeed: number;
  windDirection: number;
  windGusts: number;
  pressure: number;
  precipitation: number;
  cloudCover: number;
  visibility: number;
  uvIndex: number;
  isDay: boolean;
}

interface WeatherDaily {
  date: string;
  tempMax: number;
  tempMin: number;
  precipitationSum: number;
  weatherCode: number;
  weatherDescription: string;
  sunrise: string;
  sunset: string;
  windSpeedMax: number;
  uvIndexMax: number;
}

export interface WeatherData {
  current: WeatherCurrent;
  daily: WeatherDaily[];
  units: {
    temperature: string;
    windSpeed: string;
    pressure: string;
    precipitation: string;
    visibility: string;
  };
  timezone: string;
  source: string;
}

/**
 * WMO Weather interpretation codes → descriptions.
 * https://open-meteo.com/en/docs#weathervariables
 */
const WMO_CODES: Record<number, string> = {
  0: "Clear sky",
  1: "Mainly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Fog",
  48: "Depositing rime fog",
  51: "Light drizzle",
  53: "Moderate drizzle",
  55: "Dense drizzle",
  56: "Light freezing drizzle",
  57: "Dense freezing drizzle",
  61: "Slight rain",
  63: "Moderate rain",
  65: "Heavy rain",
  66: "Light freezing rain",
  67: "Heavy freezing rain",
  71: "Slight snow fall",
  73: "Moderate snow fall",
  75: "Heavy snow fall",
  77: "Snow grains",
  80: "Slight rain showers",
  81: "Moderate rain showers",
  82: "Violent rain showers",
  85: "Slight snow showers",
  86: "Heavy snow showers",
  95: "Thunderstorm",
  96: "Thunderstorm with slight hail",
  99: "Thunderstorm with heavy hail",
};

function weatherDescription(code: number): string {
  return WMO_CODES[code] || "Unknown";
}

function windDirection(deg: number): string {
  const dirs = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  return dirs[Math.round(deg / 22.5) % 16];
}

/**
 * Fetch current weather and daily forecast from Open-Meteo.
 */
export async function getWeather(lat: number, lon: number, days: number = 3): Promise<WeatherData | null> {
  try {
    const params = new URLSearchParams({
      latitude: lat.toString(),
      longitude: lon.toString(),
      current: [
        "temperature_2m",
        "relative_humidity_2m",
        "apparent_temperature",
        "precipitation",
        "weather_code",
        "surface_pressure",
        "wind_speed_10m",
        "wind_direction_10m",
        "wind_gusts_10m",
        "cloud_cover",
        "visibility",
        "uv_index",
        "is_day",
      ].join(","),
      daily: [
        "temperature_2m_max",
        "temperature_2m_min",
        "precipitation_sum",
        "weather_code",
        "sunrise",
        "sunset",
        "wind_speed_10m_max",
        "uv_index_max",
      ].join(","),
      timezone: "auto",
      forecast_days: Math.min(days, 16).toString(),
    });

    const url = `https://api.open-meteo.com/v1/forecast?${params}`;
    const res = await fetch(url, {
      headers: { "User-Agent": "OpenZenith/1.0 (geospatial platform)" },
    });

    if (!res.ok) return null;

    const data = await res.json();
    if (data.error) return null;

    const c = data.current;
    const d = data.daily;

    const current: WeatherCurrent = {
      temperature: Math.round(c.temperature_2m * 10) / 10,
      apparentTemperature: Math.round(c.apparent_temperature * 10) / 10,
      humidity: c.relative_humidity_2m,
      weatherCode: c.weather_code,
      weatherDescription: weatherDescription(c.weather_code),
      windSpeed: Math.round(c.wind_speed_10m * 10) / 10,
      windDirection: c.wind_direction_10m,
      windGusts: Math.round(c.wind_gusts_10m * 10) / 10,
      pressure: Math.round(c.surface_pressure * 10) / 10,
      precipitation: c.precipitation,
      cloudCover: c.cloud_cover,
      visibility: c.visibility,
      uvIndex: c.uv_index,
      isDay: c.is_day === 1,
    };

    const daily: WeatherDaily[] = [];
    if (Array.isArray(d?.time)) {
      for (let i = 0; i < d.time.length; i++) {
        daily.push({
          date: d.time[i],
          tempMax: Math.round(d.temperature_2m_max[i] * 10) / 10,
          tempMin: Math.round(d.temperature_2m_min[i] * 10) / 10,
          precipitationSum: d.precipitation_sum[i],
          weatherCode: d.weather_code[i],
          weatherDescription: weatherDescription(d.weather_code[i]),
          sunrise: d.sunrise[i],
          sunset: d.sunset[i],
          windSpeedMax: Math.round(d.wind_speed_10m_max[i] * 10) / 10,
          uvIndexMax: d.uv_index_max[i],
        });
      }
    }

    return {
      current,
      daily,
      units: {
        temperature: data.current_units?.temperature_2m || "°C",
        windSpeed: data.current_units?.wind_speed_10m || "km/h",
        pressure: data.current_units?.surface_pressure || "hPa",
        precipitation: data.current_units?.precipitation || "mm",
        visibility: data.current_units?.visibility || "m",
      },
      timezone: data.timezone || "UTC",
      source: "open-meteo",
    };
  } catch {
    return null;
  }
}

/**
 * Wind direction as cardinal string (exported for use in query response).
 */
export { windDirection, weatherDescription, WMO_CODES };
