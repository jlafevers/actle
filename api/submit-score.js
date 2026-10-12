// Records one visitor's score for a given day, so the results page can show
// how it stacks up against everyone else who played that day. Storage is a
// Redis hash keyed by date, with one field per possible score (0-4) holding
// a running count. Uses Upstash's REST API directly via fetch, so no extra
// npm packages or build step are needed.

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

    var key = "actle:scores:" + date;
    var r = await fetch(url + "/hincrby/" + encodeURIComponent(key) + "/" + score + "/1", {
      headers: { Authorization: "Bearer " + token }
    });
    if (!r.ok) throw new Error("storage request failed");

    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: "Failed to record score" });
  }
}
