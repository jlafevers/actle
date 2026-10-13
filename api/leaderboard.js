// Returns the day's rank + top-10 leaderboard, built from the sorted set
// /api/submit-score writes to (actle:leaderboard:<date>), ranked by composite
// ACT-style score with completion time as the tiebreaker. Each member string
// carries its own display data ("Nickname~composite~timeSeconds~suffix"), so
// the top 10 can be rendered without a second lookup per entry.

function parseMember(member) {
  var parts = member.split("~");
  return {
    raw: member,
    name: parts[0] || "Player",
    composite: parseInt(parts[1], 10) || 0,
    timeSeconds: parseInt(parts[2], 10) || null
  };
}

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
    var lbKey = "actle:leaderboard:" + date;

    var totalRes = await fetch(url + "/zcard/" + encodeURIComponent(lbKey), { headers: headers });
    var totalData = totalRes.ok ? await totalRes.json() : null;
    var total = (totalData && Number(totalData.result)) || 0;

    var rank = null;
    var member = req.query.member;
    if (typeof member === "string" && member) {
      var rankRes = await fetch(url + "/zrank/" + encodeURIComponent(lbKey) + "/" + encodeURIComponent(member), { headers: headers });
      var rankData = rankRes.ok ? await rankRes.json() : null;
      if (rankData && rankData.result !== null && rankData.result !== undefined) {
        rank = Number(rankData.result) + 1; // Upstash returns a 0-based rank
      }
    }

    var topRes = await fetch(url + "/zrange/" + encodeURIComponent(lbKey) + "/0/9", { headers: headers });
    var topData = topRes.ok ? await topRes.json() : null;
    var topMembers = (topData && topData.result) || [];
    var top = topMembers.map(parseMember);

    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ total: total, rank: rank, top: top });
  } catch (e) {
    res.status(500).json({ error: "Failed to load leaderboard" });
  }
}
