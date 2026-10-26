// Renames a player's entry on a day's leaderboard after they've finished.
// Leaderboard members carry their own display data ("Nickname~composite~time~suffix"),
// so a rename swaps the old member for a new one with the same composite, time,
// suffix and sort value. Only the browser that submitted the score can rename it:
// /api/submit-score hands back a random owner token, stored server-side in
// actle:owners:<date>, and this endpoint requires that token to match.

var NICKNAME_DENYLIST = ["fuck", "shit", "bitch", "cunt", "nigger", "nigga", "fag", "retard",
  "rape", "nazi", "hitler", "admin", "moderator", "actle"];
function cleanNickname(raw) {
  var cleaned = (typeof raw === "string" ? raw : "")
    .replace(/[^a-zA-Z0-9 ]/g, "")
    .trim()
    .slice(0, 16);
  var lower = cleaned.toLowerCase();
  var blocked = NICKNAME_DENYLIST.some(function (bad) { return lower.indexOf(bad) !== -1; });
  return (!cleaned || blocked) ? "" : cleaned;
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
    var member = body && body.member;
    var token = body && body.token;
    var nickname = cleanNickname(body && body.nickname);

    if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date) || typeof member !== "string" || !member) {
      res.status(400).json({ error: "Invalid request" });
      return;
    }
    if (!nickname) {
      res.status(400).json({ error: "That name isn’t allowed. Try another." });
      return;
    }
    var parts = member.split("~");
    if (parts.length !== 4) {
      res.status(400).json({ error: "Invalid request" });
      return;
    }

    var url = process.env.KV_REST_API_URL;
    var kvToken = process.env.KV_REST_API_TOKEN;
    if (!url || !kvToken) {
      res.status(500).json({ error: "Storage is not configured yet" });
      return;
    }
    var headers = { Authorization: "Bearer " + kvToken };
    var lbKey = "actle:leaderboard:" + date;
    var ownersKey = "actle:owners:" + date;

    // the entry must exist on the board
    var scoreRes = await fetch(url + "/zscore/" + encodeURIComponent(lbKey) + "/" + encodeURIComponent(member), { headers: headers });
    var scoreData = scoreRes.ok ? await scoreRes.json() : null;
    if (!scoreData || scoreData.result === null || scoreData.result === undefined) {
      res.status(404).json({ error: "Entry not found" });
      return;
    }
    var sortVal = scoreData.result;

    // ownership check: entries submitted after this feature shipped have a token on file;
    // entries from before it don't, and those are allowed through (they expire with the day)
    var ownerRes = await fetch(url + "/hget/" + encodeURIComponent(ownersKey) + "/" + encodeURIComponent(member), { headers: headers });
    var ownerData = ownerRes.ok ? await ownerRes.json() : null;
    var storedToken = ownerData && ownerData.result;
    if (storedToken && storedToken !== token) {
      res.status(403).json({ error: "You can only rename your own entry" });
      return;
    }

    var newMember = nickname + "~" + parts[1] + "~" + parts[2] + "~" + parts[3];
    if (newMember !== member) {
      var addRes = await fetch(url + "/zadd/" + encodeURIComponent(lbKey) + "/" + sortVal + "/" + encodeURIComponent(newMember), { headers: headers });
      if (!addRes.ok) throw new Error("storage request failed");
      await fetch(url + "/zrem/" + encodeURIComponent(lbKey) + "/" + encodeURIComponent(member), { headers: headers });
      if (storedToken) {
        try {
          await fetch(url + "/hset/" + encodeURIComponent(ownersKey) + "/" + encodeURIComponent(newMember) + "/" + encodeURIComponent(storedToken), { headers: headers });
          await fetch(url + "/hdel/" + encodeURIComponent(ownersKey) + "/" + encodeURIComponent(member), { headers: headers });
        } catch (e) {}
      }
    }

    res.status(200).json({ ok: true, member: newMember, nickname: nickname });
  } catch (e) {
    res.status(500).json({ error: "Failed to rename" });
  }
}
