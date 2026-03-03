/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        parchment: {
          bg: "#17130f",
          panel: "#231a14",
          panelAlt: "#2e2219",
          text: "#efe0c8",
          muted: "#b79f80",
          accent: "#d39b57",
          danger: "#c95d47",
          good: "#6db37f"
        }
      },
      boxShadow: {
        ember: "0 10px 30px rgba(0,0,0,0.35)",
      },
      keyframes: {
        fog: {
          "0%, 100%": { opacity: "0.22", transform: "translateY(0px)" },
          "50%": { opacity: "0.35", transform: "translateY(-4px)" },
        }
      },
      animation: {
        fog: "fog 8s ease-in-out infinite",
      }
    },
  },
  plugins: [],
};

