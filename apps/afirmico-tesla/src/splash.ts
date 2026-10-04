/**
 * Splash page (the site root `/`).
 *
 * This page began life as a hand-maintained static file (`public/index.html`),
 * which meant it silently drifted: the shared favicon and TOCA mark were added
 * everywhere else, but the root kept its own inline copies and picked up
 * nothing automatically. Rendering it here instead — through the same
 * `FAVICON_LINK` / `tocaMark()` chrome as every other page — removes that
 * class of bug entirely.
 *
 * It has its own hero styling rather than reusing `page()`, because the landing
 * page is a full-bleed marketing layout and the member flow is a narrow reading
 * column. The shared parts (icon, mark) are imported, not retyped.
 */
import { FAVICON_LINK, SITE_NAME, tocaMark } from './layout'

/** App store / pairing deep link shown on the splash. */
const JOIN_TOCA_URL = 'https://www.teslaowners.org.au/membership'

export function splashPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${FAVICON_LINK}
<title>${SITE_NAME} — The Tesla Ownership Advantage</title>
<style>
  *{box-sizing:border-box}
  body{margin:0;background:#090909;color:white;font-family:Arial,Helvetica,sans-serif}
  .hero{position:relative;min-height:100vh;padding:50px;
    background:linear-gradient(rgba(0,0,0,.65),rgba(0,0,0,.85)),
      url('https://images.unsplash.com/photo-1617704548623-340376564e68?q=80&w=1920') center center/cover}
  .hero-content{max-width:1200px;margin:auto}
  .logo{font-size:34px;font-weight:700;letter-spacing:1px}
  .toca-logo{position:absolute;top:20px;right:20px;z-index:100}
  .toca-logo img{width:180px;height:auto}
  .content-wrapper{max-width:900px}
  h1{font-size:72px;margin-top:40px;margin-bottom:25px;line-height:1.1}
  h2{font-size:42px;margin:0 0 30px 0;line-height:1.3}
  .content-wrapper p{color:#d5d5d5;font-size:24px;line-height:1.8;margin-bottom:25px}
  .cta{margin-top:20px;font-size:24px;font-weight:bold}
  .stats{display:flex;gap:30px;margin-top:60px;flex-wrap:wrap}
  .card{background:#151515;padding:25px;border-radius:16px;min-width:220px;text-align:center}
  .card h2{color:#42ff8c;font-size:50px;margin:0 0 10px 0}
  .footer{width:100%;background:#0d0d0d;color:#a0a0a0;text-align:center;padding:30px;font-size:18px}
  @media(max-width:900px){
    h1{font-size:48px}
    h2{font-size:28px}
    .content-wrapper p{font-size:18px}
    .toca-logo img{width:110px}
    .footer{font-size:14px}
  }
</style>
</head>
<body>
<section class="hero">
<div class="hero-content">

<div class="toca-logo">
${tocaMark(180)}
</div>

<div class="logo">${SITE_NAME}</div>

<div class="content-wrapper">

<h1>The Tesla Ownership + AFIRMICO Advantage</h1>

<h2>Connect your Tesla App to discover exclusive benefits designed specifically for Tesla owners.</h2>

<p>AFIRMICO helps participating insurance, energy and automotive partners recognise verified Tesla Owners Club of Australia (TOCA) membership. Combining driving telemetry, charging behaviour and Powerwall usage to unlock personalised insurance opportunities, energy savings and future benefits.</p>
<br>

<p>
<strong>TOCA Members</strong> - FREE
<br><br>
<strong>Non TOCA Members</strong> - $250
<small>(TOCA Membership = $25 PA)</small>
<br><br>
<a href="${JOIN_TOCA_URL}" target="_blank" rel="noopener"
   style="color:white;font-weight:bold;text-decoration:underline;">JOIN TOCA HERE</a>
</p>

</div>

<div class="stats">
<div class="card"><h2>X%</h2>Potential Insurance Savings</div>
<div class="card"><h2>100%</h2>Member Opt-In</div>
<div class="card"><h2>Instant</h2>Tesla App Connection</div>
</div>

<div class="cta">#ConnectTeslaApp<br>#AFIRMICOAuto</div>

</div>

<div class="footer">AFIRMICO Auto | EV Data | Home Energy Statistics | Benefit Optimisation</div>

</section>
</body>
</html>`
}