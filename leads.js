// Pushes check-ins to HubSpot and a Google Sheet in the background.
// Both are optional: set HUBSPOT_TOKEN and/or SHEET_WEBHOOK_URL (+ SHEET_SECRET).
// A slow or failing CRM must never slow down the game, so pushes go through a
// queue spaced under HubSpot's rate limit, retry 3 times, then get logged to
// DATA_DIR/lead-failures.jsonl (the CSV export still has every check-in).
const fs = require('fs');
const path = require('path');

const HS = 'https://api.hubapi.com';
const GAP_MS = 250;            // ~4 jobs/s; each HubSpot job is 1-3 calls, under the 100 per 10s limit

function createLeadSync({ dataDir, hubspotToken = process.env.HUBSPOT_TOKEN, sheetUrl = process.env.SHEET_WEBHOOK_URL,
  sheetSecret = process.env.SHEET_SECRET || '', hubspotBase = process.env.HUBSPOT_BASE || HS, log = console } = {}) {
  const queue = []; let running = false;
  const stats = { hubspot: 0, sheet: 0, failed: 0, pending: 0 };

  async function call(url, opts) {
    const r = await fetch(url, { ...opts, signal: AbortSignal.timeout(15000) });
    const text = await r.text();
    let body; try { body = JSON.parse(text); } catch { body = text; }
    return { status: r.status, body };
  }

  async function toHubspot(row) {
    const h = { authorization: `Bearer ${hubspotToken}`, 'content-type': 'application/json' };
    const [firstname, ...rest] = row.name.split(/\s+/);
    const props = { email: row.email, firstname, lastname: rest.join(' ') };
    if (row.phone) props.phone = row.phone;
    if (row.linkedin) props.hs_linkedin_url = row.linkedin;
    let r = await call(`${hubspotBase}/crm/v3/objects/contacts`, { method: 'POST', headers: h,
      body: JSON.stringify({ properties: { ...props, hs_lead_status: 'NEW' } }) });
    let id = r.body?.id;
    if (r.status === 409) {
      // Existing contact: don't overwrite their name or lead status. Just attach the note.
      id = String(r.body?.message || '').match(/Existing ID:\s*(\d+)/)?.[1];
      if (!id) throw new Error('409 without existing id');
    } else if (r.status >= 300) throw new Error(`contact ${r.status}: ${JSON.stringify(r.body).slice(0, 200)}`);
    const note = `Checked in at ${row.eventTitle} (event quiz, game ${row.pin}).` +
      (row.phone ? ` Phone: ${row.phone}.` : '') + (row.linkedin ? ` LinkedIn: ${row.linkedin}` : '');
    r = await call(`${hubspotBase}/crm/v3/objects/notes`, { method: 'POST', headers: h, body: JSON.stringify({
      properties: { hs_timestamp: row.time, hs_note_body: note },
      associations: [{ to: { id }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 202 }] }] }) });
    if (r.status >= 300) throw new Error(`note ${r.status}: ${JSON.stringify(r.body).slice(0, 200)}`);
  }

  async function toSheet(row) {
    const r = await call(sheetUrl, { method: 'POST', headers: { 'content-type': 'text/plain' },
      body: JSON.stringify({ secret: sheetSecret, ...row }), redirect: 'follow' });
    if (r.status >= 300 || r.body?.ok === false) throw new Error(`sheet ${r.status}: ${JSON.stringify(r.body).slice(0, 200)}`);
  }

  async function runJob(job) {
    for (let attempt = 1; ; attempt++) {
      try { await job.fn(job.row); stats[job.kind]++; return; }
      catch (e) {
        if (attempt >= 3) {
          stats.failed++;
          log.error(`lead push to ${job.kind} failed for ${job.row.email}: ${e.message}`);
          fs.appendFileSync(path.join(dataDir, 'lead-failures.jsonl'),
            JSON.stringify({ kind: job.kind, error: e.message, row: job.row }) + '\n');
          return;
        }
        await new Promise(r => setTimeout(r, attempt * 2000));
      }
    }
  }

  async function drain() {
    if (running) return; running = true;
    while (queue.length) {
      const job = queue.shift(); stats.pending = queue.length;
      await runJob(job);
      await new Promise(r => setTimeout(r, GAP_MS));
    }
    stats.pending = 0; running = false;
  }

  return {
    enabled: { hubspot: !!hubspotToken, sheet: !!sheetUrl },
    stats,
    push(row) {
      if (sheetUrl) queue.push({ kind: 'sheet', fn: toSheet, row });
      if (hubspotToken && row.consent) queue.push({ kind: 'hubspot', fn: toHubspot, row });   // CRM only with consent
      stats.pending = queue.length; drain();
    },
  };
}

module.exports = { createLeadSync };
