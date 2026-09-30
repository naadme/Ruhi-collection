export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: { extend: {
    fontFamily: { sans: ['Jost', 'Inter', 'sans-serif'], ui: ['Inter', 'Arial', 'sans-serif'], serif: ['Cormorant Garamond', 'Georgia', 'serif'] },
    // Colour only — values remapped to the brand-guideline palette.
    // Token/class names are unchanged so every existing utility keeps working.
    colors: {
      brand: { green: '#C08576', soft: '#A86B5C', yellow: '#C08576', gold: '#B7917F', red: '#A86B5C', badge: '#C08576', ink: '#4A2C23' },
      black: '#4A2C23',   // Cocoa — primary text, icons, dark surfaces
      white: '#FDF7F3',   // warm surface — cards, sheets, text on dark
      red:    { 50: '#FDF7F3', 100: '#EFDCD2', 200: '#D9BFB3', 300: '#C08576', 400: '#C08576', 500: '#C08576', 600: '#A86B5C', 700: '#6E4A3E', 800: '#6E4A3E', 900: '#4A2C23', 950: '#4A2C23' },
      amber:  { 50: '#F8EDE6', 100: '#EFDCD2', 200: '#D9BFB3', 300: '#C08576', 400: '#B7917F', 500: '#B7917F', 600: '#8A6556', 700: '#8A6556', 800: '#6E4A3E', 900: '#4A2C23', 950: '#4A2C23' },
      green:  { 50: '#FDF7F3', 100: '#EFDCD2', 200: '#E8D6CC', 300: '#D9BFB3', 400: '#B7917F', 500: '#B7917F', 600: '#B7917F', 700: '#8A6556', 800: '#6E4A3E', 900: '#4A2C23', 950: '#4A2C23' },
      blue:   { 50: '#FDF7F3', 100: '#EFDCD2', 200: '#D9BFB3', 300: '#C08576', 400: '#C08576', 500: '#C08576', 600: '#A86B5C', 700: '#A86B5C', 800: '#4A2C23', 900: '#4A2C23', 950: '#4A2C23' },
      indigo: { 50: '#F8EDE6', 100: '#EFDCD2', 200: '#E8D6CC', 300: '#D9BFB3', 400: '#B7917F', 500: '#B7917F', 600: '#8A6556', 700: '#8A6556', 800: '#6E4A3E', 900: '#4A2C23', 950: '#4A2C23' },
      gray:   { 50: '#FDF7F3', 100: '#FDF7F3', 200: '#EFDCD2', 300: '#E8D6CC', 400: '#B7917F', 500: '#B7917F', 600: '#8A6556', 700: '#6E4A3E', 800: '#4A2C23', 900: '#4A2C23', 950: '#4A2C23' },
      neutral: { 50: '#FDF7F3', 100: '#FDF7F3', 200: '#EFDCD2', 300: '#E8D6CC', 400: '#B7917F', 500: '#B7917F', 600: '#8A6556', 700: '#6E4A3E', 800: '#4A2C23', 900: '#4A2C23', 950: '#4A2C23' },
    },
    // Drop shadows + focus-ring gaps are colours too: tint them Cocoa instead
    // of the neutral black/white Tailwind ships with (same offsets, only the
    // colour changes).
    boxShadow: {
      DEFAULT: '0 1px 3px 0 rgb(74 44 35 / .1), 0 1px 2px -1px rgb(74 44 35 / .1)',
      sm: '0 1px 2px 0 rgb(74 44 35 / .05)',
      lg: '0 10px 15px -3px rgb(74 44 35 / .1), 0 4px 6px -4px rgb(74 44 35 / .1)',
      '2xl': '0 25px 50px -12px rgb(74 44 35 / .25)',
    },
    ringOffsetColor: { DEFAULT: '#FDF7F3' },
    maxWidth: { page: '1600px' },
  } },
  plugins: [],
}
