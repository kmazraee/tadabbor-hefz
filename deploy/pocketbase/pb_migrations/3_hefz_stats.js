/// <reference path="../pb_data/types.d.ts" />
// Usage statistics for the admin dashboard (deploy/vps/README.md, «داشبورد مدیریتی»).
// - hefz_sessions: one row per app session (open -> background): active seconds, platform, app version,
//   coarse device, and the country/city Cloudflare derives from the IP. The IP itself is never stored.
// - hefz_ustats: a small per-user summary of the synced progress (ayat memorized, reviews, streak, ...),
//   refreshed whenever the user's hefz_sync record changes, so the dashboard never reads the large progress JSON.
// No API rules: only the server's own routes and superusers can read or write them.
// Both are deleted with the user's account (cascadeDelete).
migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  app.save(new Collection({
    type: "base", name: "hefz_sessions",
    fields: [
      {type: "relation", name: "user", required: true, collectionId: users.id, maxSelect: 1, cascadeDelete: true},
      {type: "text", name: "sid", required: true, max: 40},
      {type: "text", name: "day", max: 10},          // YYYY-MM-DD, Iran time
      {type: "number", name: "hour"},                // 0-23, Iran time, when the session started
      {type: "number", name: "start"},               // ms
      {type: "number", name: "last"},                // ms, last report
      {type: "number", name: "secs"},                // active (foreground, in use) seconds
      {type: "text", name: "plat", max: 10},         // android / web / pwa
      {type: "text", name: "ver", max: 16},
      {type: "text", name: "os", max: 24},
      {type: "text", name: "br", max: 16},
      {type: "text", name: "dev", max: 40},
      {type: "text", name: "country", max: 2},       // from Cloudflare (CF-IPCountry)
      {type: "text", name: "region", max: 60},
      {type: "text", name: "city", max: 60},
      {type: "text", name: "tz", max: 40},           // the device's time zone
      {type: "text", name: "tzc", max: 2},           // country of that time zone
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_hefz_sessions_sid ON hefz_sessions (sid)",
      "CREATE INDEX idx_hefz_sessions_day ON hefz_sessions (day)",
      "CREATE INDEX idx_hefz_sessions_user ON hefz_sessions (user, day)",
    ],
  }));
  app.save(new Collection({
    type: "base", name: "hefz_ustats",
    fields: [
      {type: "relation", name: "user", required: true, collectionId: users.id, maxSelect: 1, cascadeDelete: true},
      {type: "text", name: "name", max: 80},
      {type: "number", name: "mem_siyaq"}, {type: "number", name: "mem_ayat"}, {type: "number", name: "learn_siyaq"},
      {type: "number", name: "tad_siyaq"}, {type: "number", name: "tad_ayat"},
      {type: "number", name: "surahs_mem"}, {type: "number", name: "surahs_tad"},
      {type: "number", name: "new_ayat"}, {type: "number", name: "reviews"}, {type: "number", name: "rev_ayat"},
      {type: "number", name: "tad_rev"}, {type: "number", name: "quizzes"}, {type: "number", name: "quiz_avg"},
      {type: "number", name: "streak"}, {type: "number", name: "best"}, {type: "text", name: "last_day", max: 10},
      {type: "number", name: "log_days"}, {type: "number", name: "day_goal"},
      {type: "number", name: "vnotes"}, {type: "number", name: "bms"}, {type: "number", name: "lessons"}, {type: "number", name: "levels"},
      {type: "json", name: "days", maxSize: 20000},      // last 120 days: {"YYYY-MM-DD": actions}
      {type: "json", name: "mastery", maxSize: 200},     // siyaqs at each of the 5 mastery levels
      {type: "json", name: "surahs", maxSize: 20000},    // [[surah, memorized siyaqs, tadabbur siyaqs, siyaqs in surah], ...]
      {type: "json", name: "prefs", maxSize: 2000},      // reciter, translation, tafsir, theme, reminders
      {type: "number", name: "synced"},                  // ms of the hefz_sync record this was made from
    ],
    indexes: ["CREATE UNIQUE INDEX idx_hefz_ustats_user ON hefz_ustats (user)"],
  }));

  const s = app.settings();
  unmarshal({rateLimits: {enabled: true, rules: [
    {label: "/api/hefz/otp/request", maxRequests: 5, duration: 600},
    {label: "/api/hefz/otp/verify", maxRequests: 15, duration: 600},
    {label: "/api/hefz/admin/login", maxRequests: 5, duration: 600},
    {label: "/api/hefz/ping", maxRequests: 20, duration: 60},
    {label: "*:auth", maxRequests: 2, duration: 3},
    {label: "*:create", maxRequests: 20, duration: 5},
    {label: "/api/batch", maxRequests: 3, duration: 1},
    {label: "/api/", maxRequests: 300, duration: 10},
  ]}}, s);
  app.save(s);
}, (app) => {
  for (const n of ["hefz_sessions", "hefz_ustats"]) { try { app.delete(app.findCollectionByNameOrId(n)); } catch (e) {} }
});
