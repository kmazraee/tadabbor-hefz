/// <reference path="../pb_data/types.d.ts" />
// Sign-in with a phone number (SMS code) and with Google, next to email + password.
// - users.phone: set only by the server after a correct SMS code (the API rules below keep users from setting it).
// - users.email is no longer required, since a phone-only account has none (email sign-up still requires one).
// - hefz_otps / hefz_oauth: short-lived server-only rows (no API rules = superusers only).
// - Rate limits per IP for the SMS endpoints, and the real client IP taken from nginx's X-Real-IP.
migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  users.fields.getByName("email").required = false;
  users.fields.add(new TextField({name: "phone", max: 11, pattern: "^09[0-9]{9}$"}));
  users.addIndex("idx_users_phone", true, "phone", "phone != ''");
  users.createRule = "@request.body.email:isset = true && @request.body.email != '' && @request.body.phone:isset = false";
  users.updateRule = "id = @request.auth.id && @request.body.phone:isset = false";
  app.save(users);

  app.save(new Collection({
    type: "base", name: "hefz_otps",
    fields: [
      {type: "text", name: "phone", required: true, max: 11},
      {type: "text", name: "hash", max: 200},
      {type: "number", name: "tries"},      // wrong codes entered for the current code
      {type: "number", name: "expires"},    // ms
      {type: "number", name: "sent"},       // ms, last SMS
      {type: "number", name: "sends"},      // SMS sent in the current window
      {type: "number", name: "window"},     // ms, start of the current window
    ],
    indexes: ["CREATE UNIQUE INDEX idx_hefz_otps_phone ON hefz_otps (phone)"],
  }));
  app.save(new Collection({
    type: "base", name: "hefz_oauth",
    fields: [
      {type: "text", name: "state", required: true, max: 100},
      {type: "text", name: "code", max: 2000},
      {type: "text", name: "error", max: 200},
      {type: "number", name: "at"},
    ],
    indexes: ["CREATE UNIQUE INDEX idx_hefz_oauth_state ON hefz_oauth (state)"],
  }));

  const s = app.settings();
  unmarshal({
    trustedProxy: {headers: ["X-Real-IP"], useLeftmostIP: false},
    rateLimits: {enabled: true, rules: [
      {label: "/api/hefz/otp/request", maxRequests: 5, duration: 600},
      {label: "/api/hefz/otp/verify", maxRequests: 15, duration: 600},
      {label: "*:auth", maxRequests: 2, duration: 3},
      {label: "*:create", maxRequests: 20, duration: 5},
      {label: "/api/batch", maxRequests: 3, duration: 1},
      {label: "/api/", maxRequests: 300, duration: 10},
    ]},
  }, s);
  app.save(s);
}, (app) => {
  for (const n of ["hefz_otps", "hefz_oauth"]) { try { app.delete(app.findCollectionByNameOrId(n)); } catch (e) {} }
  const users = app.findCollectionByNameOrId("users");
  users.removeIndex("idx_users_phone");
  users.fields.removeByName("phone");
  users.fields.getByName("email").required = true;
  users.createRule = "";
  users.updateRule = "id = @request.auth.id";
  app.save(users);
});
