/// <reference path="../pb_data/types.d.ts" />
// One record per user holding the app's progress and settings (the same JSON as the backup file).
// Rules: a signed-in user can only see and change their own record.
migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  const c = new Collection({
    type: "base",
    name: "hefz_sync",
    listRule:   "user = @request.auth.id",
    viewRule:   "user = @request.auth.id",
    createRule: "@request.auth.id != '' && @request.body.user = @request.auth.id",
    updateRule: "user = @request.auth.id && @request.body.user:isset = false",
    deleteRule: "user = @request.auth.id",
    fields: [
      {type: "relation", name: "user", required: true, collectionId: users.id, maxSelect: 1, cascadeDelete: true},
      {type: "json", name: "progress", maxSize: 5000000},
      {type: "json", name: "settings", maxSize: 200000},
      {type: "autodate", name: "updated", onCreate: true, onUpdate: true},
    ],
    indexes: ["CREATE UNIQUE INDEX idx_hefz_sync_user ON hefz_sync (user)"],
  });
  app.save(c);
}, (app) => {
  app.delete(app.findCollectionByNameOrId("hefz_sync"));
});
