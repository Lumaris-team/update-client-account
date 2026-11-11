# Library

This directory contains utility functions, helpers, and shared logic used across your frontend application.

## Contents

- **Utility functions** - Reusable helper functions (date formatting, string manipulation)
- **API clients** - HTTP client configurations, API endpoint definitions
- **Custom hooks** - React hooks for shared stateful logic
- **Constants** - Application-wide constants and configuration
- **Validators** - Form validation schemas and functions
- **Formatters** - Data formatting utilities (currency, dates, numbers)
- **Type definitions** - Shared TypeScript types and interfaces

## Organization

Consider organizing by purpose:
```
lib/
├── api/          # API-related utilities
├── hooks/        # Custom React hooks
├── utils/        # General utility functions
├── constants/    # Constants and configuration
├── validators/   # Validation logic
└── types/        # Shared TypeScript definitions
```

## Guidelines

- Keep functions pure and side-effect free when possible
- Write comprehensive unit tests for utilities
- Use TypeScript for type safety
- Document complex functions with JSDoc comments
- Keep functions small and focused on a single responsibility
- Avoid framework-specific code in utilities (keep them framework-agnostic)
