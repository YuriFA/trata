package http

// redocShell is the minimal Redoc CDN page served at /docs. It mirrors
// docs/api/redoc.html at the repo root (kept in sync by hand); the spec
// itself is served from the embedded copy at /docs/openapi.json.
const redocShell = `<!DOCTYPE html>
<html>
  <head>
    <title>Trata API — Redoc</title>
    <meta charset="utf-8"/>
    <meta name="viewport" content="width=device-width, initial-scale=1"/>
  </head>
  <body>
    <redoc spec-url="/docs/openapi.json"></redoc>
    <script src="https://cdn.jsdelivr.net/npm/redoc@2.0.0-alpha.17/bundles/redoc.standalone.js"></script>
  </body>
</html>
`
