/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{html,js,svelte,ts}'],
  theme: {
    extend: {
      colors: {
        'ryokan-bg': '#121212',
        'ryokan-surface': '#1E1E1E',
        'ryokan-accent': '#10B981', 
      }
    },
  },
  plugins: [],
}