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
  url?: string;
  publishedAt?: string;
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
  url?: string;
  publishedAt?: string;
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
    headline: "Opening range favors quality, liquidity, and names you already understand.",
    source: "Arfor Desk",
    summary:
      "Use the fallback brief as a planning surface rather than a headline feed: watch broad market tone, stick to liquid names, and wait for conviction before chasing extensions.",
    readTime: "4 min read",
    mood: "Calm tape",
    orb: "radial-gradient(circle, rgba(226,187,105,0.38), transparent 68%)",
    keyPoints: [
      "Start with the market's direction before drilling into single names.",
      "Reference prices stay local until live quotes replace them.",
      "A narrow watchlist beats a noisy one when the session opens.",
    ],
    impact: "Treat this lane as a pre-market operating note when live search is unavailable.",
  },
  {
    id: "tech-agent-workflows",
    category: "Tech",
    headline: "Useful AI products are winning by doing work, not by sounding clever.",
    source: "Product Notes",
    summary:
      "The strongest product experiences now combine memory, action, and a clear interface for recurring work like planning, tracking, and follow-through.",
    readTime: "6 min read",
    mood: "Execution edge",
    orb: "radial-gradient(circle, rgba(124,196,255,0.35), transparent 68%)",
    keyPoints: [
      "Action depth matters more than chat polish.",
      "Retention grows when products remember context across sessions.",
      "Interfaces should help users finish loops, not just start them.",
    ],
    impact: "Arfor should feel like a working surface, not a collection of widgets.",
  },
  {
    id: "world-shipping-friction",
    category: "World",
    headline: "External risk is easiest to track through shipping, energy, and policy pressure.",
    source: "Global Watch",
    summary:
      "When the live brief is offline, keep the world lane simple: monitor supply chains, fuel sensitivity, and anything that can quickly alter costs or confidence.",
    readTime: "5 min read",
    mood: "Watch list",
    orb: "radial-gradient(circle, rgba(247,179,232,0.3), transparent 68%)",
    keyPoints: [
      "A few global inputs can ripple across many local decisions.",
      "Cost shocks usually show up before narrative clarity does.",
      "Keep one eye on logistics even when the rest of the board looks calm.",
    ],
    impact: "This section exists to preserve situational awareness, not to simulate breaking news.",
  },
  {
    id: "culture-mood-objects",
    category: "Culture",
    headline: "People keep products that change the texture of the day, not just the task list.",
    source: "Design Review",
    summary:
      "A finished product needs a point of view. Visual tone, motion, and pacing are part of the utility because they shape whether users return.",
    readTime: "3 min read",
    mood: "Taste matters",
    orb: "radial-gradient(circle, rgba(255,220,170,0.35), transparent 68%)",
    keyPoints: [
      "Memorability is a product feature.",
      "Clear hierarchy and restraint age better than ornamental overload.",
      "Distinctive design should make work feel lighter, not louder.",
    ],
    impact: "This app should read as intentional from the first screen, even in offline mode.",
  },
  {
    id: "policy-privacy-posture",
    category: "Policy",
    headline: "Clear account, consent, and storage language now signals product maturity.",
    source: "Trust Notes",
    summary:
      "Users increasingly expect to understand what is local, what syncs, and what requires a connected account before they commit to a product.",
    readTime: "4 min read",
    mood: "Trust signal",
    orb: "radial-gradient(circle, rgba(148,221,178,0.28), transparent 68%)",
    keyPoints: [
      "Explain storage and sync behavior in plain language.",
      "Authentication pages should reassure before they request action.",
      "Trust is easier to keep when the product is explicit about boundaries.",
    ],
    impact: "Arfor should make local-first behavior and optional sign-in obvious everywhere.",
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

export const defaultEvents: CalendarEventSeed[] = [];

export const defaultBills: RecurringBillSeed[] = [];
