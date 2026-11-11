# Components

This directory contains reusable UI components that can be used across multiple pages and features.

## Component Types

- **UI Components** - Basic building blocks (buttons, inputs, cards, modals)
- **Layout Components** - Structural components (headers, footers, sidebars)
- **Feature Components** - Domain-specific reusable components
- **Form Components** - Form elements and validation wrappers

## Organization

Consider organizing by category:
```
components/
├── ui/           # Basic UI elements
├── layout/       # Layout components
├── forms/        # Form-related components
└── features/     # Feature-specific components
```

## Guidelines

- Components should be small, focused, and reusable
- Use props for configuration and behavior
- Follow consistent naming conventions
- Include TypeScript types/interfaces
- Keep components presentational, move logic to hooks or services
