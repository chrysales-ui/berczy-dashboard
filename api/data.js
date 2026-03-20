// Vercel serverless function — fetches all Google Sheets tabs and returns live JSON
// Called by the dashboard Refresh button for instant data updates

const SHEET_ID = '1kH0yrnjAyBW3cEvosnAqfXEYL5u_oXdeT3dMCmcSNzU';
const TABS = {
  summary:       139701347,
  facebook:      1674719500,
  googleAds:     255260152,
  googlePrivate: 714889717,
  reservations:  1037356300,
  perfectVenue:  1125904723,
  emailSent:     1698240072,
  emails:        150809214,
};

// ── Helpers ────────────────────────────────────────────────────────────────

function parseCSVLine(line) {
  const result = []; let current = ''; let inQuotes = false;
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
  if (!res.ok) throw new Error(`Failed gid=${gid}: ${res.status}`);
  return (await res.text()).split('\n').filter(l => l.trim());
}

// ── Processors (same logic as fetch-data.js) ──────────────────────────────

async function processSummary() {
  const lines = await fetchCSV(TABS.summary);
  const daily = []; const monthly = {};
  for (let i = 1; i < lines.length; i++) {
    const col = parseCSVLine(lines[i]);
    if (!col[0] || !col[0].match(/\d+\/\d+\/\d+/)) continue;
    const [m, d, y] = col[0].split('/');
    if (!y) continue;
    const spend = cleanNum(col[1]), covers = cleanNum(col[2]), users = cleanNum(col[3]);
    const date = `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
    const mk = `${y}-${m.padStart(2,'0')}`;
    daily.push({ date, spend, covers, users });
    if (!monthly[mk]) monthly[mk] = { month: mk, spend: 0, covers: 0, users: 0, days: 0 };
    monthly[mk].spend += spend; monthly[mk].covers += covers;
    monthly[mk].users += users; monthly[mk].days++;
  }
  const arr = Object.values(monthly).sort((a,b) => a.month.localeCompare(b.month));
  arr.forEach(m => {
    m.costPerCover = m.covers > 0 ? +(m.spend/m.covers).toFixed(2) : 0;
    m.avgDailyCovers = m.days > 0 ? +(m.covers/m.days).toFixed(1) : 0;
  });
  return { daily, monthly: arr };
}

async function processFacebook() {
  const lines = await fetchCSV(TABS.facebook);
  const monthly = {};
  for (let i = 3; i < lines.length; i++) {
    const col = parseCSVLine(lines[i]);
    if (!col[0] || !col[0].match(/^\d{4}-\d{2}-\d{2}/)) continue;
    const [y, m] = col[0].split('-');
    const key = `${y}-${m}`;
    const spend = cleanNum(col[4]), reach = cleanNum(col[3]);
    const impr = cleanNum(col[5]), clicks = cleanNum(col[6]);
    if (!monthly[key]) monthly[key] = { month: key, spend: 0, reach: 0, impressions: 0, clicks: 0 };
    monthly[key].spend += spend; monthly[key].reach += reach;
    monthly[key].impressions += impr; monthly[key].clicks += clicks;
  }
  const arr = Object.values(monthly).sort((a,b) => a.month.localeCompare(b.month));
  arr.forEach(m => {
    m.ctr = m.impressions > 0 ? +(m.clicks/m.impressions*100).toFixed(2) : 0;
    m.cpc = m.clicks > 0 ? +(m.spend/m.clicks).toFixed(2) : 0;
    m.cpm = m.impressions > 0 ? +(m.spend/m.impressions*1000).toFixed(2) : 0;
  });
  return arr;
}

async function processGoogleAds() {
  const lines = await fetchCSV(TABS.googleAds);
  const monthly = {}, campaigns = {};
  for (let i = 3; i < lines.length; i++) {
    const col = parseCSVLine(lines[i]);
    if (!col[0] || !col[0].match(/^\d{4}/)) continue;
    const [y, m] = col[0].split('-');
    const key = `${y}-${m}`;
    const spend = cleanNum(col[1]), impr = cleanNum(col[2]), clicks = cleanNum(col[3]);
    const res = cleanNum(col[10]), calls = cleanNum(col[14]);
    const campaign = (col[7] || '').trim();
    if (!monthly[key]) monthly[key] = { month: key, spend: 0, impressions: 0, clicks: 0, reservations: 0, calls: 0 };
    monthly[key].spend += spend; monthly[key].impressions += impr;
    monthly[key].clicks += clicks; monthly[key].reservations += res; monthly[key].calls += calls;
    if (campaign) {
      if (!campaigns[campaign]) campaigns[campaign] = { name: campaign, spend: 0, clicks: 0, impressions: 0, reservations: 0, calls: 0 };
      campaigns[campaign].spend += spend; campaigns[campaign].clicks += clicks;
      campaigns[campaign].impressions += impr; campaigns[campaign].reservations += res; campaigns[campaign].calls += calls;
    }
  }
  const arr = Object.values(monthly).sort((a,b) => a.month.localeCompare(b.month));
  arr.forEach(m => {
    m.ctr = m.impressions > 0 ? +(m.clicks/m.impressions*100).toFixed(2) : 0;
    m.cpc = m.clicks > 0 ? +(m.spend/m.clicks).toFixed(2) : 0;
    m.costPerRes = m.reservations > 0 ? +(m.spend/m.reservations).toFixed(2) : 0;
  });
  const campArr = Object.values(campaigns).map(c => ({
    ...c,
    cpc: c.clicks > 0 ? +(c.spend/c.clicks).toFixed(2) : 0,
    costPerRes: c.reservations > 0 ? +(c.spend/c.reservations).toFixed(2) : 0,
  }));
  return { monthly: arr, campaigns: campArr };
}

async function processGooglePrivate() {
  const lines = await fetchCSV(TABS.googlePrivate);
  const monthly = {};
  for (let i = 3; i < lines.length; i++) {
    const col = parseCSVLine(lines[i]);
    if (!col[0] || !col[0].match(/^\d{4}/)) continue;
    const [y, m] = col[0].split('-');
    const key = `${y}-${m}`;
    const spend = cleanNum(col[1]), impr = cleanNum(col[2]);
    const clicks = cleanNum(col[3]), leads = cleanNum(col[11]);
    if (!monthly[key]) monthly[key] = { month: key, spend: 0, impressions: 0, clicks: 0, leads: 0 };
    monthly[key].spend += spend; monthly[key].impressions += impr;
    monthly[key].clicks += clicks; monthly[key].leads += leads;
  }
  const arr = Object.values(monthly).sort((a,b) => a.month.localeCompare(b.month));
  arr.forEach(m => {
    m.ctr = m.impressions > 0 ? +(m.clicks/m.impressions*100).toFixed(2) : 0;
    m.costPerLead = m.leads > 0 ? +(m.spend/m.leads).toFixed(2) : 0;
  });
  return arr;
}

async function processReservations() {
  const lines = await fetchCSV(TABS.reservations);
  let total = 0, totalCovers = 0, firstVisit = 0, optIn = 0;
  let done = 0, cancelled = 0, noShow = 0;
  const days = { Mon:0,Tue:0,Wed:0,Thu:0,Fri:0,Sat:0,Sun:0 };
  const times = {}, sizes = {}, monthly = {}, ltSpends = [];
  for (let i = 1; i < lines.length; i++) {
    const col = parseCSVLine(lines[i]);
    if (!col[0] || !col[0].match(/\d+\/\d+\/\d+/)) continue;
    const [m, d, y] = col[0].split('/');
    if (!y || parseInt(y) < 2020) continue;
    const dt = new Date(parseInt(y), parseInt(m)-1, parseInt(d));
    const dow = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][dt.getDay()];
    days[dow] = (days[dow]||0) + 1;
    const tm = (col[1]||'').trim().match(/(\d+):(\d+)\s*(AM|PM)/i);
    if (tm) {
      let h = parseInt(tm[1]);
      if (tm[3].toUpperCase()==='PM' && h!==12) h+=12;
      if (tm[3].toUpperCase()==='AM' && h===12) h=0;
      const label = h===0?'12AM':h<12?`${h}AM`:h===12?'12PM':`${h-12}PM`;
      times[label] = (times[label]||0)+1;
    }
    const size = parseInt(col[8])||0, status = (col[9]||'').trim();
    const isFirst = (col[17]||'').trim()==='1', lt = cleanNum(col[15]);
    const key = `${y}-${m.padStart(2,'0')}`;
    if (!monthly[key]) monthly[key] = { month: key, reservations:0, covers:0, firstVisit:0, cancelled:0, noShow:0 };
    monthly[key].reservations++; monthly[key].covers += size;
    if (isFirst) monthly[key].firstVisit++;
    if (status==='Canceled') { monthly[key].cancelled++; cancelled++; }
    if (status==='No Show') { monthly[key].noShow++; noShow++; }
    if (status==='Done'||status==='Assumed Finished') done++;
    if (isFirst) firstVisit++;
    if ((col[6]||'').trim()==='TRUE') optIn++;
    if (lt>0) ltSpends.push(lt);
    if (size) sizes[size] = (sizes[size]||0)+1;
    total++; totalCovers += size;
  }
  const timeArr = Object.entries(times).map(([label,count]) => {
    const h = label.endsWith('AM')?(label==='12AM'?0:parseInt(label)):(label==='12PM'?12:parseInt(label)+12);
    return { label, count, hour: h };
  }).sort((a,b) => a.hour-b.hour);
  return {
    summary: { total, totalCovers, avgPartySize:+(totalCovers/total).toFixed(2),
      completionRate:+(done/total*100).toFixed(1), cancellationRate:+(cancelled/total*100).toFixed(1),
      noShowRate:+(noShow/total*100).toFixed(1), firstVisitRate:+(firstVisit/total*100).toFixed(1),
      returnRate:+((total-firstVisit)/total*100).toFixed(1), optInRate:+(optIn/total*100).toFixed(1),
      avgLifetimeSpend:ltSpends.length ? +(ltSpends.reduce((a,b)=>a+b,0)/ltSpends.length).toFixed(2) : 0 },
    days, times: timeArr,
    sizes: Object.entries(sizes).map(([s,c])=>({size:parseInt(s),count:c})).sort((a,b)=>a.size-b.size),
    monthly: Object.values(monthly).sort((a,b)=>a.month.localeCompare(b.month)),
  };
}

async function processPerfectVenue() {
  const lines = await fetchCSV(TABS.perfectVenue);
  const statuses = {}, lostReasons = {}, monthly = {};
  let completedRev = 0, completedCount = 0;
  for (let i = 1; i < lines.length; i++) {
    const col = parseCSVLine(lines[i]);
    if (!col[1]) continue;
    const status = (col[3]||'').trim();
    const lostReason = (col[28]||'').trim().replace(/['"]/g,'');
    const proposalTotal = cleanNum(col[42]);
    const createdOn = (col[22]||'').trim();
    statuses[status] = (statuses[status]||0)+1;
    if (lostReason && status==='Lost') lostReasons[lostReason] = (lostReasons[lostReason]||0)+1;
    if (createdOn && createdOn.match(/\d+\/\d+\/\d+/)) {
      const [m,,y] = createdOn.split('/');
      if (y) {
        const key = `${y}-${m.padStart(2,'0')}`;
        if (!monthly[key]) monthly[key] = { month: key, leads:0, completed:0, lost:0 };
        monthly[key].leads++;
        if (status==='Completed') monthly[key].completed++;
        if (status==='Lost') monthly[key].lost++;
      }
    }
    if (status==='Completed' && proposalTotal>0) { completedRev+=proposalTotal; completedCount++; }
  }
  return {
    statuses: Object.entries(statuses).map(([s,c])=>({status:s,count:c})).sort((a,b)=>b.count-a.count),
    lostReasons: Object.entries(lostReasons).filter(([r])=>r.length>1).sort((a,b)=>b[1]-a[1]).slice(0,8).map(([reason,count])=>({reason,count})),
    monthly: Object.values(monthly).sort((a,b)=>a.month.localeCompare(b.month)),
    totalCompletedRevenue: +completedRev.toFixed(0),
    avgRevenuePerEvent: completedCount>0 ? +(completedRev/completedCount).toFixed(0) : 0,
    closeRate: statuses.Completed && statuses.Lost ? +((statuses.Completed/(statuses.Completed+statuses.Lost))*100).toFixed(1) : 0,
  };
}

async function processEmail() {
  const [sentLines, subLines] = await Promise.all([fetchCSV(TABS.emailSent), fetchCSV(TABS.emails)]);
  const monthly = {};
  for (let i = 1; i < sentLines.length; i++) {
    const col = parseCSVLine(sentLines[i]);
    const mo = (col[0]||'').trim().match(/(\d+)\/(\d+)\/(\d+)/);
    if (!mo) continue;
    const key = `${mo[3]}-${mo[1].padStart(2,'0')}`;
    const status = (col[3]||'').trim();
    if (!monthly[key]) monthly[key] = { month:key, total:0, delivered:0, opened:0, clicked:0, unsubscribed:0, replied:0 };
    monthly[key].total++;
    if (status==='Delivered') monthly[key].delivered++;
    if (status==='Opened') monthly[key].opened++;
    if (status==='Clicked') monthly[key].clicked++;
    if (status==='Unsubscribed') monthly[key].unsubscribed++;
    if (status==='Replied') monthly[key].replied++;
  }
  const arr = Object.values(monthly).sort((a,b)=>a.month.localeCompare(b.month));
  arr.forEach(m => {
    m.openRate = m.total>0 ? +(m.opened/m.total*100).toFixed(1) : 0;
    m.clickRate = m.total>0 ? +(m.clicked/m.total*100).toFixed(1) : 0;
    m.unsubRate = m.total>0 ? +(m.unsubscribed/m.total*100).toFixed(1) : 0;
  });
  const subMonths = {};
  for (let i = 1; i < subLines.length; i++) {
    const col = parseCSVLine(subLines[i]);
    const mo = (col[0]||'').trim().match(/(\w+)\s+(\d+)\s+(\d+)/);
    if (mo) {
      const mm = {Jan:'01',Feb:'02',Mar:'03',Apr:'04',May:'05',Jun:'06',Jul:'07',Aug:'08',Sep:'09',Oct:'10',Nov:'11',Dec:'12'};
      const key = `${mo[3]}-${mm[mo[1]]||'00'}`;
      subMonths[key] = (subMonths[key]||0)+1;
    }
  }
  return {
    monthly: arr,
    subscribersByMonth: Object.entries(subMonths).sort((a,b)=>a[0].localeCompare(b[0])).map(([month,count])=>({month,count})),
    totalSubscribers: subLines.length-1,
  };
}

// ── Handler ────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  try {
    const [summary, facebook, googleAds, googlePrivate, reservations, perfectVenue, email] = await Promise.all([
      processSummary(), processFacebook(), processGoogleAds(), processGooglePrivate(),
      processReservations(), processPerfectVenue(), processEmail(),
    ]);
    res.status(200).json({
      summary, facebook, googleAds, googlePrivate,
      reservations, perfectVenue, email,
      meta: { lastUpdated: new Date().toISOString(), source: 'live' },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
