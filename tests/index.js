// Node 22 之後 `node --test tests/` 會把目錄當成模組路徑；這個入口讓它在 Node 18–22 都能執行。（沿用 47wan 的 tests/index.js）
import('./family.test.mjs');
import('./tags.test.mjs');
import('./dose.test.mjs');
import('./save.test.mjs');
import('./engine.test.mjs');
import('./turn.test.mjs');
import('./ending.test.mjs');
import('./ui.test.mjs');
import('./lint.test.mjs');
import('./parent_self.test.mjs');
import('./obviousness.test.mjs');
import('./perf.test.mjs');
import('./calibration.test.mjs');
