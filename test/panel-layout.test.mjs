import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanPanelLayout, columnsForWidth, panelColumns, adaptivePanelSize } from '../public/panel-layout.js';

test('resized cards have usable minimum sizes and imported layouts reject unknown or invalid values', () => {
  assert.deepEqual(cleanPanelLayout({agents:{columns:1,height:50},feed:{columns:99,height:9999},'metric-events':{height:1},unknown:{height:300},crew:{columns:'12',height:Infinity}}), {
    agents:{columns:8,height:460},feed:{columns:24,height:1600},'metric-events':{height:76}
  });
  assert.deepEqual(cleanPanelLayout(null), {});
  assert.deepEqual(cleanPanelLayout({agents:{columns:12.4,height:531.8}}), {agents:{columns:12,height:532}});
});
test('width snapping accounts for gutters and cannot expand outside the dashboard', () => {
  // 24 columns of 30 pixels and 23 gutters of 20 pixels.
  assert.equal(columnsForWidth(1180,1180),24);
  assert.equal(columnsForWidth(580,1180),12);
  assert.equal(columnsForWidth(99999,1180),24);
  assert.equal(columnsForWidth(-200,1180),1);
});
test('a desktop sidebar viewport preserves resized widths instead of forcing every card to full width', () => {
  assert.equal(panelColumns('agents',12,24,785),12);
  assert.equal(panelColumns('feed',8,24,785),8);
  assert.equal(panelColumns('agents',12,24,1600),12);
  assert.equal(panelColumns('agents',12,24,390),24);
  assert.equal(panelColumns('metric-active',4,6,390),12);
  assert.equal(columnsForWidth(280,568,8),12);
});
test('ultrawide defaults place every panel within the available window height', () => {
  const agents = adaptivePanelSize('agents',2558,909,220,28);
  const crew = adaptivePanelSize('crew',2558,909,220,28);
  const feed = adaptivePanelSize('feed',2558,909,220,28);
  const missions = adaptivePanelSize('missions',2558,909,220,28);
  const activity = adaptivePanelSize('activity',2558,909,220,28);
  assert.equal(agents.columns + crew.columns + feed.columns,24);
  assert.equal(agents.columns + missions.columns + activity.columns,24);
  assert.equal(agents.height,645);
  assert.ok(crew.height + 14 + missions.height <= agents.height);
  assert.ok(220 + agents.height + 28 + 16 <= 909);
  assert.equal(adaptivePanelSize('agents',1440,900,220,28),null);
  assert.equal(adaptivePanelSize('metric-agents',2558,909,220,28),null);
});
test('automatic heights adapt to screen height and reserve room for the editing toolbar', () => {
  assert.ok(adaptivePanelSize('agents',1920,1080,220,28).height > adaptivePanelSize('agents',1920,800,220,28).height);
  assert.equal(adaptivePanelSize('agents',1920,900,280,28).height,adaptivePanelSize('agents',1920,900,220,28).height-60);
  assert.equal(adaptivePanelSize('agents',1920,550,220,28).height,460);
  assert.equal(panelColumns('agents',18,12,2558),18);
});
