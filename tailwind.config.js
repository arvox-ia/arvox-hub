/** @type {import('tailwindcss').Config} */
const config = {
    content: [
        "./app/**/*.{js,ts,jsx,tsx}",
        "./components/**/*.{js,ts,jsx,tsx}",
        "./context/**/*.{js,ts,jsx,tsx}",
        "./features/**/*.{js,ts,jsx,tsx}",
        "./hooks/**/*.{js,ts,jsx,tsx}",
        "./lib/**/*.{js,ts,jsx,tsx}",
        "./*.{js,ts,jsx,tsx}",
    ],
    // Note: In Tailwind v4, most configuration is done in CSS with @theme
    // This file is kept for content scanning and legacy compatibility
    darkMode: 'class',
    theme: {
        extend: {
            fontFamily: {
                sans: ['var(--font-poppins)', 'Poppins', 'sans-serif'],
                display: ['var(--font-poppins)', 'Poppins', 'sans-serif'],
                serif: ['Cinzel', 'serif'],
            },
            colors: {
                primary: {
                    50: '#fef2f3',
                    100: '#fde3e5',
                    200: '#fbc9ce',
                    300: '#f79fa7',
                    400: '#f05467',
                    500: '#D10419',
                    600: '#ab0315',
                    700: '#8c0714',
                    800: '#740a16',
                    900: '#630c18',
                },
                dark: {
                    bg: '#0D0D0D',
                    card: '#161616',
                    border: '#242424',
                    hover: '#2e2e2e',
                },
                // Semantic tokens — bridge CSS vars (globals.css) to Tailwind utilities
                // Usage: bg-surface, text-muted, bg-success, text-error-text, etc.
                surface: 'var(--color-surface)',
                'surface-bg': 'var(--color-bg)',
                muted: 'var(--color-muted)',
                success: 'var(--color-success)',
                'success-bg': 'var(--color-success-bg)',
                'success-text': 'var(--color-success-text)',
                warning: 'var(--color-warning)',
                'warning-bg': 'var(--color-warning-bg)',
                'warning-text': 'var(--color-warning-text)',
                error: 'var(--color-error)',
                'error-bg': 'var(--color-error-bg)',
                'error-text': 'var(--color-error-text)',
                info: 'var(--color-info)',
                'info-bg': 'var(--color-info-bg)',
                'info-text': 'var(--color-info-text)',
                'text-primary': 'var(--color-text-primary)',
                'text-secondary': 'var(--color-text-secondary)',
                'text-muted': 'var(--color-text-muted)',
                'text-subtle': 'var(--color-text-subtle)',
            },
            backgroundImage: {
                'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
            }
        },
    },
    plugins: [],
}

module.exports = config
