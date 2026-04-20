const axios = require('axios');
require('dotenv').config();

const GROQ_URL   = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_KEY   = process.env.GROQ_API_KEY;
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.1-8b-instant';

const callLLM = async (prompt, timeout = 30000) => {
  const res = await axios.post(
    GROQ_URL,
    { model: GROQ_MODEL, messages: [{ role: 'user', content: prompt }], temperature: 0.3 },
    { headers: { Authorization: `Bearer ${GROQ_KEY}`, 'Content-Type': 'application/json' }, timeout }
  );
  return res.data.choices[0]?.message?.content?.trim() || '';
};

// ── RANKING ───────────────────────────────────────────────────────────────────

const scoreResult = (result, queryTerms) => {
  const text = `${result.title} ${result.abstract || ''}`.toLowerCase();
  const matches = queryTerms.filter(t => t.length > 2 && text.includes(t.toLowerCase())).length;
  const relevance = queryTerms.length > 0 ? matches / queryTerms.length : 0;

  const year = parseInt(result.year) || 2018;
  const recency = year >= 2024 ? 1.0 : year >= 2022 ? 0.8 : year >= 2020 ? 0.6 : year >= 2018 ? 0.4 : 0.2;

  const credibility = { PubMed: 1.0, 'ClinicalTrials.gov': 0.9, OpenAlex: 0.8 };
  const cred = credibility[result.source] || 0.7;

  return relevance * 0.5 + recency * 0.3 + cred * 0.2;
};

// ── XML PARSING HELPERS ───────────────────────────────────────────────────────

const getXmlField = (xml, tag) => {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const m = xml.match(re);
  return m ? m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : '';
};

const getXmlAuthors = (xml) => {
  const authors = [];
  const re = /<Author[^>]*>([\s\S]*?)<\/Author>/gi;
  let m;
  while ((m = re.exec(xml)) !== null && authors.length < 4) {
    const ln = getXmlField(m[1], 'LastName');
    const fn = getXmlField(m[1], 'ForeName');
    if (ln) authors.push(`${fn} ${ln}`.trim());
  }
  return authors.join(', ');
};

// ── OPENALEX ABSTRACT RECONSTRUCTION ─────────────────────────────────────────

const reconstructAbstract = (invertedIndex) => {
  if (!invertedIndex || typeof invertedIndex !== 'object') return '';
  const words = {};
  Object.entries(invertedIndex).forEach(([word, positions]) => {
    positions.forEach(pos => { words[pos] = word; });
  });
  return Object.keys(words)
    .sort((a, b) => Number(a) - Number(b))
    .map(k => words[k])
    .join(' ')
    .slice(0, 500);
};

// ── 1. QUERY EXPANSION ────────────────────────────────────────────────────────

const expandMedicalQuery = async (disease, query) => {
  try {
    const raw = await callLLM(
      `You are a medical search expert. Combine this disease and query into a precise 4-6 word PubMed search string.\nDisease: ${disease}\nQuery: ${query}\nReturn ONLY the search string. No explanation. No quotes.`
    );
    const lines = raw.replace(/"/g, '').split('\n').map(l => l.trim()).filter(l => l.length > 3);
    const expanded = lines[lines.length - 1] || '';
    return expanded.length > 4 ? expanded : `${query} ${disease}`;
  } catch {
    return `${query} ${disease}`;
  }
};

// ── 2. PUBMED DEEP FETCH ──────────────────────────────────────────────────────

const fetchPubMedDeep = async (expandedQuery, disease) => {
  try {
    // Step 1: Fetch up to 80 IDs sorted by date
    let ids = [];
    const searchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${encodeURIComponent(expandedQuery)}&retmax=80&sort=pub+date&retmode=json`;
    const searchRes = await axios.get(searchUrl, { timeout: 12000 });
    ids = searchRes.data.esearchresult?.idlist || [];

    if (ids.length < 5) {
      const fallbackUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${encodeURIComponent(disease)}&retmax=80&sort=pub+date&retmode=json`;
      const fallbackRes = await axios.get(fallbackUrl, { timeout: 12000 });
      ids = fallbackRes.data.esearchresult?.idlist || [];
    }

    if (ids.length === 0) return [];

    // Step 2: Fetch full details (XML with abstracts) for top 25
    const fetchIds = ids.slice(0, 25).join(',');
    const fetchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=${fetchIds}&retmode=xml&rettype=abstract`;
    const fetchRes = await axios.get(fetchUrl, { timeout: 18000 });
    const xml = fetchRes.data;

    // Step 3: Parse each article
    const articleRe = /<PubmedArticle>([\s\S]*?)<\/PubmedArticle>/gi;
    const results = [];
    let match;

    while ((match = articleRe.exec(xml)) !== null) {
      const art = match[1];
      const pmid  = getXmlField(art, 'PMID');
      const title = getXmlField(art, 'ArticleTitle');
      if (!title) continue;

      const abstractRaw = getXmlField(art, 'AbstractText') || getXmlField(art, 'Abstract');
      const abstract = abstractRaw.slice(0, 450);
      const authors  = getXmlAuthors(art);
      const year     = getXmlField(art, 'Year') || getXmlField(art, 'MedlineDate').slice(0, 4) || '2024';

      results.push({ title, abstract, authors, year, url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`, source: 'PubMed' });
    }

    return results;
  } catch (e) {
    console.error('PubMed error:', e.message);
    return [];
  }
};

// ── 3. CLINICAL TRIALS DEEP FETCH ────────────────────────────────────────────

const fetchClinicalTrialsDeep = async (disease, query) => {
  try {
    const url = `https://clinicaltrials.gov/api/v2/studies?query.cond=${encodeURIComponent(disease)}&query.term=${encodeURIComponent(query)}&pageSize=50&format=json`;
    const res = await axios.get(url, { timeout: 12000 });
    if (!res.data.studies) return [];

    return res.data.studies.map(study => {
      const p        = study.protocolSection;
      const idMod    = p.identificationModule   || {};
      const statusMod= p.statusModule           || {};
      const eligMod  = p.eligibilityModule      || {};
      const descMod  = p.descriptionModule      || {};
      const clMod    = p.contactsLocationsModule|| {};

      const contact  = clMod.centralContacts?.[0];
      const location = clMod.locations?.[0];

      return {
        title:       idMod.officialTitle || idMod.briefTitle || 'Clinical Trial',
        abstract:    descMod.briefSummary?.slice(0, 450) || '',
        status:      statusMod.overallStatus || 'UNKNOWN',
        eligibility: eligMod.eligibilityCriteria?.slice(0, 250) + '…' || '',
        location:    location?.facility || location?.city || 'Global',
        contact:     contact
          ? [contact.name, contact.email || contact.phone].filter(Boolean).join(' · ')
          : '',
        year:        (statusMod.startDateStruct?.date || '2024').slice(0, 4),
        url:         `https://clinicaltrials.gov/study/${idMod.nctId}`,
        source:      'ClinicalTrials.gov'
      };
    });
  } catch (e) {
    console.error('ClinicalTrials error:', e.message);
    return [];
  }
};

// ── 4. OPENALEX DEEP FETCH ────────────────────────────────────────────────────

const fetchOpenAlexDeep = async (disease, expandedQuery) => {
  try {
    const q   = encodeURIComponent(`${expandedQuery} ${disease}`);
    const url = `https://api.openalex.org/works?search=${q}&per-page=80&sort=relevance_score:desc&filter=from_publication_date:2018-01-01`;
    const res = await axios.get(url, { timeout: 12000 });

    return (res.data.results || []).map(work => ({
      title:    work.title || 'Untitled',
      abstract: reconstructAbstract(work.abstract_inverted_index),
      authors:  work.authorships?.slice(0, 3).map(a => a.author?.display_name).filter(Boolean).join(', ') || '',
      year:     work.publication_year?.toString() || '2024',
      url:      work.doi ? `https://doi.org/${work.doi.replace('https://doi.org/', '')}` : (work.id || '#'),
      source:   'OpenAlex'
    }));
  } catch (e) {
    console.error('OpenAlex error:', e.message);
    return [];
  }
};

// ── 5. RANKING PIPELINE ───────────────────────────────────────────────────────

const rankAndFilter = (allResults, queryTerms, topN = 8) => {
  const seen  = new Set();
  const valid = allResults
    .filter(r => {
      if (!r.title || r.title.length < 5) return false;
      const key = r.title.toLowerCase().slice(0, 60);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map(r => ({ ...r, _score: scoreResult(r, queryTerms) }))
    .sort((a, b) => b._score - a._score);

  // Source diversity: max 3 per source
  const counts  = {};
  const diverse = [];
  for (const item of valid) {
    const s = item.source;
    counts[s] = (counts[s] || 0) + 1;
    if (counts[s] <= 3) diverse.push(item);
    if (diverse.length >= topN) break;
  }

  return diverse.map(({ _score, ...r }) => r);
};

// ── 6. AI SYNTHESIS ───────────────────────────────────────────────────────────

const generateResearchSummary = async (disease, query, rankedResults, conversationHistory = []) => {
  try {
    const sources = rankedResults.map((r, i) =>
      `[${i + 1}] ${r.title} (${r.source}, ${r.year})${r.abstract ? '\nAbstract: ' + r.abstract : ''}`
    ).join('\n\n');

    const historyCtx = conversationHistory.length > 0
      ? `\nConversation so far:\n${conversationHistory.map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content.slice(0, 300)}`).join('\n')}\n`
      : '';

    const prompt = `You are CuraLink AI, a clinical research assistant for medical professionals.
Patient Disease: ${disease}
Current Question: ${query}
${historyCtx}
Research Sources:
${sources}

Respond with EXACTLY these four sections. Use **SECTION NAME** as the header for each.

**CONDITION OVERVIEW**
2-3 sentences of clinical context for ${disease} relevant to this question.

**RESEARCH INSIGHTS**
3-4 specific findings from the sources above. Cite as [1], [2], etc. Be precise.

**CLINICAL TRIALS**
Summarize the most relevant trial(s): what they test, their status, key eligibility points.

**PERSONALIZED INSIGHT**
A direct, research-backed answer to: "${query}" — use patient disease context. No generic statements.

Rules: Only reference the provided sources. Do not hallucinate data. Be concise and clinical.`;

    return await callLLM(prompt, 60000);
  } catch {
    return 'AI synthesis unavailable. Please review the research cards below for relevant findings.';
  }
};

module.exports = {
  expandMedicalQuery,
  fetchPubMedDeep,
  fetchClinicalTrialsDeep,
  fetchOpenAlexDeep,
  rankAndFilter,
  generateResearchSummary
};
