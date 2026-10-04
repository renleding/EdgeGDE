/**
 * INEOS QLD splash page (partner variant of the root page).
 *
 * Renders through the same Worker path as `/` so it shares the favicon and
 * chrome. The page structure mirrors the TOCA splash but with INEOS QLD
 * branding and the membership link pointing to their site.
 */
import { FAVICON_LINK, SITE_NAME } from './layout'

const INEOS_LOGO_SRC = '/ineos-logo.png'
const INEOS_JOIN_URL = 'https://www.ineos4x4clubqld.com.au/membership'

export function ineosSplashPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${FAVICON_LINK}
<title>INEOS QLD × ${SITE_NAME} — The 4WD Ownership Advantage</title>
<style>
  *{box-sizing:border-box}
  body{margin:0;background:#090909;color:white;font-family:Arial,Helvetica,sans-serif}
  .hero{position:relative;min-height:100vh;padding:50px;
    background:linear-gradient(rgba(0,0,0,.65),rgba(0,0,0,.85)),
      url('https://images.unsplash.com/photo-1520038591365-d687696f5d1a?q=80&w=1920') center center/cover}
  .hero-content{max-width:1200px;margin:auto}
  .logo{font-size:34px;font-weight:700;letter-spacing:1px}
  .partner-logo{position:absolute;top:20px;right:20px;z-index:100}
  .partner-logo img{width:180px;height:auto}
  .content-wrapper{max-width:900px}
  h1{font-size:72px;margin-top:40px;margin-bottom:25px;line-height:1.1}
  h2{font-size:42px;margin:0 0 30px 0;line-height:1.3}
  .content-wrapper p{color:#d5d5d5;font-size:24px;line-height:1.8;margin-bottom:25px}
  .cta{margin-top:20px;font-size:24px;font-weight:bold}
  .stats{display:flex;gap:30px;margin-top:60px;flex-wrap:wrap}
  .card{background:#151515;padding:25px;border-radius:16px;min-width:220px;text-align:center}
  .card h2{color:#a52045;font-size:50px;margin:0 0 10px 0}
  .footer{width:100%;background:#0d0d0d;color:#a0a0a0;text-align:center;padding:30px;font-size:18px}
  @media(max-width:900px){
    h1{font-size:48px}
    h2{font-size:28px}
    .content-wrapper p{font-size:18px}
    .partner-logo img{width:110px}
    .footer{font-size:14px}
  }
</style>
</head>
<body>
<section class="hero">
<div class="hero-content">

<div class="partner-logo">
<img src="${INEOS_LOGO_SRC}" alt="INEOS 4x4 Club Queensland" width="180">
</div>

<div class="logo">${SITE_NAME}</div>

<div class="content-wrapper">

<h1>The 4WD Ownership + ${SITE_NAME} Advantage</h1>

<h2>Connect your INEOS QLD membership to discover exclusive benefits designed specifically for 4WD owners.</h2>

<p>AFIRMICO helps participating insurance, energy and automotive partners recognise verified INEOS 4x4 Club Queensland membership. Combining club membership with tailored benefits to unlock personalised insurance opportunities, vehicle protection and future advantages.</p>
<br>

<p>
<strong>INEOS QLD Members</strong> - FREE
<br><br>
<strong>Non INEOS 4WD Members</strong> - $250
<br><br>
<a href="${INEOS_JOIN_URL}" target="_blank" rel="noopener"
   style="color:white;font-weight:bold;text-decoration:underline;">JOIN INEOS QLD HERE</a>
</p>

</div>

<div class="stats">
<div class="card"><h2>X%</h2>Potential Insurance Savings</div>
<div class="card"><h2>100%</h2>Member Opt-In</div>
<div class="card"><h2>Instant</h2>Membership Connection</div>
</div>

<div class="cta">#ConnectINEOSQLD<br>#AFIRMICOAuto</div>

</div>

<div class="footer">AFIRMICO Auto | 4WD Club Membership | Vehicle Protection | Benefit Optimisation</div>

</section>
</body>
</html>`
}