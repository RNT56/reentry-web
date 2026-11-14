import { test } from "node:test";
import assert from "node:assert/strict";
import { convertDrawingCurrency } from "../src/domain/chart-currency.js";
const source = [
  { time: 100, price: 100 },
  { time: 200, price: 110 },
  { time: 300, price: 120 },
];
const target = [
  { time: 100, price: 120 },
  { time: 200, price: 143 },
  { time: 300, price: 168 },
];
const drawing = {
  id: "example",
  type: "trend",
  text: "Exact note",
  color: "#a4dec0",
  anchors: [
    { time: 150, price: 80 },
    { time: 300, price: 150 },
  ],
};

test("drawing conversion uses an exact common bar at or before each anchor", () => {
  const [converted] = convertDrawingCurrency([drawing], source, target);
  assert.equal(converted.anchors[0].price, 96);
  assert.equal(converted.anchors[1].price, 210);
  assert.equal(converted.text, drawing.text);
  assert.equal(converted.color, drawing.color);
  assert.equal(converted.anchors[0].time, 150);
  const [back] = convertDrawingCurrency([converted], target, source);
  assert.ok(Math.abs(back.anchors[0].price - 80) < 1e-12);
  assert.ok(Math.abs(back.anchors[1].price - 150) < 1e-12);
});

test("matching timestamps prevent using independently nearest mismatched bars", () => {
  const second = [
    { time: 100, price: 200 },
    { time: 250, price: 900 },
    { time: 300, price: 360 },
  ];
  const [converted] = convertDrawingCurrency(
    [{ ...drawing, anchors: [{ time: 275, price: 80 }] }],
    source,
    second,
  );
  assert.equal(converted.anchors[0].price, 160);
  assert.throws(() =>
    convertDrawingCurrency([drawing], source, [
      { time: 99, price: 200 },
      { time: 299, price: 200 },
    ]),
  );
});

test("coverage rejects prior anchors and accepts at most seven days after latest common bar", () => {
  const withTime = (time) => [{ ...drawing, anchors: [{ time, price: 80 }] }];
  assert.throws(
    () => convertDrawingCurrency(withTime(99), source, target),
    /coverage/,
  );
  assert.equal(
    convertDrawingCurrency(withTime(300 + 7 * 86400), source, target)[0]
      .anchors[0].price,
    112,
  );
  assert.throws(
    () => convertDrawingCurrency(withTime(301 + 7 * 86400), source, target),
    /coverage/,
  );
  assert.throws(
    () => convertDrawingCurrency([drawing], source, target.slice(1)),
    /coverage/,
  );
});

test("conversion does not mutate inputs or leak partial conversions on invalid anchors", () => {
  const original = structuredClone(drawing);
  Object.freeze(drawing.anchors[0]);
  Object.freeze(drawing.anchors[1]);
  Object.freeze(drawing.anchors);
  Object.freeze(drawing);
  const result = convertDrawingCurrency([drawing], source, target);
  assert.deepEqual(drawing, original);
  assert.notEqual(result[0], drawing);
  assert.notEqual(result[0].anchors, drawing.anchors);
  assert.notEqual(result[0].anchors[0], drawing.anchors[0]);
  assert.throws(() =>
    convertDrawingCurrency(
      [
        {
          ...drawing,
          anchors: [
            { time: 150, price: 80 },
            { time: 1, price: 90 },
          ],
        },
      ],
      source,
      target,
    ),
  );
  assert.deepEqual(drawing, original);
});

test("invalid history, non-finite values and excessive converted prices fail safely", () => {
  assert.deepEqual(convertDrawingCurrency([], [], []), []);
  for (const rows of [
    [],
    [{ time: 100, price: 0 }],
    [{ time: 100, price: Infinity }],
    [source[1], source[0]],
    [source[0], source[0]],
  ])
    assert.throws(() => convertDrawingCurrency([drawing], rows, target));
  for (const price of [0, -1, Infinity, 1e12])
    assert.throws(() =>
      convertDrawingCurrency(
        [{ ...drawing, anchors: [{ time: 300, price }] }],
        source,
        target,
      ),
    );
  assert.throws(() =>
    convertDrawingCurrency(
      [{ ...drawing, anchors: [{ time: NaN, price: 1 }] }],
      source,
      target,
    ),
  );
});
