/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        navy: { DEFAULT: "#0A3161", dark: "#061f3f", light: "#1a4a85" },
        flag: "#B31942",
        cream: "#F5F1E8",
        gold: "#F2C14E",
        good: "#2E9E5B",
        bad: "#B31942",
      },
      fontFamily: {
        display: ['"Bebas Neue"', "Impact", "Arial Narrow", "sans-serif"],
        body: ["Inter", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
      },
    },
  },
  plugins: [],
};
