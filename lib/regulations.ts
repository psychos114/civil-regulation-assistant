import { env } from "cloudflare:workers";
import seedData from "@/data/seed-regulations.json";

type RegulationSeed = {
  title: string;
  code: string;
  release_date: string;
  content: string;
  version: string;
  is_new: number;
};

type RemoteRegulation = Omit<RegulationSeed, "is_new"> & {
  id: string;
};

type RegulationRow = RegulationSeed & {
  id: number;
  created_at: string;
  updated_at: string;
};

type RegulationItem = Omit<RegulationRow, "is_new"> & {
  is_new: boolean;
};

type UpdateItem = RemoteRegulation & {
  action: "new" | "update";
  local_id: number | null;
  current_version: string | null;
};

const regulations = seedData.regulations as RegulationSeed[];
const remoteRegulations = seedData.updates as RemoteRegulation[];

let initialization: Promise<void> | undefined;

const apiHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
};

function database(): D1Database {
  const binding = (env as unknown as { DB?: D1Database }).DB;
  if (!binding) {
    throw new Error("D1 数据库绑定 DB 不可用");
  }
  return binding;
}

function utcNow(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function successResponse(
  data: unknown,
  message = "请求成功",
  status = 200,
): Response {
  return new Response(JSON.stringify({ success: true, message, data }), {
    status,
    headers: apiHeaders,
  });
}

export function errorResponse(
  message: string,
  status: number,
  code: string,
): Response {
  return new Response(
    JSON.stringify({
      success: false,
      message,
      error: { code },
    }),
    { status, headers: apiHeaders },
  );
}

export function internalError(error: unknown): Response {
  console.error("Regulations API error", error);
  return errorResponse("服务器暂时无法处理请求，请稍后重试", 500, "DATABASE_ERROR");
}

function toItem(row: RegulationRow): RegulationItem {
  return { ...row, is_new: Boolean(row.is_new) };
}

async function initializeDatabase(): Promise<void> {
  const db = database();
  await db.batch([
    db.prepare(`
      CREATE TABLE IF NOT EXISTS regulations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        code TEXT NOT NULL UNIQUE,
        release_date TEXT NOT NULL,
        content TEXT NOT NULL,
        version TEXT NOT NULL,
        is_new INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `),
    db.prepare(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_regulations_code ON regulations(code)",
    ),
    db.prepare(`
      CREATE TABLE IF NOT EXISTS chat_rate_limits (
        bucket TEXT PRIMARY KEY,
        count INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT NOT NULL
      )
    `),
  ]);

  const countResult = await db
    .prepare("SELECT COUNT(*) AS total FROM regulations")
    .first<{ total: number }>();
  if (Number(countResult?.total ?? 0) > 0) {
    return;
  }

  const timestamp = utcNow();
  await db.batch(
    regulations.map((item) =>
      db
        .prepare(`
          INSERT OR IGNORE INTO regulations (
            title, code, release_date, content, version, is_new, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .bind(
          item.title,
          item.code,
          item.release_date,
          item.content,
          item.version,
          item.is_new,
          timestamp,
          timestamp,
        ),
    ),
  );
}

export async function ensureDatabase(): Promise<void> {
  initialization ??= initializeDatabase();
  return initialization;
}

async function findUpdates(): Promise<UpdateItem[]> {
  const result = await database()
    .prepare("SELECT id, code, version FROM regulations")
    .all<{ id: number; code: string; version: string }>();
  const localByCode = new Map(result.results.map((row) => [row.code, row]));

  return remoteRegulations.flatMap((remote) => {
    const local = localByCode.get(remote.code);
    if (local?.version === remote.version) {
      return [];
    }
    return [
      {
        ...remote,
        action: local ? ("update" as const) : ("new" as const),
        local_id: local?.id ?? null,
        current_version: local?.version ?? null,
      },
    ];
  });
}

export async function checkUpdate(): Promise<Response> {
  await ensureDatabase();
  const db = database();
  const [updates, countResult] = await Promise.all([
    findUpdates(),
    db.prepare("SELECT COUNT(*) AS total FROM regulations").first<{ total: number }>(),
  ]);

  return successResponse(
    {
      has_update: updates.length > 0,
      update_count: updates.length,
      local_count: Number(countResult?.total ?? 0),
      updates,
      checked_at: utcNow(),
    },
    updates.length ? "发现法规更新" : "当前已是最新版本",
  );
}

function positiveInteger(
  params: URLSearchParams,
  name: string,
  fallback: number,
  maximum?: number,
): number {
  const raw = params.get(name);
  if (raw === null) return fallback;
  if (!/^\d+$/.test(raw)) {
    throw new Error(`参数 ${name} 必须是整数`);
  }
  const value = Number(raw);
  if (value < 1) {
    throw new Error(`参数 ${name} 必须大于等于 1`);
  }
  if (maximum && value > maximum) {
    throw new Error(`参数 ${name} 不能大于 ${maximum}`);
  }
  return value;
}

export async function listRegulations(request: Request): Promise<Response> {
  await ensureDatabase();
  const params = new URL(request.url).searchParams;
  let page: number;
  let pageSize: number;
  try {
    page = positiveInteger(params, "page", 1);
    pageSize = params.has("page_size")
      ? positiveInteger(params, "page_size", 10, 100)
      : positiveInteger(params, "per_page", 10, 100);
  } catch (error) {
    return errorResponse(
      error instanceof Error ? error.message : "分页参数错误",
      400,
      "INVALID_PAGINATION",
    );
  }

  const keyword = (params.get("q") ?? params.get("search") ?? "").trim();
  const isNewRaw = params.get("is_new");
  const conditions: string[] = [];
  const bindings: Array<string | number> = [];

  if (keyword) {
    conditions.push("(title LIKE ? OR code LIKE ? OR content LIKE ?)");
    const likeKeyword = `%${keyword}%`;
    bindings.push(likeKeyword, likeKeyword, likeKeyword);
  }
  if (isNewRaw !== null) {
    const normalized = isNewRaw.trim().toLowerCase();
    if (!["0", "1", "false", "true"].includes(normalized)) {
      return errorResponse(
        "参数 is_new 必须是 0、1、false 或 true",
        400,
        "INVALID_FILTER",
      );
    }
    conditions.push("is_new = ?");
    bindings.push(["1", "true"].includes(normalized) ? 1 : 0);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const offset = (page - 1) * pageSize;
  const db = database();
  const countStatement = db
    .prepare(`SELECT COUNT(*) AS total FROM regulations ${where}`)
    .bind(...bindings);
  const listStatement = db
    .prepare(`
      SELECT * FROM regulations
      ${where}
      ORDER BY is_new DESC, release_date DESC, id DESC
      LIMIT ? OFFSET ?
    `)
    .bind(...bindings, pageSize, offset);
  const [countResult, rowsResult] = await Promise.all([
    countStatement.first<{ total: number }>(),
    listStatement.all<RegulationRow>(),
  ]);
  const total = Number(countResult?.total ?? 0);
  const totalPages = total ? Math.ceil(total / pageSize) : 0;

  return successResponse({
    items: rowsResult.results.map(toItem),
    pagination: {
      page,
      page_size: pageSize,
      total,
      total_pages: totalPages,
      has_previous: page > 1,
      has_next: page < totalPages,
    },
  });
}

function selectRemoteRegulations(payload: unknown): RemoteRegulation[] {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    throw new TypeError("请求体必须是 JSON 对象");
  }
  const object = payload as { update_ids?: unknown; ids?: unknown };
  const requested = object.update_ids ?? object.ids;
  if (requested === undefined) {
    return [...remoteRegulations];
  }
  if (
    !Array.isArray(requested) ||
    requested.some((item) => !["string", "number"].includes(typeof item))
  ) {
    throw new Error("update_ids 必须是字符串数组");
  }

  const lookup = new Map<string, RemoteRegulation>();
  remoteRegulations.forEach((item) => {
    lookup.set(item.id, item);
    lookup.set(item.code, item);
  });
  const selected = new Map<string, RemoteRegulation>();
  const unknown: string[] = [];
  [...new Set(requested.map(String))].forEach((requestedId) => {
    const item = lookup.get(requestedId);
    if (item) selected.set(item.id, item);
    else unknown.push(requestedId);
  });
  if (unknown.length) {
    throw new Error(`未找到可下载的更新：${unknown.join(", ")}`);
  }
  return [...selected.values()];
}

export async function downloadRegulations(request: Request): Promise<Response> {
  await ensureDatabase();
  let payload: unknown = {};
  const rawBody = await request.text();
  if (rawBody.trim()) {
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return errorResponse("请求体必须是有效的 JSON", 400, "INVALID_JSON_BODY");
    }
  }

  let selected: RemoteRegulation[];
  try {
    selected = selectRemoteRegulations(payload);
  } catch (error) {
    if (error instanceof TypeError) {
      return errorResponse(error.message, 400, "INVALID_JSON_BODY");
    }
    return errorResponse(
      error instanceof Error ? error.message : "更新参数错误",
      400,
      "INVALID_UPDATE_IDS",
    );
  }

  const db = database();
  const downloaded: Array<Record<string, unknown>> = [];
  const unchanged: Array<Record<string, unknown>> = [];
  let createdCount = 0;
  let updatedCount = 0;

  for (const remote of selected) {
    const local = await db
      .prepare("SELECT * FROM regulations WHERE code = ?")
      .bind(remote.code)
      .first<RegulationRow>();

    if (local?.version === remote.version) {
      unchanged.push({
        id: local.id,
        title: local.title,
        code: local.code,
        version: local.version,
      });
      continue;
    }

    const timestamp = utcNow();
    let localId: number;
    let action: "created" | "updated";
    if (!local) {
      const result = await db
        .prepare(`
          INSERT INTO regulations (
            title, code, release_date, content, version, is_new, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, 1, ?, ?)
        `)
        .bind(
          remote.title,
          remote.code,
          remote.release_date,
          remote.content,
          remote.version,
          timestamp,
          timestamp,
        )
        .run();
      localId = Number(result.meta.last_row_id);
      action = "created";
      createdCount += 1;
    } else {
      await db
        .prepare(`
          UPDATE regulations
          SET title = ?, release_date = ?, content = ?, version = ?,
              is_new = 1, updated_at = ?
          WHERE id = ?
        `)
        .bind(
          remote.title,
          remote.release_date,
          remote.content,
          remote.version,
          timestamp,
          local.id,
        )
        .run();
      localId = local.id;
      action = "updated";
      updatedCount += 1;
    }
    downloaded.push({
      id: localId,
      update_id: remote.id,
      title: remote.title,
      code: remote.code,
      version: remote.version,
      action,
    });
  }

  const remainingUpdates = await findUpdates();
  return successResponse(
    {
      downloaded_count: downloaded.length,
      created_count: createdCount,
      updated_count: updatedCount,
      unchanged_count: unchanged.length,
      downloaded,
      unchanged,
      remaining_update_count: remainingUpdates.length,
      completed_at: utcNow(),
    },
    downloaded.length
      ? `法规数据下载完成，共处理 ${downloaded.length} 份更新`
      : "所选法规已是最新版本",
  );
}

export async function getRegulation(idValue: string): Promise<Response> {
  await ensureDatabase();
  if (!/^\d+$/.test(idValue)) {
    return errorResponse("法规编号无效", 404, "REGULATION_NOT_FOUND");
  }
  const row = await database()
    .prepare("SELECT * FROM regulations WHERE id = ?")
    .bind(Number(idValue))
    .first<RegulationRow>();
  if (!row) {
    return errorResponse(
      `未找到 id 为 ${idValue} 的法规`,
      404,
      "REGULATION_NOT_FOUND",
    );
  }
  return successResponse(toItem(row));
}
