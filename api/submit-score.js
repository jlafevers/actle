// Records one visitor's score (and completion time) for a given day, so the
// results page can show how it stacks up against everyone else who played
// that day. Score counts live in a Redis hash keyed by date, with one field
// per possible score (0-4). Completion times live in a Redis sorted set keyed
// by date, one member per play, scored by seconds taken — which lets us
// compute "faster than X% of players" without storing a separate counter per
// possible time. A second sorted set holds the day's leaderboard, ranked by
// composite ACT-style score (ties broken by faster time) so /api/leaderboard
// can report a visitor's rank and the top 10 cheaply via ZRANK/ZRANGE. Uses
// Upstash's REST API directly via fetch, so no extra npm packages or build
// step are needed.

// mirrors the client's own filter — the client is the first line of defense (keeps a
// clean field as you type), this is the one that actually matters since anyone can
// bypass client-side JS and post to this endpoint directly
var NICKNAME_DENYLIST = ["fuck", "shit", "bitch", "cunt", "nigger", "nigga", "fag", "retard",
  "rape", "nazi", "hitler", "admin", "moderator", "actle"];
function sanitizeNickname(raw) {
  var cleaned = (typeof raw === "string" ? raw : "")
    .replace(/[^a-zA-Z0-9 ]/g, "")
    .trim()
    .slice(0, 16);
  var lower = cleaned.toLowerCase();
  var blocked = NICKNAME_DENYLIST.some(function (bad) { return lower.indexOf(bad) !== -1; });
  if (!cleaned || blocked) cleaned = "Player" + Math.floor(1000 + Math.random() * 9000);
  return cleaned;
}

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
    var composite = Number(body && body.composite);
    // a floor of 1s filters out the most obviously fabricated submissions (nobody
    // reads and answers 4 questions in under a second); this is a light sanity
    // check, not real anti-cheat — the question bank is public client-side code,
    // so a determined visitor could always fake a plausible-looking request
    var hasValidTime = Number.isFinite(timeSeconds) && timeSeconds >= 1 && timeSeconds <= 1000;
    var hasValidComposite = Number.isInteger(composite) && composite >= 1 && composite <= 36;

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

    // record which days have any data, so /api/admin-stats can list them without
    // having to guess or scan every possible date
    try { await fetch(url + "/sadd/actle:days/" + encodeURIComponent(date), { headers: headers }); } catch (e) {}

    if (hasValidTime) {
      var timeKey = "actle:times:" + date;
      var timeMember = Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
      // a failed time write shouldn't fail the whole request — the score already landed
      try {
        await fetch(url + "/zadd/" + encodeURIComponent(timeKey) + "/" + timeSeconds + "/" + encodeURIComponent(timeMember), { headers: headers });
      } catch (e) {}
    }

    var member = null;
    var ownerToken = null;
    if (hasValidComposite) {
      var nickname = sanitizeNickname(body && body.nickname);
      var safeTime = hasValidTime ? Math.round(timeSeconds) : 999;
      var suffix = Math.random().toString(36).slice(2, 8);
      // the member string carries its own display data (name, composite, time) so the
      // leaderboard read can show the top 10 without a second lookup per entry
      member = nickname + "~" + composite + "~" + safeTime + "~" + suffix;
      // sort ascending by (36 - composite) first, then by time, so ZRANGE/ZRANK naturally
      // put the highest composite score first and use speed as the tiebreaker
      var sortVal = (36 - composite) * 100000 + Math.min(safeTime, 99999);
      var lbKey = "actle:leaderboard:" + date;
      try {
        await fetch(url + "/zadd/" + encodeURIComponent(lbKey) + "/" + sortVal + "/" + encodeURIComponent(member), { headers: headers });
      } catch (e) { member = null; }

      // a random owner token lets this browser (and only this browser) rename the entry
      // later via /api/rename
      if (member) {
        ownerToken = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
        try {
          await fetch(url + "/hset/" + encodeURIComponent("actle:owners:" + date) + "/" + encodeURIComponent(member) + "/" + ownerToken, { headers: headers });
        } catch (e) { ownerToken = null; }
      }
    }

    res.status(200).json({ ok: true, member: member, token: ownerToken });
  } catch (e) {
    res.status(500).json({ error: "Failed to record score" });
  }
}
