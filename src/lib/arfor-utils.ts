import type {
  CalendarEventSeed,
  RecurringBillSeed,
  WatchlistItem,
  WeatherCity,
  WeatherDay,
  WeatherHour,
} from "@/lib/mock-data";

export type DashboardEvent = CalendarEventSeed;
export type DashboardBill = RecurringBillSeed;
export type StockRange = "1W" | "1M" | "3M";

export function isoDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function addMonths(date: Date, count: number) {
  return new Date(date.getFullYear(), date.getMonth() + count, 1);
}

export function sameDay(left: Date, right: Date) {
  return left.toDateString() === right.toDateString();
}

export function formatShortDate(value: string | Date) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(
    typeof value === "string" ? new Date(`${value}T00:00:00`) : value,
  );
}

export function formatDateTime(date: string, time: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(`${date}T${time}:00`));
}

export function formatTemp(value: number) {
  return `${value}F`;
}

export function formatCadence(months: number) {
  if (months === 1) return "Monthly";
  if (months === 12) return "Yearly";
  return `Every ${months} months`;
}

export function seededNumber(seed: string, min: number, max: number) {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  }
  const normalized = (hash % 1000) / 1000;
  return min + normalized * (max - min);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function scaledHistory(history: number[], length: number, seed: string) {
  const steps = Array.from({ length }, (_, index) => {
    const position = (index / Math.max(length - 1, 1)) * (history.length - 1);
    const lowerIndex = Math.floor(position);
    const upperIndex = Math.ceil(position);
    const lower = history[lowerIndex];
    const upper = history[upperIndex];
    const interpolated = lower + (upper - lower) * (position - lowerIndex);
    const drift = seededNumber(`${seed}-${index}`, -0.018, 0.018);
    return Number((interpolated * (1 + drift)).toFixed(2));
  });

  return steps;
}

export function getStockHistory(stock: WatchlistItem, range: StockRange, dayKey: string) {
  if (range === "1W") {
    return scaledHistory(stock.history.slice(-5), 7, `${stock.ticker}-${dayKey}-1W`);
  }

  if (range === "3M") {
    const extended = [...stock.history, ...stock.history.slice(-4).map((value, index) => value + index * 4)];
    return scaledHistory(extended, 18, `${stock.ticker}-${dayKey}-3M`);
  }

  return scaledHistory(stock.history, 10, `${stock.ticker}-${dayKey}-1M`);
}

export function getStockSnapshot(stock: WatchlistItem, range: StockRange, dayKey: string) {
  const history = getStockHistory(stock, range, dayKey);
  const currentPrice = Number(history.at(-1)?.toFixed(2) ?? stock.price.toFixed(2));
  const previous = history.at(-2) ?? history[0] ?? currentPrice;
  const dayChange = Number((((currentPrice - previous) / Math.max(previous, 1)) * 100).toFixed(2));
  return { history, currentPrice, dayChange };
}

export function getBillDate(bill: DashboardBill, month: Date) {
  const start = startOfMonth(new Date(`${bill.startsAt}T00:00:00`));
  const diff =
    (month.getFullYear() - start.getFullYear()) * 12 + month.getMonth() - start.getMonth();

  if (diff < 0 || diff % bill.cadenceMonths !== 0) {
    return null;
  }

  return new Date(
    month.getFullYear(),
    month.getMonth(),
    Math.min(
      bill.dueDay,
      new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate(),
    ),
  );
}

export function getBillOccurrenceKey(billId: string, dueDate: Date) {
  return `${billId}:${isoDate(dueDate)}`;
}

export function getUpcomingBillOccurrences(
  bills: DashboardBill[],
  now: Date,
  paidCycles: string[],
  count = 8,
) {
  const months = Array.from({ length: 7 }, (_, index) => addMonths(startOfMonth(now), index));
  const occurrences = bills.flatMap((bill) =>
    months
      .map((month) => {
        const dueDate = getBillDate(bill, month);
        if (!dueDate) return null;

        const key = getBillOccurrenceKey(bill.id, dueDate);
        const daysAway = Math.ceil((dueDate.getTime() - now.getTime()) / 86400000);
        const paid = paidCycles.includes(key);
        const status = paid
          ? "paid"
          : daysAway < 0
            ? "overdue"
            : daysAway <= 3
              ? "due-soon"
              : "upcoming";

        return { bill, dueDate, key, daysAway, paid, status };
      })
      .filter(Boolean),
  );

  return occurrences
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .sort((left, right) => left.dueDate.getTime() - right.dueDate.getTime())
    .slice(0, count);
}

export function getCalendarDays(month: Date, events: DashboardEvent[], bills: DashboardBill[], paidCycles: string[]) {
  const leading = (month.getDay() + 6) % 7;
  return Array.from({ length: 35 }, (_, index) => {
    const date = new Date(month.getFullYear(), month.getMonth(), index - leading + 1);
    const dateIso = isoDate(date);
    const dueBills = bills.filter((bill) => {
      const due = getBillDate(bill, startOfMonth(date));
      return due ? sameDay(due, date) : false;
    });

    const billKeys = dueBills.map((bill) => getBillOccurrenceKey(bill.id, date));
    const paidCount = billKeys.filter((key) => paidCycles.includes(key)).length;

    return {
      date,
      dateIso,
      inMonth: date.getMonth() === month.getMonth(),
      events: events.filter((event) => event.date === dateIso),
      dueBills,
      paidCount,
      unpaidCount: dueBills.length - paidCount,
    };
  });
}

export function getConflictCount(events: DashboardEvent[], date: string, time: string) {
  return events.filter((event) => event.date === date && event.time === time).length;
}

export function getWeatherSnapshot(city: WeatherCity, dayKey: string) {
  const tempDrift = Math.round(seededNumber(`${city.name}-${dayKey}-temp`, -3, 3));
  const humidityDrift = Math.round(seededNumber(`${city.name}-${dayKey}-humidity`, -6, 6));
  const windDrift = Math.round(seededNumber(`${city.name}-${dayKey}-wind`, -3, 3));
  const rainDrift = Math.round(seededNumber(`${city.name}-${dayKey}-rain`, -8, 8));

  const hourly: WeatherHour[] = city.hourly.map((hour, index) => ({
    ...hour,
    tempF: hour.tempF + tempDrift + Math.round(seededNumber(`${city.name}-${dayKey}-hour-${index}`, -1, 1)),
  }));

  const daily: WeatherDay[] = city.daily.map((day, index) => ({
    ...day,
    highF: day.highF + tempDrift,
    lowF: day.lowF + tempDrift,
    rainChance: clamp(day.rainChance + rainDrift + index * 2, 0, 100),
  }));

  return {
    ...city,
    tempF: city.tempF + tempDrift,
    feelsLikeF: city.feelsLikeF + tempDrift,
    humidity: clamp(city.humidity + humidityDrift, 28, 95),
    windMph: clamp(city.windMph + windDrift, 1, 28),
    precipitationChance: clamp(city.precipitationChance + rainDrift, 0, 100),
    hourly,
    daily,
  };
}
