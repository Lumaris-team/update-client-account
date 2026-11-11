# Assets

This directory contains static assets used throughout your frontend application.

## Asset Types

- **Images** - Logos, icons, illustrations, photos
- **Fonts** - Custom font files (WOFF2, TTF, etc.)
- **Icons** - SVG icon files or icon sprite sheets
- **Media** - Audio files, video files, animations
- **Documents** - PDFs, downloadable files

## Organization

Consider organizing by type:
```
assets/
├── images/       # Raster and vector images
├── icons/        # SVG icons and icon sets
├── fonts/        # Custom font files
├── media/        # Audio and video files
└── docs/         # Downloadable documents
```

## Guidelines

- Optimize images for web (compress, appropriate formats)
- Use modern image formats (WebP, AVIF) when possible
- Provide responsive image variants when needed
- Use SVG for icons and scalable graphics
- Keep file sizes minimal for performance
- Consider using a CDN for large assets
- Don't commit large binary files that should be in external storage
