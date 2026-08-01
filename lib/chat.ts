import { env } from "cloudflare:workers";
import {
  ensureDatabase,
  errorResponse,
  internalError,
  successResponse,
} from "@/lib/regulations";
import {
  ragDocumentCatalog,
  resolveRagSourceDetails,
  retrieveRagContext,
} from "@/lib/rag";
import { searchVectorStore } from "@/lib/vector-store";

type ChatRole = "user" | "assistant";

type ChatMessage = {
  role: ChatRole;
  content: string;
};

type RegulationContextRow = {
  title: string;
  code: string;
  content: string;
  version: string;
};

type ModelAnswer = {
  plainAnswer: string;
  sourceAnswer: string;
  sources: string[];
};

type StepFunResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
};

type ChatEnvironment = {
  DB?: D1Database;
  STEPFUN_API_KEY?: string;
  STEPFUN_BASE_URL?: string;
  STEPFUN_MODEL?: string;
};

const MAX_QUESTION_LENGTH = 2000;
const MAX_HISTORY_MESSAGES = 8;
const MAX_HISTORY_MESSAGE_LENGTH = 2000;
const MAX_REQUESTS_PER_HOUR = 20;
const DEFAULT_BASE_URL = "https://api.stepfun.com/step_plan/v1";
const DEFAULT_MODEL = "step-3.7-flash";

function bindings(): Required<Pick<ChatEnvironment, "DB">> &
  Omit<ChatEnvironment, "DB"> {
  return env as unknown as Required<Pick<ChatEnvironment, "DB">> &
    Omit<ChatEnvironment, "DB">;
}

function normalizeHistory(value: unknown): ChatMessage[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new Error("history 必须是消息数组");
  }

  return value.slice(-MAX_HISTORY_MESSAGES).map((item) => {
    if (
      !item ||
      typeof item !== "object" ||
      !["user", "assistant"].includes(String((item as ChatMessage).role)) ||
      typeof (item as ChatMessage).content !== "string"
    ) {
      throw new Error("history 中包含无效消息");
    }
    return {
      role: (item as ChatMessage).role,
      content: (item as ChatMessage).content
        .trim()
        .slice(0, MAX_HISTORY_MESSAGE_LENGTH),
    };
  });
}

async function hashClient(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function enforceRateLimit(request: Request): Promise<Response | null> {
  const runtime = bindings();
  const clientIp =
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "local";
  const hourBucket = new Date().toISOString().slice(0, 13);
  const clientHash = await hashClient(clientIp);
  const bucket = `${hourBucket}:${clientHash}`;
  const updatedAt = new Date().toISOString();
  const row = await runtime.DB.prepare(`
    INSERT INTO chat_rate_limits (bucket, count, updated_at)
    VALUES (?, 1, ?)
    ON CONFLICT(bucket) DO UPDATE SET
      count = count + 1,
      updated_at = excluded.updated_at
    RETURNING count
  `)
    .bind(bucket, updatedAt)
    .first<{ count: number }>();

  if (Number(row?.count ?? 1) > MAX_REQUESTS_PER_HOUR) {
    return errorResponse(
      "本小时提问次数已用完，请稍后再试",
      429,
      "CHAT_RATE_LIMITED",
    );
  }
  return null;
}

async function regulationContext(): Promise<{
  rows: RegulationContextRow[];
  text: string;
}> {
  const result = await bindings()
    .DB.prepare(`
      SELECT title, code, content, version
      FROM regulations
      ORDER BY is_new DESC, release_date DESC, id DESC
      LIMIT 20
    `)
    .all<RegulationContextRow>();
  const rows = result.results;
  return {
    rows,
    text: rows
      .map(
        (item) =>
          `[${item.code}《${item.title}》· ${item.version}]\n${item.content}`,
      )
      .join("\n\n"),
  };
}

function modelResponseSchema() {
  return {
    type: "json_schema",
    json_schema: {
      name: "civil_regulation_answer",
      strict: true,
      schema: {
        type: "object",
        properties: {
          plainAnswer: {
            type: "string",
            description: "面向非专业用户的清晰中文回答",
          },
          sourceAnswer: {
            type: "string",
            description: "基于检索资料的依据说明，不得虚构条款号、页码或数据",
          },
          sources: {
            type: "array",
            items: { type: "string" },
            description: "实际使用的资料标签，必须与参考资料中的名称一致",
          },
        },
        required: ["plainAnswer", "sourceAnswer", "sources"],
        additionalProperties: false,
      },
    },
  };
}

function parseModelAnswer(content: string, knownSources: Set<string>): ModelAnswer {
  const cleaned = content
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  const value = JSON.parse(cleaned) as Partial<ModelAnswer>;
  if (
    typeof value.plainAnswer !== "string" ||
    typeof value.sourceAnswer !== "string" ||
    !Array.isArray(value.sources)
  ) {
    throw new Error("模型返回格式无效");
  }

  const sources = value.sources
    .filter((source): source is string => typeof source === "string")
    .map((source) => source.trim())
    .filter(
      (source) =>
        source.length > 0 &&
        [...knownSources].some(
          (known) => known.includes(source) || source.includes(known),
        ),
    )
    .slice(0, 8);

  return {
    plainAnswer: value.plainAnswer.trim(),
    sourceAnswer: value.sourceAnswer.trim(),
    sources,
  };
}

export async function chatWithModel(request: Request): Promise<Response> {
  await ensureDatabase();

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return errorResponse("请求体必须是有效的 JSON", 400, "INVALID_JSON_BODY");
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return errorResponse("请求体必须是 JSON 对象", 400, "INVALID_JSON_BODY");
  }

  const question = String((payload as { question?: unknown }).question ?? "").trim();
  if (!question) {
    return errorResponse("请输入问题", 400, "QUESTION_REQUIRED");
  }
  if (question.length > MAX_QUESTION_LENGTH) {
    return errorResponse(
      `问题不能超过 ${MAX_QUESTION_LENGTH} 个字符`,
      400,
      "QUESTION_TOO_LONG",
    );
  }

  let history: ChatMessage[];
  try {
    history = normalizeHistory((payload as { history?: unknown }).history);
  } catch (error) {
    return errorResponse(
      error instanceof Error ? error.message : "历史消息格式错误",
      400,
      "INVALID_CHAT_HISTORY",
    );
  }

  const limited = await enforceRateLimit(request);
  if (limited) return limited;

  const runtime = bindings();
  const apiKey = runtime.STEPFUN_API_KEY?.trim();
  if (!apiKey) {
    return errorResponse(
      "大模型服务尚未配置，请联系管理员",
      503,
      "MODEL_NOT_CONFIGURED",
    );
  }

  const baseUrl = (runtime.STEPFUN_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const model = runtime.STEPFUN_MODEL || DEFAULT_MODEL;
  const [context, keywordRagContext, ragCatalog] = await Promise.all([
    regulationContext(),
    retrieveRagContext(question),
    ragDocumentCatalog(),
  ]);

  let vectorRagContext: Awaited<ReturnType<typeof searchVectorStore>> = null;
  try {
    vectorRagContext = await searchVectorStore(question);
  } catch (error) {
    console.error("Pinecone search failed; using keyword fallback", error);
  }
  const vectorMatches = vectorRagContext?.rows.length ?? 0;
  const retrievalMode: "vector" | "keyword_fallback" =
    vectorMatches > 0 ? "vector" : "keyword_fallback";
  const ragContext =
    retrievalMode === "vector" && vectorRagContext
      ? vectorRagContext
      : keywordRagContext;
  const knownSources = new Set(
    [
      ...context.rows.flatMap((item) => [
        `${item.code} ${item.title}`,
        item.code,
        item.title,
      ]),
      ...ragContext.sourceDetails.flatMap((item) => [
        item.label,
        item.title,
      ]),
      ...ragCatalog.map((item) => item.title),
    ],
  );

  const systemPrompt = (enterpriseContext: string, vectorEnabled: boolean) =>
    `你是“土木工程智能规范助手”，面向施工、监理、设计和项目管理人员提供中文法规与企业公开资料查询帮助。

必须遵守以下规则：
1. 优先依据${vectorEnabled ? "下方 Pinecone 语义检索返回的企业资料" : "下方“问题相关企业资料”"}和“法规知识库摘要”回答，不能利用未提供的记忆补充事实。
2. 企业年报、ESG 报告和官网页面属于企业公开资料，不得称为法规或规范。
3. 不得虚构条款号、页码、强制性条文、处罚金额、财务数据或技术参数。
4. 资料不足时，明确写“现有知识库中没有找到足够依据”，并说明还需要核对什么资料。
5. sources 只能填写参考资料中真实存在的法规编号、名称或《文档名称》· 第N页标签。
6. 涉及具体数字时，sourceAnswer 必须说明文档名称和页码；涉及网页资料时说明官网来源。
7. 对涉及人身安全、结构安全、消防、法律责任的事项，提醒用户由具备资质的专业人员复核，并以主管部门或标准发布机构的正式文本为准。
8. plainAnswer 使用易懂、可执行的语言；sourceAnswer 说明依据和核验边界。
9. 不输出思考过程，只输出指定 JSON 结构。

问题相关企业资料：
${enterpriseContext}

法规知识库摘要：
${context.text}`;

  const prompt = systemPrompt(
    ragContext.text || "本次问题未检索到相关企业资料。",
    retrievalMode === "vector",
  );

  const requestBody: Record<string, unknown> = {
    model,
    messages: [
      { role: "system", content: prompt },
      ...history,
      { role: "user", content: question },
    ],
    response_format: modelResponseSchema(),
    reasoning_effort: "low",
    temperature: 0.2,
    max_tokens: 1200,
    stream: false,
  };

  let upstream: Response;
  try {
    upstream = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (error) {
    console.error("StepFun request failed", error);
    return errorResponse(
      "大模型服务连接超时，请稍后重试",
      504,
      "MODEL_TIMEOUT",
    );
  }

  if (!upstream.ok) {
    const errorText = await upstream.text();
    console.error("StepFun response error", upstream.status, errorText.slice(0, 500));
    if (upstream.status === 401 || upstream.status === 403) {
      return errorResponse(
        "大模型 API 密钥无效或已失效，请联系管理员更换",
        502,
        "MODEL_AUTH_ERROR",
      );
    }
    if (upstream.status === 429) {
      return errorResponse(
        "大模型服务当前额度不足或请求过多，请稍后重试",
        503,
        "MODEL_QUOTA_ERROR",
      );
    }
    return errorResponse(
      "大模型暂时无法回答，请稍后重试",
      502,
      "MODEL_UPSTREAM_ERROR",
    );
  }

  let upstreamData: StepFunResponse;
  try {
    upstreamData = (await upstream.json()) as StepFunResponse;
  } catch {
    return errorResponse(
      "大模型返回了无法识别的数据",
      502,
      "MODEL_RESPONSE_ERROR",
    );
  }

  const content = upstreamData.choices?.[0]?.message?.content;
  if (!content) {
    return errorResponse(
      "大模型没有返回回答，请重新提问",
      502,
      "MODEL_EMPTY_RESPONSE",
    );
  }

  try {
    const answer = parseModelAnswer(content, knownSources);
    const vectorSourceDetails =
      retrievalMode === "vector"
        ? await resolveRagSourceDetails(answer.sources, ragCatalog)
        : [];
    const citedSourceDetails = ragContext.sourceDetails.filter((detail) =>
      answer.sources.some((source) => {
        const normalizedSource = source.replace(/[\s·•]/g, "");
        const normalizedLabel = detail.label.replace(/[\s·•]/g, "");
        const pageMatch = source.match(/第\s*(\d+)\s*页/);

        if (pageMatch && detail.page) {
          return (
            Number(pageMatch[1]) === detail.page &&
            normalizedSource.includes(detail.title.replace(/\s/g, ""))
          );
        }
        return normalizedSource.includes(normalizedLabel);
      }),
    );
    return successResponse(
      {
        ...answer,
        sourceDetails:
          vectorSourceDetails.length > 0
            ? vectorSourceDetails
            : citedSourceDetails.length > 0
              ? citedSourceDetails
              : ragContext.sourceDetails.slice(0, 3),
        retrieval: {
          mode: retrievalMode,
          vector_database: "Pinecone",
          rag_matches: ragContext.rows.length,
          regulation_matches: context.rows.length,
        },
        model,
      },
      "大模型回答成功",
    );
  } catch (error) {
    console.error("StepFun answer parsing failed", error);
    return errorResponse(
      "大模型回答格式异常，请重新提问",
      502,
      "MODEL_RESPONSE_ERROR",
    );
  }
}

export function chatInternalError(error: unknown): Response {
  return internalError(error);
}
