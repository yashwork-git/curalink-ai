import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import './App.css';

const API = 'https://curalink-ai-production.up.railway.app';

const SOURCE_META = {
  'PubMed':             { color: '#3b82f6', bg: 'rgba(59,130,246,0.12)' },
  'ClinicalTrials.gov': { color: '#10b981', bg: 'rgba(16,185,129,0.12)' },
  'OpenAlex':           { color: '#8b5cf6', bg: 'rgba(139,92,246,0.12)' },
};

const STATUS_META = {
  RECRUITING:         { color: '#10b981', bg: 'rgba(16,185,129,0.12)' },
  ACTIVE:             { color: '#3b82f6', bg: 'rgba(59,130,246,0.12)' },
  COMPLETED:          { color: '#6b7280', bg: 'rgba(107,114,128,0.12)' },
  TERMINATED:         { color: '#ef4444', bg: 'rgba(239,68,68,0.12)' },
  NOT_YET_RECRUITING: { color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
};

const STEPS = [
  { id: 1, label: 'Analyzing clinical query',    ms: 0    },
  { id: 2, label: 'AI expanding search terms',   ms: 900  },
  { id: 3, label: 'Fetching PubMed literature',  ms: 2200 },
  { id: 4, label: 'Scanning ClinicalTrials.gov', ms: 4000 },
  { id: 5, label: 'Querying OpenAlex network',   ms: 5800 },
  { id: 6, label: 'Synthesizing with llama3',    ms: 8500 },
];

const QUICK = [
  { label: 'Lung Cancer',   d: 'lung cancer',         q: 'Latest treatment breakthroughs for lung cancer'      },
  { label: 'Diabetes',      d: 'diabetes',            q: 'Clinical trials for type 2 diabetes management'      },
  { label: "Alzheimer's",   d: "Alzheimer's disease", q: "Top researchers in Alzheimer's neurodegeneration"    },
  { label: 'Heart Disease', d: 'heart disease',       q: 'Recent cardiovascular intervention studies'          },
  { label: "Parkinson's",   d: "Parkinson's disease", q: "Current Parkinson's disease clinical trials"         },
];

// ── STRUCTURED RESPONSE PARSER ────────────────────────────────────────────────

const SECTION_NAMES = ['CONDITION OVERVIEW', 'RESEARCH INSIGHTS', 'CLINICAL TRIALS', 'PERSONALIZED INSIGHT'];

const parseSections = (text) => {
  const sections = {};
  SECTION_NAMES.forEach((name, i) => {
    const next = SECTION_NAMES[i + 1];
    const re = new RegExp(
      `\\*\\*${name}\\*\\*([\\s\\S]*?)${next ? `(?=\\*\\*${next}\\*\\*)` : '$'}`, 'i'
    );
    const m = text.match(re);
    sections[name] = m ? m[1].trim() : '';
  });
  const hasAny = Object.values(sections).some(v => v.length > 0);
  return hasAny ? sections : null;
};

const SECTION_ICONS = {
  'CONDITION OVERVIEW':  { icon: '🩺', color: '#3b82f6' },
  'RESEARCH INSIGHTS':   { icon: '📄', color: '#8b5cf6' },
  'CLINICAL TRIALS':     { icon: '🔬', color: '#10b981' },
  'PERSONALIZED INSIGHT':{ icon: '💡', color: '#f59e0b' },
};

// ── COMPONENTS ────────────────────────────────────────────────────────────────

function StructuredResponse({ text }) {
  const sections = parseSections(text);
  if (!sections) {
    return (
      <div className="plain-response">
        {text.split('\n').filter(p => p.trim()).map((p, i) => <p key={i}>{p}</p>)}
      </div>
    );
  }
  return (
    <div className="structured-response">
      {SECTION_NAMES.map(name => {
        const content = sections[name];
        if (!content) return null;
        const meta = SECTION_ICONS[name];
        return (
          <div key={name} className="section-block">
            <div className="section-title" style={{ color: meta.color }}>
              <span>{meta.icon}</span>
              <span>{name}</span>
            </div>
            <div className="section-body">
              {content.split('\n').filter(l => l.trim()).map((line, i) => (
                <p key={i}>{line}</p>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ResearchCards({ research }) {
  const [filter, setFilter] = useState('All');
  const counts = research.reduce((a, r) => ({ ...a, [r.source]: (a[r.source] || 0) + 1 }), {});
  const filtered = filter === 'All' ? research : research.filter(r => r.source === filter);
  const srcMeta  = s => SOURCE_META[s] ?? SOURCE_META['PubMed'];
  const statMeta = s => STATUS_META[s] ?? { color: '#6b7280', bg: 'rgba(107,114,128,0.12)' };

  return (
    <div className="cards-section">
      <div className="filter-bar">
        <div className="tabs">
          {['All', 'PubMed', 'ClinicalTrials.gov', 'OpenAlex'].map(s => {
            const n = s === 'All' ? research.length : (counts[s] ?? 0);
            if (s !== 'All' && n === 0) return null;
            const meta   = SOURCE_META[s];
            const active = filter === s;
            return (
              <button
                key={s}
                className={`tab${active ? ' tab-active' : ''}`}
                onClick={() => setFilter(s)}
                style={active && meta ? { borderColor: meta.color, color: meta.color, background: meta.bg } : {}}
              >
                {s === 'All' ? 'All Sources' : s}
                <span className="tab-n">{n}</span>
              </button>
            );
          })}
        </div>
        <span className="results-n">{filtered.length} result{filtered.length !== 1 ? 's' : ''}</span>
      </div>

      <div className="cards">
        {filtered.map((r, i) => {
          const sm  = srcMeta(r.source);
          const stm = r.status ? statMeta(r.status) : null;
          return (
            <article key={i} className="card" style={{ borderLeftColor: sm.color, animationDelay: `${i * 55}ms` }}>
              <div className="card-tags">
                <span className="tag" style={{ color: sm.color, background: sm.bg }}>{r.source}</span>
                {stm && <span className="tag" style={{ color: stm.color, background: stm.bg }}>{r.status}</span>}
                {r.year && <span className="tag tag-yr">{r.year}</span>}
              </div>
              <h4 className="card-title">{r.title}</h4>
              {r.abstract && <p className="card-abstract">{r.abstract}</p>}
              {r.authors && (
                <p className="card-row"><span className="card-lbl">Researchers</span>{r.authors}</p>
              )}
              {r.eligibility && (
                <p className="card-row card-elig"><span className="card-lbl">Eligibility</span>{r.eligibility}</p>
              )}
              {r.contact && (
                <p className="card-row"><span className="card-lbl">Contact</span>{r.contact}</p>
              )}
              {r.location && <p className="card-loc">📍 {r.location}</p>}
              <a href={r.url} target="_blank" rel="noreferrer" className="card-link" style={{ color: sm.color }}>
                View Full Source →
              </a>
            </article>
          );
        })}
      </div>
    </div>
  );
}

function LoadingSteps({ step }) {
  return (
    <div className="loading-box fade-in">
      <p className="loading-title">Running Clinical Intelligence Pipeline</p>
      <div className="steps-list">
        {STEPS.map(s => {
          const state = s.id < step ? 'done' : s.id === step ? 'active' : 'idle';
          return (
            <div key={s.id} className={`step step-${state}`}>
              <span className="step-node">
                {state === 'done'   && '✓'}
                {state === 'active' && <span className="step-pulse" />}
              </span>
              <span className="step-lbl">{s.label}</span>
              {state === 'active' && <span className="step-spin" />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── MAIN APP ──────────────────────────────────────────────────────────────────

export default function App() {
  const [form, setForm]           = useState({ patientName: '', disease: '', intent: '', location: '' });
  const [sessionId, setSessionId] = useState(null);
  const [messages, setMessages]   = useState([]);   // { role, content, research, disease }
  const [input, setInput]         = useState('');
  const [loading, setLoading]     = useState(false);
  const [step, setStep]           = useState(0);
  const [history, setHistory]     = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  const [error, setError]         = useState('');
  const timers     = useRef([]);
  const bottomRef  = useRef(null);
  const inputRef   = useRef(null);

  const inChat = sessionId !== null;

  useEffect(() => { fetchHistory(); }, []);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const fetchHistory = async () => {
    try { const r = await axios.get(`${API}/history`); setHistory(r.data); } catch {}
  };

  const runSteps = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setStep(1);
    STEPS.slice(1).forEach(s => {
      timers.current.push(setTimeout(() => setStep(s.id), s.ms));
    });
  };

  const stopSteps = () => { timers.current.forEach(clearTimeout); timers.current = []; };

  const sendMessage = async (query, isFirst = false) => {
    if (!query.trim()) return;
    if (isFirst && !form.disease.trim()) { setError('Disease / Condition is required.'); return; }

    setError('');
    setInput('');
    setLoading(true);
    runSteps();

    setMessages(prev => [...prev, { role: 'user', content: query }]);

    try {
      const payload = isFirst
        ? { ...form, query, sessionId: null }
        : { query, sessionId };

      const { data } = await axios.post(`${API}/ask`, payload);
      stopSteps();

      setMessages(prev => [...prev, {
        role: 'assistant',
        content: data.summary,
        research: data.research,
        disease: data.disease
      }]);

      if (!sessionId) setSessionId(data.sessionId);
      fetchHistory();
    } catch {
      stopSteps();
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: 'Pipeline error — please ensure the backend and Ollama are running.',
        research: [],
        disease: form.disease
      }]);
    } finally {
      setLoading(false);
      setStep(0);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  };

  const handleInitialSearch = () => sendMessage(input, true);

  const handleFollowUp = () => sendMessage(input, false);

  const startNewSession = () => {
    setSessionId(null);
    setMessages([]);
    setInput('');
    setForm({ patientName: '', disease: '', intent: '', location: '' });
    setError('');
  };

  const fill = c => {
    setForm({ patientName: 'Dr. Demo', disease: c.d, intent: 'Treatment', location: 'Toronto, Canada' });
    setInput(c.q);
  };

  return (
    <div className="app">

      {/* ── HEADER ── */}
      <header className="hdr">
        <div className="hdr-inner">
          <div className="hdr-brand">
            <span className="hdr-icon">⚕</span>
            <div>
              <span className="hdr-name">CuraLink <em>AI</em></span>
              <span className="hdr-tagline">Clinical Intelligence Platform</span>
            </div>
          </div>
          <div className="hdr-right">
            <span className="pill pill-green"><span className="dot" />llama3 · Online</span>
            <span className="pill hide-sm">3 Live Sources</span>
            {inChat && (
              <button className="new-session-btn" onClick={startNewSession}>+ New Search</button>
            )}
            <button className="hdr-hist-btn" onClick={() => setShowHistory(v => !v)}>
              📋 History {history.length > 0 && <span className="hdr-badge">{history.length}</span>}
            </button>
          </div>
        </div>
      </header>

      {/* ── HISTORY DRAWER ── */}
      {showHistory && (
        <div className="history-drawer fade-in">
          <div className="history-hdr">
            <h3>Recent Searches</h3>
            <button className="close-btn" onClick={() => setShowHistory(false)}>✕</button>
          </div>
          {history.length === 0
            ? <p className="history-empty">No searches yet.</p>
            : (
              <div className="history-list">
                {history.map((h, i) => (
                  <div key={i} className="history-row" onClick={() => {
                    setInput(h.query);
                    setShowHistory(false);
                  }}>
                    <span className="history-q">{h.query}</span>
                    <span className="history-meta">
                      {h.disease && <span className="history-disease">{h.disease}</span>}
                      {new Date(h.timestamp).toLocaleDateString()}
                    </span>
                  </div>
                ))}
              </div>
            )
          }
        </div>
      )}

      <main className="main">

        {/* ── INITIAL SEARCH VIEW ── */}
        {!inChat && (
          <>
            <section className="search-panel fade-in">
              <p className="panel-sub">Precision Medical Research for Clinicians · 2026 Edition</p>

              <div className="chips">
                <span className="chips-hint">Quick search:</span>
                {QUICK.map((c, i) => (
                  <button key={i} className="chip" onClick={() => fill(c)}>{c.label}</button>
                ))}
              </div>

              <div className="input-grid">
                <div className="field">
                  <label>Patient Name <span className="opt">optional</span></label>
                  <input value={form.patientName} onChange={e => set('patientName', e.target.value)} placeholder="e.g. Dr. John Smith" />
                </div>
                <div className="field">
                  <label>Condition / Disease <span className="req">*</span></label>
                  <input
                    value={form.disease}
                    onChange={e => { set('disease', e.target.value); setError(''); }}
                    placeholder="e.g. Parkinson's Disease"
                    className={error && !form.disease ? 'input-err' : ''}
                  />
                </div>
                <div className="field">
                  <label>Clinical Intent <span className="opt">optional</span></label>
                  <select value={form.intent} onChange={e => set('intent', e.target.value)} className={form.intent ? '' : 'select-placeholder'}>
                    <option value="">Select intent…</option>
                    <option value="Treatment">Treatment Options</option>
                    <option value="Research">Latest Research</option>
                    <option value="Trials">Clinical Trials</option>
                    <option value="Researchers">Key Researchers</option>
                  </select>
                </div>
                <div className="field">
                  <label>Patient Location <span className="opt">optional</span></label>
                  <input value={form.location} onChange={e => set('location', e.target.value)} placeholder="e.g. Toronto, Canada" />
                </div>
              </div>

              <div className="field query-field">
                <label>Clinical Question <span className="req">*</span></label>
                <div className="query-wrap">
                  <input
                    ref={inputRef}
                    className={`query-input${error && !input ? ' input-err' : ''}`}
                    value={input}
                    onChange={e => { setInput(e.target.value); setError(''); }}
                    placeholder="Ask a natural language clinical question…"
                    onKeyDown={e => e.key === 'Enter' && !loading && handleInitialSearch()}
                  />
                  <button className="go-btn" onClick={handleInitialSearch} disabled={loading || !form.disease.trim() || !input.trim()}>
                    {loading ? <span className="btn-spin" /> : <span className="go-arrow">→</span>}
                  </button>
                </div>
              </div>

              {error && <p className="err-msg">⚠ {error}</p>}
            </section>

            {loading && <LoadingSteps step={step} />}

            {!loading && (
              <div className="empty fade-in">
                <div className="how-works">
                  {[
                    { icon: '💬', title: 'Enter Condition',    desc: 'Type any disease or medical condition'  },
                    { icon: '🤖', title: 'AI Expands Query',   desc: 'llama3 optimizes for precision search'  },
                    { icon: '📊', title: 'Triple-Source RAG',  desc: 'PubMed · ClinicalTrials · OpenAlex'     },
                    { icon: '🔬', title: 'AI Synthesized',     desc: 'Structured 4-section clinical summary'  },
                  ].map((s, i, arr) => (
                    <React.Fragment key={i}>
                      <div className="hw-step">
                        <div className="hw-icon">{s.icon}</div>
                        <div className="hw-title">{s.title}</div>
                        <div className="hw-desc">{s.desc}</div>
                      </div>
                      {i < arr.length - 1 && <span className="hw-arrow">→</span>}
                    </React.Fragment>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* ── CHAT VIEW ── */}
        {inChat && (
          <>
            {/* Context Bar */}
            <div className="context-bar fade-in">
              {form.patientName && <span className="ctx-pill">👤 {form.patientName}</span>}
              <span className="ctx-pill ctx-disease">🧬 {messages.find(m => m.disease)?.disease || form.disease}</span>
              {form.intent   && <span className="ctx-pill">🎯 {form.intent}</span>}
              {form.location && <span className="ctx-pill">📍 {form.location}</span>}
              <span className="ctx-pill ctx-model">⚡ llama3 · RAG</span>
            </div>

            {/* Messages */}
            <div className="chat-window">
              {messages.map((msg, i) => (
                <div key={i} className={`msg msg-${msg.role} fade-in`}>
                  {msg.role === 'user' ? (
                    <div className="msg-user-bubble">{msg.content}</div>
                  ) : (
                    <div className="msg-assistant">
                      <div className="msg-assistant-header">
                        <span className="msg-avatar">⚕</span>
                        <span className="msg-label">CuraLink AI</span>
                        {msg.research?.length > 0 && (
                          <span className="msg-source-count">{msg.research.length} sources</span>
                        )}
                      </div>
                      <StructuredResponse text={msg.content} />
                      {msg.research?.length > 0 && <ResearchCards research={msg.research} />}
                    </div>
                  )}
                </div>
              ))}

              {loading && <LoadingSteps step={step} />}
              <div ref={bottomRef} />
            </div>
          </>
        )}

      </main>

      {/* ── FOLLOW-UP INPUT BAR (sticky bottom in chat mode) ── */}
      {inChat && (
        <div className="followup-bar">
          <div className="followup-inner">
            <input
              ref={inputRef}
              className="followup-input"
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder="Ask a follow-up question…"
              onKeyDown={e => e.key === 'Enter' && !loading && handleFollowUp()}
              disabled={loading}
            />
            <button className="go-btn followup-go" onClick={handleFollowUp} disabled={loading || !input.trim()}>
              {loading ? <span className="btn-spin" /> : <span className="go-arrow">→</span>}
            </button>
          </div>
        </div>
      )}

      {!inChat && (
        <footer className="footer">
          <span>CuraLink AI · Clinical Intelligence Platform · 2026</span>
          <span className="footer-sources">PubMed · ClinicalTrials.gov · OpenAlex · llama3</span>
        </footer>
      )}
    </div>
  );
}
