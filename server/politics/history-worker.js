import { gzipSync } from "node:zlib";
import { workerData, parentPort } from "node:worker_threads";
import { parquetReadObjects, parquetMetadata } from "hyparquet";
import { compressors } from "hyparquet-compressors";
import { normalizeHistory } from "./history.js";
const records = { political_trade_events: [], political_filings: [] };
for (const { table, bytes } of workerData.shards) {
  const file = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  );
  if (Number(parquetMetadata(file).num_rows) > 100000)
    throw Error("Archive row limit exceeded");
  records[table].push(...(await parquetReadObjects({ file, compressors })));
}
const data = normalizeHistory(
  records.political_trade_events,
  records.political_filings,
  workerData.now,
);
records.political_trade_events.length = 0;
records.political_filings.length = 0;
parentPort.postMessage({ data, payload: gzipSync(JSON.stringify(data)) });
