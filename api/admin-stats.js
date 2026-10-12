// Private endpoint for Jake only: returns total plays per day, across every
// day anyone has played, so he can see whether the game is sticking over
// time. Gated by a shared-secret query param (?key=...) checked against an
// ADMIN_KEY environment variable set in the Vercel project settings — this
// is "obscurity plus a password," not a real auth system, which is fine for
// a private read-only stats page with no sensitive personal data in it.

export default async function handler(req, res) {
  try {
    var adminKey = process.env.ADMIN_KEY;
    if (!adminKey) {
      res.status(500).json({ error: "ADMIN_KEY is not configured" });
      return;
    }
    if (req.query.key !== adminKey) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    var url = process.env.KV_REST_API_URL;
    var token = process.env.KV_REST_API_TOKEN;
    if (!url || !token) {
      res.status(500).json({ error: "Storage is not configured yet" });
      return;
    }
    var headers = { Authorization: "Bearer " + token };

    var daysRes = await fetch(url + "/smembers/actle:days", { headers: headers });
    if (!daysRes.ok) throw new Error("storage request failed");
    var daysData = await daysRes.json();
    var dates = ((daysData && daysData.result) || []).slice().sort();

    var days = [];
    for (var i = 0; i < dates.length; i++) {
      var date = dates[i];
      var r = await fetch(url + "/hgetall/" + encodeURIComponent("actle:scores:" + date), { headers: headers });
      var data = r.ok ? await r.json() : null;
      var flat = (data && data.result) || [];
      var counts = [0, 0, 0, 0, 0];
      var total = 0;
      for (var j = 0; j < flat.length; j += 2) {
        var idx = parseInt(flat[j], 10);
        var count = parseInt(flat[j + 1], 10);
        if (idx >= 0 && idx <= 4 && !isNaN(count)) { counts[idx] = count; total += count; }
      }
      days.push({ date: date, total: total, counts: counts });
    }

    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ days: days });
  } catch (e) {
    res.status(500).json({ error: "Failed to load admin stats" });
  }
}
