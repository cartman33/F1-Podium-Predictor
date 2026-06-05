/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        "carbon-black": "#0B0B0F",
        "track-grey": "#38383F",
        "status-error": "#F1103F",
        "status-live": "#00D2BE",
        "status-pending": "#FFB800",
        "primary-container": "#ff553d",
        "web3-metamask": "#F6851B",
        "f1-white": "#FFFFFF",
      }
    },
  },
  plugins: [],
}
