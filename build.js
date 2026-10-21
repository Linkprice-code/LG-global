// 네이버 SA CSV → 한 장짜리 HTML 대시보드
// 사용법: node build.js <CSV 파일 또는 폴더> [--client 업체명] [--out 출력 HTML]
//   폴더를 주면 안의 CSV를 전부 읽어 종류를 알아서 나눈다
//   - 매체 보고서 (일별·매체이름·검색어 열) : 같은 날짜가 여러 파일에 있으면 기간이 더 늦은 파일 것을 쓴다
//   - 소재 보고서 (소재 열)                 : 일별 열이 있으면 날짜 필터가 적용되고, 없으면 보고서 전체 기간으로만 보인다
//   - 상품 매칭 파일 (소재 ID·기본상품명 열) : 소재 ID를 상품명으로 바꿔 보여준다
//   업체명을 안 주면 폴더 안(또는 그 위 폴더)의 config.json 의 client 를 쓴다
const fs = require("fs");
const path = require("path");

const args = process.argv.slice(2), opt = name => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : ""; };
const clientArg = opt("--client"), outArg = opt("--out"), input = args[0];
if (!input) { console.error('사용법: node build.js <CSV 파일 또는 폴더> [--client 업체명] [--out 출력 HTML]'); process.exit(1); }

// 따옴표 안의 쉼표·줄바꿈까지 처리하는 CSV 파서
function parseCsv(t) {
  const out = []; let row = [], f = "", q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(f); f = ""; }
    else if (c === "\n") { row.push(f.replace(/\r$/, "")); out.push(row); row = []; f = ""; }
    else f += c;
  }
  if (f || row.length) { row.push(f.replace(/\r$/, "")); out.push(row); }
  return out;
}
// 네이버 다운로드는 UTF-8(BOM)이지만, 엑셀로 다시 저장하면 CP949가 되기도 한다
function readText(file) {
  const buf = fs.readFileSync(file);
  let t = new TextDecoder("utf-8").decode(buf);
  if (t.includes("�")) t = new TextDecoder("euc-kr").decode(buf);
  return t.replace(/^﻿/, "");
}
const num = s => { const n = parseFloat(String(s || "").replace(/,/g, "")); return isFinite(n) ? n : 0; };
const isoDate = s => { const d = String(s).match(/(\d{4})\D(\d{1,2})\D(\d{1,2})/); return d ? `${d[1]}-${d[2].padStart(2, "0")}-${d[3].padStart(2, "0")}` : ""; };

// 파일 하나 읽기: 앞쪽 몇 줄 중 헤더를 찾아 종류를 정한다
function load(file) {
  const all = parseCsv(readText(file));
  for (let h = 0; h < Math.min(6, all.length); h++) {
    const head = all[h].map(s => s.trim());
    const kind = head.includes("소재 ID") && head.includes("기본상품명") ? "map"
      : head.includes("매체이름") && head.includes("검색어") ? "media"
      : head.includes("소재") && head.includes("노출수") ? "creative" : null;
    if (!kind) continue;
    const title = all.slice(0, h).map(r => r.join(",")).join(" ");
    const m = title.match(/(\d{4})\.(\d{2})\.(\d{2})\.?\s*~\s*(\d{4})\.(\d{2})\.(\d{2})/);
    const col = name => { const i = head.indexOf(name); if (i < 0) throw new Error(`${path.basename(file)}: "${name}" 열이 없습니다`); return i; };
    return {
      file, kind, head, col, has: name => head.includes(name),
      rows: all.slice(h + 1).filter(r => r.length >= head.length - 1 && r.some(x => x.trim())),
      since: m ? `${m[1]}-${m[2]}-${m[3]}` : "", until: m ? `${m[4]}-${m[5]}-${m[6]}` : "",
      reportNo: (title.match(/\)\s*,\s*(\d+)\s*$/) || [])[1] || "",
    };
  }
  return { file, kind: null };
}

const stat = fs.statSync(input);
const files = stat.isDirectory() ? fs.readdirSync(input).filter(f => /\.csv$/i.test(f)).map(f => path.join(input, f)) : [input];
const loaded = files.map(f => { try { return load(f); } catch (e) { console.warn("건너뜀:", e.message); return { file: f, kind: null }; } });
for (const x of loaded) console.log(`${x.kind ? { media: "매체 보고서", creative: "소재 보고서", map: "상품 매칭" }[x.kind] : "알 수 없는 파일(건너뜀)"} · ${path.basename(x.file)}${x.since ? ` · ${x.since}~${x.until}` : ""}`);

function readConfig() {
  for (const dir of stat.isDirectory() ? [input, path.dirname(path.resolve(input))] : [path.dirname(input)]) {
    const p = path.join(dir, "config.json");
    if (fs.existsSync(p)) return JSON.parse(readText(p));
  }
  return {};
}
const client = clientArg || readConfig().client || "";

// 문자열은 사전으로 바꿔 크기를 줄인다
const dict = () => { const list = [], idx = new Map(); return { list, id: k => { const s = typeof k === "string" ? k : JSON.stringify(k); if (!idx.has(s)) { idx.set(s, list.length); list.push(k); } return idx.get(s); } }; };
const campaigns = dict(), adgroups = dict(), media = dict(), terms = dict(), matchTypes = dict(), dates = dict(), cids = dict();

// 같은 날짜가 여러 파일에 있으면 기간 끝이 더 늦은 파일(같으면 파일 이름순으로 뒤)의 것만 쓴다
function dateOwners(list, dateCol) {
  const sorted = [...list].sort((a, b) => (a.until || "").localeCompare(b.until || "") || a.file.localeCompare(b.file));
  const owner = new Map();
  for (const f of sorted) { const c = f.col(dateCol); for (const r of f.rows) { const d = isoDate(r[c]); if (d) owner.set(d, f); } }
  return owner;
}

/* ---------- 매체 보고서 ---------- */
const mediaFiles = loaded.filter(x => x.kind === "media" && (x.has("일별") || (console.warn(`건너뜀: ${path.basename(x.file)} 에 일별 열이 없습니다`), false)));
if (!mediaFiles.length) { console.error("일별 열이 있는 매체 보고서가 없습니다."); process.exit(1); }
const ctypeOf = new Map();
const mOwner = dateOwners(mediaFiles, "일별");
const agg = new Map();
let sourceRows = 0;
for (const f of mediaFiles) {
  const C = {
    date: f.col("일별"), ctype: f.col("캠페인유형"), camp: f.col("캠페인"), ag: f.col("광고그룹"), media: f.col("매체이름"), kind: f.col("검색/콘텐츠 매체"),
    term: f.col("검색어"), match: f.col("검색 유형"), imp: f.col("노출수"), clk: f.col("클릭수"), cost: f.col("총비용"),
    rank: f.col("평균노출순위"), conv: f.col("구매완료 전환수"), rev: f.col("구매완료 전환매출액(원)"),
  };
  for (const r of f.rows) {
    const d = isoDate(r[C.date]);
    if (!d || mOwner.get(d) !== f) continue;
    sourceRows++;
    ctypeOf.set(r[C.camp], r[C.ctype]);
    const ci = campaigns.id([r[C.camp], r[C.ctype]]);
    const ai = adgroups.id([ci, r[C.ag]]);
    const mi = media.id([r[C.media], r[C.kind]]);
    const ti = terms.id(r[C.term]);
    const di = dates.id(d);
    const mt = matchTypes.id(r[C.match]);
    const imp = num(r[C.imp]), rank = num(r[C.rank]);
    const v = [imp, num(r[C.clk]), num(r[C.cost]), rank * imp, rank > 0 ? imp : 0, num(r[C.conv]), num(r[C.rev])];
    const k = [di, ai, mi, ti, mt].join(",");
    const o = agg.get(k);
    if (o) for (let i = 0; i < v.length; i++) o[i] += v[i]; else agg.set(k, v);
  }
}
const round = x => Math.round(x * 100) / 100;
const rows = [...agg].map(([k, v]) => [...k.split(",").map(Number), ...v.map(round)]);
const allDates = [...dates.list].sort();
const since = [allDates[0], ...mediaFiles.map(f => f.since).filter(Boolean)].sort()[0];
const until = [allDates[allDates.length - 1], ...mediaFiles.map(f => f.until).filter(Boolean)].sort().pop();

/* ---------- 소재 보고서 ---------- */
// 소재 보고서에는 캠페인유형이 없어서 매체 보고서의 캠페인 → 유형을 빌려 쓴다 (없으면 소재 ID 모양으로 추정)
const guessType = (camp, cid) => ctypeOf.get(camp) || (/^nad-a001-01-/.test(cid) ? "파워링크" : /^nad-a001-02-/.test(cid) ? "쇼핑검색" : "기타");
const creFiles = loaded.filter(x => x.kind === "creative");
const datedCre = creFiles.filter(f => f.has("일별"));
const useCre = datedCre.length ? datedCre : creFiles.length ? [[...creFiles].sort((a, b) => (a.until || "").localeCompare(b.until || "") || a.file.localeCompare(b.file)).pop()] : [];
const cOwner = datedCre.length ? dateOwners(datedCre, "일별") : null;
const cagg = new Map();
for (const f of useCre) {
  const C = { date: f.has("일별") ? f.col("일별") : -1, camp: f.col("캠페인"), ag: f.col("광고그룹"), cre: f.col("소재"), imp: f.col("노출수"), clk: f.col("클릭수"),
    cost: f.col("총비용"), rank: f.col("평균노출순위"), conv: f.col("구매완료 전환수"), rev: f.col("구매완료 전환매출액(원)") };
  for (const r of f.rows) {
    let di = -1;
    if (cOwner) { const d = isoDate(r[C.date]); if (!d || cOwner.get(d) !== f) continue; di = dates.id(d); }
    const cid = r[C.cre].trim();
    const ci = campaigns.id([r[C.camp], guessType(r[C.camp], cid)]);
    const ai = adgroups.id([ci, r[C.ag]]);
    const imp = num(r[C.imp]), rank = num(r[C.rank]);
    const v = [imp, num(r[C.clk]), num(r[C.cost]), rank * imp, rank > 0 ? imp : 0, num(r[C.conv]), num(r[C.rev])];
    const k = [di, ai, cids.id(cid)].join(",");
    const o = cagg.get(k);
    if (o) for (let i = 0; i < v.length; i++) o[i] += v[i]; else cagg.set(k, v);
  }
}
const creSince = useCre.map(f => f.since).filter(Boolean).sort()[0] || "";
const creUntil = useCre.map(f => f.until).filter(Boolean).sort().pop() || "";

/* ---------- 상품 매칭 ---------- */
// 소재 ID → [상품명, 카테고리, 쇼핑몰 상품ID] (노출상품명이 있으면 그걸, 없으면 기본상품명)
const products = {};
for (const f of loaded.filter(x => x.kind === "map").sort((a, b) => a.file.localeCompare(b.file))) {
  const C = { id: f.col("소재 ID"), base: f.col("기본상품명"), shown: f.has("노출상품명") ? f.col("노출상품명") : -1,
    cat: f.has("카테고리") ? f.col("카테고리") : -1, mall: f.has("쇼핑몰 상품ID") ? f.col("쇼핑몰 상품ID") : -1 };
  for (const r of f.rows) {
    const id = (r[C.id] || "").trim();
    if (!id) continue;
    products[id] = [((C.shown >= 0 && r[C.shown]) || r[C.base] || "").trim(), C.cat >= 0 ? r[C.cat] : "", C.mall >= 0 ? r[C.mall] : ""];
  }
}

const days = Math.round((new Date(until) - new Date(since)) / 86400000) + 1;
const reportNo = mediaFiles.map(f => f.reportNo).find(Boolean) || "";
const data = {
  meta: { client, since, until, days, source: `매체 보고서 ${reportNo}`.trim(), sourceRows, files: mediaFiles.length, built: new Date().toISOString().slice(0, 10) },
  dates: dates.list, campaigns: campaigns.list, adgroups: adgroups.list, media: media.list, terms: terms.list, matchTypes: matchTypes.list, rows,
  creatives: { dated: !!cOwner, since: creSince, until: creUntil, ids: cids.list, rows: [...cagg].map(([k, v]) => [...k.split(",").map(Number), ...v.map(round)]) },
  products,
};
const tpl = fs.readFileSync(path.join(__dirname, "template.html"), "utf8");
const html = tpl.replace("/*__DATA__*/null", () => JSON.stringify(data).replace(/</g, "\\u003c"));
const out = outArg || path.join(__dirname, "reports", `네이버SA_${client ? client + "_" : ""}${since.replace(/-/g, "")}-${until.replace(/-/g, "")}.html`);
fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
fs.writeFileSync(out, html);

const tot = rows.reduce((s, r) => { s[0] += r[7]; s[1] += r[10]; s[2] += r[11]; return s; }, [0, 0, 0]);
const matched = data.creatives.ids.filter(id => products[id]).length;
console.log(`기간 ${since} ~ ${until} (${days}일) · 매체 보고서 ${mediaFiles.length}개 · ${sourceRows}행 → ${rows.length}행`);
console.log(`광고비 ${Math.round(tot[0]).toLocaleString()} · 전환 ${tot[1]} · 전환매출 ${Math.round(tot[2]).toLocaleString()}`);
console.log(`소재 ${data.creatives.ids.length}개 (상품명 매칭 ${matched}개, ${cOwner ? "일별" : "기간 합계"}) · 매칭 표 ${Object.keys(products).length}개`);
console.log(`저장: ${out} (${(html.length / 1048576).toFixed(2)}MB)`);
