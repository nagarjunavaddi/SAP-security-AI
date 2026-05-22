require('dotenv').config();
const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());
app.use(express.static('.'));

const mockSAPData = {
  sodViolations: [
    { user: 'USER001', conflict: 'FB60 + F110', risk: 'CRITICAL', description: 'Invoice to Payment' },
    { user: 'USER002', conflict: 'ME21N + MIRO', risk: 'HIGH', description: 'Procure to Pay' },
    { user: 'USER003', conflict: 'SU01 + PFCG', risk: 'CRITICAL', description: 'User and Role Admin' }
  ],
  lockedUsers: [
    { user: 'JOHN001', reason: 'Wrong password', lockedDate: '2026-05-20' },
    { user: 'SAP_TEST', reason: 'Admin locked', lockedDate: '2026-05-19' }
  ],
  sapAllUsers: [
    { user: 'ADMIN001', profile: 'SAP_ALL', assignedDate: '2025-01-15' },
    { user: 'BASIS001', profile: 'SAP_ALL', assignedDate: '2025-03-20' }
  ]
};

app.get('/api/sap-data', (req, res) => {
  res.json(mockSAPData);
});

app.post('/api/chat', async (req, res) => {
  const { question } = req.body;

  try {
    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        contents: [{
          parts: [{
            text: `You are an SAP Security expert. Answer based on this data:
SoD Violations: ${JSON.stringify(mockSAPData.sodViolations)}
Locked Users: ${JSON.stringify(mockSAPData.lockedUsers)}
SAP_ALL Users: ${JSON.stringify(mockSAPData.sapAllUsers)}
Question: ${question}`
          }]
        }]
      },
      { timeout: 30000 }
    );

    console.log('Gemini response:', JSON.stringify(response.data));
    const text = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
    res.json({ answer: text || 'No answer received' });

  } catch (error) {
    console.log('Error:', error.response?.data || error.message);
    res.status(500).json({ answer: 'Error: ' + (error.response?.data?.error?.message || error.message) });
  }
});

app.listen(3000, () => console.log('Running on http://localhost:3000'));