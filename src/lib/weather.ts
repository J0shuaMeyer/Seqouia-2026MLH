// ── Types ──────────────────────────────────────────────────────────

export interface WeatherData {
  tempF: number;
  weatherCode: number;
  aqi: number;
  aqiLabel: string;
}

// ── AQI label mapping ──────────────────────────────────────────────

function aqiToLabel(aqi: number): string {
  if (aqi <= 50) return "Good";
  if (aqi <= 100) return "Moderate";
  if (aqi <= 150) return "Unhealthy (SG)";
  if (aqi <= 200) return "Unhealthy";
  if (aqi <= 300) return "Very Unhealthy";
  return "Hazardous";
}

// ── Public API ──────────────────────────────────────────────────────

export async function fetchWeatherData(
  lat: number,
  lng: number,
): Promise<WeatherData> {
  const [weatherRes, aqiRes] = await Promise.allSettled([
    fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,weather_code&temperature_unit=fahrenheit&timezone=auto`,
      { signal: AbortSignal.timeout(8_000) },
    ),
    fetch(
      `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lng}&current=us_aqi&timezone=auto`,
      { signal: AbortSignal.timeout(8_000) },
    ),
  ]);

  let tempF = 0;
  let weatherCode = 0;
  let aqi = 0;

  if (weatherRes.status === "fulfilled" && weatherRes.value.ok) {
    const data = await weatherRes.value.json();
    tempF = Math.round(data.current?.temperature_2m ?? 0);
    weatherCode = data.current?.weather_code ?? 0;
  }

  if (aqiRes.status === "fulfilled" && aqiRes.value.ok) {
    const data = await aqiRes.value.json();
    aqi = data.current?.us_aqi ?? 0;
  }

  return { tempF, weatherCode, aqi, aqiLabel: aqiToLabel(aqi) };
}
