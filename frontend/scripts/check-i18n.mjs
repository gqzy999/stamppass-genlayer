import { STRINGS } from "../src/i18n.js";

const en = Object.keys(STRINGS.en).sort();
const zh = Object.keys(STRINGS.zh).sort();
const missingInZh = en.filter((k) => !zh.includes(k));
const missingInEn = zh.filter((k) => !en.includes(k));
const empty = [...en, ...zh].filter((k) => {
  const v = STRINGS.en[k] ?? STRINGS.zh[k];
  return typeof v !== "string" || v.length === 0;
});
if (missingInZh.length || missingInEn.length || empty.length) {
  console.log("missing in zh:", missingInZh);
  console.log("missing in en:", missingInEn);
  console.log("empty:", empty);
  process.exit(1);
}
console.log(`i18n check passed: en/zh ${en.length}/${zh.length} keys, 0 missing.`);
