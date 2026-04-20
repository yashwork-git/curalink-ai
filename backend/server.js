const express  = require('express');
const cors     = require('cors');
const mongoose = require('mongoose');
require('dotenv').config();

const {
  expandMedicalQuery,
  fetchPubMedDeep,
  fetchClinicalTrialsDeep,
  fetchOpenAlexDeep,
  rankAndFilter,
  generateResearchSummary
} = require('./services');

const app = express();
app.use(cors());
app.use(express.json());

mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/curalink')
  .then(() => console.log('📦 MongoDB Connected'))
  .catch(err => console.error('DB Error:', err));

// ── MODELS ────────────────────────────────────────────────────────────────────

const messageSchema = new mongoose.Schema({
  role:    { type: String, enum: ['user', 'assistant'] },
  content: String,
  timestamp: { type: Date, default: Date.now }
});

const Session = mongoose.model('Session', new mongoose.Schema({
  sessionId:   { type: String, unique: true, index: true },
  disease:     String,
  patientName: String,
  intent:      String,
  location:    String,
  messages:    [messageSchema],
  createdAt:   { type: Date, default: Date.now }
}));

const Search = mongoose.model('Search', new mongoose.Schema({
  patientName: String,
  disease:     String,
  query:       String,
  summary:     String,
  timestamp:   { type: Date, default: Date.now }
}));

const genId = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

// ── PIPELINE ──────────────────────────────────────────────────────────────────

app.post('/ask', async (req, res) => {
  const { name, disease: bodyDisease, intent, location, query, sessionId: clientId } = req.body;

  if (!query?.trim()) return res.status(400).json({ error: 'Query is required.' });

  // Load or create session
  let session = clientId
    ? await Session.findOne({ sessionId: clientId }).catch(() => null)
    : null;

  const disease     = bodyDisease?.trim() || session?.disease || '';
  const patientName = name?.trim()        || session?.patientName || '';

  if (!disease) return res.status(400).json({ error: 'Disease is required.' });

  if (!session) {
    session = new Session({ sessionId: genId(), disease, patientName, intent, location, messages: [] });
  }

  // Conversation history for LLM context (last 3 exchanges = 6 messages)
  const historyForLLM = session.messages.slice(-6);

  // Add user message
  session.messages.push({ role: 'user', content: query });

  console.log(`\n🚀 Pipeline | disease: ${disease} | query: ${query} | session: ${session.sessionId}`);

  try {
    // Step A: AI query expansion
    const expandedQuery = await expandMedicalQuery(disease, query);
    const queryTerms    = expandedQuery.split(/\s+/);
    console.log(`🔍 Expanded: "${expandedQuery}"`);

    // Step B: Triple-stream deep fetch (parallel)
    const [papers, trials, alexPapers] = await Promise.all([
      fetchPubMedDeep(expandedQuery, disease),
      fetchClinicalTrialsDeep(disease, query),
      fetchOpenAlexDeep(disease, expandedQuery)
    ]);

    console.log(`📊 Candidates — PubMed: ${papers.length}, Trials: ${trials.length}, OpenAlex: ${alexPapers.length}`);

    // Step C: Rank and filter to top 8
    const topResearch = rankAndFilter([...papers, ...trials, ...alexPapers], queryTerms, 8);
    console.log(`🏆 Top results: ${topResearch.length}`);

    // Step D: Structured AI synthesis with conversation context
    const summary = await generateResearchSummary(disease, query, topResearch, historyForLLM);

    // Step E: Persist
    session.messages.push({ role: 'assistant', content: summary });
    await session.save();
    await Search.create({ patientName, disease, query, summary }).catch(() => {});

    res.json({ summary, research: topResearch, sessionId: session.sessionId, disease });

  } catch (err) {
    console.error('❌ Pipeline error:', err.message);
    res.status(500).json({ error: 'Pipeline error. Check backend logs.' });
  }
});

// ── SESSION HISTORY ───────────────────────────────────────────────────────────

app.get('/session/:id', async (req, res) => {
  try {
    const session = await Session.findOne({ sessionId: req.params.id });
    if (!session) return res.status(404).json({ error: 'Session not found.' });
    res.json(session);
  } catch { res.status(500).json({ error: 'Could not load session.' }); }
});

app.get('/history', async (req, res) => {
  try {
    const searches = await Search.find({}, 'patientName disease query timestamp')
      .sort({ timestamp: -1 }).limit(10);
    res.json(searches);
  } catch { res.json([]); }
});

// ── START ─────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`✅ CuraLink running on http://localhost:${PORT}`));
