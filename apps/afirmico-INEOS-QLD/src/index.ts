import { Hono } from 'hono'
import { ineosSplashPage } from './ineos-splash'
import { FAVICON_LINK } from './layout'

const app = new Hono()

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