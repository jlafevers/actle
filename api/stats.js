// Returns how many players got each possible score (0-4) on a given day, so
// the results page can draw the "today's players" bar chart and percentile.

export default async function handler(req, res) {
  try {
    var date = req.query.date;
    if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      res.status(400).json({ error: "Invalid date" });
      return;
    }

    var url = process.env.KV_REST_API_URL;
    var token = process.env.KV_REST_API_TOKEN;
    if (!url || !token) {
      res.status(500).json({ error: "Storage is not configured yet" });
      return;
    }

    var key = "actle:scores:" + date;
    var r = await fetch(url + "/hgetall/" + encodeURIComponent(key), {
      headers: { Authorization: "Bearer " + token }
    });
    if (!r.ok) throw new Error("storage request failed");
    var data = await r.json();

    // Upstash's REST API returns alternating [field, value, field, value, ...]
    var flat = (data && data.result) || [];
    var counts = [0, 0, 0, 0, 0];
    for (var i = 0; i < flat.length; i += 2) {
      var idx = parseInt(flat[i], 10);
      var count = parseInt(flat[i + 1], 10);
      if (idx >= 0 && idx <= 4 && !isNaN(count)) counts[idx] = count;
    }

    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ counts: counts });
  } catch (e) {
    res.status(500).json({ error: "Failed to load stats" });
  }
}
