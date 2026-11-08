import { config } from "./config.js";

// 광주소프트웨어마이스터고등학교 (NEIS school lookup: 교육청 F10, 학교 7140392)
const OFFICE_CODE = "F10";
const SCHOOL_CODE = "7140392";
const API = "https://open.neis.go.kr/hub";
const TIMEZONE = "Asia/Seoul";

/** Without an API key NEIS returns at most 5 rows per request and ignores paging. */
export const NO_KEY_ROW_LIMIT = 5;

interface NeisResult<T> {
  rows: T[];
  total: number;
}

async function call<T>(service: string, params: Record<string, string>): Promise<NeisResult<T>> {
  const query = new URLSearchParams({
    Type: "json",
    pSize: "100",
    ATPT_OFCDC_SC_CODE: OFFICE_CODE,
    SD_SCHUL_CODE: SCHOOL_CODE,
    ...params,
  });
  if (config.neisApiKey) query.set("KEY", config.neisApiKey);
  const res = await fetch(`${API}/${service}?${query}`, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`NEIS ${service} HTTP ${res.status}`);
  const body = (await res.json()) as Record<string, any>;
  // "No data" comes back as a bare RESULT object instead of the usual [head, row] pair.
  if (body.RESULT) {
    if (body.RESULT.CODE === "INFO-200") return { rows: [], total: 0 };
    throw new Error(`NEIS ${service}: ${body.RESULT.CODE} ${body.RESULT.MESSAGE}`);
  }
  const [head, data] = body[service] as [{ head: any[] }, { row: T[] }];
  return { rows: data?.row ?? [], total: Number(head.head[0]?.list_total_count ?? 0) };
}

// ---- dates ----

/** Today's date in Korea as YYYYMMDD-friendly parts. */
function today(): Date {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date())
    .split("-")
    .map(Number);
  return new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
}

const RELATIVE: Record<string, number> = { 그제: -2, 그저께: -2, 어제: -1, 오늘: 0, 내일: 1, 모레: 2 };

/**
 * Accepts 오늘/내일/모레/어제, M/D, M.D, M-D, MMDD, YYYY-MM-DD, YYYYMMDD. Empty means today.
 * Returns a UTC-midnight Date, or null when the input cannot be read.
 */
export function parseDate(input: string | null): Date | null {
  const base = today();
  const text = (input ?? "").trim().replace(/\s+/g, "");
  if (!text) return base;
  if (text in RELATIVE) return new Date(base.getTime() + RELATIVE[text] * 86_400_000);

  let year = base.getUTCFullYear();
  let month: number;
  let day: number;
  let m: RegExpMatchArray | null;
  if ((m = text.match(/^(\d{4})[-./]?(\d{1,2})[-./]?(\d{1,2})$/)) && (text.length === 8 || /\D/.test(text))) {
    [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  } else if ((m = text.match(/^(\d{1,2})[-./월](\d{1,2})일?$/)) || (m = text.match(/^(\d{2})(\d{2})$/))) {
    [month, day] = [Number(m[1]), Number(m[2])];
  } else {
    return null;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date;
}

function ymd(date: Date): string {
  return date.toISOString().slice(0, 10).replace(/-/g, "");
}

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

/** e.g. 11월 10일 (화) */
export function formatDate(date: Date): string {
  return `${date.getUTCMonth() + 1}월 ${date.getUTCDate()}일 (${WEEKDAYS[date.getUTCDay()]})`;
}

// ---- meals ----

export interface Meal {
  name: string; // 조식 / 중식 / 석식
  dishes: string[];
  calories?: string;
}

/** Drops allergy numbers like "(1.5.6)" and NEIS line breaks. */
function cleanDishes(raw: string): string[] {
  return raw
    .split(/<br\s*\/?>/i)
    .map((d) => d.replace(/\(\s*[\d.\s]+\)/g, "").trim())
    .filter(Boolean);
}

export async function meals(date: Date): Promise<Meal[]> {
  const { rows } = await call<{ MMEAL_SC_CODE: string; MMEAL_SC_NM: string; DDISH_NM: string; CAL_INFO?: string }>(
    "mealServiceDietInfo",
    { MLSV_YMD: ymd(date) },
  );
  return rows
    .sort((a, b) => Number(a.MMEAL_SC_CODE) - Number(b.MMEAL_SC_CODE))
    .map((r) => ({ name: r.MMEAL_SC_NM, dishes: cleanDishes(r.DDISH_NM), calories: r.CAL_INFO?.trim() || undefined }));
}

// ---- timetable ----

export interface Timetable {
  periods: { period: number; subject: string }[];
  /** True when NEIS had more periods than it returned (no API key). */
  truncated: boolean;
}

export async function timetable(date: Date, grade: number, classNumber: number): Promise<Timetable> {
  const { rows, total } = await call<{ PERIO: string; ITRT_CNTNT: string }>("hisTimetable", {
    ALL_TI_YMD: ymd(date),
    GRADE: String(grade),
    CLASS_NM: String(classNumber),
  });
  const byPeriod = new Map<number, string>();
  for (const r of rows) {
    const period = Number(r.PERIO);
    if (!byPeriod.has(period)) byPeriod.set(period, r.ITRT_CNTNT.replace(/^-/, "").trim());
  }
  return {
    periods: [...byPeriod].sort(([a], [b]) => a - b).map(([period, subject]) => ({ period, subject })),
    truncated: total > rows.length,
  };
}
