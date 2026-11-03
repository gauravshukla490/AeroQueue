/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/**/*.{js,ts,jsx,tsx}',
    './index.html',
  ],
  darkMode: 'class', // enable class strategy
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#0d6efd', // blue accent
          dark: '#0a58ca',
        },
        surface: {
          light: '#f8fafc', // near‑white
          dark: '#0a0a0a', // deep black
        },
        text: {
          light: '#1f2937',
          dark: '#e5e7eb',
        },
      },
    },
  },
  plugins: [],
};