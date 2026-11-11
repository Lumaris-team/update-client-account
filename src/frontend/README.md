# Frontend

This directory contains the complete frontend application code. It follows a component-based architecture with clear separation of concerns.

## Directory Structure

```
frontend/
├── pages/         # Page-level components (routes, main views)
├── components/    # Reusable UI components
├── styles/        # All styling and theme files
├── assets/        # Static assets (images, fonts, icons)
└── lib/           # Utilities, hooks, and shared logic
```

## Key Principles

- **Component-based architecture** - Build with small, reusable components
- **Separation of concerns** - Keep UI, logic, and styling separated
- **Type safety** - Use TypeScript for better development experience
- **Responsive design** - Ensure mobile-first, responsive layouts
- **Performance** - Optimize assets, code splitting, lazy loading

## Development Guidelines

- Each subdirectory has its own README with specific guidelines
- Follow existing naming conventions and patterns
- Write tests for components and utilities
- Keep components focused and single-purpose
- Use CSS Modules or CSS-in-JS for scoped styling
- Implement proper error boundaries and loading states

## Entry Point

The main entry point for the frontend application should be defined in the root of this directory (e.g., `index.tsx`, `main.tsx`, or `App.tsx`) depending on your framework choice.
