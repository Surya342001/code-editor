/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        mono: ['"JetBrains Mono"', '"Fira Code"', '"Cascadia Code"', 'monospace'],
      },
      colors: {
        e: {
          bg: '#0d1117',
          sidebar: '#161b22',
          tab: '#21262d',
          border: '#30363d',
          text: '#e6edf3',
          muted: '#8b949e',
          accent: '#7c3aed',
          ahl: '#a78bfa',
        },
      },
    },
  },
  plugins: [],
};
