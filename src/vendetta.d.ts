// vendetta-types ships ambient `declare module "@vendetta/*"` declarations, but
// its package.json `types` field points at a mis-named file, so `"types":
// ["vendetta-types"]` can't resolve it. Reference the real declaration file
// directly instead.
/// <reference path="../node_modules/vendetta-types/defs.d.ts" />
