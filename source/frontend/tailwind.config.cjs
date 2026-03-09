/** @type {import('tailwindcss').Config} */
module.exports = {
  // Files scanned by Tailwind to generate utility classes.
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    // Extend section intentionally left open for custom design tokens.
    extend: {},
  },
  plugins: [],
};
