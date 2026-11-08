import { test } from 'node:test';
import assert from 'node:assert/strict';
import { displayValue, escapeHtml, safeUrl, fieldLabel } from '../src/lib/values.ts';
test('missing and zero remain distinct; exact counters remain strings', () => {
  assert.equal(displayValue(null), 'Not reported');
  assert.equal(displayValue(0), '0');
  assert.equal(displayValue('18446744073709551615'), '18446744073709551615');
});
test('source links and source text are safe to render', () => {
  assert.equal(safeUrl('javascript:alert(1)'), null);
  assert.equal(safeUrl('https://example.org/'), 'https://example.org/');
  assert.equal(escapeHtml('<script>'), '&lt;script&gt;');
});
test('measurement and storage clocks have different labels', () => {
  assert.notEqual(fieldLabel('receivedAt'), fieldLabel('reportedAt'));
  assert.match(fieldLabel('windSpeedKmh'), /km\/h/);
});
test('attribute escaping preserves hostile query values without creating attributes', () => {
  const input = '" onfocus="run()\' & <svg>';
  assert.equal(escapeHtml(input), '&quot; onfocus=&quot;run()&#39; &amp; &lt;svg&gt;');
  const query = new URLSearchParams({ payload: input, topic: 'weather' }).toString();
  assert.equal(escapeHtml('?' + query), '?' + query.replaceAll('&', '&amp;'));
});
