const { test } = require("node:test");
const assert = require("node:assert/strict");

test("Topic generation works without randomUUID, uses five ASCII words and meets API limits", async () => {
  const { generateNotificationTopic } =
    await import("../dist/js/core/notification-topic.js");
  // HTTP LAN pages have getRandomValues but do not have randomUUID.
  const random = {
    getRandomValues: (buffer) => crypto.getRandomValues(buffer),
  };
  const topics = new Set();
  for (let i = 0; i < 100; i++) {
    const topic = generateNotificationTopic(random);
    assert.match(topic, /^[a-z]+(?:-[a-z]+){4}$/);
    assert.ok(topic.length >= 16 && topic.length <= 128);
    topics.add(topic);
  }
  assert.equal(topics.size, 100);
});
