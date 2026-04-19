const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
require('dotenv').config();

const { 
    expandMedicalQuery, fetchPubMedData, fetchClinicalTrials, fetchOpenAlexData, generateResearchSummary 
} = require('./services');

const app = express();
app.use(cors());
app.use(express.json());

// MongoDB Integration (Mandatory MERN Component)
mongoose.connect('mongodb://localhost:27017/curalink')
    .then(() => console.log("📦 MongoDB Connected Successfully"))
    .catch(err => console.log("DB Connection Error:", err));

const Search = mongoose.model('Search', new mongoose.Schema({
    patientName: String, 
    query: String, 
    summary: String, 
    timestamp: { type: Date, default: Date.now }
}));

// The Core Research Pipeline
app.post('/ask', async (req, res) => {
    const { name, disease, query } = req.body;
    console.log(`\n🚀 Executing Demo Pipeline for: ${query}`);

    try {
        // Step A: Expand Query for PubMed
        const expandedQuery = await expandMedicalQuery({ disease, query });
        
        // Step B: Triple-Stream Fetch (Simultaneous)
        const [papers, trials, alex] = await Promise.all([
            fetchPubMedData(expandedQuery, disease), 
            fetchClinicalTrials(disease), 
            fetchOpenAlexData(disease)
        ]);

        console.log(`📊 Pipeline Stats: PubMed(${papers.length}), Trials(${trials.length}), Alex(${alex.length})`);

        // Step C: Balanced Mix (Forces diversity in the UI)
        const topResearch = [
            ...papers.slice(0, 3),   // Priority 1: Peer-reviewed papers
            ...trials.slice(0, 3),   // Priority 2: Clinical trials
            ...alex.slice(0, 2)      // Priority 3: Global works/researchers
        ];

        // Step D: AI synthesis
        const summary = await generateResearchSummary(query, topResearch);

        // Step E: Persist to Database
        await Search.create({ patientName: name, query, summary }).catch(() => {});

        res.json({ summary, research: topResearch });

    } catch (error) {
        console.error("❌ Pipeline Error:", error.message);
        res.status(500).json({ error: "System Busy" });
    }
});

const PORT = 5000;
app.listen(PORT, () => console.log(`✅ CuraLink Server running on http://localhost:${PORT}`));