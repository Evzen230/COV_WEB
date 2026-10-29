// Core behavior tests inject a transport gate; actual security is tested separately.
module.exports = { handle: async () => false, authorize: () => {} };
