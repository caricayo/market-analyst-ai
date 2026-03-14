export const newsTypes = ["Markets", "Tech", "World", "Culture", "Policy"] as const;

export const newsPanels = [
  {
    category: "Markets",
    headline: "Rate-sensitive names are regaining flow as traders lean into a soft-landing week.",
    source: "Arfor Wire",
    summary:
      "Treasury volatility eased overnight, reopening appetite for software, semis, and selective consumer growth names without turning the tape euphoric.",
    readTime: "4 min read",
    mood: "Measured risk-on",
    orb: "radial-gradient(circle, rgba(226,187,105,0.38), transparent 68%)",
  },
  {
    category: "Tech",
    headline: "AI copilots are shifting from novelty assistants into workflow surfaces with memory and action depth.",
    source: "Signal Lab",
    summary:
      "The strongest product motion is happening where agents sit inside dense personal workflows: planning, calendar control, recurring tasks, and research loops.",
    readTime: "6 min read",
    mood: "Product acceleration",
    orb: "radial-gradient(circle, rgba(124,196,255,0.35), transparent 68%)",
  },
  {
    category: "World",
    headline: "Energy and shipping desks are watching regional friction, but freight pricing has not yet broken trend.",
    source: "Global Current",
    summary:
      "Cross-border supply sensitivity remains high. Markets are treating it as a watch item instead of a confirmed disruption event.",
    readTime: "5 min read",
    mood: "Cautious",
    orb: "radial-gradient(circle, rgba(247,179,232,0.3), transparent 68%)",
  },
  {
    category: "Culture",
    headline: "The best consumer apps are becoming mood objects as much as utility layers.",
    source: "Studio Index",
    summary:
      "Rounded density, tactile translucency, and a distinct point of view are separating memorable software from interchangeable product dashboards.",
    readTime: "3 min read",
    mood: "Design shift",
    orb: "radial-gradient(circle, rgba(255,220,170,0.35), transparent 68%)",
  },
  {
    category: "Policy",
    headline: "Privacy and platform scrutiny continue to favor products that can explain their data posture clearly.",
    source: "Policy Note",
    summary:
      "Teams building with identity, personalization, and recommendation systems are investing earlier in permissions clarity and audit trails.",
    readTime: "4 min read",
    mood: "Compliance pressure",
    orb: "radial-gradient(circle, rgba(148,221,178,0.28), transparent 68%)",
  },
];

export const defaultWatchlist = [
  {
    ticker: "NVDA",
    company: "NVIDIA",
    price: 944,
    dayChange: 2.41,
    history: [876, 882, 890, 899, 913, 909, 924, 930, 936, 944],
    thesis:
      "AI infrastructure demand is still dictating narrative leadership across the semiconductor stack.",
    rating: "Core focus",
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
  },
];

export const aiStockSuggestions = [
  {
    ticker: "PLTR",
    company: "Palantir",
    rating: "Signal rising",
    thesis:
      "Government and enterprise AI execution keeps improving, and the market still debates how durable the commercial flywheel will be.",
    seedHistory: [21, 22, 23, 23, 24, 25, 25, 26, 27, 28],
  },
  {
    ticker: "CRWD",
    company: "CrowdStrike",
    rating: "Watch momentum",
    thesis:
      "Security spend remains a priority bucket, and platform consolidation still benefits the cleanest operators.",
    seedHistory: [274, 279, 281, 286, 291, 296, 301, 307, 313, 318],
  },
  {
    ticker: "TTD",
    company: "The Trade Desk",
    rating: "Ad-tech setup",
    thesis:
      "Programmatic ad strength is re-rating the names with durable platform leverage and clearer execution discipline.",
    seedHistory: [72, 73, 73, 74, 76, 77, 78, 79, 81, 82],
  },
];

export const newsTickerFeed: Record<string, { headline: string; source: string }[]> = {
  NVDA: [
    {
      headline: "AI server buildouts remain the main demand engine for the chip complex.",
      source: "Market Pulse",
    },
    {
      headline: "Investors are watching margin strength more closely than unit growth this cycle.",
      source: "Desk Notes",
    },
  ],
  AAPL: [
    {
      headline: "Hardware cadence matters less than ecosystem time-spent and subscription density.",
      source: "Consumer Tech Daily",
    },
    {
      headline: "Premium industrial design is still acting as a pricing shield in mature segments.",
      source: "Studio Street",
    },
  ],
  MSFT: [
    {
      headline: "Cloud + AI bundling keeps improving Microsoft’s position inside enterprise procurement.",
      source: "Infra Brief",
    },
    {
      headline: "Copilot adoption is increasingly measured by workflow stickiness, not launch excitement.",
      source: "Product Markets",
    },
  ],
  PLTR: [
    {
      headline: "Commercial pipeline quality is the main question for the next leg of re-rating.",
      source: "Signal Lab",
    },
  ],
  CRWD: [
    {
      headline:
        "Security remains one of the few software categories still treated as unavoidable spend.",
      source: "Threat Ledger",
    },
  ],
  TTD: [
    {
      headline:
        "Advertiser budgets are rotating toward higher-visibility platforms with measurement depth.",
      source: "Ad Stack",
    },
  ],
};

export const weatherCities = [
  {
    name: "Honolulu",
    condition: "Clear with trade winds",
    summary:
      "Bright, warm, and easy to move through. Midday glare is stronger than the heat curve suggests.",
    temp: "79°",
    feelsLike: "82°",
    humidity: "66%",
    wind: "12 mph",
    hourly: [
      { time: "Now", temp: "79°", label: "Clear" },
      { time: "11 AM", temp: "81°", label: "Sunny" },
      { time: "1 PM", temp: "83°", label: "Bright" },
      { time: "4 PM", temp: "81°", label: "Soft wind" },
      { time: "7 PM", temp: "77°", label: "Mild" },
    ],
  },
  {
    name: "San Francisco",
    condition: "Marine layer easing",
    summary: "Cool in the morning, sharper by afternoon with a clean wind edge.",
    temp: "61°",
    feelsLike: "60°",
    humidity: "72%",
    wind: "9 mph",
    hourly: [],
  },
  {
    name: "New York",
    condition: "Cloud breaks late",
    summary:
      "Dense morning cloud cover, then a clearer late-day run with mild temperature lift.",
    temp: "68°",
    feelsLike: "69°",
    humidity: "58%",
    wind: "7 mph",
    hourly: [],
  },
];

export const games = [
  {
    name: "Signal Sweep",
    description:
      "A fast pattern-recognition puzzle built around market candles and color sequences.",
    sessionLength: "3 min",
    mode: "Daily challenge",
  },
  {
    name: "Orbit Tiles",
    description:
      "A tactile spatial puzzle with soft motion and a short reset loop between work sessions.",
    sessionLength: "5 min",
    mode: "Zen mode",
  },
  {
    name: "Word Drift",
    description:
      "A stylish language game where you chain themes from news and finance into clean streaks.",
    sessionLength: "4 min",
    mode: "Solo",
  },
];

export const defaultEvents = [
  {
    id: "evt-1",
    title: "Product review",
    date: "2026-03-16",
    time: "10:00",
    reminderMinutes: 30,
    category: "Work",
  },
  {
    id: "evt-2",
    title: "Gym + recovery",
    date: "2026-03-17",
    time: "18:30",
    reminderMinutes: 60,
    category: "Health",
  },
  {
    id: "evt-3",
    title: "Weekly budget reset",
    date: "2026-03-18",
    time: "08:00",
    reminderMinutes: 15,
    category: "Finance",
  },
];

export const defaultBills = [
  {
    id: "bill-1",
    name: "Studio rent",
    amount: 1800,
    dueDay: 1,
    cadenceMonths: 1,
    startsAt: "2026-01-01",
    autopay: true,
  },
  {
    id: "bill-2",
    name: "Cloud tools",
    amount: 84,
    dueDay: 9,
    cadenceMonths: 1,
    startsAt: "2026-02-09",
    autopay: true,
  },
  {
    id: "bill-3",
    name: "Insurance",
    amount: 220,
    dueDay: 24,
    cadenceMonths: 3,
    startsAt: "2026-03-24",
    autopay: false,
  },
];
