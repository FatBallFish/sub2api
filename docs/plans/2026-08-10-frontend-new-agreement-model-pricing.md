# New Frontend Agreement and Model Pricing Implementation Plan

1. Add failing tests for agreement gating, configured legal pages, user-specific rates, unsupported models, and per-request pricing.
2. Extend the model pricing response with availability and structured request-price fields.
3. Apply user rates and actual gateway model support when building console/public pricing.
4. Add shared agreement consent/document helpers and gate all authentication entry points.
5. Read legal pages and footer links exclusively from enabled backend configuration.
6. Overlay user rates in API key group pickers and summaries.
7. Render token, request-tier, and unsupported model rows as distinct pricing states.
8. Run focused tests, full tests, builds, linting, and Git diff checks; then commit and push `custom_main`.
