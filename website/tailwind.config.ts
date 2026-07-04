import { type Config } from "tailwindcss";

export default {
  content: [
    "./routes/**/*.{ts,tsx,js,jsx}",
    "./islands/**/*.{ts,tsx,js,jsx}",
    "./components/**/*.{ts,tsx,js,jsx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
} satisfies Config;
