import { Hono } from 'hono'
import { ineosSplashPage } from './ineos-splash'
import { FAVICON_LINK } from './layout'

interface Env {
  ASSETS: Fetcher
}

const app = new Hono<{ Bindings: Env }>()

app.get('/', (c) => c.html(ineosSplashPage()))

app.get('/ineos-logo.png', async (c) => {
  return c.env.ASSETS.fetch(new Request(c.req.url))
})

app.get('/favicon.svg', (c) =>
  c.body(FAVICON_LINK.replace('<link rel="icon" type="image/svg+xml" href="', '').replace('">', ''), 200, {
    'content-type': 'image/svg+xml',
    'cache-control': 'public, max-age=3600'
  })
)

export default app