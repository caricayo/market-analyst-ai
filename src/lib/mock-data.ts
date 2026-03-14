export const newsTypes = ["Markets", "Tech", "World", "Culture", "Policy"] as const;

export type NewsCategory = (typeof newsTypes)[number];

export type NewsPanel = {
  id: string;
  category: NewsCategory;
  headline: string;
  source: string;
  summary: string;
  readTime: string;
  mood: string;
  orb: string;
  keyPoints: string[];
  impact: string;
};

export type WatchlistItem = {
  ticker: string;
  company: string;
  price: number;
  dayChange: number;
  history: number[];
  thesis: string;
  rating: string;
  sectors: string[];
  conviction: number;
  userAdded?: boolean;
};

export type StockSuggestion = {
  ticker: string;
  company: string;
  rating: string;
  thesis: string;
  seedHistory: number[];
  catalyst: string;
};

export type StockNewsEntry = {
  headline: string;
  source: string;
  tone: string;
};

export type WeatherHour = {
  time: string;
  tempF: number;
  label: string;
};

export type WeatherDay = {
  day: string;
  highF: number;
  lowF: number;
  label: string;
  rainChance: number;
};

export type WeatherCity = {
  name: string;
  region: string;
  condition: string;
  summary: string;
  tempF: number;
  feelsLikeF: number;
  humidity: number;
  windMph: number;
  precipitationChance: number;
  uv: string;
  sunrise: string;
  sunset: string;
  hourly: WeatherHour[];
  daily: WeatherDay[];
};

export type GameEntry = {
  slug: string;
  name: string;
  description: string;
  tagline: string;
  sessionLength: string;
  mode: string;
  license: string;
  sourceName: string;
  sourceUrl: string;
  accent: string;
};

export type CalendarEventSeed = {
  id: string;
  title: string;
  date: string;
  time: string;
  reminderMinutes: number;
  category: string;
  notes: string;
  completed?: boolean;
};

export type RecurringBillSeed = {
  id: string;
  name: string;
  amount: number;
  dueDay: number;
  cadenceMonths: number;
  startsAt: string;
  autopay: boolean;
  category: string;
  account: string;
};

export const newsPanels: NewsPanel[] = [
  {
    id: "markets-soft-landing",
    category: "Markets",
    headline: "Rate-sensitive names are regaining flow as traders lean into a soft-landing week.",
    source: "Arfor Wire",
    summary:
      "Treasury volatility eased overnight, reopening appetite for software, semis, and selective consumer growth names without turning the tape euphoric.",
    readTime: "4 min read",
    mood: "Measured risk-on",
    orb: "radial-gradient(circle, rgba(226,187,105,0.38), transparent 68%)",
    keyPoints: [
      "Duration pressure is easing for growth-heavy baskets.",
      "Leadership is broadening, but not fully rotating.",
      "Desks still want confirmation from volume and breadth.",
    ],
    impact: "Watch software, semis, and discretionary strength into the close.",
  },
  {
    id: "tech-agent-workflows",
    category: "Tech",
    headline: "AI copilots are shifting from novelty assistants into workflow surfaces with memory and action depth.",
    source: "Signal Lab",
    summary:
      "The strongest product motion is happening where agents sit inside dense personal workflows: planning, calendar control, recurring tasks, and research loops.",
    readTime: "6 min read",
    mood: "Product acceleration",
    orb: "radial-gradient(circle, rgba(124,196,255,0.35), transparent 68%)",
    keyPoints: [
      "Products with action depth are pulling away from simple chat wrappers.",
      "Personal memory and recurring workflows are the strongest retention levers.",
      "The winning UX pattern is less inbox, more command surface.",
    ],
    impact: "Workflow-native AI products should keep compounding user time spent.",
  },
  {
    id: "world-shipping-friction",
    category: "World",
    headline: "Energy and shipping desks are watching regional friction, but freight pricing has not yet broken trend.",
    source: "Global Current",
    summary:
      "Cross-border supply sensitivity remains high. Markets are treating it as a watch item instead of a confirmed disruption event.",
    readTime: "5 min read",
    mood: "Cautious",
    orb: "radial-gradient(circle, rgba(247,179,232,0.3), transparent 68%)",
    keyPoints: [
      "Freight desks still see concern rather than hard dislocation.",
      "Energy sensitivity remains elevated around headlines.",
      "Equity traders are waiting for cost pass-through evidence.",
    ],
    impact: "No panic yet, but transport and industrial names are one headline away from repricing.",
  },
  {
    id: "culture-mood-objects",
    category: "Culture",
    headline: "The best consumer apps are becoming mood objects as much as utility layers.",
    source: "Studio Index",
    summary:
      "Rounded density, tactile translucency, and a distinct point of view are separating memorable software from interchangeable product dashboards.",
    readTime: "3 min read",
    mood: "Design shift",
    orb: "radial-gradient(circle, rgba(255,220,170,0.35), transparent 68%)",
    keyPoints: [
      "People keep software that changes how their day feels.",
      "Visual identity matters more once core utility converges.",
      "Tactility and pacing can be more memorable than raw feature count.",
    ],
    impact: "Brand and interaction quality are now product-level moats.",
  },
  {
    id: "policy-privacy-posture",
    category: "Policy",
    headline: "Privacy and platform scrutiny continue to favor products that can explain their data posture clearly.",
    source: "Policy Note",
    summary:
      "Teams building with identity, personalization, and recommendation systems are investing earlier in permissions clarity and audit trails.",
    readTime: "4 min read",
    mood: "Compliance pressure",
    orb: "radial-gradient(circle, rgba(148,221,178,0.28), transparent 68%)",
    keyPoints: [
      "Auditability is becoming a front-of-house product expectation.",
      "Clear consent language is outperforming vague privacy messaging.",
      "Permissions design is moving earlier into the build cycle.",
    ],
    impact: "Products with weak data explanations will face trust drag before legal drag.",
  },
];

export const defaultWatchlist: WatchlistItem[] = [
  {
    ticker: "NVDA",
    company: "NVIDIA",
    price: 944,
    dayChange: 2.41,
    history: [876, 882, 890, 899, 913, 909, 924, 930, 936, 944],
    thesis:
      "AI infrastructure demand is still dictating narrative leadership across the semiconductor stack.",
    rating: "Core focus",
    sectors: ["Semis", "AI infra"],
    conviction: 92,
  },
  {
    ticker: "AAPL",
    company: "Apple",
    price: 214,
    dayChange: 0.84,
    history: [201, 202, 204, 206, 207, 208, 209, 211, 213, 214],
    thesis:
      "Services durability and design-led ecosystem lock-in keep the quality profile unusually resilient.",
    rating: "Steady compounder",
    sectors: ["Consumer tech", "Devices"],
    conviction: 83,
  },
  {
    ticker: "MSFT",
    company: "Microsoft",
    price: 489,
    dayChange: 1.52,
    history: [455, 459, 463, 466, 471, 474, 477, 481, 484, 489],
    thesis:
      "Enterprise AI capture continues to broaden from infrastructure into distribution and workflow ownership.",
    rating: "Enterprise AI leader",
    sectors: ["Cloud", "Enterprise software"],
    conviction: 88,
  },
];

export const aiStockSuggestions: StockSuggestion[] = [
  {
    ticker: "PLTR",
    company: "Palantir",
    rating: "Signal rising",
    thesis:
      "Government and enterprise AI execution keeps improving, and the market still debates how durable the commercial flywheel will be.",
    seedHistory: [21, 22, 23, 23, 24, 25, 25, 26, 27, 28],
    catalyst: "Government backlog plus commercial margin expansion.",
  },
  {
    ticker: "CRWD",
    company: "CrowdStrike",
    rating: "Watch momentum",
    thesis:
      "Security spend remains a priority bucket, and platform consolidation still benefits the cleanest operators.",
    seedHistory: [274, 279, 281, 286, 291, 296, 301, 307, 313, 318],
    catalyst: "Security remains one of the least discretionary software budgets.",
  },
  {
    ticker: "TTD",
    company: "The Trade Desk",
    rating: "Ad-tech setup",
    thesis:
      "Programmatic ad strength is re-rating the names with durable platform leverage and clearer execution discipline.",
    seedHistory: [72, 73, 73, 74, 76, 77, 78, 79, 81, 82],
    catalyst: "Connected TV spend is still favoring scale plus measurement depth.",
  },
];

export const newsTickerFeed: Record<string, StockNewsEntry[]> = {
  NVDA: [
    {
      headline: "AI server buildouts remain the main demand engine for the chip complex.",
      source: "Market Pulse",
      tone: "constructive",
    },
    {
      headline: "Investors are watching margin strength more closely than unit growth this cycle.",
      source: "Desk Notes",
      tone: "measured",
    },
    {
      headline: "The next debate is less demand, more whether supply chain discipline can keep margins elevated.",
      source: "Semis Brief",
      tone: "watch",
    },
  ],
  AAPL: [
    {
      headline: "Hardware cadence matters less than ecosystem time-spent and subscription density.",
      source: "Consumer Tech Daily",
      tone: "constructive",
    },
    {
      headline: "Premium industrial design is still acting as a pricing shield in mature segments.",
      source: "Studio Street",
      tone: "steady",
    },
    {
      headline: "Services mix is doing more stabilization work than headline unit numbers suggest.",
      source: "Device Ledger",
      tone: "steady",
    },
  ],
  MSFT: [
    {
      headline: "Cloud plus AI bundling keeps improving Microsoft's position inside enterprise procurement.",
      source: "Infra Brief",
      tone: "constructive",
    },
    {
      headline: "Copilot adoption is increasingly measured by workflow stickiness, not launch excitement.",
      source: "Product Markets",
      tone: "measured",
    },
    {
      headline: "The market is rewarding distribution advantages as much as model quality.",
      source: "Enterprise Field Notes",
      tone: "constructive",
    },
  ],
  PLTR: [
    {
      headline: "Commercial pipeline quality is the main question for the next leg of re-rating.",
      source: "Signal Lab",
      tone: "watch",
    },
    {
      headline: "Narrative strength is clear; the debate is how repeatable the enterprise motion can become.",
      source: "Growth Tape",
      tone: "measured",
    },
  ],
  CRWD: [
    {
      headline: "Security remains one of the few software categories still treated as unavoidable spend.",
      source: "Threat Ledger",
      tone: "constructive",
    },
    {
      headline: "Platform breadth is starting to matter as much as point-solution performance.",
      source: "Security Desk",
      tone: "constructive",
    },
  ],
  TTD: [
    {
      headline: "Advertiser budgets are rotating toward higher-visibility platforms with measurement depth.",
      source: "Ad Stack",
      tone: "constructive",
    },
    {
      headline: "Connected TV execution remains the swing factor in the next valuation reset.",
      source: "Media Markets",
      tone: "watch",
    },
  ],
};

export const weatherCities: WeatherCity[] = [
  {
    name: "Honolulu",
    region: "Hawaii",
    condition: "Clear with trade winds",
    summary:
      "Bright, warm, and easy to move through. Midday glare is stronger than the heat curve suggests.",
    tempF: 79,
    feelsLikeF: 82,
    humidity: 66,
    windMph: 12,
    precipitationChance: 12,
    uv: "High",
    sunrise: "6:34 AM",
    sunset: "6:32 PM",
    hourly: [
      { time: "Now", tempF: 79, label: "Clear" },
      { time: "11 AM", tempF: 81, label: "Sunny" },
      { time: "1 PM", tempF: 83, label: "Bright" },
      { time: "4 PM", tempF: 81, label: "Trade winds" },
      { time: "7 PM", tempF: 77, label: "Mild" },
    ],
    daily: [
      { day: "Mon", highF: 83, lowF: 75, label: "Sunny", rainChance: 8 },
      { day: "Tue", highF: 82, lowF: 74, label: "Breezy", rainChance: 12 },
      { day: "Wed", highF: 81, lowF: 75, label: "Clear", rainChance: 10 },
      { day: "Thu", highF: 82, lowF: 75, label: "Soft clouds", rainChance: 18 },
      { day: "Fri", highF: 84, lowF: 76, label: "Bright", rainChance: 6 },
    ],
  },
  {
    name: "San Francisco",
    region: "California",
    condition: "Marine layer easing",
    summary: "Cool in the morning, sharper by afternoon with a clean wind edge.",
    tempF: 61,
    feelsLikeF: 60,
    humidity: 72,
    windMph: 9,
    precipitationChance: 18,
    uv: "Moderate",
    sunrise: "7:18 AM",
    sunset: "7:12 PM",
    hourly: [
      { time: "Now", tempF: 61, label: "Clouds" },
      { time: "11 AM", tempF: 63, label: "Marine layer" },
      { time: "1 PM", tempF: 66, label: "Clearing" },
      { time: "4 PM", tempF: 65, label: "Breezy" },
      { time: "7 PM", tempF: 58, label: "Cool" },
    ],
    daily: [
      { day: "Mon", highF: 66, lowF: 54, label: "Cloud breaks", rainChance: 16 },
      { day: "Tue", highF: 64, lowF: 53, label: "Breezy", rainChance: 12 },
      { day: "Wed", highF: 63, lowF: 52, label: "Fog AM", rainChance: 20 },
      { day: "Thu", highF: 67, lowF: 55, label: "Clearer", rainChance: 10 },
      { day: "Fri", highF: 65, lowF: 54, label: "Coastal cloud", rainChance: 18 },
    ],
  },
  {
    name: "New York",
    region: "New York",
    condition: "Cloud breaks late",
    summary:
      "Dense morning cloud cover, then a clearer late-day run with mild temperature lift.",
    tempF: 68,
    feelsLikeF: 69,
    humidity: 58,
    windMph: 7,
    precipitationChance: 24,
    uv: "Moderate",
    sunrise: "7:08 AM",
    sunset: "7:01 PM",
    hourly: [
      { time: "Now", tempF: 68, label: "Cloud cover" },
      { time: "11 AM", tempF: 69, label: "Overcast" },
      { time: "1 PM", tempF: 71, label: "Brighter" },
      { time: "4 PM", tempF: 72, label: "Mild" },
      { time: "7 PM", tempF: 66, label: "Cooling" },
    ],
    daily: [
      { day: "Mon", highF: 72, lowF: 59, label: "Cloud breaks", rainChance: 24 },
      { day: "Tue", highF: 70, lowF: 57, label: "Mild", rainChance: 18 },
      { day: "Wed", highF: 67, lowF: 55, label: "Rain chance", rainChance: 32 },
      { day: "Thu", highF: 69, lowF: 56, label: "Partly sunny", rainChance: 14 },
      { day: "Fri", highF: 71, lowF: 58, label: "Clearer", rainChance: 12 },
    ],
  },
];

export const games: GameEntry[] = [
  {
    slug: "2048",
    name: "2048",
    description:
      "Merge matching tiles, build momentum, and keep the grid alive long enough to reach 2048.",
    tagline: "The cleanest quick-session puzzle for touch and keyboard play.",
    sessionLength: "3 min",
    mode: "Solo puzzle",
    license: "MIT",
    sourceName: "gabrielecirulli/2048",
    sourceUrl: "https://github.com/gabrielecirulli/2048",
    accent: "from-[#ffd27d33] via-[#ffd27d10] to-transparent",
  },
  {
    slug: "blockfall",
    name: "Blockfall",
    description:
      "A responsive falling-block arcade lane tuned for quick restarts and equal mobile or desktop play.",
    tagline: "Arfor's lightweight block stacker, built for short bursts.",
    sessionLength: "5 min",
    mode: "Arcade run",
    license: "MIT",
    sourceName: "ovidiuch/flatris",
    sourceUrl: "https://github.com/ovidiuch/flatris",
    accent: "from-[#7cc4ff33] via-[#7cc4ff10] to-transparent",
  },
];

export const defaultEvents: CalendarEventSeed[] = [
  {
    id: "evt-1",
    title: "Product review",
    date: "2026-03-16",
    time: "10:00",
    reminderMinutes: 30,
    category: "Work",
    notes: "Bring roadmap decisions and open design questions.",
  },
  {
    id: "evt-2",
    title: "Gym + recovery",
    date: "2026-03-17",
    time: "18:30",
    reminderMinutes: 60,
    category: "Health",
    notes: "Mobility first, then cardio block.",
  },
  {
    id: "evt-3",
    title: "Weekly budget reset",
    date: "2026-03-18",
    time: "08:00",
    reminderMinutes: 15,
    category: "Finance",
    notes: "Check subscriptions, bills, and next-week cash needs.",
  },
];

export const defaultBills: RecurringBillSeed[] = [
  {
    id: "bill-1",
    name: "Studio rent",
    amount: 1800,
    dueDay: 1,
    cadenceMonths: 1,
    startsAt: "2026-01-01",
    autopay: true,
    category: "Housing",
    account: "Checking",
  },
  {
    id: "bill-2",
    name: "Cloud tools",
    amount: 84,
    dueDay: 9,
    cadenceMonths: 1,
    startsAt: "2026-02-09",
    autopay: true,
    category: "Software",
    account: "Business card",
  },
  {
    id: "bill-3",
    name: "Insurance",
    amount: 220,
    dueDay: 24,
    cadenceMonths: 3,
    startsAt: "2026-03-24",
    autopay: false,
    category: "Coverage",
    account: "Checking",
  },
];
