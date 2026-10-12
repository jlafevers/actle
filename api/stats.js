// Returns how many players got each possible score (0-4) on a given day, so
// the results page can draw the "today's players" bar chart and percentile.
// If a "time" query param (the caller's own completion time, in seconds) is
// given, also returns how that time compares to everyone else's recorded
// completion time for the day.

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
    var headers = { Authorization: "Bearer " + token };

    var scoreKey = "actle:scores:" + date;
    var r = await fetch(url + "/hgetall/" + encodeURIComponent(scoreKey), { headers: headers });
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

    var time = null;
    var myTime = Number(req.query.time);
    if (Number.isFinite(myTime) && myTime >= 0) {
      var timeKey = "actle:times:" + date;
      var totalRes = await fetch(url + "/zcard/" + encodeURIComponent(timeKey), { headers: headers });
      var totalData = totalRes.ok ? await totalRes.json() : null;
      var total = (totalData && Number(totalData.result)) || 0;

      var othersCount = Math.max(total - 1, 0);
      var fasterThanPercent = null;
      if (othersCount > 0) {
        // count of players who took strictly longer than me (the "(" prefix
        // makes the lower bound exclusive, so ties don't count either way)
        var slowerRes = await fetch(
          url + "/zcount/" + encodeURIComponent(timeKey) + "/" + encodeURIComponent("(" + myTime) + "/" + encodeURIComponent("+inf"),
          { headers: headers }
        );
        var slowerData = slowerRes.ok ? await slowerRes.json() : null;
        var slowerCount = (slowerData && Number(slowerData.result)) || 0;
        fasterThanPercent = Math.round((slowerCount / othersCount) * 100);
      }

      time = { myTimeSeconds: myTime, fasterThanPercent: fasterThanPercent };
    }

    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ counts: counts, time: time });
  } catch (e) {
    res.status(500).json({ error: "Failed to load stats" });
  }
}
