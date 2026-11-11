# Pages

This directory contains the page-level components for your application. Each file typically represents a route or a major view in your application.

## Structure

- **Home pages** - Landing pages, dashboards, main views
- **Feature pages** - Specific feature implementations (e.g., user profile, settings)
- **Error pages** - 404, 500, and other error handling pages
- **Auth pages** - Login, registration, password recovery

## Guidelines

- Each page should be a self-contained component
- Keep business logic in components or lib, not in pages
- Use consistent naming conventions (e.g., `HomePage.tsx`, `UserProfile.tsx`)
- Pages should focus on layout and composition of smaller components
