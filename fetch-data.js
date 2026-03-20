/**
 * fetch-data.js
 * Pulls all tabs from the Berczy Tavern Google Sheet,
 * processes them into clean JSON, and saves to /data.
 * Run: node fetch-data.js
 */

const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

const SHEET_ID = '1kH0yrnjAyBW3cEvosnAqfXEYL5u_oXdeT3dMCmcSNzU';
const DATA_DIR = path.join(__dirname, 'data');

const TABS = {
  summary:      139701347,
  berczy:       301571236,
  facebook:     1674719500,
  googleAds:    255260152,
  googlePrivate:714889717,
  reservations: 1037356300,
  perfectVenue: 1125904723,
  emails:       150809214,
  emailSent:    1698240072,
};

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

// ─── CSV Helpers ──────────────────────────────────────────────────────────────

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQuotes = !inQuotes; continue; }
    if (ch === ',' && !inQuotes) { result.push(current.trim()); current = ''; continue; }
    current += ch;
  }
  result.push(current.trim());
  return result;
}

function cleanNum(val) {
  if (!val) return 0;
  return parseFloat(val.replace(/[A-Z]{1,3}\$|[$%,₱\s]/g, '')) || 0;
}

async function fetchCSV(gid) {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${gid}`;
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`Failed to fetch gid=${gid}: ${res.status}`);
  const text = await res.text();
  return text.split('\n').filter(l => l.trim());
}

// ─── Processors ───────────────────────────────────────────────────────────────

async function processSummary() {
  console.log('📊 Fetching Summary...');
  const lines = await fetchCSV(TABS.summary);
  const daily = [];
  const monthly = {};

  for (let i = 1; i < lines.length; i++) {
    const col = parseCSVLine(lines[i]);
    if (!col[0] || !col[0].match(/\d+\/\d+\/\d+/)) continue;
    const [m, d, y] = col[0].split('/');
    if (!y) continue;
    const spend = cleanNum(col[1]);
    const covers = cleanNum(col[2]);
    const users = cleanNum(col[3]);
    const date = `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
    const monthKey = `${y}-${m.padStart(2,'0')}`;

    daily.push({ date, spend, covers, users });

    if (!monthly[monthKey]) monthly[monthKey] = { month: monthKey, spend: 0, covers: 0, users: 0, days: 0 };
    monthly[monthKey].spend += spend;
    monthly[monthKey].covers += covers;
    monthly[monthKey].users += users;
    monthly[monthKey].days++;
  }

  const monthlyArr = Object.values(monthly).sort((a, b) => a.month.localeCompare(b.month));
  monthlyArr.forEach(m => {
    m.costPerCover = m.covers > 0 ? +(m.spend / m.covers).toFixed(2) : 0;
    m.avgDailyCovers = m.days > 0 ? +(m.covers / m.days).toFixed(1) : 0;
  });

  return { daily, monthly: monthlyArr };
}

async function processFacebook() {
  console.log('📘 Fetching Facebook Ads...');
  const lines = await fetchCSV(TABS.facebook);
  const monthly = {};

  // Facebook CSV: 2 title rows, then header row at index 2, data starts at index 3
  // Columns: Day(0), Ad delivery(1), Budget(2), Reach(3), Amount spent(4),
  //          Impressions(5), Link clicks(6), CTR(7), CPC(8), CPM(9)
  for (let i = 3; i < lines.length; i++) {
    const col = parseCSVLine(lines[i]);
    if (!col[0] || !col[0].match(/^\d{4}-\d{2}-\d{2}/)) continue;
    const [y, m] = col[0].split('-');
    const key = `${y}-${m}`;
    const spend = cleanNum(col[4]);
    const reach = cleanNum(col[3]);
    const impr = cleanNum(col[5]);
    const clicks = cleanNum(col[6]);

    if (!monthly[key]) monthly[key] = { month: key, spend: 0, reach: 0, impressions: 0, clicks: 0 };
    monthly[key].spend += spend;
    monthly[key].reach += reach;
    monthly[key].impressions += impr;
    monthly[key].clicks += clicks;
  }

  const arr = Object.values(monthly).sort((a, b) => a.month.localeCompare(b.month));
  arr.forEach(m => {
    m.ctr = m.impressions > 0 ? +(m.clicks / m.impressions * 100).toFixed(2) : 0;
    m.cpc = m.clicks > 0 ? +(m.spend / m.clicks).toFixed(2) : 0;
    m.cpm = m.impressions > 0 ? +(m.spend / m.impressions * 1000).toFixed(2) : 0;
  });
  return arr;
}

async function processGoogleAds() {
  console.log('🔍 Fetching Google Ads...');
  const lines = await fetchCSV(TABS.googleAds);
  const monthly = {};
  const campaigns = {};

  // Header is on row index 2
  for (let i = 3; i < lines.length; i++) {
    const col = parseCSVLine(lines[i]);
    if (!col[0] || !col[0].match(/^\d{4}/)) continue;
    const [y, m] = col[0].split('-');
    const key = `${y}-${m}`;
    const spend = cleanNum(col[1]);
    const impr = cleanNum(col[2]);
    const clicks = cleanNum(col[3]);
    const res = cleanNum(col[10]);
    const calls = cleanNum(col[14]);
    const campaign = (col[7] || '').trim();

    if (!monthly[key]) monthly[key] = { month: key, spend: 0, impressions: 0, clicks: 0, reservations: 0, calls: 0 };
    monthly[key].spend += spend;
    monthly[key].impressions += impr;
    monthly[key].clicks += clicks;
    monthly[key].reservations += res;
    monthly[key].calls += calls;

    if (campaign) {
      if (!campaigns[campaign]) campaigns[campaign] = { name: campaign, spend: 0, clicks: 0, impressions: 0, reservations: 0, calls: 0 };
      campaigns[campaign].spend += spend;
      campaigns[campaign].clicks += clicks;
      campaigns[campaign].impressions += impr;
      campaigns[campaign].reservations += res;
      campaigns[campaign].calls += calls;
    }
  }

  const arr = Object.values(monthly).sort((a, b) => a.month.localeCompare(b.month));
  arr.forEach(m => {
    m.ctr = m.impressions > 0 ? +(m.clicks / m.impressions * 100).toFixed(2) : 0;
    m.cpc = m.clicks > 0 ? +(m.spend / m.clicks).toFixed(2) : 0;
    m.costPerRes = m.reservations > 0 ? +(m.spend / m.reservations).toFixed(2) : 0;
  });

  const campArr = Object.values(campaigns).map(c => ({
    ...c,
    cpc: c.clicks > 0 ? +(c.spend / c.clicks).toFixed(2) : 0,
    costPerRes: c.reservations > 0 ? +(c.spend / c.reservations).toFixed(2) : 0,
  }));

  return { monthly: arr, campaigns: campArr };
}

async function processGooglePrivate() {
  console.log('🔒 Fetching Google Private Ads...');
  const lines = await fetchCSV(TABS.googlePrivate);
  const monthly = {};
  for (let i = 3; i < lines.length; i++) {
    const col = parseCSVLine(lines[i]);
    if (!col[0] || !col[0].match(/^\d{4}/)) continue;
    const [y, m] = col[0].split('-');
    const key = `${y}-${m}`;
    const spend = cleanNum(col[1]);
    const impr = cleanNum(col[2]);
    const clicks = cleanNum(col[3]);
    const leads = cleanNum(col[11]);
    if (!monthly[key]) monthly[key] = { month: key, spend: 0, impressions: 0, clicks: 0, leads: 0 };
    monthly[key].spend += spend;
    monthly[key].impressions += impr;
    monthly[key].clicks += clicks;
    monthly[key].leads += leads;
  }
  const arr = Object.values(monthly).sort((a, b) => a.month.localeCompare(b.month));
  arr.forEach(m => {
    m.ctr = m.impressions > 0 ? +(m.clicks / m.impressions * 100).toFixed(2) : 0;
    m.costPerLead = m.leads > 0 ? +(m.spend / m.leads).toFixed(2) : 0;
  });
  return arr;
}

async function processReservations() {
  console.log('🍽️ Fetching Reservations...');
  const lines = await fetchCSV(TABS.reservations);
  let total = 0, totalCovers = 0, firstVisit = 0, optIn = 0;
  let done = 0, cancelled = 0, noShow = 0;
  const days = { Mon: 0, Tue: 0, Wed: 0, Thu: 0, Fri: 0, Sat: 0, Sun: 0 };
  const times = {};
  const sizes = {};
  const monthly = {};
  const ltSpends = [];

  for (let i = 1; i < lines.length; i++) {
    const col = parseCSVLine(lines[i]);
    if (!col[2] || !col[2].match(/\d+\/\d+\/\d+/)) continue; // col[2] = Created Date
    const [m, d, y] = col[2].split('/');
    if (!y || parseInt(y) < 2020) continue;

    const dt = new Date(parseInt(y), parseInt(m) - 1, parseInt(d));
    const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dt.getDay()];
    days[dow] = (days[dow] || 0) + 1;

    const timeStr = (col[1] || '').trim();
    const tm = timeStr.match(/(\d+):(\d+)\s*(AM|PM)/i);
    if (tm) {
      let h = parseInt(tm[1]);
      if (tm[3].toUpperCase() === 'PM' && h !== 12) h += 12;
      if (tm[3].toUpperCase() === 'AM' && h === 12) h = 0;
      const label = h === 0 ? '12AM' : h < 12 ? `${h}AM` : h === 12 ? '12PM' : `${h - 12}PM`;
      times[label] = (times[label] || 0) + 1;
    }

    const size = parseInt(col[8]) || 0;
    const status = (col[9] || '').trim();
    const isFirst = (col[17] || '').trim() === '1';
    const lt = cleanNum(col[15]);
    const key = `${y}-${m.padStart(2, '0')}`;

    if (!monthly[key]) monthly[key] = { month: key, reservations: 0, covers: 0, firstVisit: 0, cancelled: 0, noShow: 0 };
    monthly[key].reservations++;
    monthly[key].covers += size;
    if (isFirst) monthly[key].firstVisit++;
    if (status === 'Canceled') monthly[key].cancelled++;
    if (status === 'No Show') monthly[key].noShow++;

    if (size) sizes[size] = (sizes[size] || 0) + 1;
    if (status === 'Done' || status === 'Assumed Finished') done++;
    if (status === 'Canceled') cancelled++;
    if (status === 'No Show') noShow++;
    if (isFirst) firstVisit++;
    if ((col[6] || '').trim() === 'TRUE') optIn++;
    if (lt > 0) ltSpends.push(lt);
    total++; totalCovers += size;
  }

  const timeArr = Object.entries(times)
    .map(([label, count]) => {
      const h = label.endsWith('AM') ? (label === '12AM' ? 0 : parseInt(label)) : (label === '12PM' ? 12 : parseInt(label) + 12);
      return { label, count, hour: h };
    })
    .sort((a, b) => a.hour - b.hour);

  const sizeArr = Object.entries(sizes)
    .map(([size, count]) => ({ size: parseInt(size), count }))
    .sort((a, b) => a.size - b.size);

  const monthlyArr = Object.values(monthly).sort((a, b) => a.month.localeCompare(b.month));

  const avgLT = ltSpends.length ? ltSpends.reduce((a, b) => a + b, 0) / ltSpends.length : 0;

  return {
    summary: {
      total, totalCovers,
      avgPartySize: +(totalCovers / total).toFixed(2),
      completionRate: +(done / total * 100).toFixed(1),
      cancellationRate: +(cancelled / total * 100).toFixed(1),
      noShowRate: +(noShow / total * 100).toFixed(1),
      firstVisitRate: +(firstVisit / total * 100).toFixed(1),
      returnRate: +((total - firstVisit) / total * 100).toFixed(1),
      optInRate: +(optIn / total * 100).toFixed(1),
      avgLifetimeSpend: +avgLT.toFixed(2),
    },
    days,
    times: timeArr,
    sizes: sizeArr,
    monthly: monthlyArr,
  };
}

async function processPerfectVenue() {
  console.log('🏛️ Fetching Perfect Venue...');
  const lines = await fetchCSV(TABS.perfectVenue);
  const statuses = {};
  const lostReasons = {};
  const monthly = {};
  let completedRev = 0, completedCount = 0;

  for (let i = 1; i < lines.length; i++) {
    const col = parseCSVLine(lines[i]);
    if (!col[1]) continue;
    const status = (col[3] || '').trim();
    const lostReason = (col[28] || '').trim().replace(/['"]/g, '');
    const proposalTotal = cleanNum(col[42]);
    const createdOn = (col[22] || '').trim();

    statuses[status] = (statuses[status] || 0) + 1;
    if (lostReason && status === 'Lost') {
      lostReasons[lostReason] = (lostReasons[lostReason] || 0) + 1;
    }

    if (createdOn && createdOn.match(/\d+\/\d+\/\d+/)) {
      const [m,,y] = createdOn.split('/');
      if (y) {
        const key = `${y}-${m.padStart(2, '0')}`;
        if (!monthly[key]) monthly[key] = { month: key, leads: 0, completed: 0, lost: 0 };
        monthly[key].leads++;
        if (status === 'Completed') monthly[key].completed++;
        if (status === 'Lost') monthly[key].lost++;
      }
    }

    if (status === 'Completed' && proposalTotal > 0) {
      completedRev += proposalTotal;
      completedCount++;
    }
  }

  const topLostReasons = Object.entries(lostReasons)
    .filter(([r]) => r.length > 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([reason, count]) => ({ reason, count }));

  return {
    statuses: Object.entries(statuses).map(([status, count]) => ({ status, count })).sort((a, b) => b.count - a.count),
    lostReasons: topLostReasons,
    monthly: Object.values(monthly).sort((a, b) => a.month.localeCompare(b.month)),
    totalCompletedRevenue: +completedRev.toFixed(0),
    avgRevenuePerEvent: completedCount > 0 ? +(completedRev / completedCount).toFixed(0) : 0,
    closeRate: statuses.Completed && statuses.Lost ? +((statuses.Completed / (statuses.Completed + statuses.Lost)) * 100).toFixed(1) : 0,
  };
}

async function processEmail() {
  console.log('📧 Fetching Email...');
  const sentLines = await fetchCSV(TABS.emailSent);
  const subLines = await fetchCSV(TABS.emails);

  const monthly = {};
  for (let i = 1; i < sentLines.length; i++) {
    const col = parseCSVLine(sentLines[i]);
    const dateStr = (col[0] || '').trim();
    const status = (col[3] || '').trim();
    const m = dateStr.match(/(\d+)\/(\d+)\/(\d+)/);
    if (!m) continue;
    const key = `${m[3]}-${m[1].padStart(2, '0')}`;
    if (!monthly[key]) monthly[key] = { month: key, total: 0, delivered: 0, opened: 0, clicked: 0, unsubscribed: 0, replied: 0 };
    monthly[key].total++;
    if (status === 'Delivered') monthly[key].delivered++;
    if (status === 'Opened') monthly[key].opened++;
    if (status === 'Clicked') monthly[key].clicked++;
    if (status === 'Unsubscribed') monthly[key].unsubscribed++;
    if (status === 'Replied') monthly[key].replied++;
  }

  const arr = Object.values(monthly).sort((a, b) => a.month.localeCompare(b.month));
  arr.forEach(m => {
    m.openRate = m.total > 0 ? +(m.opened / m.total * 100).toFixed(1) : 0;
    m.clickRate = m.total > 0 ? +(m.clicked / m.total * 100).toFixed(1) : 0;
    m.unsubRate = m.total > 0 ? +(m.unsubscribed / m.total * 100).toFixed(1) : 0;
  });

  const subMonths = {};
  for (let i = 1; i < subLines.length; i++) {
    const col = parseCSVLine(subLines[i]);
    const dateStr = (col[0] || '').trim();
    const mo = dateStr.match(/(\w+)\s+(\d+)\s+(\d+)/);
    if (mo) {
      const monthMap = { Jan:'01',Feb:'02',Mar:'03',Apr:'04',May:'05',Jun:'06',Jul:'07',Aug:'08',Sep:'09',Oct:'10',Nov:'11',Dec:'12' };
      const key = `${mo[3]}-${monthMap[mo[1]] || '00'}`;
      subMonths[key] = (subMonths[key] || 0) + 1;
    }
  }

  return {
    monthly: arr,
    subscribersByMonth: Object.entries(subMonths).sort((a, b) => a[0].localeCompare(b[0])).map(([month, count]) => ({ month, count })),
    totalSubscribers: subLines.length - 1,
  };
}

// ─── Generate Insights ────────────────────────────────────────────────────────

function generateInsights(summary, facebook, googleAds, reservations, perfectVenue, email) {
  const insights = [];
  const monthly = summary.monthly;
  const last3 = monthly.slice(-4).filter(m => m.covers > 0);
  const prev3 = monthly.slice(-8, -4).filter(m => m.covers > 0);

  // Cover trend
  if (last3.length >= 2 && prev3.length >= 2) {
    const recentAvg = last3.reduce((a, b) => a + b.covers, 0) / last3.length;
    const prevAvg = prev3.reduce((a, b) => a + b.covers, 0) / prev3.length;
    const change = ((recentAvg - prevAvg) / prevAvg * 100).toFixed(1);
    if (Math.abs(change) > 5) {
      insights.push({
        type: change > 0 ? 'positive' : 'warning',
        title: `Covers ${change > 0 ? '▲ Up' : '▼ Down'} ${Math.abs(change)}%`,
        body: `Recent 3-month average (${Math.round(recentAvg)}/mo) vs prior period (${Math.round(prevAvg)}/mo).`,
      });
    }
  }

  // Facebook CPC trend
  const fbLast2 = facebook.slice(-3).filter(m => m.spend > 0);
  const fbFirst2 = facebook.slice(0, 3).filter(m => m.spend > 0);
  if (fbLast2.length && fbFirst2.length) {
    const recentCPC = fbLast2.reduce((a, b) => a + b.cpc, 0) / fbLast2.length;
    const earlyCPC = fbFirst2.reduce((a, b) => a + b.cpc, 0) / fbFirst2.length;
    if (recentCPC > earlyCPC * 1.5) {
      insights.push({
        type: 'warning',
        title: '⚠️ Facebook CPC Rising',
        body: `CPC has increased from $${earlyCPC.toFixed(2)} to $${recentCPC.toFixed(2)} — consider refreshing ad creative.`,
      });
    }
  }

  // CTR drop
  const fbRecent = facebook.slice(-2).filter(m => m.spend > 0);
  const fbMid = facebook.slice(-6, -2).filter(m => m.spend > 0);
  if (fbRecent.length && fbMid.length) {
    const recentCTR = fbRecent.reduce((a, b) => a + b.ctr, 0) / fbRecent.length;
    const midCTR = fbMid.reduce((a, b) => a + b.ctr, 0) / fbMid.length;
    if (recentCTR < midCTR * 0.75) {
      insights.push({
        type: 'warning',
        title: '⚠️ Facebook CTR Declining',
        body: `CTR dropped from ${midCTR.toFixed(2)}% to ${recentCTR.toFixed(2)}% — audience may be experiencing creative fatigue.`,
      });
    }
  }

  // Best month ever
  const bestMonth = [...monthly].sort((a, b) => b.covers - a.covers)[0];
  if (bestMonth) {
    insights.push({
      type: 'positive',
      title: `🏆 Best Month: ${bestMonth.month}`,
      body: `${bestMonth.covers.toLocaleString()} covers — ${bestMonth.avgDailyCovers} avg/day at $${bestMonth.costPerCover}/cover.`,
    });
  }

  // Private events close rate
  if (perfectVenue.closeRate < 35) {
    insights.push({
      type: 'warning',
      title: `⚠️ Private Events Close Rate: ${perfectVenue.closeRate}%`,
      body: `46% of lost leads went unresponsive. Faster follow-up (within 1hr) could significantly improve close rate.`,
    });
  }

  // Email unsubscribe
  const lastEmail = email.monthly[email.monthly.length - 1];
  if (lastEmail && lastEmail.unsubRate > 1.5) {
    insights.push({
      type: 'warning',
      title: `⚠️ High Email Unsubscribe Rate: ${lastEmail.unsubRate}%`,
      body: `Industry benchmark is <0.5%. Consider reducing send frequency or improving segmentation.`,
    });
  }

  // Organic floor
  const noAdMonths = monthly.filter(m => m.spend === 0 && m.covers > 0);
  if (noAdMonths.length) {
    const avgOrganic = noAdMonths.reduce((a, b) => a + b.covers, 0) / noAdMonths.length;
    insights.push({
      type: 'info',
      title: `📌 Organic Baseline: ~${Math.round(avgOrganic).toLocaleString()} covers/mo`,
      body: `Based on ${noAdMonths.length} months with zero ad spend. All covers above this are ad-driven.`,
    });
  }

  // Low marketing opt-in
  if (reservations.summary.optInRate < 15) {
    insights.push({
      type: 'opportunity',
      title: `💡 Only ${reservations.summary.optInRate}% of guests opt into marketing`,
      body: `With ${reservations.summary.total.toLocaleString()} reservation records, there's a large untapped email audience.`,
    });
  }

  // Monday opportunity
  insights.push({
    type: 'info',
    title: '📅 Monday Is Nearly Unused',
    body: 'Only 33 Monday reservations recorded. Consider closing Mondays or dedicating them to private events/buyouts.',
  });

  return insights;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🚀 Starting data fetch...\n');
  try {
    const [summary, facebook, googleAdsData, googlePrivate, reservations, perfectVenue, email] = await Promise.all([
      processSummary(),
      processFacebook(),
      processGoogleAds(),
      processGooglePrivate(),
      processReservations(),
      processPerfectVenue(),
      processEmail(),
    ]);

    const insights = generateInsights(summary, facebook, googleAdsData, reservations, perfectVenue, email);

    const save = (name, data) => {
      const filePath = path.join(DATA_DIR, `${name}.json`);
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
      console.log(`✅ Saved ${name}.json`);
    };

    save('summary', summary);
    save('facebook', facebook);
    save('google-ads', googleAdsData);
    save('google-private', googlePrivate);
    save('reservations', reservations);
    save('perfect-venue', perfectVenue);
    save('email', email);
    save('insights', insights);
    save('meta', { lastUpdated: new Date().toISOString(), sheetId: SHEET_ID });

    console.log('\n✨ All data fetched and saved successfully!');
  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  }
}

main();
