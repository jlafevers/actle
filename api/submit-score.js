// Records one visitor's score (and completion time) for a given day, so the
// results page can show how it stacks up against everyone else who played
// that day. Score counts live in a Redis hash keyed by date, with one field
// per possible score (0-4). Completion times live in a Redis sorted set keyed
// by date, one member per play, scored by seconds taken — which lets us
// compute "faster than X% of players" without storing a separate counter per
// possible time. Uses Upstash's REST API directly via fetch, so no extra npm
// packages or build step are needed.

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    var body = req.body;
    if (typeof body === "string") body = JSON.parse(body);

    var date = body && body.date;
    var score = Number(body && body.score);
    var timeSeconds = Number(body && body.timeSeconds);
    var hasValidTime = Number.isFinite(timeSeconds) && timeSeconds >= 0 && timeSeconds <= 1000;

    if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isInteger(score) || score < 0 || score > 4) {
      res.status(400).json({ error: "Invalid date or score" });
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
    var r = await fetch(url + "/hincrby/" + encodeURIComponent(scoreKey) + "/" + score + "/1", { headers: headers });
    if (!r.ok) throw new Error("storage request failed");

    if (hasValidTime) {
      var timeKey = "actle:times:" + date;
      var member = Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
      // a failed time write shouldn't fail the whole request — the score already landed
      try {
        await fetch(url + "/zadd/" + encodeURIComponent(timeKey) + "/" + timeSeconds + "/" + encodeURIComponent(member), { headers: headers });
      } catch (e) {}
    }

    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: "Failed to record score" });
  }
}
