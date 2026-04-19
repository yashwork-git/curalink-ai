import React, { useState } from 'react';
import axios from 'axios';
import './App.css';

function App() {
  const [patientName, setPatientName] = useState('');
  const [disease, setDisease] = useState('');
  const [intent, setIntent] = useState('');
  const [location, setLocation] = useState('');
  const [query, setQuery] = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

  // Demo Use Cases (Dual-Input Filling)
  const quickCases = [
    { label: "Lung Cancer", d: "lung cancer", q: "Latest treatment for lung cancer" },
    { label: "Diabetes", d: "diabetes", q: "Clinical trials for diabetes" },
    { label: "Alzheimer’s", d: "Alzheimer’s", q: "Top researchers in Alzheimer’s disease" },
    { label: "Heart Disease", d: "heart disease", q: "Recent studies on heart disease" }
  ];

  const fillSuggestion = (caseData) => {
    setDisease(caseData.d);
    setQuery(caseData.q);
    setPatientName("John Smith"); // Prefilled for demo flow
    setLocation("Toronto, Canada"); // Prefilled for demo flow
  };

  const handleSearch = async () => {
    if (!disease.trim() || !query.trim()) {
      alert("Please fill in the mandatory fields (*) to start the research.");
      return;
    }
    setLoading(true);
    setResult(null);

    try {
      const response = await axios.post('http://localhost:5000/ask', {
        name: patientName, disease, intent, location, query
      });
      setResult(response.data);
    } catch (error) {
      alert("System Busy: Re-trying connection...");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app-container">
      <div className="search-section">
        <h1 className="logo-text">CuraLink <span className="ai-accent">AI</span></h1>
        <p className="sub-header">Precision Medical Research Companion • 2026 Edition</p>
        
        {/* Suggestion Chips */}
        <div className="suggestions-bar">
          <span className="suggestion-hint">Quick Examples:</span>
          {quickCases.map((item, idx) => (
            <button key={idx} className="case-chip" onClick={() => fillSuggestion(item)}>
              {item.label}
            </button>
          ))}
        </div>

        <div className="input-grid">
          <div className="input-field">
            <label>Patient Name (optional)</label>
            <input placeholder="e.g. John Smith" value={patientName} onChange={(e) => setPatientName(e.target.value)} />
          </div>
          <div className="input-field">
            <label>Disease / Condition <span className="required">*</span></label>
            <input placeholder="e.g. Parkinson's" value={disease} onChange={(e) => setDisease(e.target.value)} />
          </div>
          <div className="input-field">
            <label>Intent (optional)</label>
            <input placeholder="e.g. Treatment" value={intent} onChange={(e) => setIntent(e.target.value)} />
          </div>
          <div className="input-field">
            <label>Location (optional)</label>
            <input placeholder="e.g. Toronto, Canada" value={location} onChange={(e) => setLocation(e.target.value)} />
          </div>
        </div>

        <div className="query-wrapper">
          <label className="query-label">Medical Question <span className="required">*</span></label>
          <input 
            className="main-query"
            value={query} 
            onChange={(e) => setQuery(e.target.value)} 
            placeholder="Ask a natural language medical question..."
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          />
        </div>

        <button className="execute-button" onClick={handleSearch} disabled={loading}>
          {loading ? 'Synthesizing Data...' : '🚀 Start Research Session'}
        </button>
      </div>

      {result && (
        <div className="fade-in result-area">
          <div className="summary-box">
            <h2>🔬 Research Synthesis</h2>
            <p>{result.summary}</p>
          </div>
          <div className="sources-grid">
            {result.research.map((res, i) => (
              <div className="source-card" key={i}>
                <div className="card-header">
                   <span className="source-tag">{res.source}</span>
                   {res.status && <span className="source-tag status">{res.status}</span>}
                </div>
                <h4>{res.title}</h4>
                {res.authors && <p className="meta-text"><strong>Researchers:</strong> {res.authors}</p>}
                {res.eligibility && <p className="meta-text secondary"><strong>Eligibility:</strong> {res.eligibility}</p>}
                {res.location && <p className="loc-text">📍 {res.location}</p>}
                <a href={res.url} target="_blank" rel="noreferrer" className="view-link">View Full Manuscript →</a>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;