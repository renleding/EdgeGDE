import { Hono } from 'hono'

export const testRouter = new Hono()

testRouter.get('/', async (c) => {
  return c.html(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>EdgeGDE Chat Test</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, system-ui, sans-serif; background: #0a0a0b; color: #e4e4e7; padding: 40px; }
    h1 { font-size: 18px; color: #3b82f6; margin-bottom: 24px; }
    p { font-size: 13px; color: #71717a; margin-bottom: 12px; }
    .card { background: #141416; border: 1px solid #2a2a2e; border-radius: 12px; padding: 24px; max-width: 600px; margin: 0 auto; }
    .status { font-size: 12px; color: #22c55e; margin-top: 12px; }
  </style>
</head>
<body>
  <div class="card">
    <h1>EdgeGDE Chat Widget Test</h1>
    <p>The AFIRMICO Finance chat widget should appear in the bottom-right corner.</p>
    <p>Send a message, then click the <strong>X</strong> close button to see the loss-framed card.</p>
    <div class="status">Chat widget loaded via widget.v1.1.0.js</div>
  </div>
  <script src="/public/widget.v1.1.0.js?v=3" data-tenant="au-mortgage-broker-afirmico"></script>
</body>
</html>`)
})
