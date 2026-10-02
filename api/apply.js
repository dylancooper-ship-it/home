// POST /api/apply - receives an application from the site quiz.
//
// Copied from the main site (growthoperator/api/apply.js). Applications land in
// the same ascension.applications table; `page` (home.theascensionpartners.com)
// and the subject prefix tell them apart.
//
// Emails it to you via Resend, and mirrors it to Whop as a server-side
// conversion event so paid traffic can be attributed even when the browser
// pixel is blocked.
//
// Required env vars (Vercel > Settings > Environment Variables):
// At least ONE channel must be configured; either alone is enough.
//   SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY   stores the application (the list)
//   WHOP_API_KEY       lands the lead in Whop as a Person + conversion event
//   WHOP_APP_API_KEY   pushes the full answers to the Whop notification feed
//                      (app_57FSjcOd7SsB1o - must be an APP key, not a company key)
//   RESEND_API_KEY     emails the full answers. The addresses default to the
//                      constants below, so this key is the only thing needed;
//                      APPLY_TO_EMAIL / APPLY_FROM_EMAIL override them.
//   WHOP_ACCOUNT_ID    optional, defaults to the business below

const WHOP_ACCOUNT = process.env.WHOP_ACCOUNT_ID || 'biz_ACUrpfixnqES98';

// Where applications land. Baked in rather than left to an env var so a missing
// setting cannot silently drop the notification; the env vars still override.
const TO_EMAIL = process.env.APPLY_TO_EMAIL || 'dylan.cooper@theascensionpartners.com';
// Resend will only send from a domain verified in the Resend dashboard.
const FROM_EMAIL = process.env.APPLY_FROM_EMAIL || 'applications@theascensionpartners.com';

const esc = (v) =>
  String(v == null ? '' : v).replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'Bad JSON' }); }
  }
  const { name, email, phone, handle, note, recommended, page, referrer } = body || {};
  // The table has no phone column, so the phone rides along inside answers:
  // adding an unknown column to the insert would fail the whole row.
  const answers = { ...((body && body.answers) || {}), ...(phone ? { phone: String(phone).trim() } : {}) };

  // trim first: validating a pasted address before normalising it rejected
  // addresses that only had trailing whitespace
  const cleanName = String(name == null ? '' : name).trim();
  const cleanEmail = String(email == null ? '' : email).trim().toLowerCase();
  if (!cleanName || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cleanEmail)) {
    return res.status(400).json({ error: 'Name and a valid email are required' });
  }

  const rows = Object.entries(answers)
    .map(([k, v]) => `<tr><td style="padding:6px 14px 6px 0;color:#57534e">${esc(k)}</td>` +
                     `<td style="padding:6px 0;color:#0c0a09"><b>${esc(v)}</b></td></tr>`)
    .join('');

  const html = `
    <div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:640px">
      <p style="font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#a16207;margin:0 0 6px">
        New application</p>
      <h2 style="margin:0 0 4px;font-size:24px;color:#0c0a09">${esc(name)}</h2>
      <p style="margin:0 0 18px;color:#57534e">
        <a href="mailto:${esc(email)}" style="color:#a16207">${esc(email)}</a>
        ${handle ? ' &middot; ' + esc(handle) : ''}
      </p>
      <table style="border-collapse:collapse;font-size:14px">${rows}</table>
      ${recommended ? `<p style="margin:18px 0 0;font-size:14px;color:#0c0a09">
        Likely starting point: <b style="color:#a16207">${esc(recommended)}</b></p>` : ''}
      ${note ? `<p style="margin:18px 0 0;padding:14px;background:#f5f5f4;
        border-left:3px solid #a16207;font-size:14px;color:#1c1917;white-space:pre-wrap">${esc(note)}</p>` : ''}
      <p style="margin:22px 0 0;font-size:12px;color:#78716c">
        ${esc(page || '')}${referrer ? ' &middot; via ' + esc(referrer) : ''}
      </p>
    </div>`;

  const { RESEND_API_KEY, WHOP_API_KEY, WHOP_APP_API_KEY,
          SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  const delivered = [];
  let emailError = null;

  // 1. Whop. Creates/updates the Person and records the conversion, so the
  //    lead is attributable to whatever ad or post produced it.
  if (WHOP_API_KEY) {
    try {
      const [first, ...rest] = cleanName.split(/\s+/);
      const r = await fetch('https://api.whop.com/api/v1/events', {
        method: 'POST',
        headers: { Authorization: `Bearer ${WHOP_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          account_id: WHOP_ACCOUNT,
          event_name: 'submit_application',
          action_source: 'website',
          url: page || undefined,
          referrer_url: referrer || undefined,
          product_id: 'prod_bPUbz4Vk5PWEK',
          user: {
            email: cleanEmail,
            first_name: first || undefined,
            last_name: rest.length ? rest.join(' ') : undefined,
          },
        }),
      });
      if (r.ok) delivered.push('whop');
      else console.error('whop event failed', r.status, await r.text());
    } catch (e) {
      console.error('whop event threw', e);
    }
  }

  // 1b. Supabase is the system of record. Whop notifications are an alert;
  //     this is the list you can actually come back to and query.
  if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/applications`, {
        method: 'POST',
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          'Content-Type': 'application/json',
          'Content-Profile': 'ascension',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({
          name, email, handle: handle || null, note: note || null,
          answers: answers || {}, recommended: recommended || null,
          page: page || null, referrer: referrer || null,
        }),
      });
      if (r.ok) delivered.push('database');
      else console.error('supabase insert failed', r.status, await r.text());
    } catch (e) {
      console.error('supabase insert threw', e);
    }
  }

  // 2. Whop notification. The event schema has nowhere to put the answers, so
  //    the full submission is pushed to the team's Whop feed instead. Requires
  //    an APP API key (WHOP_APP_API_KEY) - a company key is refused with 403.
  if (WHOP_APP_API_KEY) {
    try {
      const lines = Object.entries(answers).map(([k, v]) => `${k}: ${v}`).join('\n');
      const r = await fetch('https://api.whop.com/api/v1/notifications', {
        method: 'POST',
        headers: { Authorization: `Bearer ${WHOP_APP_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          account_id: WHOP_ACCOUNT,
          title: `New home services application - ${name}`,
          subtitle: recommended ? `Likely start: ${recommended}` : undefined,
          content: [
            `${email}${handle ? ' | ' + handle : ''}`,
            '',
            lines,
            note ? '\n' + note : '',
          ].filter(Boolean).join('\n'),
        }),
      });
      if (r.ok) delivered.push('whop-notification');
      else console.error('whop notification failed', r.status, await r.text());
    } catch (e) {
      console.error('whop notification threw', e);
    }
  }

  // 3. Email carries the full answers, which the event schema has no room for.
  if (RESEND_API_KEY) {
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: FROM_EMAIL,
          to: [TO_EMAIL],
          reply_to: email,
          subject: `[Home Services] Application - ${name}${recommended ? ' (' + recommended + ')' : ''}`,
          html,
        }),
      });
      if (r.ok) delivered.push('email');
      else {
        const detail = await r.text();
        emailError = `resend ${r.status}: ${detail.slice(0, 300)}`;
        console.error('resend failed', r.status, detail);
      }
    } catch (e) {
      emailError = `resend threw: ${e && e.message}`;
      console.error('resend threw', e);
    }
  } else {
    emailError = 'RESEND_API_KEY is not set';
  }

  // Always leave a retrievable copy in the function logs, whatever else happened.
  console.log('APPLICATION', JSON.stringify({ ...body, delivered, emailError }));

  if (!delivered.length) {
    // Carry the mailer's own reason up: "no channel configured" alone gives no
    // way to tell a missing key from a rejected sender domain.
    return res.status(500).json({
      error: 'No delivery channel configured',
      ...(emailError ? { emailError } : {}),
    });
  }
  return res.status(200).json({ ok: true, delivered, ...(emailError ? { emailError } : {}) });
};
