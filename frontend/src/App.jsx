import { useEffect, useMemo, useRef, useState } from "react";

const configuredBackend = (window.BACKEND_URL || "").replace(/\/$/, "");
const standaloneFrontendPorts = new Set(["4173", "5173", "8000"]);
const localBackend = standaloneFrontendPorts.has(window.location.port)
  ? `${window.location.protocol}//${window.location.hostname}:5000`
  : window.location.origin;
const API_BASE = `${configuredBackend || localBackend}/api`;

const sampleSources = [
  {
    title: "中国建筑股份有限公司2025年年度报告",
    organization: "中国建筑股份有限公司",
    page: 17,
    documentType: "年度报告",
    url: "https://www.cscec.com/tzzgxnew/dqbg_new/202604/P020260417798519591498.pdf",
  },
  {
    title: "公司简介",
    organization: "中国建筑集团有限公司",
    page: null,
    documentType: "官方网站",
    url: "https://www.cscec.com/zgjz_new/gyzj/gsjj_new/",
  },
  {
    title: "基础设施投资与建设",
    organization: "中国建筑集团有限公司",
    page: null,
    documentType: "业务介绍",
    url: "https://www.cscec.com/ywly_new/jcsstzyjs/",
  },
];

const initialAnswer = {
  question: "中国建筑的主要业务有哪些？",
  plainAnswer:
    "中国建筑的主要业务围绕“投资建设运营”全产业链，覆盖房屋建筑、基础设施、地产开发等领域，具体包括：",
  sections: [
    {
      title: "房屋建筑工程",
      text: "包括工业与民用建筑、城市综合体、绿色建筑等的设计、施工与总承包，涵盖住宅、商业、公共建筑等多种类型。",
    },
    {
      title: "基础设施建设",
      text: "包括交通基础设施（公路、铁路、桥梁、隧道、轨道交通等）、市政工程、水利水电工程、机场港口等的投资、建设与运营。",
    },
    {
      title: "地产开发与投资运营",
      text: "包括城市更新、住宅开发、商业地产、产业园区及城市综合开发等，提供投资、开发、运营一体化服务。",
    },
  ],
  sourceAnswer:
    "以上为中国建筑公开资料的归纳，涉及具体项目、经营数据或工程要求时，请以右侧原始文件及最新正式文本为准。",
  sourceDetails: sampleSources,
  model: "step-3.7-flash",
};

const NAV_ITEMS = [
  { id: "chat", label: "智能问答", icon: "fa-regular fa-comment-dots" },
  { id: "library", label: "规范库", icon: "fa-solid fa-book-open" },
  { id: "updates", label: "法规更新", icon: "fa-regular fa-clock" },
];

function Icon({ name, className = "" }) {
  return <i className={`${name} ${className}`} aria-hidden="true" />;
}

async function apiRequest(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.success === false) {
    throw new Error(result?.error?.message || result?.message || `请求失败（${response.status}）`);
  }
  return result.data;
}

function Sidebar({ active, onChange, onUtility }) {
  return (
    <aside className="sidebar">
      <button className="brand" type="button" onClick={() => onChange("chat")}>
        <span className="brand-mark"><Icon name="fa-solid fa-city" /></span>
        <span>土木工程智能<br />规范助手</span>
      </button>

      <nav className="primary-nav" aria-label="主要功能">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            className={`nav-item ${active === item.id ? "active" : ""}`}
            type="button"
            onClick={() => onChange(item.id)}
          >
            <Icon name={item.icon} />
            <span>{item.label}</span>
          </button>
        ))}
      </nav>

      <div className="utility-nav">
        <button className="utility-item" type="button" onClick={() => onUtility("settings")}>
          <Icon name="fa-solid fa-gear" />
          <span>设置</span>
        </button>
        <button className="utility-item" type="button" onClick={() => onUtility("about")}>
          <Icon name="fa-solid fa-circle-info" />
          <span>关于</span>
        </button>
      </div>
    </aside>
  );
}

function Header({ ragStatus, onMenu }) {
  const connected = Boolean(ragStatus?.vector_database?.ready);
  return (
    <header className="topbar">
      <button className="mobile-menu" type="button" onClick={onMenu} aria-label="打开导航">
        <Icon name="fa-solid fa-bars" />
      </button>
      <h1>土木工程智能规范助手</h1>
      <div className="topbar-actions">
        <div className="connection" title={connected ? "Pinecone 向量数据库连接正常" : "当前使用本地关键词检索"}>
          <Icon name="fa-solid fa-database" />
          <span>Pinecone {connected ? "已连接" : "待连接"}</span>
          <span className={`status-dot ${connected ? "online" : "offline"}`} />
        </div>
        <button className="profile-button" type="button" aria-label="个人中心">
          <Icon name="fa-regular fa-user" />
        </button>
      </div>
    </header>
  );
}

function SourcePanel({ sources }) {
  return (
    <aside className="source-panel">
      <div className="source-panel-heading">
        <h2>知识来源</h2>
        <span className="verified"><Icon name="fa-solid fa-shield-halved" /> 已核验</span>
      </div>
      <div className="source-list">
        {(sources.length ? sources : sampleSources).slice(0, 5).map((source, index) => (
          <article className="source-item" key={`${source.title}-${source.page || index}`}>
            <Icon name="fa-regular fa-file-lines" className="source-icon" />
            <div>
              <h3>{source.title}</h3>
              <p>{source.organization || source.documentType || "中国建筑公开资料"}</p>
              <p>{source.page ? `第 ${source.page} 页` : "官网网页"}</p>
              {source.url ? (
                <a href={source.url} target="_blank" rel="noreferrer">
                  查看原文 <Icon name="fa-solid fa-arrow-up-right-from-square" />
                </a>
              ) : (
                <span className="source-unavailable">暂无原文链接</span>
              )}
            </div>
          </article>
        ))}
      </div>
      <button className="more-sources" type="button" onClick={() => document.querySelector(".source-list")?.scrollTo({ top: 9999, behavior: "smooth" })}>
        查看更多来源 <Icon name="fa-solid fa-chevron-right" />
      </button>
    </aside>
  );
}

function AnswerContent({ answer }) {
  return (
    <>
      <p className="answer-intro">{answer.plainAnswer}</p>
      {Array.isArray(answer.sections) && answer.sections.length > 0 ? (
        <div className="answer-sections">
          {answer.sections.map((section, index) => (
            <section className="answer-section" key={section.title}>
              <span className="section-number">{index + 1}</span>
              <div>
                <h3>{section.title}</h3>
                <p>{section.text}</p>
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className="answer-plain">
          {(answer.plainAnswer || "").split("\n").filter(Boolean).map((line, index) => <p key={index}>{line}</p>)}
        </div>
      )}
      <div className="answer-caveat">
        <Icon name="fa-solid fa-circle-info" />
        <span>{answer.sourceAnswer || "以上内容由模型生成，仅供参考；如需权威依据，请查阅右侧知识来源。"}</span>
      </div>
    </>
  );
}

function ChatWorkspace({ onSourcesChange }) {
  const [answer, setAnswer] = useState(initialAnswer);
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [history, setHistory] = useState([]);
  const textareaRef = useRef(null);

  useEffect(() => onSourcesChange(answer.sourceDetails || []), [answer, onSourcesChange]);

  const sendQuestion = async () => {
    const text = question.trim();
    if (!text || loading) return;
    setQuestion("");
    setNotice("");
    setLoading(true);
    setAnswer((current) => ({ ...current, question: text, plainAnswer: "正在检索规范与企业公开资料……", sections: [], sourceAnswer: "请稍候。" }));
    try {
      const data = await apiRequest("/chat", {
        method: "POST",
        body: JSON.stringify({ question: text, history }),
      });
      const next = { ...data, question: text, sections: [] };
      setAnswer(next);
      onSourcesChange(next.sourceDetails || []);
      setHistory((items) => [...items, { role: "user", content: text }, { role: "assistant", content: data.plainAnswer }].slice(-8));
    } catch (error) {
      setAnswer({
        question: text,
        plainAnswer: `暂时无法获得大模型回答：${error.message}`,
        sections: [],
        sourceAnswer: "请确认后端服务、大模型密钥与网络连接均正常，然后重新提问。紧急或高风险工程问题请咨询具备资质的专业人员。",
        sourceDetails: sampleSources,
      });
      setNotice("请求没有完成，已保留可核验的知识来源。" );
    } finally {
      setLoading(false);
      textareaRef.current?.focus();
    }
  };

  return (
    <main className="chat-workspace">
      <div className="conversation">
        <div className="user-row">
          <div className="user-bubble">{answer.question}</div>
          <time>{new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</time>
        </div>

        <article className="assistant-answer">
          <div className="assistant-meta">
            <span className="assistant-avatar"><Icon name="fa-solid fa-city" /></span>
            <strong>土木工程智能规范助手</strong>
            <time>刚刚</time>
          </div>
          <div className="answer-body">
            <AnswerContent answer={answer} />
          </div>
        </article>
      </div>

      <div className="composer-wrap">
        {notice && <div className="inline-notice"><Icon name="fa-solid fa-triangle-exclamation" /> {notice}</div>}
        <div className="composer">
          <textarea
            ref={textareaRef}
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                sendQuestion();
              }
            }}
            placeholder="请输入您的问题，例如：混凝土结构的耐久性设计要求？"
            aria-label="输入问题"
          />
          <div className="composer-toolbar">
            <button type="button" className="attachment-button" onClick={() => setNotice("附件问答将在后续版本开放，当前可直接输入问题。") }>
              附加条件 <Icon name="fa-solid fa-chevron-down" />
            </button>
            <button type="button" className="send-button" onClick={sendQuestion} aria-disabled={!question.trim() || loading} aria-label="发送问题">
              <Icon name={loading ? "fa-solid fa-spinner fa-spin" : "fa-regular fa-paper-plane"} />
            </button>
          </div>
        </div>
        <p className="legal-note">AI 生成内容可能存在不准确，请结合规范原文谨慎使用。</p>
      </div>
    </main>
  );
}

function LibraryView() {
  const [items, setItems] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(null);

  const load = async (keyword = "") => {
    setLoading(true);
    setError("");
    try {
      const data = await apiRequest(`/regulations/list?page=1&page_size=50&q=${encodeURIComponent(keyword)}`);
      setItems(data.items || []);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const openDetail = async (item) => {
    try {
      setSelected(await apiRequest(`/regulations/${item.id}`));
    } catch {
      setSelected(item);
    }
  };

  return (
    <main className="content-view">
      <div className="view-heading">
        <div><span className="eyebrow">REGULATION LIBRARY</span><h2>规范库</h2><p>集中检索建筑法规、施工规范与工程验收资料。</p></div>
        <div className="stat-box"><strong>{items.length}</strong><span>当前结果</span></div>
      </div>
      <form className="search-bar" onSubmit={(event) => { event.preventDefault(); load(search); }}>
        <Icon name="fa-solid fa-magnifying-glass" />
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="输入规范名称、编号或关键词" />
        <button type="submit">检索规范</button>
      </form>
      {error && <div className="state-message error"><Icon name="fa-solid fa-circle-exclamation" /> {error}</div>}
      {loading ? <div className="state-message"><Icon name="fa-solid fa-spinner fa-spin" /> 正在读取规范库……</div> : (
        <div className="regulation-table">
          <div className="table-head"><span>规范名称</span><span>编号 / 版本</span><span>发布日期</span><span>状态</span></div>
          {items.map((item) => (
            <button className="table-row" type="button" key={item.id} onClick={() => openDetail(item)}>
              <span className="regulation-name"><Icon name="fa-regular fa-file-lines" /><strong>{item.title}</strong></span>
              <span>{item.code}<small>{item.version}</small></span>
              <span>{item.release_date || "—"}</span>
              <span className={item.is_new ? "new-label" : "current-label"}>{item.is_new ? "新发布" : "现行"}</span>
            </button>
          ))}
          {!items.length && !error && <div className="state-message">没有找到匹配的规范。</div>}
        </div>
      )}
      {selected && (
        <div className="drawer-backdrop" onClick={() => setSelected(null)}>
          <article className="detail-drawer" onClick={(event) => event.stopPropagation()}>
            <button className="drawer-close" type="button" onClick={() => setSelected(null)} aria-label="关闭"><Icon name="fa-solid fa-xmark" /></button>
            <span className="eyebrow">REGULATION DETAIL</span>
            <h2>{selected.title}</h2>
            <dl><div><dt>规范编号</dt><dd>{selected.code}</dd></div><div><dt>版本</dt><dd>{selected.version}</dd></div><div><dt>发布日期</dt><dd>{selected.release_date || "—"}</dd></div></dl>
            <div className="detail-content">{selected.content || "暂无正文摘要。"}</div>
          </article>
        </div>
      )}
    </main>
  );
}

function UpdatesView() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [message, setMessage] = useState("");

  const check = async () => {
    setLoading(true);
    setMessage("");
    try { setData(await apiRequest("/regulations/check-update")); }
    catch (error) { setMessage(error.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { check(); }, []);

  const download = async () => {
    setDownloading(true);
    try {
      const result = await apiRequest("/regulations/download", { method: "POST", body: "{}" });
      setMessage(`更新完成：本次处理 ${result.downloaded_count || 0} 份法规。`);
      await check();
    } catch (error) { setMessage(error.message); }
    finally { setDownloading(false); }
  };

  const updates = data?.updates || [];
  return (
    <main className="content-view">
      <div className="view-heading">
        <div><span className="eyebrow">REGULATION UPDATES</span><h2>法规更新</h2><p>检查并同步最新法规数据，保持本地规范库有效。</p></div>
        <button className="secondary-button" type="button" onClick={check} disabled={loading}><Icon name="fa-solid fa-rotate" /> 重新检查</button>
      </div>
      <section className="update-summary">
        <div className="summary-icon"><Icon name={updates.length ? "fa-solid fa-bell" : "fa-solid fa-circle-check"} /></div>
        <div><span>更新检查结果</span><strong>{loading ? "正在检查……" : updates.length ? `发现 ${updates.length} 项可用更新` : "当前已是最新版本"}</strong><p>本地法规数量：{data?.local_count ?? "—"} · 最近检查：{data?.checked_at ? new Date(data.checked_at).toLocaleString("zh-CN") : "刚刚"}</p></div>
        <button className="primary-button" type="button" onClick={download} disabled={!updates.length || downloading}>{downloading ? "正在同步…" : "下载全部更新"}</button>
      </section>
      {message && <div className="state-message"><Icon name="fa-solid fa-circle-info" /> {message}</div>}
      <div className="update-list">
        {updates.map((item, index) => (
          <article className="update-row" key={item.id || item.code || index}>
            <span className="update-index">{String(index + 1).padStart(2, "0")}</span>
            <div><h3>{item.title}</h3><p>{item.code} · {item.version || "新版本"}</p></div>
            <span className="new-label">{item.action === "new" ? "新增" : "修订"}</span>
          </article>
        ))}
        {!loading && !updates.length && <div className="empty-update"><Icon name="fa-regular fa-circle-check" /><h3>无需更新</h3><p>本地法规库已经同步到最新状态。</p></div>}
      </div>
    </main>
  );
}

function UtilityModal({ type, onClose }) {
  const isSettings = type === "settings";
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section className="modal" onClick={(event) => event.stopPropagation()}>
        <button type="button" className="drawer-close" onClick={onClose} aria-label="关闭"><Icon name="fa-solid fa-xmark" /></button>
        <span className="eyebrow">{isSettings ? "SETTINGS" : "ABOUT"}</span>
        <h2>{isSettings ? "服务设置" : "关于本助手"}</h2>
        {isSettings ? <><label>当前后端 API 地址</label><div className="readonly-field">{API_BASE}</div><p>如需修改，请编辑前端目录中的 config.js，然后重新启动前端。</p></> : <p>土木工程智能规范助手 v0.1，采用 FastAPI、SQLite、StepFun 与 Pinecone，为工程人员提供法规检索和 RAG 智能问答能力。</p>}
      </section>
    </div>
  );
}

export function App() {
  const [active, setActive] = useState("chat");
  const [sources, setSources] = useState(sampleSources);
  const [ragStatus, setRagStatus] = useState(null);
  const [utility, setUtility] = useState(null);
  const [mobileNav, setMobileNav] = useState(false);

  useEffect(() => {
    apiRequest("/rag/status").then(setRagStatus).catch(() => setRagStatus({ vector_database: { ready: false } }));
  }, []);

  const content = useMemo(() => {
    if (active === "library") return <LibraryView />;
    if (active === "updates") return <UpdatesView />;
    return <ChatWorkspace onSourcesChange={setSources} />;
  }, [active]);

  const changeView = (view) => { setActive(view); setMobileNav(false); };

  return (
    <div className={`app-shell ${mobileNav ? "nav-open" : ""}`}>
      <Sidebar active={active} onChange={changeView} onUtility={setUtility} />
      {mobileNav && <button className="nav-scrim" type="button" aria-label="关闭导航" onClick={() => setMobileNav(false)} />}
      <Header ragStatus={ragStatus} onMenu={() => setMobileNav((value) => !value)} />
      <div className={`main-stage ${active !== "chat" ? "full" : ""}`}>
        {content}
        {active === "chat" && <SourcePanel sources={sources} />}
      </div>
      {utility && <UtilityModal type={utility} onClose={() => setUtility(null)} />}
    </div>
  );
}
